import { env } from "cloudflare:workers";
import { ensureSchema, getD1 } from "@/db/initialize";
import { localUsers, upsertUser, type SessionUser } from "@/lib/auth";
import { githubRepositoryAccess } from "@/lib/github-app";

export type AccessService = "game" | "music";
export type AccessRequestRow = {
  id: string; applicant_id: string; service: AccessService; target: string;
  display_name: string; purpose: string; state: "pending" | "approved" | "rejected";
  created_at: string; decided_at: string | null; decided_by: string | null;
  reason: string; grant_type: string | null; game_id: string | null; repository_access: number;
  login: string; avatar_url: string; game_title: string | null;
};

/** @brief 利用者へ返すエラーをHTTP状態とともに生成する */
function fail(status: number, message: string): never {
  throw Response.json({ error: message }, { status });
}

/** @brief 文字数上限を超える入力や空入力を拒否する */
function text(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    fail(400, `${label}を1〜${maximum}文字で入力してください`);
  }
  return value.trim();
}

/** @brief サービスを限定しMusic無効環境への書き込みを拒否する */
export function accessService(value: unknown): AccessService {
  if (value !== "game" && value !== "music") fail(400, "サービスが不正です");
  if (value === "music" && (env as Record<string, unknown>).MUSIC_ENABLED !== "true") {
    fail(503, "Music管理は無効です");
  }
  return value;
}

/** @brief ゲーム運営とMusic運営の審査権限を分離する */
export async function canReview(actor: SessionUser, service: AccessService): Promise<boolean> {
  if (service === "game") return actor.isAdmin && actor.gameAccess;
  return Boolean(await getD1().prepare("SELECT 1 FROM music_accounts WHERE id=? AND admin=1")
    .bind(actor.githubUserId).first());
}

/** @brief 本番はGitHubの最新権限、隔離開発では固定fixtureだけを参照する */
export async function hasRepositoryAccess(id: string, actor: SessionUser): Promise<boolean> {
  if (actor.authSource === "local-development") {
    return Object.values(localUsers).some((user) => user.githubUserId === id && user.gameAccess);
  }
  return githubRepositoryAccess(id);
}

/** @brief 一般利用者には自分の申請だけ、審査者には対象サービスの申請を返す */
export async function listAccessRequests(actor: SessionUser, service: AccessService, review: boolean) {
  await ensureSchema();
  const reviewer = await canReview(actor, service);
  if (review && !reviewer) fail(403, "このサービスの申請を審査する権限がありません");
  const db = getD1();
  const filter = review ? "" : "AND r.applicant_id=?";
  const gameTitle = service === "music" ? "(SELECT json_extract(draft,'$.title') FROM music_games WHERE id=r.game_id)" : "NULL";
  const statement = db.prepare(`SELECT r.id,r.applicant_id,r.service,r.target,r.display_name,r.purpose,
    r.state,r.created_at,r.decided_at,r.decided_by,r.reason,r.grant_type,r.game_id,r.repository_access,
    u.login_snapshot AS login,u.avatar_url,${gameTitle} AS game_title FROM access_requests r
    JOIN users u ON u.github_user_id=r.applicant_id WHERE r.service=? ${filter}
    ORDER BY CASE WHEN r.state='pending' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 100`);
  const requests = await (review ? statement.bind(service) : statement.bind(service, actor.githubUserId)).all<AccessRequestRow>();

  // 未公開作品の候補はMusic運営にだけ返す
  const games = review && service === "music" ? (await db.prepare(
    "SELECT id,json_extract(draft,'$.title') AS title FROM music_games ORDER BY id",
  ).all<{ id: string; title: string }>()).results : [];
  return { requests: requests.results, canReview: reviewer, games };
}

/** @brief セッション本人に紐付けて申請を作り、承認待ちの重複をDBで防ぐ */
export async function submitAccessRequest(actor: SessionUser, input: Record<string, unknown>) {
  const service = accessService(input.service);
  const target = service === "game" ? "GameLauncher" : text(input.target, 120, "担当したい作品名");
  const displayName = text(input.displayName, 80, "氏名・活動名");
  const purpose = text(input.purpose, 1000, "利用目的");
  await upsertUser(actor);
  const id = crypto.randomUUID();
  const result = await getD1().prepare(`INSERT INTO access_requests
    (id,applicant_id,service,target,display_name,purpose,created_at,repository_access)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`)
    .bind(id, actor.githubUserId, service, target, displayName, purpose, new Date().toISOString(), actor.gameAccess ? 1 : 0).run();
  if (!result.meta.changes) fail(409, "同じ対象への申請は承認待ちです");
  return { id };
}

