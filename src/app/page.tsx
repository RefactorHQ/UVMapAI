'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';

import Toolbar, { Tool } from '@/components/Toolbar';
import PromptPanel from '@/components/PromptPanel';
import ComparisonPanel from '@/components/ComparisonPanel';

import TextureOptimizePanel from '@/components/TextureOptimizePanel';
import styles from './page.module.css';
import { ImagePlus, Loader2, Crosshair, MessageSquare } from 'lucide-react';
import { useHistory } from '@/hooks/useHistory';
import {
  listRecentModelProjects,
  loadRecentModelProject,
  saveRecentModelProject,
  type PersistedOverlayNode,
  type PersistedSceneState,
  type PersistedTextureState,
  type SaveRecentProjectResult
} from '@/utils/recentProjects';
import {
  applyMagicWandClick,
  getFullImageRect,
  type MagicWandPoint as SamPoint,
  type MagicWandRect as Rect
} from '@/utils/magicWand';
import type { RecentProjectMeta } from '@/utils/recentProjects';
import type { ExtractedTexture } from '@/types/model';
import type {
  TextureOptimizationOptions,
  TextureOptimizationResult,
  TextureOptimizationSourceMeta
} from '@/types/optimization';

// Use a type-only import for the types we need
import type { OverlayNode, ViewportRef } from '@/components/Viewport';


interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  fullPath: string;
  file?: (callback: (file: File) => void) => void;
  createReader?: () => {
    readEntries: (callback: (entries: FileSystemEntryLike[]) => void) => void;
  };
}

type PendingRecentProject =
  | { kind: 'file'; file: File; displayName?: string }
  | { kind: 'gltf-bundle'; entryFile: File; files: File[]; displayName: string };

type FileWithRelativePath = File & {
  webkitRelativePath?: string;
};

type TextureSnapshot = {
  slotKey: string;
  slot: ExtractedTexture['slot'];
  slotLabel: string;
  previewMode: ExtractedTexture['previewMode'];
  channelPacking: ExtractedTexture['channelPacking'];
  colorSpace: ExtractedTexture['colorSpace'];
  supportsVideo: boolean;
  materialIndex: number;
  materialName: string;
  textureIndex: number;
  sourceIndex: number;
  texCoord?: number;
  base64: string;
  width: number;
  height: number;
  sourceKind?: 'image' | 'video';
  videoFile?: File | null;
};

const MODEL_FILE_REGEX = /\.(glb|gltf)$/i;
const ZIP_FILE_REGEX = /\.zip$/i;
const IMAGE_FILE_REGEX = /\.(png|jpe?g|webp)$/i;
const MAX_NESTED_ZIP_DEPTH = 4;

const isModelFile = (file: File) => MODEL_FILE_REGEX.test(file.name);

const isZipFile = (file: File) => ZIP_FILE_REGEX.test(file.name);

const isImageFile = (file: File) => file.type.startsWith('image/') || IMAGE_FILE_REGEX.test(file.name);

const getRelativePath = (file: File) => (((file as FileWithRelativePath).webkitRelativePath) || file.name).replace(/\\/g, '/');

const normalizeArchivePath = (path: string) => path.replace(/\\/g, '/').replace(/^\/+/, '');

const joinArchivePath = (basePath: string, childPath: string) => {
  const normalizedBase = normalizeArchivePath(basePath).replace(/\/+$/, '');
  const normalizedChild = normalizeArchivePath(childPath);
  return normalizedBase ? `${normalizedBase}/${normalizedChild}` : normalizedChild;
};

const withRelativePath = (file: File, relativePath: string) => {
  Object.defineProperty(file, 'webkitRelativePath', {
    value: relativePath.replace(/\\/g, '/'),
    configurable: true
  });
  return file as FileWithRelativePath;
};

const getMimeTypeForPath = (path: string) => {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith('.gltf')) return 'model/gltf+json';
  if (lowerPath.endsWith('.glb')) return 'model/gltf-binary';
  if (lowerPath.endsWith('.png')) return 'image/png';
  if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerPath.endsWith('.webp')) return 'image/webp';
  if (lowerPath.endsWith('.bin')) return 'application/octet-stream';
  return 'application/octet-stream';
};

const cloneFileBytes = (bytes: Uint8Array) => Uint8Array.from(bytes);

const pickPrimaryModelFile = (files: File[]) => {
  const modelFiles = files.filter(isModelFile);
  if (modelFiles.length === 0) return null;

  return [...modelFiles].sort((left, right) => {
    const leftPath = getRelativePath(left);
    const rightPath = getRelativePath(right);
    const leftPriority = left.name.toLowerCase().endsWith('.gltf') ? 0 : 1;
    const rightPriority = right.name.toLowerCase().endsWith('.gltf') ? 0 : 1;

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    const depthDifference = leftPath.split('/').length - rightPath.split('/').length;
    if (depthDifference !== 0) {
      return depthDifference;
    }

    return leftPath.localeCompare(rightPath);
  })[0];
};

const serializeOverlayHistory = (historyState: OverlayNode[][], currentIndex: number) => {
  const history = historyState.map((overlays) =>
    overlays.map((overlay) => ({
      id: overlay.id,
      x: overlay.x,
      y: overlay.y,
      width: overlay.width,
      height: overlay.height,
      imageBase64: overlay.imageObj.src
    } satisfies PersistedOverlayNode))
  );

  return {
    history,
    currentIndex
  };
};

const buildTextureSnapshotFromTexture = (texture: ExtractedTexture): TextureSnapshot => ({
  slotKey: texture.slotKey,
  slot: texture.slot,
  slotLabel: texture.slotLabel,
  previewMode: texture.previewMode,
  channelPacking: texture.channelPacking,
  colorSpace: texture.colorSpace,
  supportsVideo: texture.supportsVideo,
  materialIndex: texture.materialIndex,
  materialName: texture.materialName,
  textureIndex: texture.textureIndex,
  sourceIndex: texture.sourceIndex,
  texCoord: texture.texCoord,
  base64: texture.base64,
  width: texture.width,
  height: texture.height,
  sourceKind: texture.sourceKind,
  videoFile: texture.videoFile || null
});

const buildTextureSnapshotFromPersistedState = (textureId: string, textureState: PersistedTextureState): TextureSnapshot => ({
  slotKey: textureId,
  slot: textureState.slot || 'baseColor',
  slotLabel: textureState.slotLabel || (textureState.slot === 'normal'
    ? 'Normal'
    : textureState.slot === 'metallicRoughness'
      ? 'Roughness / Metallic'
      : textureState.slot === 'occlusion'
        ? 'Ambient Occlusion'
        : textureState.slot === 'emissive'
          ? 'Emissive'
          : 'Base Color'),
  previewMode: textureState.previewMode || (textureState.slot === 'normal'
    ? 'normal'
    : textureState.slot === 'metallicRoughness'
      ? 'channelPacked'
      : textureState.slot === 'occlusion'
        ? 'grayscale'
        : 'color'),
  channelPacking: textureState.channelPacking || (textureState.slot === 'metallicRoughness' ? 'gltfMetallicRoughness' : 'none'),
  colorSpace: textureState.colorSpace || (textureState.slot === 'baseColor' || textureState.slot === 'emissive' ? 'srgb' : 'linear'),
  supportsVideo: textureState.supportsVideo ?? textureState.slot === 'baseColor',
  materialIndex: textureState.materialIndex ?? -1,
  materialName: textureState.materialName || 'Material',
  textureIndex: textureState.textureIndex ?? -1,
  sourceIndex: textureState.sourceIndex ?? -1,
  texCoord: textureState.texCoord,
  base64: textureState.base64,
  width: textureState.width,
  height: textureState.height,
  sourceKind: textureState.sourceKind,
  videoFile: textureState.videoBlob
    ? new File([textureState.videoBlob], textureState.videoName || `${textureId}.mp4`, {
      type: textureState.videoType || 'video/mp4',
      lastModified: textureState.videoLastModified || Date.now()
    })
    : null
});

const getTextureEditingHint = (texture: ExtractedTexture | null) => {
  if (!texture) return null;
  if (texture.slot === 'normal') {
    return 'Normal maps encode surface direction. Treat edits as technical data, not painted color.';
  }
  if (texture.slot === 'metallicRoughness') {
    return 'This glTF map is packed: roughness lives in green, metallic in blue. Preserve the channel layout when editing.';
  }
  if (texture.slot === 'occlusion') {
    return texture.texCoord === 1
      ? 'This AO map uses the second UV set (UV1), so 3D-picked edit bounds may not match the base color layout.'
      : 'Ambient occlusion is usually grayscale and should stay aligned with the model UVs.';
  }
  if (texture.slot === 'emissive') {
    return 'Emissive maps drive self-illumination. Bright edits will make the material glow in 3D.';
  }
  return null;
};

const dataUrlToFile = async (dataUrl: string, filename: string) => {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], filename, {
    type: blob.type || 'image/png',
    lastModified: Date.now()
  });
};

const deserializeOverlayHistory = async (history: PersistedOverlayNode[][]): Promise<OverlayNode[][]> => {
  return Promise.all(
    history.map(async (overlays) =>
      Promise.all(
        overlays.map(async (overlay) => {
          const imageObj = new Image();
          imageObj.src = overlay.imageBase64;
          await new Promise<void>((resolve, reject) => {
            imageObj.onload = () => resolve();
            imageObj.onerror = () => reject(new Error('Failed to restore overlay image.'));
          });

          return {
            id: overlay.id,
            x: overlay.x,
            y: overlay.y,
            width: overlay.width,
            height: overlay.height,
            imageObj
          } satisfies OverlayNode;
        })
      )
    )
  );
};

// Normalize image dimensions for Gemini: upscale tiny crops, downscale overly large crops.
const normalizeForGemini = (
  base64Str: string,
  minSize: number = 512,
  maxSize: number = 1536
): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const { width, height } = img;
      const longest = Math.max(width, height);
      const shortest = Math.min(width, height);

      let scale = 1;
      if (shortest < minSize) {
        scale = Math.max(scale, minSize / shortest);
      }
      if (longest * scale > maxSize) {
        scale = Math.min(scale, maxSize / longest);
      }

      if (Math.abs(scale - 1) < 0.001) {
        resolve(base64Str);
        return;
      }

      const newWidth = Math.max(1, Math.round(width * scale));
      const newHeight = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = newWidth;
      canvas.height = newHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(base64Str);
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, newWidth, newHeight);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(base64Str);
  });
};

const clampColor = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

// Light denoise + sharpen pass before SAM.
// Blur removes high-frequency pixel noise, then a mild unsharp mask restores edges.
const preprocessCanvasForSam = (sourceCanvas: HTMLCanvasElement): HTMLCanvasElement => {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;

  const originalCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!originalCtx) return sourceCanvas;

  const blurredCanvas = document.createElement('canvas');
  blurredCanvas.width = width;
  blurredCanvas.height = height;
  const blurredCtx = blurredCanvas.getContext('2d', { willReadFrequently: true });
  if (!blurredCtx) return sourceCanvas;

  blurredCtx.filter = 'blur(0.8px) contrast(1.05) saturate(0.96)';
  blurredCtx.drawImage(sourceCanvas, 0, 0, width, height);
  blurredCtx.filter = 'none';

  const originalData = originalCtx.getImageData(0, 0, width, height);
  const blurredData = blurredCtx.getImageData(0, 0, width, height);
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputCtx = outputCanvas.getContext('2d');
  if (!outputCtx) return sourceCanvas;

  const out = outputCtx.createImageData(width, height);
  const amount = 0.65;

  for (let i = 0; i < originalData.data.length; i += 4) {
    const or = originalData.data[i];
    const og = originalData.data[i + 1];
    const ob = originalData.data[i + 2];
    const oa = originalData.data[i + 3];

    const br = blurredData.data[i];
    const bg = blurredData.data[i + 1];
    const bb = blurredData.data[i + 2];

    out.data[i] = clampColor(or + amount * (or - br));
    out.data[i + 1] = clampColor(og + amount * (og - bg));
    out.data[i + 2] = clampColor(ob + amount * (ob - bb));
    out.data[i + 3] = oa;
  }

  outputCtx.putImageData(out, 0, 0);
  return outputCanvas;
};

