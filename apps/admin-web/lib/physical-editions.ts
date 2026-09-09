import { env } from "cloudflare:workers";
import { ensureSchema, getD1 } from "@/db/initialize";
import { requireGameAccess, type SessionUser } from "@/lib/auth";
import { dispatchEditionWorkflow, githubAppDispatchConfigured } from "@/lib/github-app";
import { loadPublishedGames } from "@/lib/published-game-profile";
import { PRODUCTION_ORIGIN, validateEdition, validateEditionImage, type EditionDefinition } from "@/lib/physical-edition-contract";
import type { ActionsIdentity } from "@/lib/actions-identity";

type BuildRow = { build_id: string; edition_id: string; state: string; run_id: string | null; run_attempt: number | null };

/** @brief 配布版の作成・実行は既存の管理者に限定する */
export async function requireEditionAdmin(actor: SessionUser): Promise<void> {
  requireGameAccess(actor);
  if (!actor.isAdmin) throw new Response("Admin required", { status: 403 });
  await ensureSchema();
}

/** @brief 既存の非公開受入ストレージへ配布デザインを保管する */
function storage(): R2Bucket {
  const bucket = (env as unknown as { INTAKE?: R2Bucket }).INTAKE;
  if (!bucket) throw new Error("INTAKE storage is unavailable");
  return bucket;
}

/** @brief 本番Windowsカタログを取得し、障害時に空一覧へ置換しない */
export async function productionCatalog() {
  const response = await fetch(`${PRODUCTION_ORIGIN}/v1/catalog/ja-JP/windows/x86_64.json`, {
    redirect: "manual", signal: AbortSignal.timeout(15000), cache: "no-store",
  });
  if (!response.ok) throw new Error("Windows本番ゲーム一覧を取得できません");
  const catalog = await response.json() as { games: Array<{ gameId: string; name: string }> };
  if (!Array.isArray(catalog.games)) throw new Error("本番カタログが不正です");
  return catalog;
}

/** @brief 管理ゲーム・配布版・ビルド履歴を返す */
export async function editionDashboard(actor: SessionUser) {
  await requireEditionAdmin(actor);
  const [catalog, profiles, managed, editions, builds] = await Promise.all([
    productionCatalog(), loadPublishedGames("ja-JP"),
    getD1().prepare("SELECT DISTINCT game_id FROM deployment_requests").all<{ game_id: string }>(),
    getD1().prepare("SELECT * FROM physical_editions ORDER BY created_at DESC").all(),
    getD1().prepare("SELECT * FROM physical_edition_builds ORDER BY created_at DESC LIMIT 100").all(),
  ]);
  const published = new Map(catalog.games.map((game) => [game.gameId, game.name]));
  const ids = new Set([...published.keys(), ...profiles.map((game) => game.gameId), ...managed.results.map((game) => game.game_id)]);
  return {
    games: [...ids].sort().map((id) => ({ id, name: published.get(id) ?? profiles.find((game) => game.gameId === id)?.name ?? id,
      available: published.has(id), reason: published.has(id) ? "" : "Windows向けの本番公開版がありません" })),
    editions: editions.results.map((row) => ({ ...row, definition: JSON.parse(String(row.definition_json)) })),
    builds: builds.results,
    dispatchConfigured: githubAppDispatchConfigured("production"),
  };
}

/** @brief 収録対象とデザインを固定した新規配布版を保存する */
export async function createEdition(actor: SessionUser, form: FormData) {
  await requireEditionAdmin(actor);
  const id = crypto.randomUUID();
  const definition = validateEdition(JSON.parse(String(form.get("definition"))), id);
  const catalog = await productionCatalog();
  if (definition.games.some((id) => !catalog.games.some((game) => game.gameId === id))) {
    throw new Error("本番Windows公開済みゲームだけを選択してください");
  }
  for (const name of ["logo", "background"]) {
    const file = form.get(name);
    if (!(file instanceof File) || file.size > 2 * 1024 * 1024) throw new Error("PNG画像が必要です");
    const bytes = new Uint8Array(await file.arrayBuffer());
    validateEditionImage(bytes);
    await storage().put(`physical-editions/${id}/${name}.png`, bytes, { httpMetadata: { contentType: "image/png" } });
  }
  await getD1().prepare("INSERT INTO physical_editions VALUES (?, ?, ?, ?)")
    .bind(id, JSON.stringify(definition), actor.githubUserId, new Date().toISOString()).run();
  return { editionId: id };
}

