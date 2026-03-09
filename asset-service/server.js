import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.ASSET_SERVICE_PORT || 8100);
const HOST = process.env.ASSET_SERVICE_HOST || '0.0.0.0';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 256 * 1024 * 1024
  }
});

const app = express();

const sanitizeFilename = (value, fallback) => {
  const cleaned = String(value || fallback || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
};

const decodeImageBuffer = async (buffer) => {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    width: info.width,
    height: info.height,
    data
  };
};

const toDataUrl = (buffer, mimeType) => `data:${mimeType};base64,${buffer.toString('base64')}`;

const jsonField = (rawValue, fieldName) => {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    throw new Error(`${fieldName} is required.`);
  }

  try {
    return JSON.parse(rawValue);
  } catch {
    throw new Error(`${fieldName} must be valid JSON.`);
  }
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const mapTextureQualityToGltfpack = (quality) => String(clamp(Math.round(quality / 10), 1, 10));

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code}.`));
    });
  });

app.get('/healthz', (_req, res) => {
  res.json({
    status: 'ok'
  });
});

app.post('/optimize-texture', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'image is required.' });
      return;
    }

    const source = jsonField(req.body.source, 'source');
    const options = jsonField(req.body.options, 'options');
    const resizePercent = clamp(Number(options.resizePercent || 100), 10, 100);
    const quality = clamp(Number(options.quality || 82), 1, 100);
    const width = Math.max(1, Math.round(Number(source.width || 1) * (resizePercent / 100)));
    const height = Math.max(1, Math.round(Number(source.height || 1) * (resizePercent / 100)));
    const pipeline = sharp(req.file.buffer).rotate().resize({
      width,
      height,
      fit: 'fill'
    });

    let outputBuffer;
    let outputMimeType = 'image/png';
    let outputExtension = 'png';
    let previewBuffer;

    if (options.format === 'jpeg') {
      outputBuffer = await pipeline.clone().jpeg({
        quality,
        mozjpeg: true
      }).toBuffer();
      outputMimeType = 'image/jpeg';
      outputExtension = 'jpg';
      previewBuffer = outputBuffer;
    } else if (options.format === 'webp') {
      outputBuffer = await pipeline.clone().webp({
        quality,
        alphaQuality: quality,
        effort: 5
      }).toBuffer();
      outputMimeType = 'image/webp';
      outputExtension = 'webp';
      previewBuffer = outputBuffer;
    } else if (options.format === 'ktx2') {
      previewBuffer = await pipeline.clone().png().toBuffer();
      outputBuffer = await encodeToKTX2(new Uint8Array(previewBuffer), {
        isKTX2File: true,
        isUASTC: options.ktx2Mode === 'uastc',
        enableRDO: options.ktx2Mode === 'uastc',
        needSupercompression: options.ktx2Mode === 'uastc',
        isNormalMap: source.slot === 'normal',
        isPerceptual: source.colorSpace === 'srgb',
        isSetKTX2SRGBTransferFunc: source.colorSpace === 'srgb',
        qualityLevel: clamp(Math.round((quality / 100) * 255), 1, 255),
        uastcLDRQualityLevel: clamp(Math.round((quality / 100) * 4), 0, 4),
        generateMipmap: true,
        imageDecoder: decodeImageBuffer
      });
      outputMimeType = 'image/ktx2';
      outputExtension = 'ktx2';
    } else {
      outputBuffer = await pipeline.clone().png({
        compressionLevel: clamp(Math.round((100 - quality) / 12), 0, 9)
      }).toBuffer();
      outputMimeType = 'image/png';
      outputExtension = 'png';
      previewBuffer = outputBuffer;
    }

    const appliedPreviewBuffer = previewBuffer || await sharp(outputBuffer).png().toBuffer();
    const safeBaseName = sanitizeFilename(source.name, 'optimized-texture');
    res.json({
      format: options.format,
      delivery: options.format === 'ktx2' ? 'downloadOnly' : 'inline',
      previewDataUrl: toDataUrl(appliedPreviewBuffer, 'image/png'),
      appliedDataUrl: toDataUrl(appliedPreviewBuffer, 'image/png'),
      outputBase64: Buffer.from(outputBuffer).toString('base64'),
      outputMimeType,
      outputFilename: `${safeBaseName}.${outputExtension}`,
      outputBytes: outputBuffer.length,
      width,
      height
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Texture optimization failed.'
    });
  }
});

app.post('/optimize-model', upload.single('model'), async (req, res) => {
  let tempDir = null;

  try {
    if (!req.file) {
      res.status(400).json({ error: 'model is required.' });
      return;
    }

    const options = jsonField(req.body.options, 'options');
    const safeBaseName = sanitizeFilename(req.file.originalname, 'optimized-scene');
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'texture-enhancer-asset-'));
    const inputPath = path.join(tempDir, `input-${safeBaseName}.glb`);
    const outputPath = path.join(tempDir, `output-${safeBaseName}.${options.outputFormat === 'gltf' ? 'gltf' : 'glb'}`);
    await writeFile(inputPath, req.file.buffer);

    const gltfpackBinary = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'gltfpack.cmd' : 'gltfpack');
    const args = [
      '-i', inputPath,
      '-o', outputPath,
      '-c'
    ];

    if (options.presetId === 'smallest') {
      args.push('-cc');
    }

    if (options.textureMode === 'webp') {
      args.push('-tw');
    } else if (options.textureMode === 'ktx2') {
      args.push('-tc');
      if (options.presetId === 'preserveQuality' || Number(options.textureQuality) >= 85) {
        args.push('-tu');
      }
    }

    if (Number(options.textureQuality) > 0) {
      args.push('-tq', mapTextureQualityToGltfpack(Number(options.textureQuality)));
    }

    if (Number(options.textureScalePercent) > 0 && Number(options.textureScalePercent) < 100) {
      args.push('-ts', String(Number(options.textureScalePercent) / 100));
    }

    if (Number(options.maxTextureSize) > 0) {
      args.push('-tl', String(Number(options.maxTextureSize)));
    }

    await runCommand(gltfpackBinary, args, { cwd: tempDir });
    const outputBuffer = await readFile(outputPath);
    const outputExtension = options.outputFormat === 'gltf' ? 'gltf' : 'glb';
    const outputMimeType = options.outputFormat === 'gltf' ? 'model/gltf+json' : 'model/gltf-binary';

    res.setHeader('content-type', outputMimeType);
    res.setHeader('content-disposition', `attachment; filename="${safeBaseName}.${outputExtension}"`);
    res.send(outputBuffer);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Model optimization failed.'
    });
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Asset service listening on http://${HOST}:${PORT}`);
});
