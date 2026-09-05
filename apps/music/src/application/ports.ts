import type {
  Account,
  Advertisement,
  Asset,
  AuditEntry,
  Game,
  Principal,
  Track,
} from "../domain/models";

export interface MusicRepository {
  games(): Promise<Game[]>;
  game(id: string): Promise<Game | null>;
  tracks(gameId: string): Promise<Track[]>;
  track(id: string): Promise<Track | null>;
  saveGame(
    value: Game,
    expectedVersion: number,
    actor: Principal,
    action: string,
  ): Promise<void>;
  saveTrack(
    value: Track,
    expectedVersion: number,
    actor: Principal,
    action: string,
  ): Promise<void>;
  createGame(value: Game, actor: Principal): Promise<void>;
  createTrack(value: Track, actor: Principal): Promise<void>;
  asset(id: string): Promise<Asset | null>;
  addAsset(value: Asset, actor: Principal): Promise<void>;
  finishAsset(value: Asset, actor: Principal): Promise<void>;
  canReadAsset(id: string): Promise<boolean>;
  advertisement(): Promise<Advertisement>;
  saveAdvertisement(value: Advertisement, actor: Principal): Promise<void>;
  accounts(): Promise<Account[]>;
  memberships(gameId: string): Promise<string[]>;
  setMembership(
    gameId: string,
    accountId: string,
    enabled: boolean,
    actor: Principal,
  ): Promise<void>;
  setAdmin(
    accountId: string,
    enabled: boolean,
    actor: Principal,
  ): Promise<void>;
  audit(): Promise<AuditEntry[]>;
}
export interface StoredBody {
  body: ReadableStream<Uint8Array>;
  size: number;
}
export interface AssetStorage {
  put(
    key: string,
    body: ReadableStream<Uint8Array>,
    bytes: number,
  ): Promise<void>;
  get(
    key: string,
    range?: { offset: number; length: number },
  ): Promise<StoredBody | null>;
  remove(key: string): Promise<void>;
  inspect(
    key: string,
    kind: Asset["kind"],
    bytes: number,
  ): Promise<
    Pick<
      Asset,
      | "mime"
      | "durationSeconds"
      | "sampleRateHz"
      | "channels"
      | "widthPixels"
      | "heightPixels"
    >
  >;
}
export interface Session {
  principal: Principal;
  csrf: string;
  expiresAt: number;
}
export interface AuthStore {
  session(tokenHash: string, now: number): Promise<Session | null>;
  createSession(
    tokenHash: string,
    accountId: string,
    csrf: string,
    expiresAt: number,
  ): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  provisionAccount(
    id: string,
    login: string,
    bootstrapAdmin: boolean,
  ): Promise<void>;
  saveFlow(
    stateHash: string,
    verifier: string,
    expiresAt: number,
  ): Promise<void>;
  consumeFlow(stateHash: string, now: number): Promise<string | null>;
  rateLimit(key: string, window: number, max: number): Promise<boolean>;
}
export interface IdentityProvider {
  exchange(
    code: string,
    verifier: string,
  ): Promise<{ id: string; login: string }>;
}
export interface Clock {
  now(): number;
}
export interface IdSource {
  next(): string;
}
