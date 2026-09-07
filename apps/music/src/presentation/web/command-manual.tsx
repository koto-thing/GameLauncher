import { useEffect, useState } from "react";
import { displayCommand, normalizeCommand } from "../../domain/command-code";
/** @brief コントローラー・キーボード・貼り付けを同じ12枠へ入力する */
export function CommandManual({
  submit,
  busy,
}: {
  submit: (code: string) => void;
  busy: boolean;
}) {
  const [code, setCode] = useState(""),
    [paste, setPaste] = useState(""),
    [error, setError] = useState("");
  /** @brief 入力は最大12記号で止め、検査記号を自動生成しない */
  function add(c: string) {
    setCode(
      /** @brief 連打でも現在の入力へ追加する */ (current) =>
        current.length < 12 ? current + c : current,
    );
  }
  useEffect(
    /** @brief テキスト入力や修飾キーの操作を横取りしない */ () => {
      /** @brief 矢印キーとABXYだけを読み、入力欄内は通常の文字入力に任せる */
      function key(e: KeyboardEvent) {
        const target = e.target as HTMLElement;
        if (
          busy ||
          e.ctrlKey ||
          e.metaKey ||
          e.altKey ||
          target.closest("input,textarea,select,[contenteditable=true]")
        )
          return;
        const keys: Record<string, string> = {
          ArrowUp: "U",
          ArrowDown: "D",
          ArrowRight: "R",
          ArrowLeft: "L",
        };
        const c = keys[e.key] ?? e.key.toUpperCase();
        if (/^[ABXY]$/.test(c) || keys[e.key]) {
          e.preventDefault();
          add(c);
        }
      }
      window.addEventListener("keydown", key);
      return /** @brief 入力方法を離れたらキー処理を外す */ () =>
        window.removeEventListener("keydown", key);
    },
    [busy],
  );
  return (
    <div className="command-manual">
      <h2>コマンド入力 · v1</h2>
      <ol className="command-slots" aria-label="12記号の入力状況">
        {Array.from(
          { length: 12 },
          /** @brief 空欄も読み上げ可能にする */ (_, i) => (
            <li
              key={i}
              aria-label={`${i + 1}番 ${code[i] ? displayCommand(code[i]) : "未入力"}`}
            >
              {code[i] ? displayCommand(code[i]) : "·"}
            </li>
          ),
        )}
      </ol>
      <div className="command-pad">
        <div className="direction-pad">
          {[
            ["U", "↑", "上"],
            ["L", "←", "左"],
            ["D", "↓", "下"],
            ["R", "→", "右"],
          ].map(
            /** @brief 方向キーの意味を日本語で読み上げる */ ([
              c,
              label,
              name,
            ]) => (
              <button
                className={`direction-${c}`}
                key={c}
                disabled={busy || code.length === 12}
                aria-label={name}
                onClick={/** @brief 押した方向を追加する */ () => add(c)}
              >
                {label}
              </button>
            ),
          )}
        </div>
        <div className="letter-pad">
          {[..."ABXY"].map(
            /** @brief 4ボタンを固定順で表示する */ (c) => (
              <button
                key={c}
                disabled={busy || code.length === 12}
                onClick={/** @brief 押した記号を追加する */ () => add(c)}
              >
                {c}
              </button>
            ),
          )}
        </div>
      </div>
      <div className="command-actions">
        <button
          disabled={busy}
          onClick={
            /** @brief 検査部を含め1文字戻す */ () =>
              setCode(code.slice(0, -1))
          }
        >
          1文字削除
        </button>
        <button
          disabled={busy}
          onClick={
            /** @brief 全枠を空に戻す */ () => {
              setCode("");
              setError("");
            }
          }
        >
          全消去
        </button>
        <button
          className="primary"
          disabled={busy || code.length !== 12}
          onClick={
            /** @brief 共通Use Caseで検査して照会する */ () => submit(code)
          }
        >
          読み込む
        </button>
      </div>
      <label>
        記号またはASCIIを貼り付け
        <input
          value={paste}
          onChange={
            /** @brief 不明文字を削除せず元の入力を保持する */ (e) =>
              setPaste(e.target.value)
          }
        />
      </label>
      <p className="hint">
        区切りは空白・改行・ハイフン・カンマ。小文字も使えます。
      </p>
      <button
        disabled={busy}
        onClick={
          /** @brief 許可した記号だけを枠に反映する */ () => {
            try {
              setCode(normalizeCommand(paste));
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }
        }
      >
        入力枠へ反映
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
