import { createContext, useContext } from "react";
import type { Player } from "../../application/player";
import type { Session } from "../../application/ports";
import type { DomainPolicy, PublicGame } from "../../domain/models";

export interface SiteConfig {
  contactUrl: string;
  policy: DomainPolicy;
  local: boolean;
  oauthConfigured: boolean;
}
export interface SiteState {
  player: Player;
  catalogue: PublicGame[];
  session: Session | null;
  config: SiteConfig | null;
  loading: boolean;
  refresh(): Promise<void>;
}
export const SiteContext = createContext<SiteState | null>(null);
/** @brief サイト全体に1つだけのデータとプレーヤーを参照する。 */
export function useSite(): SiteState {
  const state = useContext(SiteContext);
  if (!state) throw new Error("SiteContextがありません。");
  return state;
}
