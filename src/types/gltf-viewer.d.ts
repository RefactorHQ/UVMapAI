declare module '@khronosgroup/gltf-viewer' {
  export const GltfView: unknown;
  export const GltfState: {
    ToneMaps: Record<string, string>;
    DebugOutput: Record<string, string | Record<string, string>>;
  };
  export const ResourceLoader: unknown;
}

declare module '@khronosgroup/gltf-viewer/dist/gltf-viewer.js' {
  export const GltfView: unknown;
  export const GltfState: {
    ToneMaps: Record<string, string>;
    DebugOutput: Record<string, string | Record<string, string>>;
  };
  export const ResourceLoader: unknown;
}
