/** Validate a self-contained VRM binary before handing it to the renderer */
export function validateVrm(buffer) {
  // Check the container and JSON chunk boundaries before decoding
  if (buffer.byteLength < 20 || buffer.byteLength > 128 * 1024 * 1024) {
    throw new Error('VRM must be a GLB file no larger than 128 MiB');
  }
  const view = new DataView(buffer);
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== buffer.byteLength ||
      view.getUint32(16, true) !== 0x4e4f534a || jsonLength > buffer.byteLength - 20) {
    throw new Error('Invalid VRM GLB container');
  }

  // Models are bundled assets and must not request external files or network content
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  if (!json.extensions?.VRM && !json.extensions?.VRMC_vrm) {
    throw new Error('The model has no VRM extension');
  }
  for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (item.uri !== undefined) throw new Error('VRM resources must be embedded in the GLB');
  }
  return json;
}
