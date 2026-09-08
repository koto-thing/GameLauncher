import { useState } from "react";
import { commandSvg } from "../../domain/command-art";
import { encodeCommand, displayCommand } from "../../domain/command-code";
import type { CommandCode } from "../../../../../contracts/music/command-code-v1";
import { COMMAND_RUNTIME } from "../../config/command-runtime.defaults";

export interface CommandExport {
  png(svg: string, width: number): Promise<Blob>;
  save(blob: Blob, name: string): void;
}

/** @brief 永続予約から同じ図形を表示し、未発行なら準備中だけを表示する */
export function CommandShare({
  assignment,
  url,
  exporter,
}: {
  assignment?: CommandCode;
  url: string;
  exporter: () => Promise<CommandExport>;
}) {
  const [open, setOpen] = useState(false),
    [message, setMessage] = useState(""),
    [displayPercent, setDisplayPercent] = useState(100),
    [width, setWidth] = useState<number>(COMMAND_RUNTIME.pngWidth),
    [busy, setBusy] = useState(false);
  if (!assignment) return <p className="hint">コマンドコードは準備中です。</p>;
  const code = encodeCommand(assignment.codeId),
    svg = commandSvg(assignment.codeId);
  /** @brief 保存エラー・クリップボード拒否を利用者へ表示する */
  async function action(kind: "png" | "svg" | "code" | "url") {
    setBusy(true);
    setMessage("");
    try {
      if (kind === "code" || kind === "url")
        await navigator.clipboard.writeText(
          kind === "code" ? displayCommand(code) : url,
        );
      else {
        const output = await exporter();
        const blob =
          kind === "png"
            ? await output.png(svg, width)
            : new Blob([svg], { type: "image/svg+xml" });
        output.save(blob, `pandd-command-v1-${code}.${kind}`);
      }
      setMessage(
        kind === "code" || kind === "url"
          ? "コピーしました。"
          : "保存を開始しました。",
      );
    } catch {
      setMessage(
        "保存・コピーに失敗しました。ブラウザーの許可を確認してください。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="command-share">
      <button
        onClick={
          /** @brief 共有画面の表示だけを切り替える */ () => setOpen(!open)
        }
        aria-expanded={open}
      >
        コマンドコード
      </button>
      {open && (
        <div className="command-card">
          <h2>PandD Command Code · v1</h2>
          <img
            className="command-image"
            src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
            alt={`v1 コマンドコード ${displayCommand(code)}`}
            style={{ width: `${displayPercent}%` }}
          />
          <p className="command-text">{displayCommand(code)}</p>
          <p>「コードを読み取る」から、画像・カメラ・手入力で開けます。</p>
          <label>
            表示倍率 {displayPercent}%
            <input
              type="range"
              min={50}
              max={100}
              step={10}
              value={displayPercent}
              onChange={
                /** @brief 保存解像度を変えず画面内の大きさを調整する */ (
                  e,
                ) => setDisplayPercent(Number(e.target.value))
              }
            />
          </label>
          <label>
            PNG保存幅{" "}
            <select
              value={width}
              onChange={
                /** @brief 形式を変えず出力解像度を選ぶ */ (e) =>
                  setWidth(Number(e.target.value))
              }
            >
              <option value={1200}>1200px</option>
              <option value={1600}>1600px</option>
              <option value={2400}>2400px</option>
            </select>
          </label>
          <div className="command-actions">
            {(
              [
                ["png", "PNG保存"],
                ["svg", "SVG保存"],
                ["code", "記号文字列コピー"],
                ["url", "曲URLコピー"],
              ] as const
            ).map(
              /** @brief 同じ予約を各出力形式へ変換する */ ([
                kind,
                label,
              ]) => (
                <button
                  key={kind}
                  disabled={busy}
                  onClick={
                    /** @brief 保存処理を開始する */ () => void action(kind)
                  }
                >
                  {label}
                </button>
              ),
            )}
          </div>
          <p role="status">{message}</p>
        </div>
      )}
    </section>
  );
}
