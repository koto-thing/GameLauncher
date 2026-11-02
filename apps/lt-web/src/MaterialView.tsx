import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize } from "lucide-react";
import { materialView } from "../../../contracts/lt/material-view";
import uploadedMaterials from "../../../contracts/lt/uploaded-materials.json";
import "./material-view.css";

type Deck = { name: string; baseUrl: string; pages: number };
const uploaded: Record<string, Deck[]> = uploadedMaterials;

/**
 * 資料の共有設定と公式埋め込みURLの取得方法を案内する
 * @returns 提出フォームに表示する説明
 */
export function MaterialHelp() {
  return (
    <p className="material-help">
      Google
      スライドは共有URLまたは「ウェブに公開」のURL、PowerPointはOneDriveの「埋め込み」で取得したURL（iframeのsrc）を入力してください。公開済みの発表では資料も一般向けに表示されます。閲覧者に必要な共有権限を設定してください。
    </p>
  );
}

/**
 * アップロード済み資料を一枚ずつ切り替えて表示する
 * @param props 表示する資料の一覧
 * @returns ページ切替と資料選択を備えたスライドビュー
 */
function UploadedSlides({ decks }: { decks: Deck[] }) {
  const [deckIndex, setDeckIndex] = useState(0);
  const [page, setPage] = useState(1);
  const deck = decks[deckIndex];

  /**
   * 資料の範囲内でページを切り替える
   * @param next 表示するページ番号
   * @returns 戻り値なし
   */
  function changePage(next: number) {
    setPage(Math.max(1, Math.min(deck.pages, next)));
  }

  return (
    <div
      className="uploaded-slides"
      tabIndex={0}
      aria-label="スライドビュー"
      onKeyDown={(event) => {
        // 入力欄の操作を妨げず、ビュー本体では矢印キーで移動する
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)
          return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          changePage(page + (event.key === "ArrowRight" ? 1 : -1));
        }
      }}
    >
      <div className="uploaded-slide-stage">
        <img
          src={`${deck.baseUrl}page-${String(page).padStart(3, "0")}.jpg`}
          alt={`スライド ${page} / ${deck.pages}`}
        />
      </div>
      <div className="uploaded-slide-controls">
        <button
          type="button"
          aria-label="前のスライド"
          disabled={page === 1}
          onClick={() => changePage(page - 1)}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <label>
          ページ{" "}
          <input
            aria-label="ページ番号"
            type="number"
            min={1}
            max={deck.pages}
            value={page}
            onChange={(event) => changePage(Number(event.currentTarget.value) || 1)}
          />
        </label>
        <span aria-live="polite">/ {deck.pages}</span>
        <button
          type="button"
          aria-label="次のスライド"
          disabled={page === deck.pages}
          onClick={() => changePage(page + 1)}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
        {decks.length > 1 && (
          <select
            aria-label="表示する資料"
            value={deckIndex}
            onChange={(event) => {
              setDeckIndex(Number(event.currentTarget.value));
              setPage(1);
            }}
          >
            {decks.map((item, index) => (
              <option key={item.baseUrl} value={index}>
                {item.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

/**
 * 発表資料欄にアップロード資料または公式埋め込みを表示する
 * @param props 表示する資料の指定
 * @param props.url 提出済みまたはプレビュー対象の資料URL
 * @returns 全画面表示に対応するスライドビュー、表示対象がなければnull
 */
export function MaterialView({ url }: { url: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [fullscreenError, setFullscreenError] = useState(false);
  const material = materialView(url);
  const decks = material ? uploaded[material.url] : undefined;

  /**
   * スライドとページ切替操作を全画面表示する
   * @returns 完了を表すPromise、利用不可の場合はエラーを表示する
   */
  async function fullscreen() {
    setFullscreenError(false);
    try {
      await frame.current!.requestFullscreen();
    } catch {
      setFullscreenError(true);
    }
  }

  if (!material || (!decks && !material.embedUrl)) return null;

  // 外部リンクと常設の注釈を置かず、資料そのものを発表詳細に表示する
  return (
    <section className="material-view" aria-label="発表資料">
      <div className="material-actions">
        <button
          type="button"
          aria-label="スライドを全画面表示"
          title="スライドを全画面表示"
          onClick={() => void fullscreen()}
        >
          <Maximize size={20} aria-hidden="true" />
        </button>
      </div>
      <div ref={frame} className="material-screen">
        {decks ? (
          <UploadedSlides key={material.url} decks={decks} />
        ) : (
          <iframe
            key={material.embedUrl}
            className="material-frame"
            src={material.embedUrl!}
            title={`${material.provider}の発表資料`}
            referrerPolicy="no-referrer"
            allowFullScreen
          />
        )}
      </div>
      {fullscreenError && <p role="status">この環境では全画面表示を開始できません。</p>}
    </section>
  );
}
