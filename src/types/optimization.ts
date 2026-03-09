import type { ExtractedTexture, PbrMapSlot } from '@/types/model';

export type OptimizationPresetId = 'balanced' | 'smallest' | 'preserveQuality';
export type TextureOptimizationFormat = 'png' | 'jpeg' | 'webp' | 'ktx2';
export type TextureOptimizationDelivery = 'inline' | 'downloadOnly';
export type TextureOptimizationKtx2Mode = 'etc1s' | 'uastc';
export type GltfTextureMode = 'preserve' | 'webp' | 'ktx2';
export type GltfOptimizationOutputFormat = 'glb' | 'gltf';

export interface TextureOptimizationPreset {
  id: OptimizationPresetId;
  label: string;
  description: string;
}

export interface GltfOptimizationPreset {
  id: OptimizationPresetId;
  label: string;
  description: string;
}

export interface TextureOptimizationOptions {
  presetId: OptimizationPresetId;
  format: TextureOptimizationFormat;
  quality: number;
  resizePercent: number;
  ktx2Mode: TextureOptimizationKtx2Mode;
}

export interface TextureOptimizationSourceMeta {
  name: string;
  slot: PbrMapSlot;
  slotLabel: string;
  channelPacking: ExtractedTexture['channelPacking'];
  colorSpace: ExtractedTexture['colorSpace'];
  width: number;
  height: number;
}

export interface TextureOptimizationResult {
  format: TextureOptimizationFormat;
  delivery: TextureOptimizationDelivery;
  previewDataUrl: string;
  appliedDataUrl: string;
  outputBase64: string;
  outputMimeType: string;
  outputFilename: string;
  outputBytes: number;
  width: number;
  height: number;
}

export interface GltfOptimizationOptions {
  presetId: OptimizationPresetId;
  outputFormat: GltfOptimizationOutputFormat;
  textureMode: GltfTextureMode;
  textureQuality: number;
  textureScalePercent: number;
  maxTextureSize: number;
}

export const OPTIMIZATION_PRESETS: TextureOptimizationPreset[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Good size savings without visibly changing most textures.'
  },
  {
    id: 'smallest',
    label: 'Smallest File',
    description: 'Pushes compression harder for lighter downloads.'
  },
  {
    id: 'preserveQuality',
    label: 'Preserve Quality',
    description: 'Keeps more detail and minimizes visible artifacts.'
  }
];

export const GLTF_OPTIMIZATION_PRESETS: GltfOptimizationPreset[] = OPTIMIZATION_PRESETS;

export const TEXTURE_FORMAT_OPTIONS: Array<{ value: TextureOptimizationFormat; label: string }> = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
  { value: 'ktx2', label: 'KTX2' }
];

export const GLTF_TEXTURE_MODE_OPTIONS: Array<{ value: GltfTextureMode; label: string }> = [
  { value: 'preserve', label: 'Keep current textures' },
  { value: 'webp', label: 'Convert textures to WebP' },
  { value: 'ktx2', label: 'Convert textures to KTX2' }
];

export const KTX2_MODE_OPTIONS: Array<{ value: TextureOptimizationKtx2Mode; label: string }> = [
  { value: 'etc1s', label: 'ETC1S (smaller)' },
  { value: 'uastc', label: 'UASTC (higher quality)' }
];

export const getDefaultTextureFormat = (slot: PbrMapSlot): TextureOptimizationFormat => {
  if (slot === 'baseColor' || slot === 'emissive') {
    return 'webp';
  }

  return 'png';
};

export const getDefaultTextureOptions = (
  slot: PbrMapSlot,
  presetId: OptimizationPresetId = 'balanced'
): TextureOptimizationOptions => {
  const base: TextureOptimizationOptions = {
    presetId,
    format: getDefaultTextureFormat(slot),
    quality: 82,
    resizePercent: 100,
    ktx2Mode: slot === 'normal' || slot === 'metallicRoughness' || slot === 'occlusion' ? 'uastc' : 'etc1s'
  };

  if (presetId === 'smallest') {
    return {
      ...base,
      format: slot === 'normal' || slot === 'metallicRoughness' || slot === 'occlusion' ? 'ktx2' : 'webp',
      quality: 68,
      resizePercent: 75
    };
  }

  if (presetId === 'preserveQuality') {
    return {
      ...base,
      format: slot === 'baseColor' || slot === 'emissive' ? 'webp' : 'png',
      quality: 92,
      resizePercent: 100
    };
  }

  return base;
};

export const getDefaultGltfOptimizationOptions = (
  outputFormat: GltfOptimizationOutputFormat = 'glb',
  presetId: OptimizationPresetId = 'balanced'
): GltfOptimizationOptions => {
  if (presetId === 'smallest') {
    return {
      presetId,
      outputFormat,
      textureMode: 'ktx2',
      textureQuality: 7,
      textureScalePercent: 75,
      maxTextureSize: 2048
    };
  }

  if (presetId === 'preserveQuality') {
    return {
      presetId,
      outputFormat,
      textureMode: 'preserve',
      textureQuality: 10,
      textureScalePercent: 100,
      maxTextureSize: 4096
    };
  }

  return {
    presetId,
    outputFormat,
    textureMode: 'webp',
    textureQuality: 8,
    textureScalePercent: 100,
    maxTextureSize: 2048
  };
};

export const isLossyTextureFormat = (format: TextureOptimizationFormat) =>
  format === 'jpeg' || format === 'webp' || format === 'ktx2';

export const getTextureOptimizationWarnings = (
  texture: Pick<TextureOptimizationSourceMeta, 'slot' | 'channelPacking'>,
  options: Pick<TextureOptimizationOptions, 'format'>
) => {
  const warnings: string[] = [];

  if ((texture.slot === 'normal' || texture.channelPacking === 'gltfMetallicRoughness') && isLossyTextureFormat(options.format)) {
    warnings.push('Lossy compression can damage packed channels and normal-map direction data.');
  }

  if (texture.slot === 'occlusion' && options.format === 'jpeg') {
    warnings.push('JPEG can introduce blocking artifacts on grayscale occlusion maps.');
  }

  if (options.format === 'ktx2') {
    warnings.push('KTX2 is export-oriented. The editor keeps a raster preview so you can continue working.');
  }

  return warnings;
};
