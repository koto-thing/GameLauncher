import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Bundle the actual Worker entry point before exercising it inside workerd
function build() {
  execFileSync(process.execPath, [fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)),
    "deploy", "--dry-run", "--outdir", ".wrangler/test-worker", "--env", ""], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "pipe",
  });
}

build();
