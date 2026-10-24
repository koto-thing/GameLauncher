# Download API Rust migration, Part 1

The Worker now executes Rust compiled to WebAssembly for every parsed download
pointer. Rust validates the exact version, digest, schema and safe positive integer
size contract. There is no JavaScript validation fallback. JavaScript retains JSON
decoding, R2 get/head calls, artifact metadata comparison and HTTP responses.

The standalone `rust/` crate has no dependencies and does not modify the shared
Cargo workspace. Its small fixed memory ABI needs no wasm-bindgen runtime or CLI.
Input is copied and validated synchronously, with no await between those operations.
The 8192-byte capacity exceeds the input possible under the existing 4096-byte
R2 pointer limit. Rust rejects invalid lengths before reading memory.

## Build and verify

Generated Wasm is committed, following the existing Music generated-artifact
convention, so ordinary Worker checks and deployment do not need Rust installed.
Rust 1.94.1 was used; rebuilding requires the official Wasm standard library target:

```sh
rustup target add wasm32-unknown-unknown
npm run build:rust
cargo test --manifest-path rust/Cargo.toml --locked
npm ci
npm test
npm run check
```

Run these commands in this directory. `npm run check` only creates a dry-run
deployment bundle. Unit tests exercise the actual committed Wasm against the old
JavaScript validation rules; Miniflare tests run the real module with local R2.
The integration owner can add regeneration plus a clean-diff assertion to the
shared `launcher-download-check.yml`; this migration does not edit that workflow.

## Contract and delivery boundary

- GET and HEAD `/download/windows` resolve to the fixed public artifact origin
- Other paths return 404; other methods return 405 with `Allow: GET, HEAD`
- Missing/oversized pointers return 503 with the existing unavailable message
- Invalid JSON, invalid pointers, missing/mismatched artifacts and R2 failures
  retain the existing temporary-unavailable 503 response and logging
- All responses retain no-store cache headers and nosniff; HEAD has no body
- Query parameters cannot alter the target; no authentication or CORS is added
- The Worker only redirects: byte streaming, range requests and artifact caching
  remain on the existing public R2 `/v1/*` path, outside its route
- This service has no signed download endpoint

## Release and rollback

Keep the existing Worker name, compatibility settings, route and RELEASES binding
in `wrangler.jsonc`. Wasm is supported within the current Cloudflare Worker host;
no hosting change or paid dependency is required. The dry-run upload must include
`validation.wasm`. Run the existing production release checks before authorizing
deployment. This change does not publish a pointer, alter R2 objects or deploy.

After approval, use the existing `npm run deploy` procedure. Roll back by deploying
the previous Worker bundle/revision. R2 pointer and artifact state are unchanged.
