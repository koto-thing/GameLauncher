import { readFile, readdir } from "node:fs/promises";
import { resolve, relative, dirname, extname } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const docsRoot = resolve(repositoryRoot, "docs");
const forbiddenPath = /(?:^|[\\/])(client|backend|publisher|installer|contracts|apps[\\/]control-plane)(?:[\\/]|$)/i;
const secretValue = /(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|X-Amz-(?:Credential|Signature)=|R2_SECRET_ACCESS_KEY\s*=\s*\S+|SESSION_SECRET\s*=\s*\S+)/i;
const absoluteLocalPath = /(?:[A-Z]:\\Users\\|\/home\/[^/]+\/|\/Users\/[^/]+\/)/i;

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if ([".vitepress", "node_modules"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await markdownFiles(path));
    else if (entry.name.endsWith(".md")) result.push(path);
  }
  return result;
}

const failures = [];
const files = await markdownFiles(docsRoot);
for (const file of files) {
  const content = await readFile(file, "utf8");
  const display = relative(repositoryRoot, file);
  if (secretValue.test(content)) failures.push(`${display}: secret-like value`);
  if (absoluteLocalPath.test(content)) failures.push(`${display}: local absolute path`);
  if (!display.includes("PLAN") && !display.includes("HANDOFF")) {
    for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split("#", 1)[0];
      if (!target || /^(?:https?:|mailto:|#)/.test(target)) continue;
      const decoded = decodeURIComponent(target);
      if (forbiddenPath.test(decoded)) failures.push(`${display}: obsolete path ${decoded}`);
      const resolved = resolve(dirname(file), decoded);
      if (!extname(resolved) && !decoded.endsWith("/")) continue;
      try {
        await readFile(resolved);
      } catch {
        failures.push(`${display}: missing link target ${decoded}`);
      }
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} Markdown files.`);
}
