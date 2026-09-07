import {
  initSync,
  TrackMeter,
} from "../../../../../packages/music-loudness/generated/music_loudness.js";
import wasmDataUrl from "../../../../../packages/music-loudness/generated/music_loudness_bg.wasm?url&inline";
import type { AnalyzeLoudness } from "../../application/loudness";
import { trackLoudness } from "../../domain/loudness";

// 管理端末だけで全曲を展開する公開プレーヤーの96MiB予算とは別
const PCM_BUDGET_BYTES = 256 * 1024 * 1024;
const SAMPLE_RATE = 48000;
let initializing: Promise<void> | undefined;

/** @brief 自前DSPを持たず、固定したLoudnessMeterのWASMを初期化する */
async function initialize(): Promise<void> {
  initializing ??= WebAssembly.compile(
    Uint8Array.from(
      atob(wasmDataUrl.split(",")[1]),
      /** @brief 同梱データURLをネットワーク通信せず復元する */ (character) =>
        character.charCodeAt(0),
    ),
  ).then(
    /** @brief 非同期コンパイルした同梱モジュールだけを初期化する */ (
      module,
    ) => {
      initSync({ module });
    },
  );
  try {
    await initializing;
  } catch (error) {
    initializing = undefined;
    throw error;
  }
}

/** @brief 管理originの認可済み音源を全曲解析するPortを構成する */
export function createLoudnessAnalyzer(
  assetUrl: (id: string) => string,
): AnalyzeLoudness {
  const analyze: AnalyzeLoudness =
    /** @brief 小分け処理の間にUIへ制御を返し、破棄時は測定を停止する */ async (
      source,
      signal,
      progress,
      file,
    ) => {
      signal.throwIfAborted();
      if (
        !Number.isFinite(source.durationSeconds) ||
        source.durationSeconds <= 0 ||
        source.durationSeconds > 600 ||
        ![1, 2].includes(source.channels) ||
        source.durationSeconds * SAMPLE_RATE * source.channels * 4 >
          PCM_BUDGET_BYTES
      )
        throw new Error(
          "音量解析の音源長・チャンネル数・メモリ上限を超えています。",
        );
      if (typeof OfflineAudioContext === "undefined")
        throw new Error("このブラウザーは音量解析に対応していません。");
      progress(0);
      let encoded: ArrayBuffer;
      if (file) encoded = await file.arrayBuffer();
      else {
        const response = await fetch(assetUrl(source.audioAssetId), { signal });
        if (!response.ok) throw new Error("音量解析用の音源を取得できません。");
        encoded = await response.arrayBuffer();
      }
      signal.throwIfAborted();
      if (encoded.byteLength !== source.audioBytes)
        throw new Error("音源サイズが一致しません。");
      const context = new OfflineAudioContext(source.channels, 1, SAMPLE_RATE);
      const buffer = await context.decodeAudioData(encoded);
      signal.throwIfAborted();
      if (
        buffer.length * buffer.numberOfChannels * 4 > PCM_BUDGET_BYTES ||
        buffer.duration > 600 ||
        buffer.numberOfChannels !== source.channels
      )
        throw new Error(
          "展開した音源が解析の上限またはチャンネル数と一致しません。",
        );
      await initialize();
      signal.throwIfAborted();
      const meter = new TrackMeter(
        buffer.sampleRate,
        buffer.numberOfChannels,
        buffer.duration,
      );
      const channels = Array.from(
        { length: buffer.numberOfChannels },
        /** @brief デコード済みチャンネルを複製せず参照する */ (_, index) =>
          buffer.getChannelData(index),
      );
      const chunkFrames = 16384;
      const chunk = new Float32Array(chunkFrames * channels.length);
      try {
        for (let offset = 0; offset < buffer.length; offset += chunkFrames) {
          signal.throwIfAborted();
          const frames = Math.min(chunkFrames, buffer.length - offset);
          for (let frame = 0; frame < frames; frame++)
            for (let channel = 0; channel < channels.length; channel++)
              chunk[frame * channels.length + channel] =
                channels[channel][offset + frame];
          meter.process(chunk.subarray(0, frames * channels.length));
          progress(Math.floor(((offset + frames) / buffer.length) * 100));
          await new Promise(
            /** @brief 入力やキャンセルを処理する時間を確保する */ (
              resolve,
            ) => setTimeout(resolve, 0),
          );
        }
        signal.throwIfAborted();
        meter.finish();
        return trackLoudness(
          {
            audioAssetId: source.audioAssetId,
            integratedLufs: meter.integrated_lufs() ?? null,
            truePeakDbtp: meter.true_peak_dbtp() ?? null,
          },
          source.audioAssetId,
        );
      } finally {
        meter.free();
      }
    };
  let previous: Promise<unknown> = Promise.resolve();
  return /** @brief 中断できないdecodeAudioDataを含め、管理端末の解析を1曲ずつに制限する */ (
    ...args
  ) => {
    const job = previous
      .catch(/** @brief 前曲の失敗は次曲へ伝播させない */ () => {})
      .then(
        /** @brief 前曲のPCM解放後に次の取得とデコードを始める */ () =>
          analyze(...args),
      );
    previous = job;
    return job;
  };
}
