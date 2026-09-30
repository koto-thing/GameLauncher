import { env } from "cloudflare:workers";
import { createPrivateKey } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";

type GitHubAppEnv = {
  STAGING_DISPATCH_ENABLED?: string;
  PRODUCTION_DISPATCH_ENABLED?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_INSTALLATION_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_REPOSITORY_ID?: string;
};

export type DeploymentEnvironment = "staging" | "production";

const workflowByEnvironment: Record<DeploymentEnvironment, string> = {
  staging: "deploy-game-staging.yml",
  production: "deploy-game-production.yml",
};

function dispatchEnabled(current: GitHubAppEnv, environment: DeploymentEnvironment): boolean {
  return environment === "production"
    ? current.PRODUCTION_DISPATCH_ENABLED === "true"
    : current.STAGING_DISPATCH_ENABLED === "true";
}

function config(environment?: DeploymentEnvironment) {
  const current = env as unknown as GitHubAppEnv;
  if ((environment && !dispatchEnabled(current, environment)) ||
      !current.GITHUB_APP_ID || !current.GITHUB_APP_INSTALLATION_ID ||
      !current.GITHUB_APP_PRIVATE_KEY) {
    throw new Error("GitHub App dispatch設定が不足しています");
  }
  return {
    appId: current.GITHUB_APP_ID,
    installationId: current.GITHUB_APP_INSTALLATION_ID,
    privateKey: current.GITHUB_APP_PRIVATE_KEY.replaceAll("\\n", "\n"),
  };
}

/** 指定環境のGitHub Actions dispatchに必要な設定が揃っているかを確認する */
export function githubAppDispatchConfigured(environment: DeploymentEnvironment): boolean {
  const current = env as unknown as GitHubAppEnv;
  return Boolean(
    dispatchEnabled(current, environment) &&
    current.GITHUB_APP_ID && current.GITHUB_APP_INSTALLATION_ID &&
    current.GITHUB_APP_PRIVATE_KEY && current.GITHUB_REPOSITORY_ID,
  );
}

async function installationToken(environment?: DeploymentEnvironment): Promise<string> {
  const current = config(environment);
  const pkcs8 = createPrivateKey(current.privateKey)
    .export({ format: "pem", type: "pkcs8" })
    .toString();
  const key = await importPKCS8(pkcs8, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(current.appId)
    .setIssuedAt(now - 30)
    .setExpirationTime(now + 9 * 60)
    .sign(key);
  const response = await fetch(
    `https://api.github.com/app/installations/${encodeURIComponent(current.installationId)}/access_tokens`,
    {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${jwt}`,
        "content-type": "application/json",
        "x-github-api-version": "2026-03-10",
        "user-agent": "PandD-Deployment-Control-Plane",
      },
      body: JSON.stringify({
        repositories: ["GameLauncher"],
        permissions: environment ? { actions: "write", contents: "read" } : { metadata: "read" },
      }),
    },
  );
  const result = await response.json() as { token?: string; message?: string };
  if (!response.ok || !result.token) {
    throw new Error(result.message ?? "GitHub App installation tokenを取得できませんでした");
  }
  return result.token;
}

/** @brief 数値IDから現在の本人とリポジトリ権限を再確認する */
export async function githubRepositoryAccess(id: string): Promise<boolean> {
  const token = await installationToken();
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2026-03-10",
    "user-agent": "PandD-Deployment-Control-Plane",
  };

  // 名前変更や旧ユーザー名の再利用によって別人へ付与しない
  const identity = await fetch(`https://api.github.com/user/${encodeURIComponent(id)}`, {
    headers, redirect: "manual", signal: AbortSignal.timeout(10000),
  });
  if (identity.status === 404) return false;
  if (!identity.ok) throw new Error("GitHubの本人情報を確認できません。時間をおいて再試行してください");
  const user = await identity.json() as { id: number; login: string };
  if (String(user.id) !== id || typeof user.login !== "string") throw new Error("GitHubの本人情報が一致しません");

  const response = await fetch(`https://api.github.com/repos/koto-thing/GameLauncher/collaborators/${encodeURIComponent(user.login)}/permission`, {
    headers, redirect: "manual", signal: AbortSignal.timeout(10000),
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error("GitHubのリポジトリ権限を確認できません。App設定を確認して再試行してください");
  const permission = await response.json() as { permission: string; role_name: string; user: { id: number } };
  return String(permission.user?.id) === id &&
    (permission.permission === "write" || permission.permission === "admin" || permission.role_name === "maintain");
}

/**
 * GitHub Appとして対象環境のデプロイWorkflowを起動する
 * @param environment 起動対象の公開環境
 * @param requestId 実行する公開申請ID
 * @param attemptId 実行試行ID
 */
export async function dispatchDeploymentWorkflow(
  environment: DeploymentEnvironment,
  requestId: string,
  attemptId: string,
): Promise<void> {
  const token = await installationToken(environment);
  const workflow = workflowByEnvironment[environment];
  const response = await fetch(
    `https://api.github.com/repos/koto-thing/GameLauncher/actions/workflows/${workflow}/dispatches`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": "2026-03-10",
        "user-agent": "PandD-Deployment-Control-Plane",
      },
      body: JSON.stringify({
        ref: "master",
        inputs: { request_id: requestId, attempt_id: attemptId },
      }),
    },
  );
  if (!response.ok) {
    const responseText = await response.text();
    let message: string;
    try {
      message = (JSON.parse(responseText) as { message?: string }).message ?? "";
    } catch {
      message = responseText.trim();
    }
    throw new Error(
      `${environment} workflowを開始できませんでした (GitHub HTTP ${response.status}${message ? `: ${message}` : ""})`,
    );
  }
}

/** @brief 固定配布版のWindowsビルドをGitHub Appで起動する */
export async function dispatchEditionWorkflow(editionId: string, buildId: string): Promise<void> {
  const token = await installationToken("production");
  const response = await fetch(
    "https://api.github.com/repos/koto-thing/GameLauncher/actions/workflows/build-physical-edition.yml/dispatches",
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": "2026-03-10",
        "user-agent": "PandD-Deployment-Control-Plane",
      },
      body: JSON.stringify({ ref: "master", inputs: { edition_id: editionId, build_id: buildId } }),
    },
  );
  if (!response.ok) throw new Error(`配布版Actionsを開始できませんでした (HTTP ${response.status})`);
}
