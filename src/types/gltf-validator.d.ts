declare module 'gltf-validator' {
  export function validateBytes(
    bytes: Uint8Array,
    options?: Record<string, unknown>
  ): Promise<unknown>;
}
