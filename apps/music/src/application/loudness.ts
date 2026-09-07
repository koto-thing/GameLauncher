import type { TrackLoudness } from "../domain/models";

export interface AudioAnalysisSource {
  audioAssetId: string;
  audioBytes: number;
  durationSeconds: number;
  channels: number;
}
export type AnalyzeLoudness = (
  source: AudioAnalysisSource,
  signal: AbortSignal,
  progress: (percent: number) => void,
  file?: Blob,
) => Promise<TrackLoudness>;
