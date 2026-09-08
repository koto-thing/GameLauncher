import type { TrackLoudness } from "./models";
import { record, requireValue } from "./rules";

// 音楽配信の製品方針測定規格の定数ではない
export const LOUDNESS_TARGET_LUFS = -18;
export const LOUDNESS_PEAK_CEILING_DBTP = -1;
const MAXIMUM_BOOST_DB = 12;

/** @brief 測定値を音源IDに拘束し、差し替え前の値や不正な増幅を拒否する */
export function trackLoudness(
  input: unknown,
  audioAssetId: string | null,
): TrackLoudness {
  const value = record(input);
  requireValue(
    Boolean(audioAssetId) && value.audioAssetId === audioAssetId,
    "音源を変更したため、音量を測定し直してください。",
    "loudness",
  );
  for (const [key, minimum, maximum] of [
    ["integratedLufs", -70, 10],
    ["truePeakDbtp", -200, 30],
  ] as const) {
    const metric = value[key];
    requireValue(
      metric === null ||
        (typeof metric === "number" &&
          Number.isFinite(metric) &&
          metric >= minimum &&
          metric <= maximum),
      "音量の測定値が不正です。再測定してください。",
      "loudness",
    );
  }
  requireValue(
    value.integratedLufs === null || value.truePeakDbtp !== null,
    "ピークの測定値が必要です。",
    "loudness",
  );
  return {
    audioAssetId: audioAssetId!,
    integratedLufs: value.integratedLufs as number | null,
    truePeakDbtp: value.truePeakDbtp as number | null,
  };
}

/** @brief 曲内の強弱を保ち、ピーク余裕と最大増幅量の範囲で目標音量へ揃える */
export function normalizationGainDb(
  measurement: TrackLoudness | undefined,
  audioAssetId: string | null,
): number {
  if (!measurement) return 0;
  const value = trackLoudness(measurement, audioAssetId);
  if (value.integratedLufs === null || value.truePeakDbtp === null) return 0;
  return Math.min(
    LOUDNESS_TARGET_LUFS - value.integratedLufs,
    LOUDNESS_PEAK_CEILING_DBTP - value.truePeakDbtp,
    MAXIMUM_BOOST_DB,
  );
}
