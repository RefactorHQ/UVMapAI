import { describe, expect, it } from 'vitest';
import {
  getDefaultGltfOptimizationOptions,
  getDefaultTextureOptions,
  getTextureOptimizationWarnings
} from './optimization';

describe('optimization helpers', () => {
  it('uses safer defaults for technical maps', () => {
    const options = getDefaultTextureOptions('normal');

    expect(options.format).toBe('png');
    expect(options.ktx2Mode).toBe('uastc');
  });

  it('tightens the smallest gltf export preset', () => {
    const options = getDefaultGltfOptimizationOptions('glb', 'smallest');

    expect(options.textureMode).toBe('ktx2');
    expect(options.textureScalePercent).toBe(75);
    expect(options.maxTextureSize).toBe(2048);
  });

  it('warns when lossy compression is used on packed textures', () => {
    const warnings = getTextureOptimizationWarnings(
      {
        slot: 'metallicRoughness',
        channelPacking: 'gltfMetallicRoughness'
      },
      {
        format: 'webp'
      }
    );

    expect(warnings.some((warning) => warning.includes('Lossy compression'))).toBe(true);
  });
});
