import { nextTrack, shuffledQueue } from "../domain/rules";
import type {
  LoopRegion,
  PlaybackStatus,
  PublicTrack,
  RepeatMode,
} from "../domain/models";

export interface AudioSnapshot {
  status: PlaybackStatus;
  positionSeconds: number;
  error: string | null;
  regionActive: boolean;
}
export interface AudioEngine {
  load(track: PublicTrack): void;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  setRegion(region: LoopRegion | null): Promise<void>;
  snapshot(): AudioSnapshot;
  subscribe(listener: () => void): () => void;
  setEnded(listener: () => void): void;
  dispose(): void;
}
export interface PlayerSnapshot extends AudioSnapshot {
  track: PublicTrack | null;
  queue: PublicTrack[];
  repeat: RepeatMode;
  shuffle: boolean;
}

/** @brief ルーティングから独立した再生キューと排他的モードを管理する。 */
export class Player {
  private tracks: PublicTrack[] = [];
  private order: string[] = [];
  private current: PublicTrack | null = null;
  private repeat: RepeatMode = "off";
  private shuffle = false;
  private modeGeneration = 0;
  private listeners = new Set<() => void>();
  private state: PlayerSnapshot;
  /** @brief 唯一の音声エンジンとテスト可能な乱数を受け取る。 */
  constructor(
    private readonly engine: AudioEngine,
    private readonly random: () => number,
  ) {
    this.state = this.read();
    engine.subscribe(this.changed);
    engine.setEnded(this.ended);
  }
  /** @brief UI用の不変スナップショットを再作成する。 */
  private read(): PlayerSnapshot {
    return {
      ...this.engine.snapshot(),
      track: this.current,
      queue: this.tracks,
      repeat: this.repeat,
      shuffle: this.shuffle,
    };
  }
  /** @brief 実際の再生状態が変化した時だけUIへ通知する。 */
  private changed = (): void => {
    this.state = this.read();
    for (const listener of this.listeners) listener();
  };
  /** @brief Reactの外部ストア購読を接続する。 */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return /** @brief ページの購読だけを解除し音声は破棄しない。 */ () => {
      this.listeners.delete(listener);
    };
  };
  /** @brief キャッシュした表示状態を返す。 */
  snapshot = (): PlayerSnapshot => this.state;
  /** @brief ユーザー操作から曲を開始し古い非同期モード変更を無効化する。 */
  async start(track: PublicTrack, queue: PublicTrack[]): Promise<void> {
    this.modeGeneration++;
    if (this.repeat === "region") this.repeat = "off";
    this.current = track;
    this.tracks = queue;
    const ids = queue.map(
      /** @brief キューから安定IDを取り出す。 */ (item) => item.id,
    );
    this.order = this.shuffle ? shuffledQueue(ids, track.id, this.random) : ids;
    this.engine.load(track);
    this.changed();
    await this.engine.play();
  }
  /** @brief 読み込み途中の停止も音声エンジンへ伝える。 */
  toggle = async (): Promise<void> => {
    const state = this.engine.snapshot();
    if (state.status === "playing" || state.status === "loading")
      this.engine.pause();
    else await this.engine.play();
  };
  /** @brief 指定秒への移動は音声エンジンの正規化結果を表示する。 */
  seek = (seconds: number): void => {
    this.engine.seek(seconds);
  };
  /** @brief 自然終端で次の曲へ進む。 */
  private ended = (): void => {
    void this.move(1, true);
  };
  /** @brief 手動移動では曲固有ループを解除する。 */
  async move(direction: 1 | -1, automatic = false): Promise<void> {
    if (!this.current) return;
    const id = nextTrack(
      this.order,
      this.current.id,
      direction,
      this.repeat,
      automatic,
    );
    if (!id) {
      this.changed();
      return;
    }
    const next = this.tracks.find(
      /** @brief キュー内だけから次曲を解決する。 */ (track) => track.id === id,
    );
    if (!next) return;
    // シャッフル順を毎回生成し直すと曲が重複しやすいため、移動前の順を維持する。
    const order = this.order;
    await this.start(next, this.tracks);
    this.order = order;
  }
  /** @brief 区間の準備完了と一致する排他的モードを表示する。 */
  async setRepeat(mode: RepeatMode): Promise<void> {
    if (!this.current) return;
    if (mode === "region" && !this.current.loop) return;
    const generation = ++this.modeGeneration;
    await this.engine.setRegion(mode === "region" ? this.current.loop : null);
    if (generation !== this.modeGeneration) return;
    const actual = this.engine.snapshot();
    this.repeat =
      actual.error || (mode === "region" && !actual.regionActive)
        ? "off"
        : mode;
    this.changed();
  }
  /** @brief シャッフルONでも再生中の曲は変えない。 */
  toggleShuffle = (): void => {
    this.shuffle = !this.shuffle;
    const ids = this.tracks.map(
      /** @brief 基本順を復元可能にする。 */ (track) => track.id,
    );
    this.order = this.shuffle
      ? shuffledQueue(ids, this.current?.id ?? "", this.random)
      : ids;
    this.changed();
  };
  /** @brief 投稿者の継ぎ目試聴も同じエンジンを使用する。 */
  async preview(track: PublicTrack, leadSeconds: number): Promise<void> {
    await this.start(track, [track]);
    if (!track.loop) return;
    await this.setRepeat("region");
    this.seek(Math.max(0, track.loop.endSeconds - leadSeconds));
  }
}
