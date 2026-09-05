import type { LoopRegion } from "../../domain/models";

/** @brief 実再生とOfflineAudioContextテストで共通の精密ループNodeを構成する。 @param context 音声クロック。 @param buffer 必要な1曲だけのPCM。 @param region ループ区間または通常再生。 @param offsetSeconds 開始位置。 @param destination 出力。 @returns 開始済みNode。 */
export function startRegionSource(
  context: BaseAudioContext,
  buffer: AudioBuffer,
  region: LoopRegion | null,
  offsetSeconds: number,
  destination: AudioNode,
): AudioBufferSourceNode {
  const source = context.createBufferSource();
  source.buffer = buffer;
  // タイマーによる位置戻しを行わず、レンダリングスレッドに反復を任せる。
  source.loop = region !== null;
  if (region) {
    source.loopStart = region.startSeconds;
    source.loopEnd = region.endSeconds;
  }
  source.connect(destination);
  source.start(0, offsetSeconds);
  return source;
}
