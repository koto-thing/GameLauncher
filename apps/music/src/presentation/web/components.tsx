import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import type { PublicTrack } from "../../domain/models";
import { useSite } from "./context";
import { api } from "./api-client";

/** @brief 秒を再生表示用に整形する。 */
export function timeLabel(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
/** @brief 曲画像・作品画像・共通プレースホルダーの順で元比率を保って表示する。 */
export function Artwork({
  assetId,
  fallbackId,
  alt,
  compact = false,
}: {
  assetId?: string | null;
  fallbackId?: string | null;
  alt: string;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const chosen = [assetId, fallbackId].find(
    /** @brief 読み込み失敗した画像を再要求し続けない。 */ (id) =>
      id && !failed.includes(id),
  );
  if (!chosen)
    return (
      <div
        className={`artwork placeholder ${compact ? "compact" : ""}`}
        role="img"
        aria-label={alt || "作品画像なし"}
      >
        <span aria-hidden="true">
          P<span className="amp">&</span>D
        </span>
        <small>ORIGINAL SOUNDTRACK</small>
      </div>
    );
  return (
    <img
      className={`artwork ${compact ? "compact" : ""}`}
      src={`/api/assets/${chosen}`}
      alt={alt || "作品の代表画像"}
      loading="lazy"
      onError={
        /** @brief 非公開化や削除済み画像を代替表示に切り替える。 */ () =>
          setFailed([...failed, chosen])
      }
    />
  );
}
/** @brief 広告の取得・画像失敗が再生に影響しない独立したバナー枠。 */
export function AdSlot() {
  const [ad, setAd] = useState<{
    enabled: boolean;
    imageAssetId?: string;
    href?: string;
    alt?: string;
  } | null>(null);
  useEffect(
    /** @brief 広告を独立取得し、ブロッカーや失敗時には枠を消す。 */ () => {
      let active = true;
      void api<NonNullable<typeof ad>>("/public/ad")
        .then(
          /** @brief マウント中だけ広告を反映する。 */ (value) => {
            if (active) setAd(value);
          },
        )
        .catch(
          /** @brief 広告失敗は音楽UIのエラーへ波及させない。 */ () =>
            undefined,
        );
      return /** @brief 遅い広告応答を無効化する。 */ () => {
        active = false;
      };
    },
    [],
  );
  if (!ad?.enabled) return null;
  return (
    <aside className="ad-slot">
      <small>広告</small>
      <a href={ad.href} target="_blank" rel="sponsored noopener noreferrer">
        <img
          src={`/api/assets/${ad.imageAssetId}`}
          alt={ad.alt}
          onError={
            /** @brief 画像を表示できない広告枠を閉じる。 */ () => setAd(null)
          }
        />
      </a>
    </aside>
  );
}
/** @brief 全画面と編集試聴で共通の操作を表示する。 */
export function PlayerControls({
  track,
  queue,
}: {
  track: PublicTrack;
  queue: PublicTrack[];
}) {
  const { player } = useSite();
  const state = useSyncExternalStore(player.subscribe, player.snapshot);
  const current = state.track?.id === track.id;
  const position = current ? state.positionSeconds : 0;
  /** @brief 対象曲が違えば開始し、同じ曲なら一時停止・再開する。 */
  async function toggle(): Promise<void> {
    if (current) await player.toggle();
    else await player.start(track, queue);
  }
  return (
    <div className="player-controls">
      <label className="seek-label">
        再生位置
        <input
          type="range"
          min="0"
          max={track.durationSeconds}
          step="0.01"
          value={position}
          disabled={!current}
          aria-label="再生位置"
          onChange={
            /** @brief シークの丸めは表示だけにとどめる。 */ (event) =>
              player.seek(Number(event.target.value))
          }
        />
      </label>
      <div className="time-row">
        <span>{timeLabel(position)}</span>
        <span>{timeLabel(track.durationSeconds)}</span>
      </div>
      <div className="transport">
        <button
          onClick={
            /** @brief 手動前曲は区間ループから離脱できる。 */ () => {
              void player.move(-1);
            }
          }
          disabled={!current}
          aria-label="前の曲"
        >
          ⏮
        </button>
        <button
          className="primary play-button"
          onClick={
            /** @brief 操作起点で音声制限を解除する。 */ () => {
              void toggle();
            }
          }
          aria-label={
            current && ["playing", "loading"].includes(state.status)
              ? "一時停止"
              : "再生"
          }
        >
          {current && ["playing", "loading"].includes(state.status) ? "Ⅱ" : "▶"}
        </button>
        <button
          onClick={
            /** @brief 手動次曲へ進む。 */ () => {
              void player.move(1);
            }
          }
          disabled={!current}
          aria-label="次の曲"
        >
          ⏭
        </button>
      </div>
      <div className="mode-row">
        <button
          disabled={!current}
          aria-pressed={state.shuffle}
          onClick={player.toggleShuffle}
        >
          シャッフル
        </button>
        <label>
          リピート
          <select
            aria-label="リピート"
            disabled={!current}
            value={current ? state.repeat : "off"}
            onChange={
              /** @brief 排他的モードを選択する。 */ (event) => {
                void player.setRepeat(
                  event.target.value as "off" | "track" | "queue" | "region",
                );
              }
            }
          >
            <option value="off">OFF</option>
            <option value="track">1曲</option>
            <option value="queue">全曲</option>
            <option value="region" disabled={!track.loop}>
              ゲーム内ループ
            </option>
          </select>
        </label>
      </div>
      {track.loop ? (
        <p className="hint">
          ゲーム内ループ：{track.loop.startSeconds}〜{track.loop.endSeconds}
          秒。ONのまま終了位置以後へ移動すると開始位置へ戻ります。
        </p>
      ) : (
        <p className="hint">この曲にはゲーム内ループが設定されていません。</p>
      )}
      {current && (
        <p role="status" className={state.error ? "error" : "hint"}>
          {state.error ??
            {
              idle: "再生待ち",
              loading: "音源を読み込み中…",
              playing: "再生中",
              paused: "一時停止",
              interrupted:
                "再生が中断されました。再生ボタンで再開してください。",
              error: "再生に失敗しました。",
            }[state.status]}
        </p>
      )}
    </div>
  );
}
/** @brief ページの移動先に関係なく現在曲の画像と操作を保持する。 */
export function MiniPlayer() {
  const { player, catalogue } = useSite();
  const state = useSyncExternalStore(player.subscribe, player.snapshot);
  const track = state.track;
  if (!track) return null;
  const game = catalogue.find(
    /** @brief 閲覧先ではなく再生中の作品を探す。 */ (item) =>
      item.id === track.gameId,
  );
  return (
    <aside className="mini-player" aria-label="ミニプレーヤー">
      <Link className="mini-info" to={`/tracks/${track.id}`}>
        <Artwork
          assetId={track.imageAssetId}
          fallbackId={game?.imageAssetId}
          alt={track.imageAlt || game?.imageAlt || track.title}
          compact
        />
        <span>
          <strong>{track.title}</strong>
          <small>
            {game?.title ?? "下書き試聴"} · {timeLabel(state.positionSeconds)}
          </small>
        </span>
      </Link>
      <button
        className="primary"
        onClick={
          /** @brief 共通プレーヤーを操作する。 */ () => {
            void player.toggle();
          }
        }
        aria-label={
          state.status === "playing"
            ? "ミニプレーヤーで一時停止"
            : "ミニプレーヤーで再生"
        }
      >
        {state.status === "playing" ? "Ⅱ" : "▶"}
      </button>
      {state.error && (
        <span className="mini-error" role="status">
          再生エラー・再試行できます
        </span>
      )}
    </aside>
  );
}