/** @brief 一度だけ審査を確定し、権限付与と審査記録を同じトランザクションに保存する */
export async function decideAccessRequest(actor: SessionUser, input: Record<string, unknown>) {
  const service = accessService(input.service);
  await ensureSchema();
  if (!await canReview(actor, service)) fail(403, "このサービスの申請を審査する権限がありません");
  const id = text(input.id, 100, "申請");
  const decision = input.decision;
  if (decision !== "approved" && decision !== "rejected") fail(400, "審査結果が不正です");
  const reason = decision === "rejected" ? text(input.reason, 1000, "却下理由") : "";
  const db = getD1();
  const row = await db.prepare("SELECT * FROM access_requests WHERE id=? AND service=?")
    .bind(id, service).first<AccessRequestRow>();
  if (!row) fail(404, "申請が見つかりません");
  if (row.state !== "pending") fail(409, "この申請は審査済みです。最新の状態に更新してください");
  if (row.applicant_id === actor.githubUserId) fail(403, "自分の利用申請は承認・却下できません");

  let grant: string | null = null;
  let gameId: string | null = null;
  if (decision === "approved" && service === "game") {
    grant = text(input.grantType, 30, "付与する権限");
    if (!["requester", "approver", "production_requester"].includes(grant)) fail(400, "権限が不正です");
    if (!await hasRepositoryAccess(row.applicant_id, actor)) {
      await db.prepare("UPDATE access_requests SET repository_access=0 WHERE id=? AND state='pending'").bind(id).run();
      fail(409, "リポジトリのWrite以上の権限設定が必要です。設定後に再度承認してください");
    }
  }
  if (decision === "approved" && service === "music") {
    gameId = text(input.gameId, 100, "付与する作品");
    if (!await db.prepare("SELECT 1 FROM music_games WHERE id=?").bind(gameId).first()) fail(400, "作品が見つかりません");
  }

  await upsertUser(actor);
  const token = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  // Music運営の取消と競合しても、書き込み時の権限がなければ確定させない
  const authority = service === "music" ? "AND EXISTS(SELECT 1 FROM music_accounts WHERE id=? AND admin=1)" : "";
  const update = db.prepare(`UPDATE access_requests SET state=?,decided_at=?,decided_by=?,reason=?,grant_type=?,game_id=?,decision_token=?,
    repository_access=CASE WHEN service='game' AND ?='approved' THEN 1 ELSE repository_access END
    WHERE id=? AND state='pending' ${authority}`);
  const values = [decision, timestamp, actor.githubUserId, reason, grant, gameId, token, decision, id];
  const batch = [update.bind(...(service === "music" ? [...values, actor.githubUserId] : values))];
  const owned = "EXISTS(SELECT 1 FROM access_requests WHERE id=? AND decision_token=?)";

  // 各書き込みは今回だけの審査tokenを条件にし、競合で負けた処理から権限を付与させない
  if (decision === "approved" && service === "game") {
    batch.push(db.prepare(`INSERT INTO policy_grants
      (github_user_id,grant_type,granted_by_github_user_id,granted_at,revoked_at)
      SELECT ?,?,?,?,NULL WHERE ${owned}
      ON CONFLICT(github_user_id,grant_type) DO UPDATE SET granted_by_github_user_id=excluded.granted_by_github_user_id,
      granted_at=excluded.granted_at,revoked_at=NULL`).bind(row.applicant_id, grant, actor.githubUserId, timestamp, id, token));
  }
  if (decision === "approved" && service === "music") {
    batch.push(db.prepare(`INSERT INTO music_accounts(id,login,admin)
      SELECT github_user_id,login_snapshot,0 FROM users WHERE github_user_id=? AND ${owned}
      ON CONFLICT(id) DO UPDATE SET login=excluded.login`).bind(row.applicant_id, id, token));
    batch.push(db.prepare(`INSERT INTO music_memberships(game_id,account_id) SELECT ?,? WHERE ${owned} ON CONFLICT DO NOTHING`)
      .bind(gameId, row.applicant_id, id, token));
    batch.push(db.prepare(`INSERT INTO music_audit_log(actor,action,target,at) SELECT ?,'membership.approved',?,? WHERE ${owned}`)
      .bind(actor.githubUserId, `${gameId}:${row.applicant_id}`, Date.now(), id, token));
  }
  const results = await db.batch(batch);
  if (!results[0].meta.changes) fail(409, "審査済み、または審査権限が変更されました。最新の状態に更新してください");
}
