import { stat } from "node:fs/promises";

// CI must consume the outputs prepared in this job instead of silently rebuilding
const artifacts = [
  "../dist/index.html",
  "../../admin-web/public/music-editor/manager.js",
  "../../admin-web/lib/generated/intake-policy.wasm",
  "../../admin-web/lib/generated/music-upload-policy.wasm",
  "../../admin-web/lib/generated/schema-validators.js",
  "../../admin-web/dist/server/wrangler.json",
];

for (const artifact of artifacts) {
  const file = new URL(artifact, import.meta.url);
  if (!(await stat(file)).isFile()) {
    throw new Error(`Missing prepared artifact: ${file.pathname}`);
  }
}