const getLuminance = (r: number, g: number, b: number) => {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// Expand masks only into nearby dark fringe pixels, which helps recover
// missed shadow edges without blindly growing already-good masks.
const refineMaskShadowEdges = async (
  maskBase64: string,
  sourceCanvas: HTMLCanvasElement
): Promise<string> => {
  return new Promise((resolve) => {
    const maskImg = new Image();
    maskImg.src = maskBase64;
    maskImg.onload = () => {
      const width = sourceCanvas.width;
      const height = sourceCanvas.height;

      const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
      if (!sourceCtx) {
        resolve(maskBase64);
        return;
      }

      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = width;
      maskCanvas.height = height;
      const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
      if (!maskCtx) {
        resolve(maskBase64);
        return;
      }

      maskCtx.drawImage(maskImg, 0, 0, width, height);
      const maskImage = maskCtx.getImageData(0, 0, width, height);
      const sourceImage = sourceCtx.getImageData(0, 0, width, height);
      const maskData = maskImage.data;
      const sourceData = sourceImage.data;

      const isMasked = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        const i = (y * width + x) * 4;
        const a = maskData[i + 3];
        const r = maskData[i];
        const g = maskData[i + 1];
        const b = maskData[i + 2];
        return a > 50 && (r > 128 || g > 128 || b > 128);
      };

      let originalArea = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (isMasked(x, y)) originalArea++;
        }
      }

      const pendingAdds: number[] = [];
      const MAX_GROWTH_RATIO = 0.12;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (isMasked(x, y)) continue;

          let hasRadius1MaskNeighbor = false;
          let hasRadius2MaskNeighbor = false;

          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (!isMasked(x + dx, y + dy)) continue;
              const chebyshev = Math.max(Math.abs(dx), Math.abs(dy));
              if (chebyshev <= 1) hasRadius1MaskNeighbor = true;
              if (chebyshev <= 2) hasRadius2MaskNeighbor = true;
            }
          }

          if (!hasRadius1MaskNeighbor && !hasRadius2MaskNeighbor) continue;

          const i = (y * width + x) * 4;
          const luminance = getLuminance(sourceData[i], sourceData[i + 1], sourceData[i + 2]);

          // Radius-1: include moderately dark fringe.
          const includeRadius1 = hasRadius1MaskNeighbor && luminance < 118;
          // Radius-2: only include very dark pixels to avoid bloating clean masks.
          const includeRadius2 = !includeRadius1 && hasRadius2MaskNeighbor && luminance < 82;

          if (includeRadius1 || includeRadius2) {
            pendingAdds.push(i);
          }
        }
      }

      // Avoid damaging masks that were already clean and tight.
      if (originalArea === 0 || pendingAdds.length / Math.max(1, originalArea) > MAX_GROWTH_RATIO) {
        resolve(maskBase64);
        return;
      }

      pendingAdds.forEach((i) => {
        maskData[i] = 255;
        maskData[i + 1] = 255;
        maskData[i + 2] = 255;
        maskData[i + 3] = 255;
      });

      maskCtx.putImageData(maskImage, 0, 0);
      resolve(maskCanvas.toDataURL('image/png'));
    };
    maskImg.onerror = () => resolve(maskBase64);
  });
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(0.0001, edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

// Smooth jagged mask contours by rasterizing at higher resolution
// and converting the result into an anti-aliased alpha mask.
const smoothMaskEdges = async (maskBase64: string): Promise<string> => {
  return new Promise((resolve) => {
    const maskImg = new Image();
    maskImg.src = maskBase64;
    maskImg.onload = () => {
      const width = maskImg.width;
      const height = maskImg.height;
      const scale = 4;

      const hiCanvas = document.createElement('canvas');
      hiCanvas.width = width * scale;
      hiCanvas.height = height * scale;
      const hiCtx = hiCanvas.getContext('2d');
      if (!hiCtx) {
        resolve(maskBase64);
        return;
      }

      // First pass: upscale smoothly to reduce staircase artifacts.
      hiCtx.imageSmoothingEnabled = true;
      hiCtx.imageSmoothingQuality = 'high';
      hiCtx.drawImage(maskImg, 0, 0, hiCanvas.width, hiCanvas.height);

      // Second pass: light blur to regularize broken edges.
      const blurredCanvas = document.createElement('canvas');
      blurredCanvas.width = hiCanvas.width;
      blurredCanvas.height = hiCanvas.height;
      const blurredCtx = blurredCanvas.getContext('2d', { willReadFrequently: true });
      if (!blurredCtx) {
        resolve(maskBase64);
        return;
      }
      blurredCtx.filter = 'blur(1.5px)';
      blurredCtx.drawImage(hiCanvas, 0, 0);
      blurredCtx.filter = 'none';

      // Downsample back to original size with smoothing enabled.
      const outCanvas = document.createElement('canvas');
      outCanvas.width = width;
      outCanvas.height = height;
      const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
      if (!outCtx) {
        resolve(maskBase64);
        return;
      }
      outCtx.imageSmoothingEnabled = true;
      outCtx.imageSmoothingQuality = 'high';
      outCtx.drawImage(blurredCanvas, 0, 0, width, height);

      // Final pass: convert to a smooth alpha mask.
      // Interior stays opaque, contour becomes anti-aliased instead of re-pixelated.
      const finalImage = outCtx.getImageData(0, 0, width, height);
      const finalData = finalImage.data;
      for (let i = 0; i < finalData.length; i += 4) {
        const alpha = finalData[i + 3];
        const brightness = (finalData[i] + finalData[i + 1] + finalData[i + 2]) / 3;
        const coverage = (alpha / 255) * (brightness / 255);

        // Use a soft transition band to smooth rough edges while
        // keeping the mask core fully opaque.
        const softAlpha = Math.round(smoothstep(0.18, 0.72, coverage) * 255);
        const value = softAlpha > 6 ? 255 : 0;
        finalData[i] = value;
        finalData[i + 1] = value;
        finalData[i + 2] = value;
        finalData[i + 3] = softAlpha;
      }
      outCtx.putImageData(finalImage, 0, 0);

      resolve(outCanvas.toDataURL('image/png'));
    };
    maskImg.onerror = () => resolve(maskBase64);
  });
};

// Final conservative coverage pass: add at most a 1px ring where the pixel is
// directly adjacent to the smoothed mask and visually consistent with a missed edge.
const completeMaskContour = async (
  maskBase64: string,
  sourceCanvas: HTMLCanvasElement
): Promise<string> => {
  return new Promise((resolve) => {
    const maskImg = new Image();
    maskImg.src = maskBase64;
    maskImg.onload = () => {
      const width = sourceCanvas.width;
      const height = sourceCanvas.height;

      const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
      if (!sourceCtx) {
        resolve(maskBase64);
        return;
      }

      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = width;
      maskCanvas.height = height;
      const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
      if (!maskCtx) {
        resolve(maskBase64);
        return;
      }

      maskCtx.drawImage(maskImg, 0, 0, width, height);
      const maskImage = maskCtx.getImageData(0, 0, width, height);
      const sourceImage = sourceCtx.getImageData(0, 0, width, height);
      const maskData = maskImage.data;
      const sourceData = sourceImage.data;

      const isMasked = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        const i = (y * width + x) * 4;
        return maskData[i + 3] > 127;
      };

      let originalArea = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (isMasked(x, y)) originalArea++;
        }
      }

      const additions: number[] = [];

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (isMasked(x, y)) continue;

          let directNeighbors = 0;
          let diagonalNeighbors = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (!isMasked(x + dx, y + dy)) continue;
              if (Math.abs(dx) + Math.abs(dy) === 1) directNeighbors++;
              else diagonalNeighbors++;
            }
          }

          // Only complete tiny gaps right next to an existing contour.
          if (directNeighbors === 0) continue;

          const i = (y * width + x) * 4;
          const luminance = getLuminance(sourceData[i], sourceData[i + 1], sourceData[i + 2]);

          // Reliable heuristic:
          // - strong direct adjacency means likely missed fringe
          // - allow either dark shadow support OR enough surrounding mask support
          const enoughSupport = directNeighbors >= 2 || (directNeighbors >= 1 && diagonalNeighbors >= 2);
          const darkEnough = luminance < 132;
          if (enoughSupport || darkEnough) {
            additions.push(i);
          }
        }
      }

      // Keep this pass extremely conservative.
      if (originalArea === 0 || additions.length / Math.max(1, originalArea) > 0.04) {
        resolve(maskBase64);
        return;
      }

      additions.forEach((i) => {
        maskData[i] = 255;
        maskData[i + 1] = 255;
        maskData[i + 2] = 255;
        maskData[i + 3] = 255;
      });

      maskCtx.putImageData(maskImage, 0, 0);
      resolve(maskCanvas.toDataURL('image/png'));
    };
    maskImg.onerror = () => resolve(maskBase64);
  });
};

// Add a tiny soft alpha halo around the final contour so subtle glows and
// anti-aliased edges are preserved without materially changing mask coverage.
const addSoftEdgeHalo = async (maskBase64: string): Promise<string> => {
  return new Promise((resolve) => {
    const maskImg = new Image();
    maskImg.src = maskBase64;
    maskImg.onload = () => {
      const width = maskImg.width;
      const height = maskImg.height;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        resolve(maskBase64);
        return;
      }

      ctx.drawImage(maskImg, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      const original = new Uint8ClampedArray(image.data);
      const data = image.data;

      const originalAlphaAt = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return 0;
        return original[(y * width + x) * 4 + 3];
      };

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (original[i + 3] > 127) continue;

          let directNeighbors = 0;
          let diagonalNeighbors = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (originalAlphaAt(x + dx, y + dy) <= 127) continue;
              if (Math.abs(dx) + Math.abs(dy) === 1) directNeighbors++;
              else diagonalNeighbors++;
            }
          }

          let haloAlpha = 0;
          if (directNeighbors >= 2) haloAlpha = 108;
          else if (directNeighbors >= 1 && diagonalNeighbors >= 2) haloAlpha = 84;
          else if (directNeighbors >= 1) haloAlpha = 58;

          if (haloAlpha > 0) {
            data[i] = 255;
            data[i + 1] = 255;
            data[i + 2] = 255;
            data[i + 3] = haloAlpha;
          }
        }
      }

      ctx.putImageData(image, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    maskImg.onerror = () => resolve(maskBase64);
  });
};

// Helper to extract bounding box from a mask image and crop the base image
const getMaskedCrop = async (maskBase64: string, baseImageObj: HTMLImageElement, overlays: OverlayNode[] | null): Promise<{ croppedBase64: string, bounds: { x: number, y: number, width: number, height: number } }> => {
  return new Promise((resolve) => {
    const maskImg = new Image();
    maskImg.src = maskBase64;
    maskImg.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = maskImg.width;
      canvas.height = maskImg.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error("Could not get context");

      ctx.drawImage(maskImg, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
      let hasMask = false;

      // Find bounding box of the non-transparent/white pixels in the mask
      // SAM masks are typically white-on-black or white-on-transparent, so check alpha and brightness.
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];

          // Assuming the mask is white where selected. Let's say if mostly white and opaque.
          // Or if it's a binary mask where object > 128
          if (a > 18 && (r > 128 || g > 128 || b > 128)) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            hasMask = true;
          }
        }
      }

      if (!hasMask) {
        // Fallback to center 256x256 if mask is entirely empty
        minX = canvas.width / 2 - 128;
        minY = canvas.height / 2 - 128;
        maxX = canvas.width / 2 + 128;
        maxY = canvas.height / 2 + 128;
      }

      // Add a small padding (10%)
      const paddingX = Math.floor((maxX - minX) * 0.1);
      const paddingY = Math.floor((maxY - minY) * 0.1);

      const bx = Math.max(0, minX - paddingX);
      const by = Math.max(0, minY - paddingY);
      const bw = Math.min(canvas.width - bx, (maxX - minX) + paddingX * 2);
      const bh = Math.min(canvas.height - by, (maxY - minY) + paddingY * 2);

      // We need it to be relatively square for Gemini usually, but we'll let Gemini handle the aspect ratio if needed, or just crop exact.
      // Crop the base image (composited with overlays if we want, but base is fine)
      const compositeCanvas = document.createElement('canvas');
      compositeCanvas.width = canvas.width;
      compositeCanvas.height = canvas.height;
      const compCtx = compositeCanvas.getContext('2d');
      if (compCtx) {
        compCtx.drawImage(baseImageObj, 0, 0);
        overlays?.forEach(o => {
          compCtx.drawImage(o.imageObj, o.x, o.y, o.width, o.height);
        });
      }

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = bw;
      cropCanvas.height = bh;
      const cropCtx = cropCanvas.getContext('2d');
      if (cropCtx && compCtx) {
        cropCtx.putImageData(compCtx.getImageData(bx, by, bw, bh), 0, 0);
        resolve({
          croppedBase64: cropCanvas.toDataURL('image/png'),
          bounds: { x: bx, y: by, width: bw, height: bh }
        });
      }
    };
  });
};

const getMaskBounds = async (maskBase64: string): Promise<Rect | null> => {
  return new Promise((resolve) => {
    const maskImg = new Image();
    maskImg.src = maskBase64;
    maskImg.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = maskImg.width;
      canvas.height = maskImg.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.drawImage(maskImg, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = -1;
      let maxY = -1;

      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a > 50 && (r > 128 || g > 128 || b > 128)) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }

      if (maxX < minX || maxY < minY) {
        resolve(null);
        return;
      }

      resolve({
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
      });
    };
    maskImg.onerror = () => resolve(null);
  });
};

const analyzeMask = async (
  maskBase64: string,
  points: Array<{ x: number; y: number; label: 0 | 1 }> = []
): Promise<{ bounds: Rect | null; area: number; positiveHitCount: number; negativeInsideCount: number }> => {
  return new Promise((resolve) => {
    const maskImg = new Image();
    maskImg.src = maskBase64;
    maskImg.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = maskImg.width;
      canvas.height = maskImg.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        resolve({ bounds: null, area: 0, positiveHitCount: 0, negativeInsideCount: 0 });
        return;
      }

      ctx.drawImage(maskImg, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      let area = 0;

      const isSelectedAt = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        return a > 50 && (r > 128 || g > 128 || b > 128);
      };

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!isSelectedAt(x, y)) continue;
          area++;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }

      const bounds = maxX < minX || maxY < minY
        ? null
        : {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1
        };

      // Count how many selected points are inside this mask.
      // Small neighborhood tolerance handles off-by-1 from resizing.
      let positiveHitCount = 0;
      let negativeInsideCount = 0;
      const RADIUS = 2;
      points.forEach((point) => {
        const px = Math.round(point.x);
        const py = Math.round(point.y);
        let hit = false;
        for (let dy = -RADIUS; dy <= RADIUS && !hit; dy++) {
          for (let dx = -RADIUS; dx <= RADIUS && !hit; dx++) {
            if (isSelectedAt(px + dx, py + dy)) hit = true;
          }
        }
        if (point.label === 1) {
          if (hit) positiveHitCount++;
        } else if (hit) {
          negativeInsideCount++;
        }
      });

      resolve({ bounds, area, positiveHitCount, negativeInsideCount });
    };
    maskImg.onerror = () => resolve({ bounds: null, area: 0, positiveHitCount: 0, negativeInsideCount: 0 });
  });
};

