import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, relative, dirname, extname } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const configuredBase = process.env.DOCS_BASE_PATH?.trim() || "/";
const base = configuredBase === "/" ? "/" : `/${configuredBase.replace(/^\/+|\/+$/g, "")}/`;
const failures = [];

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}

async function exists(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

for (const required of ["index.html", "reference/admin-api.html", "reference/admin/index.html", "reference/cpp/index.html", "robots.txt"]) {
  if (!await exists(resolve(dist, required))) failures.push(`missing required output: ${required}`);
}

const allFiles = await files(dist);
for (const file of allFiles) {
  if (file.endsWith(".html")) {
    const content = await readFile(file, "utf8");
    if (/(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|X-Amz-(?:Credential|Signature)=|[A-Z]:\\Users\\|\/home\/[^/]+\/)/i.test(content)) {
      failures.push(`${relative(dist, file)}: secret or local path pattern`);
    }
    for (const match of content.matchAll(/(?:href|src)=["']([^"']+)["']/g)) {
      let target = match[1];
      if (/^(?:https?:|mailto:|data:|javascript:|#)/i.test(target)) continue;
      target = decodeURIComponent(target.split(/[?#]/, 1)[0]);
      if (!target) continue;
      let candidate;
      if (target.startsWith("/")) {
        if (base !== "/" && !target.startsWith(base)) {
          failures.push(`${relative(dist, file)}: path escapes Pages base: ${target}`);
          continue;
        }
        candidate = resolve(dist, base === "/" ? target.slice(1) : target.slice(base.length));
      } else {
        candidate = resolve(dirname(file), target);
      }
      if (await exists(candidate)) continue;
      if (!extname(candidate) && (await exists(`${candidate}.html`) || await exists(resolve(candidate, "index.html")))) continue;
      failures.push(`${relative(dist, file)}: broken local asset/link ${target}`);
    }
  }
}

if (failures.length) {
  console.error([...new Set(failures)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked ${allFiles.length} generated files under base ${base}.`);
}
