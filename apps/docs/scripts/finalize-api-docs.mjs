import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputPath = resolve(import.meta.dirname, "..", "dist", "reference", "admin", "index.html");
let html = await readFile(outputPath, "utf8");

// Redocly emits the full rendered document as HTML. The accompanying client
// hydration only duplicates that work and can report false hydration mismatch
// errors, so the Pages artifact deliberately keeps the static HTML and CSS.
html = html
  .replace(/<script src="https:\/\/cdn\.redocly\.com\/redoc\/[^>]+><\/script>/, "")
  .replace(/\s*<script>\s*const __redoc_state = [\s\S]*?Redoc\.hydrate\(__redoc_state, container\);\s*<\/script>/, "");

if (html.includes("Redoc.hydrate") || html.includes("cdn.redocly.com/redoc/")) {
  throw new Error("Failed to remove Redoc's client hydration from the static API reference.");
}

await writeFile(outputPath, html, "utf8");
console.log(`Finalized static API reference at ${outputPath}.`);