const combineMasks = async (maskBase64List: string[]): Promise<string | null> => {
  if (maskBase64List.length === 0) return null;

  const maskImages = await Promise.all(maskBase64List.map((maskBase64) => {
    return new Promise<HTMLImageElement | null>((resolve) => {
      const maskImg = new Image();
      maskImg.onload = () => resolve(maskImg);
      maskImg.onerror = () => resolve(null);
      maskImg.src = maskBase64;
    });
  }));
  const validImages = maskImages.filter((img): img is HTMLImageElement => !!img);
  if (validImages.length === 0) return null;

  const width = validImages[0].width;
  const height = validImages[0].height;
  const unionCanvas = document.createElement('canvas');
  unionCanvas.width = width;
  unionCanvas.height = height;
  const unionCtx = unionCanvas.getContext('2d', { willReadFrequently: true });
  if (!unionCtx) return null;

  const unionImage = unionCtx.createImageData(width, height);
  const unionData = unionImage.data;

  validImages.forEach((image) => {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    if (!tempCtx) return;
    tempCtx.drawImage(image, 0, 0, width, height);
    const data = tempCtx.getImageData(0, 0, width, height).data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const isSelected = a > 50 && (r > 128 || g > 128 || b > 128);
      if (!isSelected) continue;

      // Write opaque white for selected union pixels.
      unionData[i] = 255;
      unionData[i + 1] = 255;
      unionData[i + 2] = 255;
      unionData[i + 3] = 255;
    }
  });

  unionCtx.putImageData(unionImage, 0, 0);
  return unionCanvas.toDataURL('image/png');
};

const expandMaskToFullImage = async (
  maskBase64: string,
  fullWidth: number,
  fullHeight: number,
  cropRegion: Rect | null
): Promise<string> => {
  return new Promise((resolve) => {
    const maskImg = new Image();
    maskImg.src = maskBase64;
    maskImg.onload = () => {
      // If already full-size, no remapping needed.
      if (maskImg.width === fullWidth && maskImg.height === fullHeight) {
        resolve(maskBase64);
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = fullWidth;
      canvas.height = fullHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(maskBase64);
        return;
      }

      if (cropRegion) {
        ctx.drawImage(maskImg, cropRegion.x, cropRegion.y, cropRegion.width, cropRegion.height);
      } else {
        ctx.drawImage(maskImg, 0, 0, fullWidth, fullHeight);
      }
      resolve(canvas.toDataURL('image/png'));
    };
    maskImg.onerror = () => resolve(maskBase64);
  });
};

const cropImageToBounds = async (
  imageBase64: string,
  bounds: Rect
): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = imageBase64;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bounds.width));
      canvas.height = Math.max(1, Math.round(bounds.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(imageBase64);
        return;
      }
      ctx.drawImage(
        img,
        Math.round(bounds.x),
        Math.round(bounds.y),
        Math.round(bounds.width),
        Math.round(bounds.height),
        0,
        0,
        Math.round(bounds.width),
        Math.round(bounds.height)
      );
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(imageBase64);
  });
};

// Helper to composite the new image through the SAM mask back onto the original
const compositeWithMask = async (originalBase64: string, newCropBase64: string, maskBase64: string, bounds: { x: number, y: number, width: number, height: number }): Promise<string> => {
  return new Promise((resolve) => {
    const origImg = new Image();
    const newImg = new Image();
    const maskImg = new Image();

    // Load all 3
    let loaded = 0;
    const onload = () => {
      loaded++;
      if (loaded === 3) {
        const canvas = document.createElement('canvas');
        canvas.width = origImg.width;
        canvas.height = origImg.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(originalBase64); // Fallback

        // Draw original
        ctx.drawImage(origImg, 0, 0);

        // Draw mask to a temporary canvas to get pixel data
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = maskImg.width;
        maskCanvas.height = maskImg.height;
        const mCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
        mCtx?.drawImage(maskImg, 0, 0);
        const maskData = mCtx?.getImageData(0, 0, canvas.width, canvas.height).data;

        // Draw the new crop exactly where it belongs on a scratch canvas
        const newCanvas = document.createElement('canvas');
        newCanvas.width = canvas.width;
        newCanvas.height = canvas.height;
        const nCtx = newCanvas.getContext('2d', { willReadFrequently: true });
        nCtx?.drawImage(newImg, bounds.x, bounds.y, bounds.width, bounds.height);
        const newData = nCtx?.getImageData(0, 0, canvas.width, canvas.height).data;

        // Blend them manually
        const targetData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const tData = targetData.data;

        if (maskData && newData) {
          for (let i = 0; i < tData.length; i += 4) {
            const maskAlpha = maskData[i + 3] / 255;
            const maskBrightness = ((maskData[i] + maskData[i + 1] + maskData[i + 2]) / 3) / 255;
            const blend = maskAlpha * maskBrightness;
            if (blend > 0.01) {
              tData[i] = Math.round(tData[i] * (1 - blend) + newData[i] * blend);
              tData[i + 1] = Math.round(tData[i + 1] * (1 - blend) + newData[i + 1] * blend);
              tData[i + 2] = Math.round(tData[i + 2] * (1 - blend) + newData[i + 2] * blend);
              tData[i + 3] = 255;
            }
          }
          ctx.putImageData(targetData, 0, 0);
        }

        resolve(canvas.toDataURL('image/png'));
      }
    };

    origImg.onload = onload; origImg.src = originalBase64;
    newImg.onload = onload; newImg.src = newCropBase64;
    maskImg.onload = onload; maskImg.src = maskBase64;
  });
};

const blendRectangularEnhancement = async (
  originalCropBase64: string,
  enhancedCropBase64: string
): Promise<string> => {
  return new Promise((resolve) => {
    const originalImg = new Image();
    const enhancedImg = new Image();

    let loaded = 0;
    const onload = () => {
      loaded += 1;
      if (loaded < 2) return;

      const width = originalImg.width;
      const height = originalImg.height;

      const originalCanvas = document.createElement('canvas');
      originalCanvas.width = width;
      originalCanvas.height = height;
      const originalCtx = originalCanvas.getContext('2d', { willReadFrequently: true });

      const enhancedCanvas = document.createElement('canvas');
      enhancedCanvas.width = width;
      enhancedCanvas.height = height;
      const enhancedCtx = enhancedCanvas.getContext('2d', { willReadFrequently: true });

      if (!originalCtx || !enhancedCtx) {
        resolve(enhancedCropBase64);
        return;
      }

      originalCtx.drawImage(originalImg, 0, 0, width, height);
      enhancedCtx.drawImage(enhancedImg, 0, 0, width, height);

      const originalImage = originalCtx.getImageData(0, 0, width, height);
      const enhancedImage = enhancedCtx.getImageData(0, 0, width, height);
      const originalData = originalImage.data;
      const enhancedData = enhancedImage.data;

      const mask = new Float32Array(width * height);
      const DIFFERENCE_FLOOR = 10;
      const DIFFERENCE_CEILING = 28;

      for (let i = 0, pixelIndex = 0; i < originalData.length; i += 4, pixelIndex += 1) {
        const dr = Math.abs(enhancedData[i] - originalData[i]);
        const dg = Math.abs(enhancedData[i + 1] - originalData[i + 1]);
        const db = Math.abs(enhancedData[i + 2] - originalData[i + 2]);
        const maxDiff = Math.max(dr, dg, db);
        mask[pixelIndex] = smoothstep(DIFFERENCE_FLOOR, DIFFERENCE_CEILING, maxDiff);
      }

      const blurredMask = new Float32Array(mask.length);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          let total = 0;
          let weight = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              const neighborWeight = dx === 0 && dy === 0 ? 4 : Math.abs(dx) + Math.abs(dy) === 1 ? 2 : 1;
              total += mask[ny * width + nx] * neighborWeight;
              weight += neighborWeight;
            }
          }
          blurredMask[y * width + x] = weight > 0 ? total / weight : 0;
        }
      }

      for (let i = 0, pixelIndex = 0; i < originalData.length; i += 4, pixelIndex += 1) {
        const blend = blurredMask[pixelIndex];
        if (blend <= 0.001) continue;

        originalData[i] = Math.round(originalData[i] * (1 - blend) + enhancedData[i] * blend);
        originalData[i + 1] = Math.round(originalData[i + 1] * (1 - blend) + enhancedData[i + 1] * blend);
        originalData[i + 2] = Math.round(originalData[i + 2] * (1 - blend) + enhancedData[i + 2] * blend);
        originalData[i + 3] = 255;
      }

      originalCtx.putImageData(originalImage, 0, 0);
      resolve(originalCanvas.toDataURL('image/png'));
    };

    originalImg.onload = onload;
    enhancedImg.onload = onload;
    originalImg.onerror = () => resolve(enhancedCropBase64);
    enhancedImg.onerror = () => resolve(enhancedCropBase64);
    originalImg.src = originalCropBase64;
    enhancedImg.src = enhancedCropBase64;
  });
};

// Helper to build a strict prompt for Gemini Nano Banana
const buildGeminiPrompt = (userPrompt: string): string => {
  return `You are a strict texture editing AI. The provided image is a cropped selection of a larger 2D texture. 
Required Guidelines:
1. Maintain the exact same style, lighting, perspective, and general material of the surrounding texture.
2. DO NOT add borders, watermarks, text, or UI elements.
3. Your provided image MUST seamlessly tile or integrate back into the original texture.
4. If asked to remove an object, seamlessly fill the background using the texture's natural patterns.
5. If asked to improve lighting/noise, maintain the exact same subjects but enhance photorealism or clarity as requested.

User Request: "${userPrompt}"`;
};

// Dynamically import Viewport to avoid SSR issues with Konva (window is not defined)
const Viewport = dynamic(() => import('@/components/Viewport'), {
  ssr: false,
});

const ModelViewer = dynamic(() => import('@/components/ModelViewer'), {
  ssr: false,
});

