declare module "*.wasm?module" {
  const compiledModule: WebAssembly.Module;
  export default compiledModule;
}