/** @brief 固定配布版に新しい独立ビルドを作成してActionsへ渡す */
export async function buildEdition(actor: SessionUser, editionId: string) {
  await requireEditionAdmin(actor);
  if (!githubAppDispatchConfigured("production")) throw new Error("Production Actions設定が必要です");
  if (!await getD1().prepare("SELECT edition_id FROM physical_editions WHERE edition_id = ?").bind(editionId).first()) {
    throw new Error("配布版が見つかりません");
  }
  const buildId = crypto.randomUUID();
  await getD1().prepare(`INSERT INTO physical_edition_builds (build_id, edition_id, state, created_by, created_at)
    VALUES (?, ?, 'queued', ?, ?)`).bind(buildId, editionId, actor.githubUserId, new Date().toISOString()).run();
  try {
    await dispatchEditionWorkflow(editionId, buildId);
  } catch (error) {
    await getD1().prepare("UPDATE physical_edition_builds SET state = 'failed', error = ?, finished_at = ? WHERE build_id = ? AND state = 'queued'")
      .bind(String(error), new Date().toISOString(), buildId).run();
    throw error;
  }
  return { buildId };
}

/** @brief Actions実行を一つの配布ビルドへ原子的に固定する */
export async function editionPreflight(identity: ActionsIdentity, editionId: string, buildId: string) {
  await ensureSchema();
  const result = await getD1().prepare(`UPDATE physical_edition_builds
    SET state = 'running', run_id = ?, run_attempt = ?, workflow_sha = ?
    WHERE build_id = ? AND edition_id = ? AND state = 'queued' AND run_id IS NULL`)
    .bind(identity.runId, identity.runAttempt, identity.workflowSha, buildId, editionId).run();
  if (result.meta.changes !== 1) throw new Error("このビルドは実行済みか、別のActionsに割り当てられています");
  const row = await getD1().prepare("SELECT definition_json FROM physical_editions WHERE edition_id = ?")
    .bind(editionId).first<{ definition_json: string }>();
  if (!row) throw new Error("配布版が見つかりません");
  const images: Record<string, string> = {};
  for (const name of ["logo", "background"]) {
    const object = await storage().get(`physical-editions/${editionId}/${name}.png`);
    if (!object || object.size > 2 * 1024 * 1024) throw new Error("配布版画像がありません、または容量が不正です");
    images[name] = Buffer.from(await object.arrayBuffer()).toString("base64");
  }
  return { definition: JSON.parse(row.definition_json) as EditionDefinition, images };
}

/** @brief 実行主体が固定されたビルドの記録だけを更新する */
export async function editionStatus(identity: ActionsIdentity, input: {
  buildId: string; state: string; snapshot?: unknown; artifactId?: string; error?: string;
}) {
  await ensureSchema();
  const row = await getD1().prepare("SELECT * FROM physical_edition_builds WHERE build_id = ?")
    .bind(input.buildId).first<BuildRow>();
  if (!row || row.run_id !== identity.runId || row.run_attempt !== identity.runAttempt || row.state !== "running") {
    throw new Error("このActionsからビルド結果を更新できません");
  }
  if (!["running", "succeeded", "failed", "cancelled"].includes(input.state) ||
      (input.state === "succeeded" && !/^\d+$/.test(input.artifactId ?? ""))) throw new Error("不正なビルド結果です");
  const snapshot = input.snapshot === undefined ? null : JSON.stringify(input.snapshot);
  if (snapshot && snapshot.length > 100000) throw new Error("ビルド記録が大きすぎます");
  await getD1().prepare(`UPDATE physical_edition_builds SET state = ?, snapshot_json = COALESCE(snapshot_json, ?),
    artifact_id = COALESCE(?, artifact_id), error = ?, finished_at = ? WHERE build_id = ? AND state = 'running' AND run_id = ? AND run_attempt = ?`)
    .bind(input.state, snapshot, input.artifactId ?? null, input.error?.slice(0, 2000) ?? null,
      input.state === "running" ? null : new Date().toISOString(), input.buildId, identity.runId, identity.runAttempt).run();
}
