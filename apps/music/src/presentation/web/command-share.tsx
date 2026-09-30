import { useState } from "react";
import { encodeCommand, displayCommand } from "../../domain/command-code";
import type { CommandCode } from "../../../../../contracts/music/command-code-v1";
import type { GameDesign } from "../../domain/models";
import { DistributionCard } from "./distribution-card";

export interface CommandExport {
  png(svg: string, width: number): Promise<Blob>;
  save(blob: Blob, name: string): void;
}

/** @brief 記号コードを背景付きで共有する */
export function CommandShare({
  assignment,
  url,
  exporter,
  title = "PandD Music",
  webgl,
}: {
  assignment?: CommandCode;
  url: string;
  exporter: () => Promise<CommandExport>;
  title?: string;
  webgl?: GameDesign["webgl"];
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  if (!assignment) return <p className="hint">コマンドコードは準備中です。</p>;

  const code = displayCommand(encodeCommand(assignment.codeId));

  /** @brief 記号と曲URLをクリップボードへコピーする */
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("コピーしました。");
    } catch {
      setMessage(
        "コピーできませんでした。ブラウザーの許可を確認してください。",
      );
    }
  }

  return (
    <section className="command-share">
      <button
        type="button"
        aria-expanded={open}
        onClick={/** @brief 配布画像の設定を開閉する */ () => setOpen(!open)}
      >
        コマンドコード
      </button>
      {open && (
        <div className="command-card">
          <h2>曲の配布コード</h2>
          <DistributionCard
            id={assignment.codeId}
            url={url}
            title={title}
            exporter={exporter}
            webgl={webgl}
          />
          <p className="command-text">{code}</p>
          <button
            type="button"
            onClick={/** @brief 記号をコピーする */ () => void copy(code)}
          >
            記号文字列コピー
          </button>
          <button
            type="button"
            onClick={/** @brief 公開曲のURLをコピーする */ () => void copy(url)}
          >
            曲URLコピー
          </button>
          <p role="status">{message}</p>
        </div>
      )}
    </section>
  );
}