export default function App() {
  const SAMPLE_PROJECT_ID = 'sample-flighthelmet';
  const [currentTool, setCurrentTool] = useState<Tool>('select');
  const handleSetTool = useCallback((tool: Tool) => {
    if (tool === 'sam-select' && currentTool !== 'sam-select') {
      setSamMode('points');
      setSamPoints([]);
      setSamPromptText('');
      setSamMaskBase64(null);
      setSamMaskOptions([]);
      setSelectedSamMaskIndex(0);
    }
    setCurrentTool(tool);
  }, [currentTool]);
  const [imageObj, setImageObj] = useState<HTMLImageElement | null>(null);

  // History and modifications state
  const { currentState: overlays, pushState, undo, redo, canUndo, canRedo, reset, setFullState, history, currentIndex } = useHistory<OverlayNode[]>([]);
  const [textureHistories, setTextureHistories] = useState<Record<string, { history: OverlayNode[][], currentIndex: number }>>({});
  const textureEditBaseRef = useRef<Record<string, string>>({});

  // Viewport and selection state
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const viewportContainerRef = useRef<HTMLDivElement>(null);
  const konvaViewportRef = useRef<ViewportRef>(null);

  // Prompt UI state
  const [showPrompt, setShowPrompt] = useState(false);
  const [selectionRect, setSelectionRect] = useState<{ x: number, y: number, width: number, height: number } | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [showUpload, setShowUpload] = useState(true);

  // SAM State
  const [samMode, setSamMode] = useState<'points' | 'prompt'>('points');
  const [samMaskBase64, setSamMaskBase64] = useState<string | null>(null);
  const [samMaskOptions, setSamMaskOptions] = useState<string[]>([]);
  const [selectedSamMaskIndex, setSelectedSamMaskIndex] = useState(0);
  const [isGeneratingSam, setIsGeneratingSam] = useState(false);
  const [samPoints, setSamPoints] = useState<SamPoint[]>([]);
  const [samPromptText, setSamPromptText] = useState('');
  const [samInteractionRegion, setSamInteractionRegion] = useState<Rect | null>(null);
  // Store the crop region so we can position the mask back onto the full texture
  const [samCropRegion, setSamCropRegion] = useState<{ x: number, y: number, width: number, height: number } | null>(null);
  const [selectionViewportRect, setSelectionViewportRect] = useState<Rect | null>(null);
  const [viewportBounds, setViewportBounds] = useState<Rect | null>(null);

  // Comparison state
  const [showComparison, setShowComparison] = useState(false);
  const [comparisonImages, setComparisonImages] = useState<{ original: string, enhanced: string } | null>(null);
  const [comparisonApplyImage, setComparisonApplyImage] = useState<string | null>(null);
  const [comparisonVariant, setComparisonVariant] = useState<'enhancement' | 'textureOptimization'>('enhancement');
  const [pendingTextureOptimization, setPendingTextureOptimization] = useState<TextureOptimizationResult | null>(null);

  // Texture optimization state
  const [showTextureOptimizePanel, setShowTextureOptimizePanel] = useState(false);
  const [isOptimizingTexture, setIsOptimizingTexture] = useState(false);
  const [textureOptimizeError, setTextureOptimizeError] = useState<string | null>(null);

  // 3D Model state
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [modelBundleFiles, setModelBundleFiles] = useState<File[] | null>(null);
  const [gltfModelUrl, setGltfModelUrl] = useState<string | null>(null); // Passed down instead of raw file if we load a folder
  const [showModelViewer, setShowModelViewer] = useState(false);
  const [active3DTexture, setActive3DTexture] = useState<ExtractedTexture | null>(null);
  const [sceneName, setSceneName] = useState('Untitled Scene');
  const [restoredTextureStates, setRestoredTextureStates] = useState<Record<string, PersistedTextureState> | null>(null);
  const [restoredActiveTextureId, setRestoredActiveTextureId] = useState<string | null>(null);
  const [textureSnapshots, setTextureSnapshots] = useState<Record<string, TextureSnapshot>>({});
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingDrop, setIsProcessingDrop] = useState(false);
  const [recentProjects, setRecentProjects] = useState<RecentProjectMeta[]>([]);
  const [isLoadingRecentProjects, setIsLoadingRecentProjects] = useState(false);
  const [isOpeningRecentProjectId, setIsOpeningRecentProjectId] = useState<string | null>(null);
  const lastSavedModelKeyRef = useRef<string | null>(null);
  const pendingRecentProjectRef = useRef<PendingRecentProject | null>(null);
  const lastModelThumbnailRef = useRef<string | null>(null);
  const textureOptimizationSource = useMemo<TextureOptimizationSourceMeta | null>(() => {
    if (!imageObj) return null;

    return {
      name: active3DTexture?.name || 'Current Texture',
      slot: active3DTexture?.slot || 'baseColor',
      slotLabel: active3DTexture?.slotLabel || 'Base Color',
      channelPacking: active3DTexture?.channelPacking || 'none',
      colorSpace: active3DTexture?.colorSpace || 'srgb',
      width: imageObj.width,
      height: imageObj.height
    };
  }, [active3DTexture, imageObj]);

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const replaceTextureImageInputRef = useRef<HTMLInputElement>(null);
  const replaceTextureVideoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const directoryInput = directoryInputRef.current;
    if (!directoryInput) return;

    // React does not reliably apply non-standard directory picker attributes in all browsers.
    directoryInput.setAttribute('webkitdirectory', '');
    directoryInput.setAttribute('directory', '');
  }, []);

  const refreshRecentProjects = useCallback(async () => {
    if (typeof window === 'undefined') return;
    try {
      setIsLoadingRecentProjects(true);
      const projects = await listRecentModelProjects(5);
      setRecentProjects(projects);
    } catch (error) {
      console.warn('Failed to load recent projects:', error);
    } finally {
      setIsLoadingRecentProjects(false);
    }
  }, []);

  const applySaveWarnings = useCallback((result?: SaveRecentProjectResult) => {
    setStorageWarning(result?.warnings[0] ?? null);
  }, []);

  useEffect(() => {
    if (!storageWarning) return;

    const timeout = window.setTimeout(() => {
      setStorageWarning((currentWarning) => (currentWarning === storageWarning ? null : currentWarning));
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [storageWarning]);

  // Measure viewport for canvas
  useEffect(() => {
    let rafId = 0;
    const updateSize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (viewportContainerRef.current) {
          setViewportSize({
            width: viewportContainerRef.current.clientWidth,
            height: viewportContainerRef.current.clientHeight,
          });
          const bounds = viewportContainerRef.current.getBoundingClientRect();
          setViewportBounds({
            x: bounds.left,
            y: bounds.top,
            width: bounds.width,
            height: bounds.height
          });
        }
      });
    };

    // Initial measure
    updateSize();

    window.addEventListener('resize', updateSize);
    window.addEventListener('scroll', updateSize, true);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('scroll', updateSize, true);
    };
  }, []);

  useEffect(() => {
    refreshRecentProjects();
  }, [refreshRecentProjects]);

  // Handle Browser Back/Forward navigation based on URL Hash
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash === '#3d') {
        if (modelFile || gltfModelUrl) {
          setShowModelViewer(true);
          setShowUpload(false);
        }
      } else if (hash === '#2d') {
        if (imageObj) {
          setShowModelViewer(false);
          setShowUpload(false);
        }
      } else if (hash === '') {
        // Reset mostly handled by state naturally, 
        // but if we are on empty, we do nothing to prevent breaking active sessions
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    // Trigger on mount in case they refresh while on a hash
    handleHashChange();

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [modelFile, gltfModelUrl, imageObj]);

  const processSingleFile = useCallback((file: File, options?: { preserveRestoredState?: boolean; sceneNameOverride?: string }) => {
    if (file.name.toLowerCase().endsWith('.glb') || file.name.toLowerCase().endsWith('.gltf')) {
      // It's a 3D model

      // Save current active texture history before switching (just in case they were editing one)
      if (active3DTexture) {
        setTextureHistories(prev => ({
          ...prev,
          [active3DTexture.id]: { history, currentIndex }
        }));
      }

      setModelFile(file);
      setModelBundleFiles(null);
      setSceneName(options?.sceneNameOverride || file.name.replace(/\.(glb|gltf)$/i, ''));
      if (!options?.preserveRestoredState) {
        textureEditBaseRef.current = {};
        setRestoredTextureStates(null);
        setRestoredActiveTextureId(null);
        setTextureSnapshots({});
        setTextureHistories({});
      }
      lastSavedModelKeyRef.current = null;
      pendingRecentProjectRef.current = { kind: 'file', file, displayName: file.name };
      setGltfModelUrl(null); // Resets any custom folder URL
      setShowModelViewer(true);
      setShowUpload(false);
      setImageObj(null); // Clear 2D image
      setActive3DTexture(null);
      reset([]);
      window.location.hash = '3d';
    } else {
      // It's a regular 2D image
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      img.onload = () => {
        pendingRecentProjectRef.current = null;
        setImageObj(img);
        setShowUpload(false);
        setModelFile(null); // Clear 3D model
        setModelBundleFiles(null);
        setGltfModelUrl(null);
        textureEditBaseRef.current = {};
        setActive3DTexture(null);
        setRestoredTextureStates(null);
        setRestoredActiveTextureId(null);
        setTextureSnapshots({});
        setSamMaskBase64(null);
        setSamMaskOptions([]);
        setSelectedSamMaskIndex(0);
        setSamPoints([]);
        setSamPromptText('');
        setSamInteractionRegion(null);
        setCurrentTool('select');
        reset([]); // clear history on new image
        window.location.hash = '2d';
      };
    }
  }, [active3DTexture, currentIndex, history, reset]);

  const extractZipFiles = useCallback(async (archiveFile: File) => {
    const extractArchive = async (sourceFile: File, parentPath = '', depth = 0): Promise<File[]> => {
      if (depth > MAX_NESTED_ZIP_DEPTH) {
        throw new Error(`Nested ZIP depth exceeded ${MAX_NESTED_ZIP_DEPTH} levels.`);
      }

      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(sourceFile);
      const extractedGroups = await Promise.all(
        Object.values(zip.files)
          .filter((entry) => !entry.dir && !entry.name.startsWith('__MACOSX/') && !entry.name.endsWith('.DS_Store'))
          .map(async (entry) => {
            const entryPath = joinArchivePath(parentPath, entry.name);
            const bytes = await entry.async('uint8array');

            if (ZIP_FILE_REGEX.test(entry.name)) {
              const nestedZipName = entry.name.split('/').pop() || entry.name;
              const nestedArchivePath = normalizeArchivePath(entryPath).replace(/\.zip$/i, '');
              const nestedZipFile = new File([cloneFileBytes(bytes)], nestedZipName, {
                type: 'application/zip',
                lastModified: sourceFile.lastModified
              });

              return extractArchive(nestedZipFile, nestedArchivePath, depth + 1);
            }

            const fileName = entryPath.split('/').pop() || entryPath;
            const extractedFile = new File([cloneFileBytes(bytes)], fileName, {
              type: getMimeTypeForPath(entryPath),
              lastModified: sourceFile.lastModified
            });

            return [withRelativePath(extractedFile, normalizeArchivePath(entryPath))];
          })
      );

      return extractedGroups.flat().filter((file) => file.size > 0);
    };

    return extractArchive(archiveFile);
  }, []);

  const resetToHome = useCallback(() => {
    pendingRecentProjectRef.current = null;
    lastSavedModelKeyRef.current = null;
    lastModelThumbnailRef.current = null;
    textureEditBaseRef.current = {};

    setShowPrompt(false);
    setShowComparison(false);
    setComparisonImages(null);
    setComparisonApplyImage(null);
    setComparisonVariant('enhancement');
    setPendingTextureOptimization(null);
    setShowTextureOptimizePanel(false);
    setTextureOptimizeError(null);
    setIsEnhancing(false);
    setImageObj(null);
    setModelFile(null);
    setModelBundleFiles(null);
    setGltfModelUrl(null);
    setShowModelViewer(false);
    setShowUpload(true);
    setActive3DTexture(null);
    setSceneName('Untitled Scene');
    setRestoredTextureStates(null);
    setRestoredActiveTextureId(null);
    setTextureSnapshots({});
    setTextureHistories({});
    setStorageWarning(null);
    setSaveStatus('idle');
    setSelectionRect(null);
    setSelectionViewportRect(null);
    setSamMaskBase64(null);
    setSamMaskOptions([]);
    setSelectedSamMaskIndex(0);
    setSamPoints([]);
    setSamPromptText('');
    setSamInteractionRegion(null);
    setCurrentTool('select');
    reset([]);
    window.location.hash = '';
  }, [reset]);

  const handleModelSnapshot = useCallback(async (snapshotDataUrl: string) => {
    const pendingProject = pendingRecentProjectRef.current;
    if (!pendingProject) return;
    lastModelThumbnailRef.current = snapshotDataUrl;

    const keyFile = pendingProject.kind === 'file' ? pendingProject.file : pendingProject.entryFile;
    const modelKey = `${pendingProject.kind}__${keyFile.name}__${keyFile.size}__${keyFile.lastModified}`;
    if (lastSavedModelKeyRef.current === modelKey) return;

    try {
      if (pendingProject.kind === 'gltf-bundle') {
        await saveRecentModelProject(pendingProject.entryFile, {
          thumbnailDataUrl: null,
          bundleFiles: pendingProject.files,
          entryFileName: pendingProject.entryFile.name,
          displayName: sceneName
        });
      } else {
        await saveRecentModelProject(pendingProject.file, {
          thumbnailDataUrl: null,
          displayName: sceneName
        });
      }
      lastSavedModelKeyRef.current = modelKey;
      await refreshRecentProjects();
    } catch (error) {
      console.warn('Failed to save recent project:', error);
    }
  }, [refreshRecentProjects, sceneName]);

  const openGltfBundle = useCallback(async (entryFile: File, files: File[], displayName?: string, options?: { preserveRestoredState?: boolean; sceneNameOverride?: string }) => {
    const blobMap = new Map<string, string>();
    files.forEach((file) => {
      const url = URL.createObjectURL(file);
      blobMap.set(file.name, url);
    });

    const THREE = await import('three');
    THREE.DefaultLoadingManager.setURLModifier((url) => {
      const fileName = url.split('/').pop()?.split('?')[0];
      if (fileName && blobMap.has(fileName)) {
        return blobMap.get(fileName)!;
      }
      return url;
    });

    const mainUrl = blobMap.get(entryFile.name);
    if (!mainUrl) {
      alert('Could not resolve the main .gltf file.');
      return;
    }

    setGltfModelUrl(mainUrl);
    setModelFile(entryFile);
    setModelBundleFiles(files);
    setSceneName(options?.sceneNameOverride || (displayName || entryFile.name).replace(/\.(glb|gltf)$/i, ''));
    if (!options?.preserveRestoredState) {
      textureEditBaseRef.current = {};
      setRestoredTextureStates(null);
      setRestoredActiveTextureId(null);
      setTextureSnapshots({});
      setTextureHistories({});
    }
    lastSavedModelKeyRef.current = null;
    pendingRecentProjectRef.current = {
      kind: 'gltf-bundle',
      entryFile,
      files,
      displayName: displayName || entryFile.name
    };
    setShowModelViewer(true);
    setShowUpload(false);
    setImageObj(null);
    setActive3DTexture(null);
    setSamMaskBase64(null);
    setSamMaskOptions([]);
    setSelectedSamMaskIndex(0);
    setSamPoints([]);
    setSamPromptText('');
    setSamInteractionRegion(null);
    reset([]);
    window.location.hash = '3d';
  }, [reset]);

  const importSelectedFiles = useCallback(async (selectedFiles: File[], options?: { zipDisplayName?: string }) => {
    if (selectedFiles.length === 0) return;

    setIsProcessingDrop(true);
    try {
      const openImportedModelFiles = (files: File[], displayName?: string) => {
        const primaryModelFile = pickPrimaryModelFile(files);
        if (!primaryModelFile) {
          throw new Error('No .gltf or .glb file found in the selected files.');
        }

        if (primaryModelFile.name.toLowerCase().endsWith('.glb')) {
          processSingleFile(primaryModelFile);
          return;
        }

        openGltfBundle(primaryModelFile, files, displayName || primaryModelFile.name);
      };

      const zipFile = selectedFiles.find(isZipFile);
      if (zipFile) {
        const extractedFiles = await extractZipFiles(zipFile);
        openImportedModelFiles(extractedFiles, options?.zipDisplayName || zipFile.name.replace(/\.zip$/i, ''));
        return;
      }

      const modelFiles = selectedFiles.filter(isModelFile);
      if (modelFiles.length > 1 || (modelFiles.length === 1 && selectedFiles.length > 1)) {
        openImportedModelFiles(selectedFiles);
        return;
      }

      const firstFile = selectedFiles[0];
      if (isModelFile(firstFile) || isImageFile(firstFile)) {
        processSingleFile(firstFile);
        return;
      }

      throw new Error('Unsupported file type. Use an image, a .glb/.gltf model, a folder, or a .zip glTF package.');
    } catch (error) {
      console.error('Failed to import files:', error);
      alert(error instanceof Error ? error.message : 'Failed to import the selected files.');
    } finally {
      setIsProcessingDrop(false);
    }
  }, [extractZipFiles, openGltfBundle, processSingleFile]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    e.target.value = '';
    await importSelectedFiles(selectedFiles);
  };

  const handleDirectoryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    e.target.value = '';
    await importSelectedFiles(selectedFiles);
  };

  const handleOpenSampleProject = useCallback(async () => {
    try {
      setIsOpeningRecentProjectId(SAMPLE_PROJECT_ID);
      const response = await fetch('/flighthelmet.zip');
      if (!response.ok) {
        throw new Error('Failed to download the sample project.');
      }

      const sampleBlob = await response.blob();
      const sampleFile = new File([sampleBlob], 'flighthelmet.zip', {
        type: sampleBlob.type || 'application/zip',
        lastModified: Date.now()
      });

      await importSelectedFiles([sampleFile], { zipDisplayName: 'Flight Helmet' });
    } catch (error) {
      console.error('Failed to open sample project:', error);
      alert(error instanceof Error ? error.message : 'Failed to open the sample project.');
    } finally {
      setIsOpeningRecentProjectId(null);
    }
  }, [importSelectedFiles]);


  const restoreSceneState = useCallback(async (sceneState?: PersistedSceneState) => {
    setRestoredTextureStates(sceneState?.textures ?? null);
    setRestoredActiveTextureId(sceneState?.activeSlotKey ?? sceneState?.activeTextureId ?? null);

    if (!sceneState) {
      setTextureHistories({});
      setTextureSnapshots({});
      return;
    }

    const restoredHistories = await Promise.all(
      Object.entries(sceneState.textures).map(async ([textureId, textureState]) => ([
        textureId,
        {
          history: await deserializeOverlayHistory(textureState.history),
          currentIndex: textureState.currentIndex
        }
      ] as const))
    );
    setTextureHistories(Object.fromEntries(restoredHistories));
    setTextureSnapshots(
      Object.fromEntries(
        Object.entries(sceneState.textures).map(([textureId, textureState]) => [
          textureId,
          buildTextureSnapshotFromPersistedState(textureId, textureState)
        ])
      )
    );
  }, []);

  const handleOpenRecentProject = useCallback(async (projectId: string) => {
    try {
      setIsOpeningRecentProjectId(projectId);
      const restoredProject = await loadRecentModelProject(projectId);
      if (!restoredProject) {
        alert('This recent project could not be restored.');
        await refreshRecentProjects();
        return;
      }

      if (restoredProject.kind === 'gltf-bundle') {
        await restoreSceneState(restoredProject.sceneState);
        setSceneName(restoredProject.sceneState?.sceneName || restoredProject.entryFile.name.replace(/\.(glb|gltf)$/i, ''));
        openGltfBundle(
          restoredProject.entryFile,
          restoredProject.files,
          restoredProject.entryFile.name,
          {
            preserveRestoredState: true,
            sceneNameOverride: restoredProject.sceneState?.sceneName || restoredProject.entryFile.name.replace(/\.(glb|gltf)$/i, '')
          }
        );
      } else {
        await restoreSceneState(restoredProject.sceneState);
        setSceneName(restoredProject.sceneState?.sceneName || restoredProject.file.name.replace(/\.(glb|gltf)$/i, ''));
        processSingleFile(restoredProject.file, {
          preserveRestoredState: true,
          sceneNameOverride: restoredProject.sceneState?.sceneName || restoredProject.file.name.replace(/\.(glb|gltf)$/i, '')
        });
      }
    } catch (error) {
      console.error('Failed to open recent project:', error);
      alert('Failed to open recent project.');
    } finally {
      setIsOpeningRecentProjectId(null);
    }
  }, [openGltfBundle, processSingleFile, refreshRecentProjects, restoreSceneState]);

  // Helper to read directory entries natively
  const readDirectory = async (directoryEntry: FileSystemEntryLike): Promise<File[]> => {
    const reader = directoryEntry.createReader?.();
    if (!reader) return [];

    const entries: FileSystemEntryLike[] = await new Promise((resolve) => {
      reader.readEntries(resolve);
    });

    const files: File[] = [];
    for (const entry of entries) {
      if (entry.isFile) {
        const file: File = await new Promise((resolve, reject) => {
          if (!entry.file) {
            reject(new Error('File entry could not be resolved'));
            return;
          }
          entry.file(resolve);
        });
        // Keep the relative path by modifying the File object (sneaky but effective for loaders)
        Object.defineProperty(file, 'webkitRelativePath', {
          value: entry.fullPath.replace(/^\//, '')
        });
        files.push(file);
      } else if (entry.isDirectory) {
        files.push(...await readDirectory(entry));
      }
    }
    return files;
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    // Check if dragging a folder
    const item = items[0].webkitGetAsEntry();
    if (item && item.isDirectory) {
      try {
        const allFiles = await readDirectory(item);
        await importSelectedFiles(allFiles);
      } catch (err) {
        console.error('Failed to parse dropped directory:', err);
        alert('Failed to read the dropped directory.');
      }
    } else if (e.dataTransfer.files.length > 0) {
      await importSelectedFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleTextureSelect = (tex: ExtractedTexture) => {
    const isSameTexture = active3DTexture?.id === tex.id;

    if (!isSameTexture) {
      // Save history of the PREVIOUSLY active texture so it's not lost
      if (active3DTexture) {
        setTextureHistories(prev => ({
          ...prev,
          [active3DTexture.id]: { history, currentIndex }
        }));
      } else if (imageObj) { // If it was a standalone 2D image, save its history
        setTextureHistories(prev => ({
          ...prev,
          ['standalone_2d_image']: { history, currentIndex }
        }));
      }
    }

    setActive3DTexture(tex);
    if (!textureEditBaseRef.current[tex.id]) {
      textureEditBaseRef.current[tex.id] = tex.base64;
    }
    setTextureSnapshots(prev => ({
      ...prev,
      [tex.id]: buildTextureSnapshotFromTexture(tex)
    }));
    const img = new Image();
    img.src = textureEditBaseRef.current[tex.id] || tex.base64;
    img.onload = () => {
      setImageObj(img);
      setShowModelViewer(false);
      window.location.hash = '2d';

      // If we got UV coordinates, pre-select that region perfectly
      if (tex.uv) {
        const texWidth = img.width;
        const texHeight = img.height;

        // Wrap UVs to [0, 1] range in case the 3D model uses repeating textures (u > 1 or v > 1)
        const wrappedU = tex.uv.u - Math.floor(tex.uv.u);
        const wrappedV = tex.uv.v - Math.floor(tex.uv.v);

        // GLTF UV y-axis is mapped natively because GLTFLoader sets texture.flipY = false.
        const pixelX = wrappedU * texWidth;
        const pixelY = wrappedV * texHeight;

        // Start with a standard box size
        let boxSize = 256;
        // Ensure box is not larger than the entire texture itself
        boxSize = Math.min(boxSize, texWidth, texHeight);

        const half = boxSize / 2;

        // Calculate box X and Y, aggressively clamped to the image boundaries
        const boxX = Math.max(0, Math.min(pixelX - half, texWidth - boxSize));
        const boxY = Math.max(0, Math.min(pixelY - half, texHeight - boxSize));

        setSelectionRect({
          x: boxX,
          y: boxY,
          width: boxSize,
          height: boxSize
        });
        setSamPoints([]);
        setSamPromptText('');
        setSamMaskBase64(null);
        setSamMaskOptions([]);
        setSelectedSamMaskIndex(0);
        setSamInteractionRegion(null);
        setCurrentTool('select');
      } else {
        setSelectionRect(null);
        setSamMaskBase64(null);
        setSamMaskOptions([]);
        setSelectedSamMaskIndex(0);
        setSamPoints([]);
        setSamPromptText('');
        setSamInteractionRegion(null);
        setCurrentTool('select');
      }

      // Restore specific history if we've edited this texture before, otherwise clear it to start fresh
      if (!isSameTexture) {
        setHistoryStoreForTexture(tex.id);
      }
    };
  };

  // Helper inside page.tsx to fetch dictionary data without stale closures on inner loops if needed
  const setHistoryStoreForTexture = (texId: string) => {
    setTextureHistories(prev => {
      const savedData = prev[texId];
      if (savedData) {
        setFullState(savedData.history, savedData.currentIndex);
      } else {
        reset([]);
      }
      return prev;
    });
  }

  useEffect(() => {
    if (!active3DTexture) return;

    setTextureHistories(prev => {
      const existing = prev[active3DTexture.id];
      if (existing?.history === history && existing.currentIndex === currentIndex) {
        return prev;
      }

      return {
        ...prev,
        [active3DTexture.id]: { history, currentIndex }
      };
    });
  }, [active3DTexture, currentIndex, history]);

  // Headless compositing helper that doesn't rely on the viewport being open
  const compositeTexture = (tex: ExtractedTexture, currentOverlays: OverlayNode[]) => {
    return new Promise<void>((resolve) => {
      if (tex.sourceKind === 'video') {
        resolve();
        return;
      }

      const img = new Image();
      img.src = textureEditBaseRef.current[tex.id] || tex.base64;
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve();
          return;
        }

        ctx.drawImage(img, 0, 0);

        if (currentOverlays && currentOverlays.length > 0) {
          currentOverlays.forEach((overlay) => {
            ctx.drawImage(overlay.imageObj, overlay.x, overlay.y, overlay.width, overlay.height);
          });
        }

        const nextBase64 = canvas.toDataURL('image/png');
        tex.sourceKind = 'image';
        tex.videoFile = null;
        tex.base64 = nextBase64;
        await tex.applyUpdatedBase64?.(nextBase64);
        setTextureSnapshots(prev => ({
          ...prev,
          [tex.id]: {
            ...buildTextureSnapshotFromTexture(tex),
            base64: nextBase64,
            width: canvas.width,
            height: canvas.height,
            sourceKind: 'image',
            videoFile: null
          }
        }));
        resolve();
      };
      img.onerror = () => resolve();
    });
  };

  // Sync 2D edits back to 3D model automatically when editing
  useEffect(() => {
    if (active3DTexture && overlays) {
      void compositeTexture(active3DTexture, overlays);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlays]);

  // Headless Undo directly from 3D Viewport
  const handleHeadlessUndo = (tex: ExtractedTexture) => {
    const data = textureHistories[tex.id];
    if (!data || data.currentIndex <= 0) return;

    const newIndex = data.currentIndex - 1;
    setTextureHistories(prev => ({
      ...prev,
      [tex.id]: { ...data, currentIndex: newIndex }
    }));

    if (active3DTexture?.id === tex.id) {
      undo();
    }

    compositeTexture(tex, data.history[newIndex]);
  };

  // Headless Redo directly from 3D Viewport
  const handleHeadlessRedo = (tex: ExtractedTexture) => {
    const data = textureHistories[tex.id];
    if (!data || data.currentIndex >= data.history.length - 1) return;

    const newIndex = data.currentIndex + 1;
    setTextureHistories(prev => ({
      ...prev,
      [tex.id]: { ...data, currentIndex: newIndex }
    }));

    if (active3DTexture?.id === tex.id) {
      redo();
    }

    compositeTexture(tex, data.history[newIndex]);
  };

  const handleSelectionComplete = useCallback((rect: { x: number, y: number, width: number, height: number }) => {
    setSelectionRect(rect);
    setSamMaskBase64(null);
    setSamMaskOptions([]);
    setSelectedSamMaskIndex(0);
    setSamPoints([]);
    setSamPromptText('');
    setSamInteractionRegion(rect);
    setShowPrompt(false);
    setCurrentTool('select');
  }, []);

  const handleEnhanceSubmit = async (prompt: string) => {
    if (!imageObj || !konvaViewportRef.current) return;

    // In SAM mode, we don't need a selectionRect, the samMask defines the area
    if (!samMaskBase64 && !selectionRect) return;

    setIsEnhancing(true);

    try {
      let rawBase64Image: string;
      let activeBounds = selectionRect;
      let previewBounds: Rect | null = null;
      let originalContextBase64 = "";

      if (samMaskBase64) {
        // Build one effective mask image (union) for enhancement.
        const combinedMask = samMaskOptions.length > 1 ? await combineMasks(samMaskOptions) : null;
        const effectiveCropMask = combinedMask || samMaskBase64;
        const effectiveFullMask = await expandMaskToFullImage(
          effectiveCropMask,
          imageObj.width,
          imageObj.height,
          samCropRegion
        );

        // 1a. Extract bounds from SAM mask and get cropped image
        const cropData = await getMaskedCrop(effectiveFullMask, imageObj, overlays);
        rawBase64Image = cropData.croppedBase64;
        activeBounds = cropData.bounds;
        previewBounds = cropData.bounds;

        // Save original context to use for compositing later
        // Note: we can't extract the full viewport image if it has UI on it. So we'll just use the base canvas.
        const canvas = document.createElement('canvas');
        canvas.width = imageObj.width; canvas.height = imageObj.height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(imageObj, 0, 0);
        overlays?.forEach(o => ctx?.drawImage(o.imageObj, o.x, o.y, o.width, o.height));
        originalContextBase64 = canvas.toDataURL('image/png');
      } else {
        // 1b. standard rectangular selection
        const extracted = konvaViewportRef.current.extractSelection(selectionRect!);
        if (!extracted) throw new Error("Could not extract image data.");
        rawBase64Image = extracted;
      }

      // 2. Normalize dimensions for Gemini:
      // - keep minimum detail floor
      // - avoid very large requests that often yield empty/failed image outputs
      const scaledBase64 = await normalizeForGemini(rawBase64Image, 512, 1536);

      // 3. Build strict context prompt
      const finalPrompt = buildGeminiPrompt(prompt);

      // 4. Call our Backend API
      const res = await fetch('/api/enhance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: finalPrompt,
          imageBase64: scaledBase64
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to enhance image');
      }

      const { imageBase64 } = await res.json();

      let finalResultBase64 = imageBase64;

      if (!samMaskBase64) {
        finalResultBase64 = await blendRectangularEnhancement(rawBase64Image, imageBase64);
      }

      // 5. If we used SAM, we need to composite the returned image through the mask onto the original 
      // BEFORE showing it to comparison (or show the whole image in comparison)
      if (samMaskBase64 && activeBounds) {
        const combinedMask = samMaskOptions.length > 1 ? await combineMasks(samMaskOptions) : null;
        const effectiveCropMask = combinedMask || samMaskBase64;
        const effectiveFullMask = await expandMaskToFullImage(
          effectiveCropMask,
          imageObj.width,
          imageObj.height,
          samCropRegion
        );
        finalResultBase64 = await compositeWithMask(originalContextBase64, imageBase64, effectiveFullMask, activeBounds);

        // Since it's composited full size, the "active bounds" for the overlay is now the entire image
        activeBounds = { x: 0, y: 0, width: imageObj.width, height: imageObj.height };

        // Original for comparison is just the full image
        rawBase64Image = originalContextBase64;
      }

      // 6. Hand off to comparison UI
      // Important: temporarily store the bounds we used so we know where to place the accepted image
      setSelectionRect(activeBounds!);

      let comparisonOriginal = rawBase64Image;
      let comparisonEnhanced = finalResultBase64;

      // In SAM mode, preview only the edited portion in the slider,
      // but keep full composited image for final apply.
      if (samMaskBase64 && previewBounds) {
        comparisonOriginal = await cropImageToBounds(originalContextBase64, previewBounds);
        comparisonEnhanced = await cropImageToBounds(finalResultBase64, previewBounds);
      }

      setComparisonImages({
        original: comparisonOriginal,
        enhanced: comparisonEnhanced
      });
      setComparisonApplyImage(finalResultBase64);
      setComparisonVariant('enhancement');
      setPendingTextureOptimization(null);
      setShowPrompt(false);
      setShowComparison(true);

    } catch (error) {
      console.error('Enhancement failed:', error);
      alert('Enhancement failed. Please check the console.');
    } finally {
      setIsEnhancing(false);
    }
  };

  const generateSamMask = useCallback(async (points: SamPoint[], promptText?: string) => {
    const activeRegion = samInteractionRegion || getFullImageRect(imageObj);
    const trimmedPrompt = promptText?.trim() || '';
    if (!imageObj || !activeRegion || (points.length === 0 && !trimmedPrompt)) return;

    setIsGeneratingSam(true);

    try {
      // Composite current texture state first so SAM sees applied overlays.
      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = imageObj.width;
      fullCanvas.height = imageObj.height;
      const fullCtx = fullCanvas.getContext('2d');
      if (!fullCtx) return;
      fullCtx.drawImage(imageObj, 0, 0);
      overlays?.forEach((overlay) => {
        fullCtx.drawImage(overlay.imageObj, overlay.x, overlay.y, overlay.width, overlay.height);
      });

      const cropX = Math.round(activeRegion.width < 0 ? activeRegion.x + activeRegion.width : activeRegion.x);
      const cropY = Math.round(activeRegion.height < 0 ? activeRegion.y + activeRegion.height : activeRegion.y);
      const cropW = Math.round(Math.abs(activeRegion.width));
      const cropH = Math.round(Math.abs(activeRegion.height));

      setSamCropRegion({ x: cropX, y: cropY, width: cropW, height: cropH });

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = cropW;
      cropCanvas.height = cropH;
      const cropCtx = cropCanvas.getContext('2d');
      if (!cropCtx) return;
      cropCtx.drawImage(fullCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      // Improve SAM input quality with a light denoise + sharpen pass
      // before a moderate upscale. This is usually better than just magnifying pixels.
      const preprocessedCanvas = preprocessCanvasForSam(cropCanvas);

      // Use adaptive moderate targets instead of always pushing to 3072.
      const IDEAL_LONGEST_SIDE = Math.max(cropW, cropH) <= 768 ? 1536 : 2048;
      const MIN_SCALE_UP = 1;
      const MAX_LONGEST_SIDE = 2048;
      const originalLongestSide = Math.max(cropW, cropH);
      const desiredScale = Math.max(MIN_SCALE_UP, IDEAL_LONGEST_SIDE / originalLongestSide);
      const maxAllowedScale = MAX_LONGEST_SIDE / originalLongestSide;
      const samScale = Math.max(1, Math.min(desiredScale, maxAllowedScale));
      const scaledW = Math.max(1, Math.round(cropW * samScale));
      const scaledH = Math.max(1, Math.round(cropH * samScale));

      const scaledCanvas = document.createElement('canvas');
      scaledCanvas.width = scaledW;
      scaledCanvas.height = scaledH;
      const scaledCtx = scaledCanvas.getContext('2d');
      if (!scaledCtx) return;
      scaledCtx.imageSmoothingEnabled = true;
      scaledCtx.imageSmoothingQuality = 'high';
      scaledCtx.drawImage(preprocessedCanvas, 0, 0, scaledW, scaledH);
      const croppedBase64 = scaledCanvas.toDataURL('image/png');

      // Transform crop-space points into upscaled SAM-space pixel coordinates.
      const pointPrompts = points.map((point) => ({
        x: Math.max(0, Math.min(Math.round((point.x - cropX) * samScale), scaledW - 1)),
        y: Math.max(0, Math.min(Math.round((point.y - cropY) * samScale), scaledH - 1)),
        label: point.label,
        object_id: points.length > 1 ? points.findIndex((candidate) => candidate.id === point.id) : undefined
      }));
      const cropRelativePoints = points.map((point) => ({
        x: Math.max(0, Math.min(Math.round(point.x - cropX), cropW - 1)),
        y: Math.max(0, Math.min(Math.round(point.y - cropY), cropH - 1)),
        label: point.label
      }));

      const res = await fetch('/api/sam3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: croppedBase64,
          points: pointPrompts,
          prompt: trimmedPrompt
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to generate SAM mask');
      }

      const { maskBase64, maskBase64List } = await res.json();
      const rawMasks: string[] = Array.isArray(maskBase64List) && maskBase64List.length > 0
        ? maskBase64List
        : (maskBase64 ? [maskBase64] : []);
      if (rawMasks.length === 0) {
        throw new Error('SAM did not return any masks.');
      }

      // Resize all returned SAM masks back to original crop size.
      const normalizedMasks = await Promise.all(rawMasks.map(async (rawMask) => {
        const normalizedMask = await new Promise<string>((resolve) => {
          const returnedMaskImg = new Image();
          returnedMaskImg.onload = () => {
            const normalizedCanvas = document.createElement('canvas');
            normalizedCanvas.width = cropW;
            normalizedCanvas.height = cropH;
            const normalizedCtx = normalizedCanvas.getContext('2d');
            if (!normalizedCtx) {
              resolve(rawMask);
              return;
            }
            normalizedCtx.imageSmoothingEnabled = true;
            normalizedCtx.imageSmoothingQuality = 'high';
            normalizedCtx.drawImage(returnedMaskImg, 0, 0, cropW, cropH);
            resolve(normalizedCanvas.toDataURL('image/png'));
          };
          returnedMaskImg.onerror = () => resolve(rawMask);
          returnedMaskImg.src = rawMask;
        });
        const shadowRefinedMask = await refineMaskShadowEdges(normalizedMask, cropCanvas);
        const smoothedMask = await smoothMaskEdges(shadowRefinedMask);
        const completedMask = await completeMaskContour(smoothedMask, cropCanvas);
        return addSoftEdgeHalo(completedMask);
      }));

      setSamMaskOptions(normalizedMasks);
      const maskAnalyses = await Promise.all(normalizedMasks.map((mask) => analyzeMask(mask, cropRelativePoints)));
      let bestMaskIndex = 0;
      for (let i = 1; i < maskAnalyses.length; i++) {
        const currentBest = maskAnalyses[bestMaskIndex];
        const candidate = maskAnalyses[i];
        if (
          candidate.negativeInsideCount < currentBest.negativeInsideCount
          || (
            candidate.negativeInsideCount === currentBest.negativeInsideCount
            && candidate.positiveHitCount > currentBest.positiveHitCount
          )
          || (
            candidate.negativeInsideCount === currentBest.negativeInsideCount
            && candidate.positiveHitCount === currentBest.positiveHitCount
            && candidate.area > currentBest.area
          )
        ) {
          bestMaskIndex = i;
        }
      }

      let selectedMask = normalizedMasks[bestMaskIndex];
      let nextMaskOptions = normalizedMasks;
      let selectedBounds = maskAnalyses[bestMaskIndex].bounds;
      let selectedIndex = bestMaskIndex;

      // Multi-point behavior: combine all candidate masks that match at least one clicked point.
      if (cropRelativePoints.length > 1) {
        const matchingMaskIndices = maskAnalyses
          .map((analysis, index) => ({ analysis, index }))
          .filter(({ analysis }) => analysis.positiveHitCount > 0 && analysis.negativeInsideCount === 0)
          .map(({ index }) => index);

        if (matchingMaskIndices.length > 1) {
          const combinedMask = await combineMasks(matchingMaskIndices.map((index) => normalizedMasks[index]));
          if (combinedMask) {
            selectedMask = combinedMask;
            const combinedAnalysis = await analyzeMask(combinedMask, cropRelativePoints);
            selectedBounds = combinedAnalysis.bounds;
            nextMaskOptions = [combinedMask, ...normalizedMasks];
            selectedIndex = 0;
          }
        }
      }

      setSamMaskOptions(nextMaskOptions);
      setSelectedSamMaskIndex(selectedIndex);
      setSamMaskBase64(selectedMask);

      if (selectedBounds) {
        setSelectionRect({
          x: cropX + selectedBounds.x,
          y: cropY + selectedBounds.y,
          width: selectedBounds.width,
          height: selectedBounds.height
        });
      }
      setShowPrompt(true);
    } catch (error) {
      console.error('SAM generation failed:', error);
      alert('SAM selection failed. Try adding points on the object and avoiding the edges.');
    } finally {
      setIsGeneratingSam(false);
    }
  }, [imageObj, overlays, samInteractionRegion]);

  const handleSamClick = async (pos: { x: number, y: number, label: 0 | 1 }) => {
    if (!imageObj || isGeneratingSam) return;

    const clickResult = applyMagicWandClick({
      imageRect: getFullImageRect(imageObj),
      selectionRect,
      samInteractionRegion,
      samPoints,
      pos
    });

    if (clickResult.error === 'invalid-area') {
      alert('Could not determine a valid texture area for the magic wand.');
      return;
    }

    if (clickResult.error === 'outside-selection') {
      alert('Please click inside the selected area.');
      return;
    }

    setSamPoints(clickResult.updatedPoints);
    if (!samInteractionRegion && clickResult.nextInteractionRegion) {
      setSamInteractionRegion(clickResult.nextInteractionRegion);
    }

    if (clickResult.shouldClearMask) {
      setSamMaskBase64(null);
      setSamMaskOptions([]);
      setSelectedSamMaskIndex(0);
      return;
    }
  };

  const handleGenerateSamFromPoints = async () => {
    if (isGeneratingSam) return;
    if (samMode === 'points' && samPoints.length === 0) {
      alert('Add at least one point on the object you want to select.');
      return;
    }
    if (samMode === 'prompt' && !samPromptText.trim()) {
      alert('Enter a description of the object you want to select.');
      return;
    }
    const pointsToUse = samMode === 'points' ? samPoints : [];
    const promptToUse = samMode === 'prompt' ? samPromptText : '';
    await generateSamMask(pointsToUse, promptToUse);
  };

  const handleComparisonAccept = () => {
    if (comparisonVariant === 'textureOptimization' && pendingTextureOptimization) {
      void applyOptimizedTextureResult(pendingTextureOptimization)
        .then(() => {
          setShowComparison(false);
          setComparisonImages(null);
          setComparisonApplyImage(null);
          setComparisonVariant('enhancement');
          setPendingTextureOptimization(null);
        })
        .catch((error) => {
          console.error('Failed to apply optimized texture:', error);
          alert(error instanceof Error ? error.message : 'Could not apply the optimized texture.');
        });
      return;
    }

    if (!comparisonApplyImage || !selectionRect) return;

    const img = new Image();
    img.src = comparisonApplyImage;
    img.onload = () => {
      const newOverlay: OverlayNode = {
        id: Date.now().toString(),
        x: selectionRect.x,
        y: selectionRect.y,
        width: selectionRect.width,  // place it exactly at original selected dimensions
        height: selectionRect.height,
        imageObj: img
      };

      pushState([...(overlays || []), newOverlay]);

      // Close comparison and clear selection
      setShowComparison(false);
      setComparisonImages(null);
      setComparisonApplyImage(null);
      setComparisonVariant('enhancement');
      setPendingTextureOptimization(null);
      setSelectionRect(null);
      setSamMaskBase64(null);
      setSamMaskOptions([]);
      setSelectedSamMaskIndex(0);
      setSamPoints([]);
      setSamPromptText('');
      setSamInteractionRegion(null);
      setCurrentTool('select');
    };
  };

  const handleComparisonReject = () => {
    // Just close and keep selection active in case they want to reprompt
    setShowComparison(false);
    setComparisonImages(null);
    setComparisonApplyImage(null);
    if (comparisonVariant === 'textureOptimization') {
      setPendingTextureOptimization(null);
      setComparisonVariant('enhancement');
      setShowTextureOptimizePanel(true);
      return;
    }

    setShowPrompt(true); // Re-open prompt so they can try again or cancel
  };

  const handleDownload = () => {
    if (!imageObj) return;

    // Create a temporary unseen canvas to composite the final image
    const canvas = document.createElement('canvas');
    canvas.width = imageObj.width;
    canvas.height = imageObj.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw base
    ctx.drawImage(imageObj, 0, 0);

    // Draw overlays
    overlays?.forEach((overlay) => {
      ctx.drawImage(overlay.imageObj, overlay.x, overlay.y, overlay.width, overlay.height);
    });

    // Trigger download
    const dataURL = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `enhanced_texture_${Date.now()}.png`;
    link.href = dataURL;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const composeCurrentTextureDataUrl = useCallback(() => {
    if (!imageObj) {
      throw new Error('No active image to optimize.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = imageObj.width;
    canvas.height = imageObj.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not prepare the current texture for optimization.');
    }

    context.drawImage(imageObj, 0, 0);
    overlays?.forEach((overlay) => {
      context.drawImage(overlay.imageObj, overlay.x, overlay.y, overlay.width, overlay.height);
    });

    return canvas.toDataURL('image/png');
  }, [imageObj, overlays]);

  const reset2DEditState = useCallback(() => {
    setSelectionRect(null);
    setSamMaskBase64(null);
    setSamMaskOptions([]);
    setSelectedSamMaskIndex(0);
    setSamPoints([]);
    setSamPromptText('');
    setSamInteractionRegion(null);
    setCurrentTool('select');
    reset([]);
  }, [reset]);

  const applyOptimizedTextureResult = useCallback(async (result: TextureOptimizationResult) => {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not decode the optimized texture preview.'));
      img.src = result.appliedDataUrl;
    });

    if (active3DTexture) {
      active3DTexture.sourceKind = 'image';
      active3DTexture.videoFile = null;
      active3DTexture.base64 = result.appliedDataUrl;
      active3DTexture.width = img.width;
      active3DTexture.height = img.height;
      textureEditBaseRef.current[active3DTexture.id] = result.appliedDataUrl;
      await active3DTexture.applyUpdatedBase64?.(result.appliedDataUrl);
      setTextureSnapshots(prev => ({
        ...prev,
        [active3DTexture.id]: {
          ...buildTextureSnapshotFromTexture(active3DTexture),
          base64: result.appliedDataUrl,
          width: img.width,
          height: img.height,
          sourceKind: 'image',
          videoFile: null
        }
      }));
      setTextureHistories(prev => ({
        ...prev,
        [active3DTexture.id]: { history: [], currentIndex: 0 }
      }));
    }

    setImageObj(img);
    reset2DEditState();
  }, [active3DTexture, reset2DEditState]);

  const handleOpenTextureOptimizePanel = useCallback(() => {
    if (!imageObj) return;
    setTextureOptimizeError(null);
    setShowPrompt(false);
    setShowTextureOptimizePanel(true);
  }, [imageObj]);

  const handleTextureOptimizeSubmit = useCallback(async (options: TextureOptimizationOptions) => {
    if (!textureOptimizationSource) return;

    setIsOptimizingTexture(true);
    setTextureOptimizeError(null);

    try {
      const composedDataUrl = composeCurrentTextureDataUrl();
      const textureFile = await dataUrlToFile(
        composedDataUrl,
        `${textureOptimizationSource.name.replace(/[^a-zA-Z0-9-_]/g, '_') || 'texture'}.png`
      );
      const formData = new FormData();
      formData.append('image', textureFile);
      formData.append('source', JSON.stringify(textureOptimizationSource));
      formData.append('options', JSON.stringify(options));

      const response = await fetch('/api/optimize-texture', {
        method: 'POST',
        body: formData
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload && typeof payload.error === 'string'
            ? payload.error
            : 'Texture optimization failed.'
        );
      }

      const result = payload as TextureOptimizationResult;
      setPendingTextureOptimization(result);
      setComparisonVariant('textureOptimization');
      setComparisonImages({
        original: composedDataUrl,
        enhanced: result.previewDataUrl
      });
      setComparisonApplyImage(result.appliedDataUrl);
      setShowTextureOptimizePanel(false);
      setShowComparison(true);
    } catch (error) {
      setTextureOptimizeError(error instanceof Error ? error.message : 'Texture optimization failed.');
    } finally {
      setIsOptimizingTexture(false);
    }
  }, [composeCurrentTextureDataUrl, textureOptimizationSource]);

  const applyLocalImageTexture = useCallback(async (file: File) => {
    if (!active3DTexture) return;

    await new Promise<void>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const nextBase64 = typeof reader.result === 'string' ? reader.result : null;
        if (!nextBase64) {
          reject(new Error('Could not read image file.'));
          return;
        }

        const img = new Image();
        img.src = nextBase64;
        img.onload = async () => {
          active3DTexture.sourceKind = 'image';
          active3DTexture.videoFile = null;
          active3DTexture.base64 = nextBase64;
          active3DTexture.width = img.width;
          active3DTexture.height = img.height;
          await active3DTexture.applyUpdatedBase64?.(nextBase64);
          setTextureSnapshots(prev => ({
            ...prev,
            [active3DTexture.id]: {
              ...buildTextureSnapshotFromTexture(active3DTexture),
              base64: nextBase64,
              width: img.width,
              height: img.height,
              sourceKind: 'image',
              videoFile: null
            }
          }));
          setImageObj(img);
          reset2DEditState();
          resolve();
        };
        img.onerror = () => reject(new Error('Could not decode image texture.'));
      };
      reader.onerror = () => reject(new Error('Could not read image file.'));
      reader.readAsDataURL(file);
    });
  }, [active3DTexture, reset2DEditState]);

  const applyLocalVideoTexture = useCallback(async (file: File) => {
    if (!active3DTexture?.applyVideoTexture) return;

    try {
      await active3DTexture.applyVideoTexture(file, (previewBase64, width, height) => {
        active3DTexture.sourceKind = 'video';
        active3DTexture.videoFile = file;
        active3DTexture.base64 = previewBase64;
        active3DTexture.width = width;
        active3DTexture.height = height;
        setTextureSnapshots(prev => ({
          ...prev,
          [active3DTexture.id]: {
            ...buildTextureSnapshotFromTexture(active3DTexture),
            base64: previewBase64,
            width,
            height,
            sourceKind: 'video',
            videoFile: file
          }
        }));

        const img = new Image();
        img.src = previewBase64;
        img.onload = () => setImageObj(img);
      });
      reset2DEditState();
    } catch (error) {
      console.error('Failed to apply video texture:', error);
      alert('Could not load this video as a texture.');
    }
  }, [active3DTexture, reset2DEditState]);

  const handleReplaceActiveTextureImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const isVideoFile = file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name);

    try {
      if (isVideoFile) {
        if (!active3DTexture?.supportsVideo) {
          alert('Video replacement is only supported for base color maps right now.');
          return;
        }
        await applyLocalVideoTexture(file);
      } else {
        await applyLocalImageTexture(file);
      }
    } catch (error) {
      console.error('Failed to replace active texture:', error);
      alert('Could not load this file as a texture.');
    } finally {
      event.target.value = '';
    }
  };

  const handleReplaceActiveTextureVideo = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!active3DTexture?.supportsVideo) {
      alert('Video replacement is only supported for base color maps right now.');
      event.target.value = '';
      return;
    }

    await applyLocalVideoTexture(file);
    event.target.value = '';
  };

  const buildPersistedSceneState = useCallback((): PersistedSceneState | null => {
    if (!modelFile) return null;

    const currentTextureStates: Record<string, PersistedTextureState> = {};
    const allTextureIds = new Set<string>([
      ...Object.keys(textureHistories),
      ...Object.keys(textureSnapshots),
      ...(active3DTexture ? [active3DTexture.id] : [])
    ]);

    allTextureIds.forEach((textureId) => {
      const historyState =
        active3DTexture?.id === textureId
          ? { history, currentIndex }
          : textureHistories[textureId];
      const snapshot =
        active3DTexture?.id === textureId
          ? buildTextureSnapshotFromTexture(active3DTexture)
          : textureSnapshots[textureId];

      if (!snapshot) return;

      const serializedHistory = historyState
        ? serializeOverlayHistory(historyState.history, historyState.currentIndex)
        : { history: [], currentIndex: 0 };

      currentTextureStates[textureId] = {
        slot: snapshot.slot,
        slotLabel: snapshot.slotLabel,
        previewMode: snapshot.previewMode,
        channelPacking: snapshot.channelPacking,
        colorSpace: snapshot.colorSpace,
        supportsVideo: snapshot.supportsVideo,
        materialIndex: snapshot.materialIndex,
        materialName: snapshot.materialName,
        textureIndex: snapshot.textureIndex,
        sourceIndex: snapshot.sourceIndex,
        texCoord: snapshot.texCoord,
        base64: snapshot.base64,
        width: snapshot.width,
        height: snapshot.height,
        sourceKind: snapshot.sourceKind,
        videoBlob: snapshot.videoFile || undefined,
        videoType: snapshot.videoFile?.type,
        videoName: snapshot.videoFile?.name,
        videoLastModified: snapshot.videoFile?.lastModified,
        history: serializedHistory.history,
        currentIndex: serializedHistory.currentIndex
      };
    });

    return {
      sceneName,
      activeSlotKey: active3DTexture?.id || null,
      activeTextureId: active3DTexture?.id || null,
      textures: currentTextureStates
    };
  }, [active3DTexture, currentIndex, history, modelFile, sceneName, textureHistories, textureSnapshots]);

  useEffect(() => {
    const pendingProject = pendingRecentProjectRef.current;
    if (!pendingProject || !modelFile) return;

    const sceneState = buildPersistedSceneState();
    const timeout = window.setTimeout(async () => {
      try {
        let result: SaveRecentProjectResult;
        if (pendingProject.kind === 'gltf-bundle') {
          result = await saveRecentModelProject(pendingProject.entryFile, {
            thumbnailDataUrl: null,
            bundleFiles: pendingProject.files,
            entryFileName: pendingProject.entryFile.name,
            displayName: sceneName,
            sceneState: sceneState || undefined
          });
        } else {
          result = await saveRecentModelProject(pendingProject.file, {
            thumbnailDataUrl: null,
            displayName: sceneName,
            sceneState: sceneState || undefined
          });
        }
        applySaveWarnings(result);
      } catch (error) {
        console.warn('Failed to persist project state:', error);
      }
    }, 600);

    return () => window.clearTimeout(timeout);
  }, [applySaveWarnings, buildPersistedSceneState, modelFile, sceneName]);

  const handleSaveProject = useCallback(async () => {
    const pendingProject = pendingRecentProjectRef.current;
    if (!pendingProject || !modelFile) return;

    setIsSavingProject(true);
    setSaveStatus('saving');
    try {
      if (active3DTexture && overlays) {
        await compositeTexture(active3DTexture, overlays);
      }

      const sceneState = buildPersistedSceneState();
      let result: SaveRecentProjectResult;

      if (pendingProject.kind === 'gltf-bundle') {
        result = await saveRecentModelProject(pendingProject.entryFile, {
          thumbnailDataUrl: null,
          bundleFiles: pendingProject.files,
          entryFileName: pendingProject.entryFile.name,
          displayName: sceneName,
          sceneState: sceneState || undefined
        });
      } else {
        result = await saveRecentModelProject(pendingProject.file, {
          thumbnailDataUrl: null,
          displayName: sceneName,
          sceneState: sceneState || undefined
        });
      }

      applySaveWarnings(result);
      await refreshRecentProjects();
      setSaveStatus('saved');
      window.setTimeout(() => {
        setSaveStatus((currentStatus) => currentStatus === 'saved' ? 'idle' : currentStatus);
      }, 1800);
    } catch (error) {
      console.warn('Failed to save project:', error);
      alert('Failed to save this project locally.');
      setSaveStatus('idle');
    } finally {
      setIsSavingProject(false);
    }
  }, [active3DTexture, applySaveWarnings, buildPersistedSceneState, modelFile, overlays, refreshRecentProjects, sceneName]);

  const selectionActionStyle = selectionViewportRect ? {
    left: `${Math.max(12, Math.min(
      selectionViewportRect.x + selectionViewportRect.width / 2 - 120,
      viewportSize.width - 240 - 12
    ))}px`,
    top: `${Math.min(
      selectionViewportRect.y + selectionViewportRect.height + 4,
      viewportSize.height - 48 + 10
    )}px`
  } : undefined;

  const centeredToolbarTitle = (() => {
    const parts: string[] = [sceneName];

    if (modelFile) {
      parts.push(modelFile.name);
    }

    if (active3DTexture) {
      parts.push(`${active3DTexture.materialName} / ${active3DTexture.slotLabel}`);
      parts.push(`${active3DTexture.width}x${active3DTexture.height}`);

      const approximateBytes = Math.max(
        0,
        Math.round((active3DTexture.base64.length * 3) / 4)
      );
      const sizeLabel =
        approximateBytes >= 1024 * 1024
          ? `${(approximateBytes / (1024 * 1024)).toFixed(2)} MB`
          : `${Math.round(approximateBytes / 1024)} KB`;
      parts.push(sizeLabel);
    }

    return parts.join(' - ');
  })();
  const activeTextureEditingHint = getTextureEditingHint(active3DTexture);
  const comparisonCopy = comparisonVariant === 'textureOptimization'
    ? {
      title: 'Review Optimization',
      subtitle: 'Drag the slider to compare the original texture against the optimized preview.',
      acceptLabel: 'Apply Optimized Texture',
      rejectLabel: 'Adjust Settings',
      resultAlt: 'Optimized texture preview'
    }
    : {
      title: 'Review Enhancement',
      subtitle: 'Drag the slider to compare',
      acceptLabel: 'Apply Edit',
      rejectLabel: 'Discard',
      resultAlt: 'Enhanced AI texture'
    };

  return (
    <div className={styles.container}>
      {!showModelViewer && (
        <Toolbar
          currentTool={currentTool}
          setTool={handleSetTool}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          onSave={handleSaveProject}
          onDownload={handleDownload}
          saveDisabled={!modelFile || isSavingProject}
          saveLabel={saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Save'}
          onUploadClick={resetToHome}
          show3DButton={!!modelFile && !showModelViewer && !showUpload}
          onReturnTo3D={async () => {
            if (active3DTexture && overlays) {
              await compositeTexture(active3DTexture, overlays);
            }
            setShowModelViewer(true);
            window.location.hash = '3d';
          }}
          centerTitle={centeredToolbarTitle}
          showTextureReplace={!!active3DTexture && !!imageObj && !showUpload && !showModelViewer}
          showTextureVideoReplace={!!active3DTexture?.supportsVideo && !!imageObj && !showUpload && !showModelViewer}
          onReplaceTextureImage={() => replaceTextureImageInputRef.current?.click()}
          onReplaceTextureVideo={() => replaceTextureVideoInputRef.current?.click()}
          showTextureOptimize={!!imageObj && !showUpload && !showModelViewer}
          onOptimizeTexture={handleOpenTextureOptimizePanel}
        />
      )}

      {storageWarning && (
        <div className={styles.storageWarning} role="status" aria-live="polite">
          {storageWarning}
        </div>
      )}

      {currentTool === 'sam-select' && !showModelViewer && !showUpload && imageObj && !isGeneratingSam && (
        <div className={styles.samPromptDock}>
          <div className={styles.samPromptBar}>
            <div className={styles.samHeader}>
              <div className={styles.samHeaderLeft}>
                <span className={styles.samHeaderIcon}>✨</span>
                <span className={styles.samHeaderTitle}>Magic Wand</span>
              </div>
              <div className={styles.samModeToggle}>
                <button
                  type="button"
                  className={`${styles.samModeBtn} ${samMode === 'points' ? styles.samModeBtnActive : ''}`}
                  onClick={() => {
                    setSamMode('points');
                    setSamPromptText('');
                    setSamMaskBase64(null);
                    setSamMaskOptions([]);
                    setSelectedSamMaskIndex(0);
                  }}
                >
                  <Crosshair size={14} />
                  Points
                </button>
                <button
                  type="button"
                  className={`${styles.samModeBtn} ${samMode === 'prompt' ? styles.samModeBtnActive : ''}`}
                  onClick={() => {
                    setSamMode('prompt');
                    setSamPoints([]);
                    setSamMaskBase64(null);
                    setSamMaskOptions([]);
                    setSelectedSamMaskIndex(0);
                  }}
                >
                  <MessageSquare size={14} />
                  Prompt
                </button>
              </div>
            </div>

            <p className={styles.samDescription}>
              {samMode === 'points'
                ? 'Click on the object you want to select to add positive points. Use right-click or tap and hold to add negative points and refine the selection.'
                : 'Describe the object you want to select. We\'ll generate a precise mask from your description. Optionally draw a selection rectangle first to limit the search area.'}
            </p>

            {samMode === 'prompt' && (
              <input
                type="text"
                className={styles.samPromptInput}
                placeholder="E.g. chair leg, red table top, lamp shade..."
                value={samPromptText}
                onChange={(e) => setSamPromptText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleGenerateSamFromPoints(); }}
                autoFocus
              />
            )}

            <div className={styles.samActions}>
              {samMode === 'points' && (
                <div className={styles.samPointBadges}>
                  <span className={styles.samPointBadgePos}>
                    {samPoints.filter((p) => p.label === 1).length} positive
                  </span>
                  <span className={styles.samPointBadgeNeg}>
                    {samPoints.filter((p) => p.label === 0).length} negative
                  </span>
                </div>
              )}
              <div className={styles.samActionsRight}>
                <button
                  type="button"
                  className={styles.samSecondaryButton}
                  disabled={samPoints.length === 0 && !samPromptText.trim()}
                  onClick={() => {
                    setSamPoints([]);
                    setSamPromptText('');
                    setSamMaskBase64(null);
                    setSamMaskOptions([]);
                    setSelectedSamMaskIndex(0);
                  }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className={styles.samGenerateButton}
                  disabled={(samMode === 'points' ? samPoints.length === 0 : !samPromptText.trim()) || isGeneratingSam}
                  onClick={handleGenerateSamFromPoints}
                >
                  Generate Mask
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={styles.viewportArea} ref={viewportContainerRef}>
        {activeTextureEditingHint && !showUpload && !showModelViewer && (
          <div className={styles.textureHint} role="note">
            {activeTextureEditingHint}
          </div>
        )}
        <input
          ref={replaceTextureImageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className={styles.hiddenTextureInput}
          onChange={handleReplaceActiveTextureImage}
        />
        <input
          ref={replaceTextureVideoInputRef}
          type="file"
          accept="video/*"
          className={styles.hiddenTextureInput}
          onChange={handleReplaceActiveTextureVideo}
        />

        {!imageObj && !showUpload && !showModelViewer && (
          <div className={styles.emptyState}>
            <ImagePlus size={48} opacity={0.2} />
            <p style={{ fontWeight: 500 }}>No active image</p>
            <p style={{ fontSize: '0.9rem', textAlign: 'center', maxWidth: 400 }}>
              Click the **Upload New Image** icon in the top right to select a local texture, or to import a full 3D GLTF model or GLB file.
            </p>
          </div>
        )}

        {selectionRect && !showPrompt && !showComparison && !showUpload && !showModelViewer && currentTool !== 'sam-select' && selectionViewportRect && (
          <div className={styles.selectionActions} style={selectionActionStyle}>
            <button
              type="button"
              className={styles.selectionActionSecondary}
              onClick={() => setShowPrompt(true)}
            >
              Edit Selection
            </button>
            <button
              type="button"
              className={styles.selectionActionPrimary}
              onClick={() => setCurrentTool('sam-select')}
            >
              Magic Wand
            </button>
          </div>
        )}

        {/* Loading Spinner for SAM inside Viewport */}
        {isGeneratingSam && (
          <div className={styles.samLoadingOverlay}>
            <Loader2 size={48} className={styles.spinner} color="var(--accent-primary)" />
            <p style={{ marginTop: '16px', fontWeight: 500 }}>Generating Smart Mask...</p>
          </div>
        )}

        {/* The Konva Canvas */}
        {viewportSize.width > 0 && (
          <Viewport
            ref={konvaViewportRef}
            currentTool={currentTool}
            imageObj={imageObj}
            overlays={overlays || []}
            onSelectionComplete={handleSelectionComplete}
            onSelectionViewportRectChange={setSelectionViewportRect}
            onSamClick={samMode === 'points' ? handleSamClick : undefined}
            samPoints={samPoints}
            samMaskBase64={samMaskBase64}
            samCropRegion={samCropRegion}
            viewportSize={viewportSize}
            externalSelectionRect={selectionRect}
          />
        )}
      </div>

      {showPrompt && (
        <PromptPanel
          isVisible={showPrompt}
          onClose={() => {
            setShowPrompt(false);
            setSamMaskBase64(null);
            setSamMaskOptions([]);
            setSelectedSamMaskIndex(0);
            setSamPoints([]);
            setSamPromptText('');
            setSamInteractionRegion(null);
            setCurrentTool('select'); // Revert tool if canceled
          }}
          onSubmit={handleEnhanceSubmit}
          isLoading={isEnhancing}
          selectionRect={selectionRect}
          selectionViewportRect={selectionViewportRect}
          viewportBounds={viewportBounds}
          // Pass a boolean so PromptPanel can say "Enhance Selection" or "Enhance Mask"
          isSamMode={!!samMaskBase64}
        />
      )}

      <TextureOptimizePanel
        isVisible={showTextureOptimizePanel}
        source={textureOptimizationSource}
        isSubmitting={isOptimizingTexture}
        errorMessage={textureOptimizeError}
        onClose={() => {
          if (isOptimizingTexture) return;
          setTextureOptimizeError(null);
          setShowTextureOptimizePanel(false);
        }}
        onSubmit={handleTextureOptimizeSubmit}
      />

      {showComparison && comparisonImages && (
        <ComparisonPanel
          isVisible={showComparison}
          originalImageBase64={comparisonImages.original}
          enhancedImageBase64={comparisonImages.enhanced}
          onAccept={handleComparisonAccept}
          onReject={handleComparisonReject}
          title={comparisonCopy.title}
          subtitle={comparisonCopy.subtitle}
          acceptLabel={comparisonCopy.acceptLabel}
          rejectLabel={comparisonCopy.rejectLabel}
          resultAlt={comparisonCopy.resultAlt}
        />
      )}

      {showUpload && (
        <div
          className={styles.uploadOverlay}
          onClick={() => imageObj && setShowUpload(false)}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <div
            className={`${styles.uploadBox} ${isDragging ? styles.uploadBoxDragging : ''}`}
            onClick={(e) => {
              if (isProcessingDrop) return;
              if (e.target !== e.currentTarget) return;
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
          >
            {isProcessingDrop ? (
              <>
                <Loader2 size={48} className={styles.spinner} color="var(--accent-primary)" />
                <div>
                  <h3>Processing Import...</h3>
                  <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
                    Reading folders, extracting ZIPs, and resolving model assets
                  </p>
                </div>
              </>
            ) : (
              <>
                <ImagePlus size={48} color={isDragging ? 'var(--accent-hover)' : 'var(--accent-primary)'} />
                <div>
                  <h3>Load Texture or 3D Model</h3>
                  <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
                    Click to browse files, use the folder picker, or drag and drop images, `.glb`, `.gltf`, `.zip`, or a folder containing a glTF scene and its assets.
                  </p>
                </div>
                <div className={styles.uploadActions} onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className={styles.uploadActionButton}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (isProcessingDrop) return;
                      fileInputRef.current?.click();
                    }}
                  >
                    Browse Files
                  </button>
                  <button
                    type="button"
                    className={`${styles.uploadActionButton} ${styles.uploadActionButtonSecondary}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (isProcessingDrop) return;
                      directoryInputRef.current?.click();
                    }}
                  >
                    Browse Folder
                  </button>
                </div>
                <div className={styles.recentProjectsSection} onClick={(e) => e.stopPropagation()}>
                  <h4 className={styles.recentProjectsTitle}>Recent 3D Projects</h4>
                  {isLoadingRecentProjects ? (
                    <p className={styles.recentProjectsHint}>Loading recent projects...</p>
                  ) : recentProjects.length === 0 ? (
                    <p className={styles.recentProjectsHint}>No recent 3D projects yet.</p>
                  ) : (
                    <div className={styles.recentProjectsList}>
                      {recentProjects.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          className={styles.recentProjectItem}
                          disabled={isOpeningRecentProjectId === project.id}
                          onClick={() => handleOpenRecentProject(project.id)}
                        >
                          <div className={styles.recentProjectThumbFallback}>
                            {isOpeningRecentProjectId === project.id ? (
                              <Loader2 size={16} className={styles.spinner} />
                            ) : (
                              "3D"
                            )}
                          </div>
                          <div className={styles.recentProjectMeta}>
                            <p className={styles.recentProjectName}>{project.name}</p>
                            <p className={styles.recentProjectDate}>
                              {new Date(project.openedAt).toLocaleString()}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className={styles.sampleProjectsSection}>
                    <h4 className={styles.recentProjectsTitle}>Sample Project</h4>
                    <button
                      type="button"
                      className={styles.recentProjectItem}
                      disabled={isOpeningRecentProjectId === SAMPLE_PROJECT_ID || isProcessingDrop}
                      onClick={handleOpenSampleProject}
                    >
                      <div className={styles.sampleProjectThumbWrapper}>
                        {isOpeningRecentProjectId === SAMPLE_PROJECT_ID ? (
                          <div className={styles.recentProjectThumbFallback}>
                            <Loader2 size={16} className={styles.spinner} />
                          </div>
                        ) : (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src="/helmet-thumbnail.png" alt="Flight Helmet" className={styles.recentProjectThumb} />
                        )}
                      </div>
                      <div className={styles.recentProjectMeta}>
                        <p className={styles.recentProjectName}>Flight Helmet</p>
                        <p className={styles.recentProjectDate}>Load bundled sample scene</p>
                      </div>
                    </button>
                  </div>
                </div>
              </>
            )}
            <input
              type="file"
              accept=".glb,.gltf,.zip,image/png,image/jpeg,image/webp"
              ref={fileInputRef}
              onChange={handleFileUpload}
              multiple
              className={styles.hiddenTextureInput}
            />
            <input
              type="file"
              ref={directoryInputRef}
              onChange={handleDirectoryUpload}
              multiple
              className={styles.hiddenTextureInput}
            />
          </div>
        </div>
      )}

      <div style={{ display: showModelViewer && (modelFile || gltfModelUrl) ? 'block' : 'none' }}>
        {(modelFile || gltfModelUrl) && (
          <ModelViewer
            file={modelFile!}
            bundleFiles={modelBundleFiles}
            resolvedUrl={gltfModelUrl}
            sceneName={sceneName}
            onSceneNameChange={setSceneName}
            restoredTextureStates={restoredTextureStates}
            restoredActiveTextureId={restoredActiveTextureId}
            onSaveProject={handleSaveProject}
            saveLabel={saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Save'}
            onTextureSelect={handleTextureSelect}
            textureHistories={textureHistories}
            onUndo={handleHeadlessUndo}
            onRedo={handleHeadlessRedo}
            onModelSnapshot={handleModelSnapshot}
            onNewProject={resetToHome}
          />
        )}

        {currentTool === 'sam-select' && !showModelViewer && !showUpload && imageObj && samMaskOptions.length > 1 && samCropRegion && (
          <div className={styles.samMaskPicker}>
            <p className={styles.samMaskPickerTitle}>Mask Candidates</p>
            <div className={styles.samMaskPickerList}>
              {samMaskOptions.map((mask, index) => (
                <button
                  key={`${index}-${mask.slice(0, 32)}`}
                  type="button"
                  className={`${styles.samMaskOption} ${selectedSamMaskIndex === index ? styles.samMaskOptionActive : ''}`}
                  onClick={async () => {
                    setSelectedSamMaskIndex(index);
                    setSamMaskBase64(mask);
                    const maskBounds = await getMaskBounds(mask);
                    if (maskBounds) {
                      setSelectionRect({
                        x: samCropRegion.x + maskBounds.x,
                        y: samCropRegion.y + maskBounds.y,
                        width: maskBounds.width,
                        height: maskBounds.height
                      });
                    }
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mask} alt={`Mask ${index + 1}`} />
                  <span>{index === 0 && samMaskOptions.length > 1 ? 'Combined' : `Mask ${index + 1}`}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
