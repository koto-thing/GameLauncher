import { currentRole, permits } from "@/lib/roles";
import { env } from "cloudflare:workers";
import { ensureSchema, getD1 } from "@/db/initialize";
import { upsertUser, type SessionUser } from "@/lib/auth";

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
  void service;
  return permits(await currentRole(actor.githubUserId), "invite");
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

  // 権限付与は本人が受諾する共通招待へ一本化する
  if (decision === "approved") fail(410, "メンバー管理から運営ロールを招待してください");
  await db.batch([
    db.prepare("UPDATE access_requests SET state='rejected',decided_at=?,decided_by=?,reason=? WHERE id=? AND state='pending'")
      .bind(new Date().toISOString(),actor.githubUserId,reason,id),
    db.prepare("INSERT INTO operation_events(id,actor,action,target,result,at) SELECT ?,?,'access.rejected',?,'succeeded',? WHERE changes()=1")
      .bind(crypto.randomUUID(),actor.githubUserId,id,new Date().toISOString()),
  ]);
}
