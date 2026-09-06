import type { DomainPolicy } from "../domain/models";
import policy from "../../../../contracts/music/policy.json";
// TSとPHPへ同一の投稿制約を配布する。
export const DOMAIN_POLICY_DEFAULTS: DomainPolicy = policy;
