import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputPath = resolve(import.meta.dirname, "..", "dist", "reference", "admin", "index.html");
let html = await readFile(outputPath, "utf8");

// 事前描画済みの API 本文を配信するため、Redoc のモジュール先読みと再描画処理を除く
html = html
  .replace(/<link rel="modulepreload" href="https:\/\/cdn\.redocly\.com\/redoc\/[^>]*>/g, "")
  .replace(/<script type="module">\s*import \{ hydrate \} from "https:\/\/cdn\.redocly\.com\/redoc\/[\s\S]*?<\/script>/, "");

if (html.includes("__redoc_definition") || html.includes("cdn.redocly.com/redoc/")) {
  throw new Error("Failed to remove Redoc's client hydration from the static API reference.");
}

await writeFile(outputPath, html, "utf8");
console.log(`Finalized static API reference at ${outputPath}.`);
