import { env } from "cloudflare:workers";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const OIDC_AUDIENCE = "pandd-control-plane";
const REPOSITORY = "koto-thing/GameLauncher";
const WORKFLOW_ENVIRONMENTS = new Map<string, "staging" | "production">([
  ["koto-thing/GameLauncher/.github/workflows/deploy-game-staging.yml@refs/heads/master", "staging"],
  ["koto-thing/GameLauncher/.github/workflows/deploy-game-production.yml@refs/heads/master", "production"],
] as const);
const ALLOWED_REPOSITORY_VISIBILITIES = new Set(["private", "public"]);
const jwks = createRemoteJWKSet(new URL(`${OIDC_ISSUER}/.well-known/jwks`));

type ActionsEnv = { GITHUB_REPOSITORY_ID?: string };

export type ActionsIdentity = {
  runId: string;
  runAttempt: number;
  workflowSha: string;
  deploymentEnvironment: "staging" | "production";
  environment?: string;
  claims: JWTPayload;
};

/** @brief OIDC claimを文字列へ正規化する */
function text(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

/** @brief OIDCの実行回数を数値化する */
function number(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

/**
 * GitHub Actions OIDCトークンを検証し、許可されたWorkflowの実行主体を返す
 * @param request Actionsから届いたコールバックリクエスト
 * @param requireEnvironment 対象環境claimも必須にするか
 */
export async function requireActionsIdentity(
  request: Request,
  requireEnvironment: boolean,
  purpose: "deployment" | "edition" = "deployment",
): Promise<ActionsIdentity> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new Response("OIDC token required", { status: 401 });
  const repositoryId = (env as unknown as ActionsEnv).GITHUB_REPOSITORY_ID;
  if (!repositoryId) throw new Error("GITHUB_REPOSITORY_IDが設定されていません");
  const { payload } = await jwtVerify(authorization.slice("Bearer ".length), jwks, {
    issuer: OIDC_ISSUER,
    audience: OIDC_AUDIENCE,
  });
  const deploymentEnvironment = purpose === "edition"
    ? (payload.workflow_ref === "koto-thing/GameLauncher/.github/workflows/build-physical-edition.yml@refs/heads/master" ? "production" : undefined)
    : WORKFLOW_ENVIRONMENTS.get(text(payload.workflow_ref));
  if (payload.repository !== REPOSITORY || payload.repository_id !== repositoryId ||
      !ALLOWED_REPOSITORY_VISIBILITIES.has(text(payload.repository_visibility)) ||
      payload.event_name !== "workflow_dispatch" ||
      !deploymentEnvironment || payload.ref !== "refs/heads/master") {
    throw new Response("OIDC claims rejected", { status: 403 });
  }
  if (requireEnvironment && payload.environment !== deploymentEnvironment) {
    throw new Response(`${deploymentEnvironment} Environment claim required`, { status: 403 });
  }
  const runId = text(payload.run_id);
  const runAttempt = number(payload.run_attempt);
  const workflowSha = text(payload.workflow_sha);
  if (!/^\d+$/.test(runId) || !Number.isSafeInteger(runAttempt) || runAttempt < 1 ||
      !/^[0-9a-f]{40}$/.test(workflowSha)) {
    throw new Response("OIDC run claims rejected", { status: 403 });
  }
  return {
    runId,
    runAttempt,
    workflowSha,
    deploymentEnvironment,
    environment: typeof payload.environment === "string" ? payload.environment : undefined,
    claims: payload,
  };
}
