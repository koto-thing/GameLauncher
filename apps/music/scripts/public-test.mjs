import path from "node:path";
process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve("build/browsers");
await import("./verify-public-independence.mjs");
