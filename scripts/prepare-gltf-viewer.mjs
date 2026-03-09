import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = process.cwd();
const viewerDistDir = path.join(
  workspaceRoot,
  'node_modules',
  '@khronosgroup',
  'gltf-viewer',
  'dist'
);
const viewerLibsDir = path.join(viewerDistDir, 'libs');
const publicLibsDir = path.join(workspaceRoot, 'public', 'gltf-viewer-libs');
const localDracoDecoderPath = path.join(
  workspaceRoot,
  'node_modules',
  'three',
  'examples',
  'jsm',
  'libs',
  'draco',
  'gltf',
  'draco_decoder.js'
);

const copyIfPresent = async (sourcePath, targetPath) => {
  try {
    await access(sourcePath);
  } catch {
    return false;
  }

  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
  return true;
};

const patchViewerBundle = async (bundlePath) => {
  try {
    let original = await readFile(bundlePath, 'utf8');
    const targetSnippet = `        if (this.attributes.TANGENT === undefined && this.attributes.NORMAL && this.attributes.TEXCOORD_0 && this.mode > 3)
        {
            console.info("Generating tangents using the MikkTSpace algorithm.");
            console.time("Tangent generation");
            this.unweld(gltf);
            this.generateTangents(gltf);
            console.timeEnd("Tangent generation");
        }`;
    const patchedSnippet = `        if (this.attributes.TANGENT === undefined && this.attributes.NORMAL && this.attributes.TEXCOORD_0 && this.mode > 3)
        {
            try
            {
                this.unweld(gltf);
                this.generateTangents(gltf);
            }
            catch (error)
            {
                console.warn("Skipping tangent generation due to incompatible geometry.", error);
            }
        }`;
    const cubemapInitSnippet = `        for(let i = 0; i < 6; ++i)
        {
            this.gl.texImage2D(
                this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
                0,
                this.internalFormat(),
                this.textureSize,
                this.textureSize,
                0,
                this.gl.RGBA,
                this.textureTargetType(),
                null
            );
        }`;
    const cubemapPatchedSnippet = `        const initialCubeFaceData = this.textureTargetType() === this.gl.FLOAT
            ? new Float32Array(this.textureSize * this.textureSize * 4)
            : new Uint8Array(this.textureSize * this.textureSize * 4);
        for(let i = 0; i < 6; ++i)
        {
            this.gl.texImage2D(
                this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + i,
                0,
                this.internalFormat(),
                this.textureSize,
                this.textureSize,
                0,
                this.gl.RGBA,
                this.textureTargetType(),
                initialCubeFaceData
            );
        }`;

    if (original.includes(targetSnippet) && !original.includes('Skipping tangent generation due to incompatible geometry.')) {
      original = original.replace(targetSnippet, patchedSnippet);
    }

    original = original.replace(/^\s*console\.info\("Generating tangents using the MikkTSpace algorithm\."\);\r?\n/gm, '');

    if (original.includes(cubemapInitSnippet) && !original.includes('initialCubeFaceData')) {
      original = original.replace(cubemapInitSnippet, cubemapPatchedSnippet);
    }

    original = original.replaceAll(
      'assets/images/lut_sheen_E.png',
      'https://github.khronos.org/glTF-Sample-Viewer-Release/assets/images/lut_sheen_E.png'
    );

    await writeFile(bundlePath, original, 'utf8');
  } catch {
    // Ignore patch failures if the package layout changes.
  }
};

const main = async () => {
  const wasmFiles = ['mikktspace_bg.wasm', 'libktx.wasm'];
  const jsFiles = ['libktx.js'];

  for (const fileName of wasmFiles) {
    const sourcePath = path.join(viewerLibsDir, fileName);

    if (fileName === 'mikktspace_bg.wasm') {
      await copyIfPresent(sourcePath, path.join(viewerDistDir, fileName));
    }

    await copyIfPresent(sourcePath, path.join(publicLibsDir, fileName));
  }

  for (const fileName of jsFiles) {
    const sourcePath = path.join(viewerLibsDir, fileName);
    await copyIfPresent(sourcePath, path.join(publicLibsDir, fileName));
  }

  await copyIfPresent(
    localDracoDecoderPath,
    path.join(publicLibsDir, 'draco_decoder_gltf.js')
  );

  await patchViewerBundle(path.join(viewerDistDir, 'gltf-viewer.module.js'));
  await patchViewerBundle(path.join(viewerDistDir, 'gltf-viewer.js'));
};

main().catch((error) => {
  console.error('[prepare-gltf-viewer] Failed to prepare viewer assets:', error);
  process.exitCode = 1;
});
