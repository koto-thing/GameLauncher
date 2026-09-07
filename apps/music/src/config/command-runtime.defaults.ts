// 形式そのものではなく端末性能・撮影条件に合わせる実行設定
export const COMMAND_RUNTIME = {
  intervalMs: 200,
  consecutiveFrames: 3,
  maxDimension: 1400,
  minimumScore: 0.87,
  minimumMargin: 0.075,
  maxFileBytes: 10 * 1024 * 1024,
  maxPixels: 20_000_000,
  timeoutMs: 8000,
  pngWidth: 1600,
} as const;
