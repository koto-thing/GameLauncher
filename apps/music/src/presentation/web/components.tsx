import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import type { GameDesign, PublicTrack } from "../../domain/models";
import { useSite } from "./context";
import { publicApi as api } from "./public-client";
import { GameDesignSurface } from "./design-surface";

/** @brief 秒を再生表示用に整形する */
export function timeLabel(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

/** @brief 曲画像・作品画像・共通プレースホルダーの順で元比率を保って表示する */
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
  const { assetUrl } = useSite();
  const [failed, setFailed] = useState<string[]>([]);
  const chosen = [assetId, fallbackId].find(
    /** @brief 読み込み失敗した画像を再要求し続けない */ (id) =>
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
      src={assetUrl(chosen)}
      alt={alt || "作品の代表画像"}
      loading="lazy"
      onError={
        /** @brief 非公開化や削除済み画像を代替表示に切り替える */ () =>
          setFailed([...failed, chosen])
      }
    />
  );
}

/** @brief 広告の取得・画像失敗が再生に影響しない独立したバナー枠 */
export function AdSlot() {
  const { assetUrl } = useSite();
  const [ad, setAd] = useState<{
    enabled: boolean;
    imageAssetId?: string;
    href?: string;
    alt?: string;
  } | null>(null);
  useEffect(
    /** @brief 広告を独立取得し、ブロッカーや失敗時には枠を消す */ () => {
      let active = true;
      void api<NonNullable<typeof ad>>("/public/ad")
        .then(
          /** @brief マウント中だけ広告を反映する */ (value) => {
            if (active) setAd(value);
          },
        )
        .catch(
          /** @brief 広告失敗は音楽UIのエラーへ波及させない */ () =>
            undefined,
        );
      return /** @brief 遅い広告応答を無効化する */ () => {
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
          src={assetUrl(ad.imageAssetId!)}
          alt={ad.alt}
          onError={
            /** @brief 画像を表示できない広告枠を閉じる */ () => setAd(null)
          }
        />
      </a>
    </aside>
  );
}

/** @brief 全画面と編集試聴で共通の操作を表示する */
export function PlayerControls({
  track,
  queue,
  design,
}: {
  track: PublicTrack;
  queue: PublicTrack[];
  design?: GameDesign;
}) {
  const { player } = useSite();
  const state = useSyncExternalStore(player.subscribe, player.snapshot);
  const [repeatBusy, setRepeatBusy] = useState(false);
  const current = state.track?.id === track.id;
  const position = current ? state.positionSeconds : 0;
  /** @brief 対象曲が違えば開始し、同じ曲なら一時停止・再開する */
  async function toggle(): Promise<void> {
    if (current) await player.toggle();
    else await player.start(track, queue);
  }
  return (
    <div className="player-controls">
      <label className="seek-label">
        再生位置
        <SpectrumSeekBar
          track={track}
          design={design}
          position={position}
          disabled={!current}
          onSeek={player.seek}
        />
      </label>
      <div className="time-row">
        <span>{timeLabel(position)}</span>
        <span>{timeLabel(track.durationSeconds)}</span>
      </div>
      <div className="transport">
        <button
          onClick={
            /** @brief 手動前曲は区間ループから離脱できる */ () => {
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
            /** @brief 操作起点で音声制限を解除する */ () => {
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
            /** @brief 手動次曲へ進む */ () => {
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
          className="mode-icon"
          aria-label="シャッフル"
          title={`シャッフル：${state.shuffle ? "ON" : "OFF"}`}
          aria-pressed={state.shuffle}
          onClick={player.toggleShuffle}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 3.5-2 5-5m2-2c1.5-3 3-5 5-5h3m-4-4 4 4-4 4" /></svg>
        </button>
        <button
          type="button"
          className="mode-icon repeat-icon"
          disabled={!current || repeatBusy}
          aria-label="リピート"
          aria-pressed={current && state.repeat !== "off"}
          data-repeat={current ? state.repeat : "off"}
          title={`リピート：${{ off: "OFF", track: "1曲ループ", queue: "全曲ループ", region: "区間ループ" }[current ? state.repeat : "off"]}`}
          onClick={/** @brief 1曲・全曲・区間・OFFを循環し、区間未設定なら区間を飛ばす */ async () => {
            const next = { off: "track", track: "queue", queue: track.loop ? "region" : "off", region: "off" } as const;
            setRepeatBusy(true);
            try { await player.setRepeat(next[state.repeat]); }
            finally { setRepeatBusy(false); }
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 2 4 4-4 4M4 11V9a3 3 0 0 1 3-3h13M8 22l-4-4 4-4m12-1v2a3 3 0 0 1-3 3H4" /></svg>
          {current && state.repeat !== "off" && <span className="mode-badge" aria-hidden="true">{{ track: "1", queue: "ALL", region: "|−|" }[state.repeat]}</span>}
          <span className="repeat-status" role="status">{{ off: "ループしない", track: "1曲ループ", queue: "全曲ループ", region: "区間ループ" }[current ? state.repeat : "off"]}</span>
        </button>
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

const SPECTRUM_BARS = 56;

/** @brief 曲ごとに安定したスペクトラム形状を作り、再描画で揺れないようにする */
function spectrumHeights(id: string): number[] {
  let seed = 2166136261;
  for (const character of id) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return Array.from({ length: SPECTRUM_BARS }, (_, index) => {
    seed = Math.imul(seed ^ (index + 1), 2246822519);
    const wave = Math.abs(Math.sin(index * 0.43) * 0.28);
    return 24 + ((seed >>> 24) / 255 + wave) * 58;
  });
}

/** @brief 画像を細い列へ縮小し、各列の平均色をスペクトラムのグラデーションに使う */
function imagePalette(image: HTMLImageElement): string[] {
  const canvas = document.createElement("canvas");
  canvas.width = SPECTRUM_BARS;
  canvas.height = 8;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  return Array.from(
    { length: SPECTRUM_BARS },
    /** @brief 縮小画像の列ごとに平均RGBを求める */ (_, column) => {
    let red = 0;
    let green = 0;
    let blue = 0;
    for (let row = 0; row < canvas.height; row++) {
      const offset = (row * canvas.width + column) * 4;
      red += pixels[offset];
      green += pixels[offset + 1];
      blue += pixels[offset + 2];
    }
    return `rgb(${Math.round(red / canvas.height)} ${Math.round(green / canvas.height)} ${Math.round(blue / canvas.height)})`;
    },
  );
}

/** @brief 作品配色を保ったままrange入力の操作性を提供する */
function SpectrumSeekBar({
  track,
  design,
  position,
  disabled,
  onSeek,
}: {
  track: PublicTrack;
  design?: GameDesign;
  position: number;
  disabled: boolean;
  onSeek(seconds: number): void;
}) {
  const { assetUrl } = useSite();
  const heights = useMemo(
    /** @brief 曲が変わった時だけブロック形状を作り直す */ () =>
      spectrumHeights(track.id),
    [track.id],
  );
  const fallback = design?.backgroundColor ?? "#d62945";
  const [colors, setColors] = useState<string[]>([]);
  useEffect(
    /** @brief 背景画像がある時だけ安全なCanvasから配色を抽出する */ () => {
    if (!design?.backgroundAssetId) {
      setColors([]);
      return;
    }
    let active = true;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = /** @brief 読み込み済み画像の列色を反映する */ () => {
      if (!active) return;
      try {
        setColors(imagePalette(image));
      } catch {
        setColors([]);
      }
    };
    image.onerror = /** @brief 画像失敗時は作品の単色配色へ戻す */ () =>
      active && setColors([]);
    image.src = assetUrl(design.backgroundAssetId);
    return /** @brief 古い画像の遅延完了を無視する */ () => {
      active = false;
    };
    },
    [assetUrl, design?.backgroundAssetId],
  );
  const progress = track.durationSeconds
    ? Math.min(1, position / track.durationSeconds)
    : 0;
  return (
    <span className={`spectrum-seek ${disabled ? "is-disabled" : ""}`}>
      <span className="spectrum-bars" aria-hidden="true">
        {heights.map(
          /** @brief 再生位置より前のブロックだけ強調する */ (height, index) => (
          <i
            key={index}
            className={index / SPECTRUM_BARS <= progress ? "is-played" : ""}
            style={{
              height: `${height}%`,
              background:
                colors[index] ??
                `color-mix(in srgb, white ${Math.round((1 - index / (SPECTRUM_BARS - 1)) * 100)}%, ${fallback})`,
            }}
          />
          ),
        )}
      </span>
      <input
        type="range"
        min="0"
        max={track.durationSeconds}
        step="0.01"
        value={position}
        disabled={disabled}
        aria-label="再生位置"
        onChange={
          /** @brief ネイティブrangeの値を音声位置へ渡す */ (event) =>
            onSeek(Number(event.target.value))
        }
      />
    </span>
  );
}

/** @brief ページの移動先に関係なく現在曲の画像と操作を保持する */
export function MiniPlayer() {
  const { player, catalogue } = useSite();
  const state = useSyncExternalStore(player.subscribe, player.snapshot);
  const track = state.track;
  if (!track) return null;
  const game = catalogue.find(
    /** @brief 閲覧先ではなく再生中の作品を探す */ (item) =>
      item.id === track.gameId,
  );
  return (
    <aside className="mini-player" aria-label="ミニプレーヤー">
      <GameDesignSurface key={game?.id ?? "preview"} design={game?.design} variant="mini">
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
          /** @brief 共通プレーヤーを操作する */ () => {
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
      <label className="mini-volume">
        <span>音量</span>
        <span className="volume-control">
          <span className="volume-meter" aria-hidden="true">
            {Array.from({ length: 20 }, /** @brief 音量を段階的なレベルメーターとして描く */ (_, index) => (
              <i key={index} className={state.volume * 20 > index ? "is-active" : ""} style={{ height: `${6 + index * 0.8}px` }} />
            ))}
          </span>
        <input type="range" min="0" max="100" step="1"
          aria-label="再生音量" aria-valuetext={`${Math.round(state.volume * 100)}%`}
          value={Math.round(state.volume * 100)}
          onChange={/** @brief ミニプレーヤーから共通音量を変更する */ (event) => player.setVolume(Number(event.target.value) / 100)} />
        </span>
        <output>{Math.round(state.volume * 100)}%</output>
      </label>
      {state.error && (
        <span className="mini-error" role="status">
          再生エラー・再試行できます
        </span>
      )}
      </GameDesignSurface>
    </aside>
  );
}
