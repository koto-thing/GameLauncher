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
  finishAsset(value: Asset, actor: Principal): Promise<void>;
  advertisement(): Promise<Advertisement>;
  accounts(): Promise<Account[]>;
  memberships(gameId: string): Promise<string[]>;
  setMembership(
    gameId: string,
    accountId: string,
    enabled: boolean,
    actor: Principal,
    login: string | null,
  ): Promise<void>;
  audit(): Promise<AuditEntry[]>;
}
export interface MusicPublisher {
  game(
    value: Game,
    version: number,
    actor: Principal,
    adminOnly?: boolean,
  ): Promise<void>;
  track(value: Track, version: number, actor: Principal): Promise<void>;
  advertisement(value: Advertisement, actor: Principal): Promise<void>;
}
export interface Session {
  principal: Principal;
  csrf: string;
  expiresAt: number;
}
export interface AccountDirectory {
  findById(id: string): Promise<{ id: string; login: string }>;
}
export interface Clock {
  now(): number;
}
export interface IdSource {
  next(): string;
}
