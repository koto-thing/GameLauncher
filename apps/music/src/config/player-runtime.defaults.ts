export interface PlayerRuntime {
  decodedAudioBudgetBytes: number;
  decodeSampleRateHz: number;
  simultaneousDecodeLimit: number;
  loopPreviewLeadInSeconds: number;
  nextTrackAudioPrefetchEnabled: boolean;
  displayIntervalMs: number;
}
// PCM以外の一時バッファも必要になるため、この値を端末の安全保証とは扱わない。
export const PLAYER_RUNTIME_DEFAULTS: PlayerRuntime = {
  decodedAudioBudgetBytes: 96 * 1024 * 1024,
  decodeSampleRateHz: 48000,
  simultaneousDecodeLimit: 1,
  loopPreviewLeadInSeconds: 3,
  nextTrackAudioPrefetchEnabled: false,
  displayIntervalMs: 200,
};
