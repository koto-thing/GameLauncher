import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PublicGame } from "../../domain/models";
import { CAROUSEL_DEFAULTS } from "../../config/carousel.defaults";
import { Artwork } from "./components";

/** @brief 公開作品だけを一定間隔で紹介し、音声再生とは独立して画像を送る。 */
export function SoundtrackCarousel({ games }: { games: PublicGame[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(
    /** @brief 動きを減らす端末設定では自動送りを開始しない。 */ () =>
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [engaged, setEngaged] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);

  useEffect(
    /** @brief 非表示タブでは画像送りを止め、端末の省動作設定にも追従する。 */ () => {
      const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
      /** @brief タブを戻した際は表示中の画像から再開する。 */
      function visibility(): void {
        setHidden(document.hidden);
      }
      /** @brief 利用途中で省動作を有効にした場合も自動送りを停止する。 */
      function reduceMotion(): void {
        if (motion.matches) setPaused(true);
      }
      document.addEventListener("visibilitychange", visibility);
      motion.addEventListener("change", reduceMotion);
      return /** @brief ページ遷移でイベント購読を残さない。 */ () => {
        document.removeEventListener("visibilitychange", visibility);
        motion.removeEventListener("change", reduceMotion);
      };
    },
    [],
  );
  useEffect(
    /** @brief 閲覧・キーボード操作中は対象のリンクを勝手に差し替えない。 */ () => {
      if (games.length < 2 || paused || engaged || focused || hidden) return;
      const timer = window.setTimeout(
        /** @brief 最後の作品から先頭へ循環する。 */ () =>
          setIndex((index + 1) % games.length),
        CAROUSEL_DEFAULTS.intervalMs,
      );
      return /** @brief 手動送りや遷移の後に古いタイマーが動くことを防ぐ。 */ () =>
        window.clearTimeout(timer);
    },
    [games.length, index, paused, engaged, focused, hidden],
  );

  const game = games[index % games.length];
  if (!game) return null;
  const fallbackId = game.tracks.find(
    /** @brief ジャケット未設定時は公開曲の代表画像で作品を紹介する。 */ (
      track,
    ) => track.imageAssetId,
  )?.imageAssetId;
  return (
    <div
      className="soundtrack-carousel"
      role="region"
      aria-roledescription="カルーセル"
      aria-label="サントラのピックアップ"
      onMouseEnter={
        /** @brief 画像を見たりクリックする間は自動送りを待つ。 */ () =>
          setEngaged(true)
      }
      onMouseLeave={
        /** @brief ポインターが離れたら新しい表示間隔を開始する。 */ () =>
          setEngaged(false)
      }
      onFocusCapture={
        /** @brief キーボードのリンク操作中は対象を固定する。 */ () =>
          setFocused(true)
      }
      onBlurCapture={
        /** @brief カルーセル外へフォーカスが移った時だけ送りを再開する。 */ (
          event,
        ) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setFocused(false);
        }
      }
    >
      <Link
        key={game.id}
        className="soundtrack-slide"
        to={`/games/${game.id}`}
        aria-label={`${game.title}のサウンドトラックを見る`}
      >
        <div className="soundtrack-image">
          <Artwork
            assetId={game.imageAssetId}
            fallbackId={fallbackId}
            alt={game.imageAlt || game.title}
          />
        </div>
        <div className="soundtrack-caption">
          <small>ORIGINAL SOUNDTRACK</small>
          <strong>
            {game.title}
            <span aria-hidden="true">↗</span>
          </strong>
        </div>
      </Link>
      {games.length > 1 && (
        <div className="carousel-controls">
          <span className="carousel-counter">
            {String((index % games.length) + 1).padStart(2, "0")} /{" "}
            {String(games.length).padStart(2, "0")}
          </span>
          <button
            type="button"
            aria-label="前のサントラ画像"
            onClick={
              /** @brief ポインター操作に依存せず前の作品へ移る。 */ () =>
                setIndex((index + games.length - 1) % games.length)
            }
          >
            ←
          </button>
          <button
            type="button"
            aria-label={paused ? "自動切り替えを再開" : "自動切り替えを停止"}
            onClick={
              /** @brief 利用者が時間制限なしで画像を見られるよう停止を提供する。 */ () =>
                setPaused(!paused)
            }
          >
            {paused ? "▶" : "Ⅱ"}
          </button>
          <button
            type="button"
            aria-label="次のサントラ画像"
            onClick={
              /** @brief 次の作品を待たずに表示する。 */ () =>
                setIndex((index + 1) % games.length)
            }
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
