import type {
  Advertisement,
  PublicGame,
} from "../../apps/music/src/domain/models";

export type PublicationState =
  "prepared" | "sending" | "applied" | "failed" | "unknown";
export interface PublicationPayload {
  protocolVersion: 1;
  scope: string;
  game: PublicGame | null;
  advertisement?: Advertisement;
}
export interface Receipt {
  operationId: string;
  scope: string;
  payloadDigest: string;
  revision: number;
}
export interface Envelope {
  protocolVersion: 1;
  keyId: string;
  audience: "pandd-music";
  environment: string;
  method: "POST";
  path: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  operationId: string;
  actorId: string;
  gameId: string;
  assetId: string | null;
  action: "upload" | "preview" | "publish" | "status";
  expectedRevision: number;
  payloadDigest: string;
  bytes: number;
  kind: "audio" | "image" | null;
  mime: string | null;
}
