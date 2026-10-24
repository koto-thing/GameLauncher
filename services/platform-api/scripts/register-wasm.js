import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";

// Node の契約テストで Workers と同じ静的 Wasm インポートを提供する
registerHooks({
  /**
   * Node の Wasm import をコンパイル済みモジュールとして読み込む
   * @param {string} url 読み込むモジュールの URL
   * @param {object} context Node の読込コンテキスト
   * @param {Function} nextLoad 次のモジュールローダー
   * @returns {object} Wasm または後続ローダーの読込結果
   */
  load(url, context, nextLoad) {
    if (!url.endsWith(".wasm")) return nextLoad(url, context);

    return { format: "module", shortCircuit: true, source: `export default new WebAssembly.Module(new Uint8Array(${JSON.stringify([...readFileSync(new URL(url))])}));` };
  },
});
