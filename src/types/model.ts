export interface TextureUvCoordinate {
  u: number;
  v: number;
}

export type PbrMapSlot = 'baseColor' | 'normal' | 'metallicRoughness' | 'occlusion' | 'emissive';

export type PbrMapPreviewMode = 'color' | 'normal' | 'grayscale' | 'channelPacked';

export type PbrChannelPacking = 'none' | 'gltfMetallicRoughness';

export type PbrColorSpace = 'srgb' | 'linear';

export interface TextureTransform {
  offset?: [number, number];
  scale?: [number, number];
  rotation?: number;
}

export interface ExtractedTexture {
  id: string;
  slotKey: string;
  name: string;
  slot: PbrMapSlot;
  slotLabel: string;
  previewMode: PbrMapPreviewMode;
  channelPacking: PbrChannelPacking;
  colorSpace: PbrColorSpace;
  supportsVideo: boolean;
  materialIndex: number;
  materialName: string;
  textureIndex: number;
  sourceIndex: number;
  texCoord?: number;
  textureTransform?: TextureTransform | null;
  base64: string;
  width: number;
  height: number;
  sourceKind?: 'image' | 'video';
  videoFile?: File | null;
  uv?: TextureUvCoordinate | null;
  applyUpdatedBase64?: (nextBase64: string) => Promise<void> | void;
  applyVideoTexture?: (
    file: File,
    onPreviewFrame?: (previewDataUrl: string, width: number, height: number) => void
  ) => Promise<void> | void;
}
