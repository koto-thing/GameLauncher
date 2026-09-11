import { useRef, useState } from "react";

/** @brief アクキーに書き込む作品URLと実物での確認手順を表示する */
export function NfcDistribution({
  publicUrl,
  gameId,
  published,
}: {
  publicUrl?: string;
  gameId: string;
  published: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const url = publicUrl
    ? new URL(
        `games/${encodeURIComponent(gameId)}`,
        `${publicUrl.replace(/\/$/, "")}/`,
      ).href
    : "";

  /** @brief 作品リンクをコピーし失敗時には手動選択へ案内する */
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("NFC用の作品URLをコピーしました。");
    } catch {
      input.current?.focus();
      input.current?.select();
      setMessage("URLを選択して手動でコピーしてください。");
    }
  }

  return (
    <section className="publication">
      <h2>アクキー配布（NFC）</h2>
      <p>
        アクキーは作品ページ、コマンドコードは各曲のページを開きます。同じ作品のタグには同じURLを書き込めます。
      </p>
      {url ? (
        <>
          <label>
            NFC用の作品URL
            <input
              ref={input}
              readOnly
              value={url}
              onFocus={
                /** @brief 手動コピーできるよう全体を選択する */ (event) =>
                  event.target.select()
              }
            />
          </label>
          <button type="button" onClick={copy}>
            NFC用URLをコピー
          </button>
          <a href={url} target="_blank" rel="noreferrer">
            NFCのリンク先を確認 ↗
          </a>
        </>
      ) : (
        <p>公開サイトのURLを設定すると、NFC用の作品URLが表示されます。</p>
      )}
      {!published && (
        <p role="status">
          この作品は現在非公開または公開停止中です。配布前に公開してください。
        </p>
      )}
      <ol>
        <li>NDEF対応のNFCタグを用意します。</li>
        <li>
          スマートフォンのNFC書き込みアプリで「URL /
          URI」を選び、上記URLを1件書き込みます。テキスト形式にはしないでください。
        </li>
        <li>
          アクリルに組み込んだ状態で、iPhone・Androidの対応端末から作品ページが開くことを確認します。
        </li>
        <li>
          量産前にURLを確認します。読み取り専用へのロックは元に戻せないため、検品後に行ってください。
        </li>
      </ol>
      <p className="hint">
        タグには音源ではなく公開URLを保存します。アクセスには通信が必要です。配布後も同じドメイン・作品URLを維持してください。
      </p>
      <p role="status">{message}</p>
    </section>
  );
}
