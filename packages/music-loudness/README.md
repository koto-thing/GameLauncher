# Music loudness measurement

Thin WebAssembly boundary around [LoudnessMeter](https://github.com/koto-thing/LoudnessMeter), pinned to commit `c828effc8ccff7f61312fcbe53693aa7c2d30127`. The Rust dependency implements all loudness and true-peak DSP. This adapter only exposes full-track measurement and represents unavailable/non-finite peak values as absent values.

`generated/` is checked in so normal Music builds do not require Rust or a network fetch. It is included only in the manager bundle. The listener bundle contains only the fixed-gain calculation and Web Audio output graph.

To regenerate from the repository root (Rust 1.94.1 was used):

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.114 --locked
cargo build --manifest-path packages/music-loudness/Cargo.toml --target wasm32-unknown-unknown --release --locked
wasm-bindgen packages/music-loudness/target/wasm32-unknown-unknown/release/music_loudness.wasm --target web --out-dir packages/music-loudness/generated
```

Run `node --import tsx --test tests/unit/loudness.test.ts` from `apps/music` to exercise the actual generated WASM, not a mock. After changing the Rust source, regenerate before running Music builds/tests.

LoudnessMeter is used under its MIT license; see `LICENSE-LoudnessMeter`. The wasm-bindgen runtime/glue is used under MIT; see `LICENSE-wasm-bindgen`.
