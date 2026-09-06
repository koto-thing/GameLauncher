import type { AudioEngine, AudioSnapshot } from "../../application/player";
import type {
  LoopRegion,
  PlaybackStatus,
  PublicTrack,
} from "../../domain/models";
import type { PlayerRuntime } from "../../config/player-runtime.defaults";
import { playbackPosition, seekPosition } from "../../domain/rules";
import { startRegionSource } from "./region-source";

/** @brief 通常のHTMLAudioElementと必要時だけのPCMループを排他的に切り替える。 */
export class BrowserAudio implements AudioEngine {
  private readonly audio = new Audio();
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private region: LoopRegion | null = null;
  private track: PublicTrack | null = null;
  private offset = 0;
  private startedAt = 0;
  private status: PlaybackStatus = "idle";
  private error: string | null = null;
  private generation = 0;
  private abort: AbortController | null = null;
  private decodeJob: Promise<AudioBuffer | null> = Promise.resolve(null);
  private listeners = new Set<() => void>();
  private onEnded: () => void = empty;
  private readonly timer: ReturnType<typeof setInterval>;
  /** @brief イベントと表示専用タイマーをアプリ全体に1組だけ登録する。 */
  constructor(private readonly runtime: PlayerRuntime, private readonly assetUrl: (id: string) => string) {
    if (
      runtime.simultaneousDecodeLimit !== 1 ||
      runtime.nextTrackAudioPrefetchEnabled ||
      runtime.decodedAudioBudgetBytes <= 0 ||
      runtime.displayIntervalMs <= 0 ||
      runtime.decodeSampleRateHz <= 0
    )
      throw new Error(
        "音声ランタイム設定が不正です。初期版は1曲ずつのデコードに対応します。",
      );
    this.audio.preload = "metadata";
    this.audio.addEventListener("playing", this.playing);
    this.audio.addEventListener("pause", this.paused);
    this.audio.addEventListener("waiting", this.waiting);
    this.audio.addEventListener("error", this.failed);
    this.audio.addEventListener("ended", this.ended);
    // このタイマーは表示だけを更新し、再生位置やループ境界を操作しない。
    this.timer = setInterval(this.emit, runtime.displayIntervalMs);
  }
  /** @brief UIへ実際の状態変化を通知する。 */
  private emit = (): void => {
    for (const listener of this.listeners) listener();
  };
  /** @brief HTML音声が鳴り始めた時点で再生中を表示する。 */
  private playing = (): void => {
    // 停止前にキューへ入ったplaying通知で、停止後のエラーを消さない。
    if (!this.buffer && !this.audio.paused) {
      this.status = "playing";
      this.error = null;
      this.emit();
    }
  };
  /** @brief OSや外部操作による停止もUIに反映する。 */
  private paused = (): void => {
    if (!this.buffer && this.status === "playing") {
      this.status = "paused";
      this.emit();
    }
  };
  /** @brief 通信待ちを再生中と区別する。 */
  private waiting = (): void => {
    if (!this.buffer && !this.audio.paused) {
      this.status = "loading";
      this.emit();
    }
  };
  /** @brief 読み込み失敗を成功扱いにしない。 */
  private failed = (): void => {
    if (!this.buffer && this.track)
      this.fail("音源を読み込めません。接続を確認して再生を押してください。");
  };
  /** @brief HTML音声の自然終端をキューへ伝える。 */
  private ended = (): void => {
    if (!this.buffer) {
      this.status = "paused";
      this.emit();
      this.onEnded();
    }
  };
  /** @brief AudioContext中断では止まった音声クロックに表示を合わせる。 */
  private contextChanged = (): void => {
    if (
      this.buffer &&
      this.status === "playing" &&
      this.context?.state !== "running"
    ) {
      this.offset = this.position();
      this.stopSource();
      this.status = "interrupted";
      this.emit();
    }
  };
  /** @brief ユーザー操作の同期区間でAudioContextを起動・再開する。 */
  private unlock(): AudioContext {
    if (typeof AudioContext === "undefined")
      throw new Error(
        "このブラウザー環境はWeb Audioの区間ループに対応していません。通常再生を利用してください。",
      );
    if (!this.context) {
      this.context = new AudioContext({
        sampleRate: this.runtime.decodeSampleRateHz,
      });
      this.context.addEventListener("statechange", this.contextChanged);
    }
    void this.context.resume().catch(
      /** @brief ブラウザーの自動再生制限を復旧可能な状態にする。 */ () => {
        this.status = "interrupted";
        this.emit();
      },
    );
    return this.context;
  }
  /** @brief Sourceの寿命をBufferと分け、手動停止を自然終端として扱わない。 */
  private stopSource(): void {
    if (this.source) {
      this.source.onended = null;
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
  }
  /** @brief 古い通信・デコード結果を無効化する。 */
  private cancel(): void {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
  }
  /** @brief 曲変更時に前曲のPCMとNodeと通信を解放する。 */
  load(track: PublicTrack): void {
    this.cancel();
    this.stopSource();
    this.audio.pause();
    this.buffer = null;
    this.region = null;
    this.offset = 0;
    this.track = track;
    this.error = null;
    this.status = "idle";
    this.audio.src = this.assetUrl(track.audioAssetId!);
    this.audio.load();
    if ("mediaSession" in navigator)
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.credits
          .map(
            /** @brief 公開クレジットだけをOS表示へ渡す。 */ (credit) =>
              credit.name,
          )
          .join(" / "),
      });
    this.emit();
  }
  /** @brief ユーザー操作から再生を開始しPromise失敗も状態へ反映する。 */
  async play(): Promise<void> {
    if (!this.track) return;
    const generation = this.generation;
    this.error = null;
    try {
      if (this.buffer) {
        const context = this.unlock();
        await context.resume();
        if (generation !== this.generation) return;
        this.startBuffer(this.offset);
      } else {
        this.status = "loading";
        this.emit();
        await this.audio.play();
      }
    } catch {
      if (generation === this.generation)
        this.fail("再生が中断されました。再生ボタンを押して再開してください。");
    }
  }
  /** @brief 音源内位置を保存し、準備中の処理も無効化する。 */
  pause(): void {
    this.offset = this.position();
    this.cancel();
    this.stopSource();
    this.audio.pause();
    this.status = "paused";
    this.emit();
  }
  /** @brief 使用済みNodeを再利用せず保存位置から新しいNodeを開始する。 */
  private startBuffer(seconds: number): void {
    if (!this.context || !this.buffer || !this.track) return;
    this.stopSource();
    this.offset = seekPosition(seconds, this.buffer.duration, this.region);
    this.startedAt = this.context.currentTime;
    this.source = startRegionSource(
      this.context,
      this.buffer,
      this.region,
      this.offset,
      this.context.destination,
    );
    this.source.onended =
      /** @brief 手動停止では解除される自然終端専用通知。 */ () => {
        this.offset = this.buffer?.duration ?? 0;
        this.status = "paused";
        this.stopSource();
        this.emit();
        this.onEnded();
      };
    this.status = "playing";
    this.emit();
  }
  /** @brief 位置計算には音声クロックを使い、表示タイマーの遅延を累積させない。 */
  private position(): number {
    if (!this.buffer)
      return Number.isFinite(this.audio.currentTime)
        ? this.audio.currentTime
        : this.offset;
    return this.status === "playing" && this.context
      ? playbackPosition(
          this.offset,
          this.context.currentTime - this.startedAt,
          this.buffer.duration,
          this.region,
        )
      : this.offset;
  }
  /** @brief ループ外シークを開始位置へ正規化し、非同期競合を止める。 */
  seek(seconds: number): void {
    if (!this.track) return;
    const playing = this.status === "playing";
    this.cancel();
    this.offset = seekPosition(
      seconds,
      this.buffer?.duration ?? this.track.durationSeconds,
      this.region,
    );
    if (this.buffer) {
      this.stopSource();
      if (playing) this.startBuffer(this.offset);
    } else {
      this.audio.currentTime = this.offset;
      if (this.status === "loading" && this.audio.paused)
        this.status = "paused";
    }
    this.emit();
  }
  /** @brief 必要な1曲だけを直列デコードし精密ループへ切り替える。 */
  async setRegion(region: LoopRegion | null): Promise<void> {
    if (!this.track) return;
    const position = this.position();
    const wasPlaying =
      this.status === "playing" ||
      (this.status === "loading" && !this.audio.paused);
    this.cancel();
    const generation = this.generation;
    if (!region) {
      // Nodeのloopフラグだけを解除して、現在の波形位置からアウトロへ自然に進む。
      this.offset = position;
      if (this.context) this.startedAt = this.context.currentTime;
      this.region = null;
      if (this.source) this.source.loop = false;
      if (this.status === "loading" && this.audio.paused)
        this.status = "paused";
      this.emit();
      return;
    }
    let context: AudioContext;
    try {
      context = this.unlock();
    } catch (error) {
      this.fail(
        error instanceof Error
          ? error.message
          : "区間ループを開始できません。通常再生を利用してください。",
      );
      return;
    }
    if (this.buffer) {
      this.offset = seekPosition(position, this.buffer.duration, region);
      this.region = region;
      this.stopSource();
      if (wasPlaying) this.startBuffer(this.offset);
      this.emit();
      return;
    }
    this.audio.pause();
    this.offset = position;
    this.status = "loading";
    this.error = null;
    this.emit();
    const track = this.track;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    try {
      // デコード後の実サンプルレートを使い、圧縮サイズとは別にPCM予算を検査する。
      if (
        track.durationSeconds * context.sampleRate * track.channels * 4 >
        this.runtime.decodedAudioBudgetBytes
      )
        throw new Error(
          "区間ループのPCMメモリ予算を超えます。通常再生を利用するか、短い音源に差し替えてください。",
        );
      const previous = this.decodeJob;
      /** @brief 古いデコードが終わるまで次の展開を待ち、並列数を1に制限する。 */
      const job = (async () => {
        await previous.catch(empty);
        if (generation !== this.generation) return null;
        const response = await fetch(
          this.assetUrl(track.audioAssetId!),
          { signal },
        );
        if (
          !response.ok
        )
          throw new Error("音源取得に失敗しました。再試行してください。");
        const compressed = await response.arrayBuffer();
        // 管理proxyの転送符号化に依存せず、展開後の実バイト数を検証する。
        if (compressed.byteLength !== track.audioBytes)
          throw new Error("音源サイズが一致しません。再試行してください。");
        if (generation !== this.generation) return null;
        const decoded = await context.decodeAudioData(compressed);
        if (
          decoded.length * decoded.numberOfChannels * 4 >
          this.runtime.decodedAudioBudgetBytes
        )
          throw new Error(
            "デコード後のメモリ予算を超えました。通常再生を利用してください。",
          );
        return generation === this.generation ? decoded : null;
      })();
      this.decodeJob = job;
      const decoded = await job;
      if (this.decodeJob === job) this.decodeJob = Promise.resolve(null);
      if (generation !== this.generation || !decoded) return;
      if (region.endSeconds > decoded.duration + 1 / decoded.sampleRate)
        throw new Error(
          "デコード後の長さを超えるループです。設定を修正してください。",
        );
      this.buffer = decoded;
      this.region = region;
      this.offset = seekPosition(position, decoded.duration, region);
      this.status = "paused";
      if (wasPlaying) {
        await context.resume();
        if (generation === this.generation) this.startBuffer(this.offset);
      }
      this.emit();
    } catch (error) {
      if (generation !== this.generation) return;
      this.buffer = null;
      this.region = null;
      this.audio.currentTime = this.offset;
      this.fail(
        error instanceof Error
          ? error.message
          : "ループ音源をデコードできません。通常再生を利用してください。",
      );
    } finally {
      // 解決済みPromiseにもPCM参照が残るため、完了した最新ジョブから参照を切る。
      if (generation === this.generation)
        this.decodeJob = Promise.resolve(null);
    }
  }
  /** @brief 二重再生を止めて復旧方法を通知する。 */
  private fail(message: string): void {
    this.stopSource();
    this.audio.pause();
    this.status = "error";
    this.error = message;
    this.emit();
  }
  /** @brief プレーヤーの表示用スナップショットを返す。 */
  snapshot(): AudioSnapshot {
    return {
      status: this.status,
      positionSeconds: this.position(),
      error: this.error,
      regionActive: this.region !== null,
    };
  }
  /** @brief 状態変更通知を登録する。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return /** @brief 購読を解除する。 */ () => {
      this.listeners.delete(listener);
    };
  }
  /** @brief 自然終端のキュー進行だけを上位へ委譲する。 */
  setEnded(listener: () => void): void {
    this.onEnded = listener;
  }
  /** @brief アプリ終了時だけ全音声リソースを破棄する。 */
  dispose(): void {
    this.cancel();
    this.stopSource();
    this.buffer = null;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.audio.removeEventListener("playing", this.playing);
    this.audio.removeEventListener("pause", this.paused);
    this.audio.removeEventListener("waiting", this.waiting);
    this.audio.removeEventListener("error", this.failed);
    this.audio.removeEventListener("ended", this.ended);
    this.context?.removeEventListener("statechange", this.contextChanged);
    void this.context?.close();
    clearInterval(this.timer);
    this.listeners.clear();
  }
}
/** @brief 通知未登録時と拒否済みジョブの回収時に副作用を起こさない。 */
function empty(): void {}
