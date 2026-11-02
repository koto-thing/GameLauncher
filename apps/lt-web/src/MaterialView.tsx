import { useRef, useState } from "react";
import { materialView } from "../../../contracts/lt/material-view";
import "./material-view.css";

/**
 * 資料の共有設定と公式埋め込みURLの取得方法を案内する
 * @returns 提出フォームに表示する説明
 */
export function MaterialHelp() {
  return (
    <p className="material-help">
      Google
      スライドは共有URLまたは「ウェブに公開」のURL、PowerPointはOneDriveの「埋め込み」で取得したURL（iframeのsrc）を入力してください。短縮共有URLは通常のリンクとして扱います。公開済みの発表では資料URLも一般向けに表示されます。閲覧者に必要な共有権限を設定してください。HTMLコードやファイルの直接アップロードには対応していません。
    </p>
  );
}

/**
 * 対応資料を公式スライドビューで表示する
 * @param props 表示する資料の指定
 * @param props.url 提出済みまたはプレビュー対象の資料URL
 * @returns スライドビューと元資料へのリンク、未入力ならnull
 */
export function MaterialView({ url }: { url: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [fullscreenError, setFullscreenError] = useState(false);
  const material = materialView(url);

  /**
   * ユーザー操作からスライドの全画面表示を要求する
   * @returns 完了を表すPromise、利用不可の場合は画面に案内する
   */
  async function fullscreen() {
    setFullscreenError(false);
    try {
      await frame.current!.requestFullscreen();
    } catch {
      setFullscreenError(true);
    }
  }

  if (!material) return null;

  // 通常資料はリンクで案内し、対応スライドは表示時に読み込みを開始する
  return (
    <section className="material-view" aria-label="発表資料">
      <div className="material-actions">
        <a
          href={material.url}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          元の資料を開く
        </a>
        {material.embedUrl && (
          <button type="button" onClick={() => void fullscreen()}>
            スライドを全画面表示
          </button>
        )}
      </div>
      {material.embedUrl && (
        <>
          <iframe
            key={material.embedUrl}
            ref={frame}
            className="material-frame"
            src={material.embedUrl}
            title={`${material.provider}の発表資料`}
            referrerPolicy="no-referrer"
            allowFullScreen
          />
          <p className="material-help">
            表示できない場合は「元の資料を開く」からログインや共有設定を確認してください。資料の閲覧可否は提供元の設定に従います。
          </p>
          {fullscreenError && (
            <p role="status">
              この環境では全画面表示を開始できません。元の資料を開いてご覧ください。
            </p>
          )}
        </>
      )}
    </section>
  );
}
