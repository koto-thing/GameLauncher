export interface DomainPolicy {
  media: {
    maxAudioFileBytes: number;
    maxImageFileBytes: number;
    maxAudioDurationSeconds: number;
    maxImageEdgePixels: number;
  };
  loop: { minimumLengthSeconds: number };
  text: {
    titleMax: number;
    descriptionMax: number;
    creditMax: number;
    creditNameMax: number;
    creditRoleMax: number;
    imageAltMax: number;
    urlMax: number;
  };
}
export interface LoopRegion {
  startSeconds: number;
  endSeconds: number;
}
export interface Credit {
  name: string;
  role: string;
}
export interface GameContent {
  title: string;
  description: string;
  imageAssetId: string | null;
  imageAlt: string;
  externalUrl: string;
  rightsConfirmed: boolean;
  design?: GameDesign;
}
export interface GameDesign {
  backgroundColor: string;
  backgroundAssetId: string | null;
  backgroundMode: "cover" | "contain" | "tile";
}
export interface TrackContent {
  title: string;
  credits: Credit[];
  comment: string;
  audioAssetId: string | null;
  imageAssetId: string | null;
  imageAlt: string;
  loop: LoopRegion | null;
  rightsConfirmed: boolean;
}
export interface Game {
  id: string;
  version: number;
  draft: GameContent;
  published: GameContent | null;
  suspended: boolean;
}
export interface Track {
  id: string;
  gameId: string;
  version: number;
  position: number;
  publishedPosition: number | null;
  draft: TrackContent;
  published: TrackContent | null;
}
export interface Asset {
  id: string;
  gameId: string;
  key: string;
  kind: "audio" | "image";
  mime: string;
  bytes: number;
  status: "pending" | "verified" | "failed";
  durationSeconds: number | null;
  sampleRateHz: number | null;
  channels: number | null;
  widthPixels: number | null;
  heightPixels: number | null;
  createdAt: number;
}
export interface Account {
  id: string;
  login: string;
  admin: boolean;
}
export interface Principal extends Account {
  gameIds: string[];
}
export interface Advertisement {
  enabled: boolean;
  imageAssetId: string | null;
  href: string;
  alt: string;
  version: number;
}
export interface PublicTrack extends TrackContent {
  id: string;
  gameId: string;
  position: number;
  durationSeconds: number;
  sampleRateHz: number;
  channels: number;
  audioBytes: number;
}
export interface PublicGame extends GameContent {
  id: string;
  tracks: PublicTrack[];
}
export type RepeatMode = "off" | "track" | "queue" | "region";
export type PlaybackStatus =
  "idle" | "loading" | "playing" | "paused" | "interrupted" | "error";
export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  target: string;
  at: number;
}

/** @brief 業務エラーをHTTPなど外側の表現から独立して保持する。 */
export class MusicError extends Error {
  /** @brief 安定したエラーコードと利用者向けの説明を設定する。 @param code エラー分類。 @param message 復旧に必要な説明。 @param field 入力項目。 */
  constructor(
    public code:
      | "INVALID"
      | "UNAUTHENTICATED"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "CONFLICT"
      | "TOO_LARGE"
      | "RATE_LIMIT"
      | "UNAVAILABLE",
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}
