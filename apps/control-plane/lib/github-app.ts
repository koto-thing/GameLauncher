import { env } from "cloudflare:workers";
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

function config(environment: DeploymentEnvironment) {
  const current = env as unknown as GitHubAppEnv;
  if (!dispatchEnabled(current, environment) ||
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

export function githubAppDispatchConfigured(environment: DeploymentEnvironment): boolean {
  const current = env as unknown as GitHubAppEnv;
  return Boolean(
    dispatchEnabled(current, environment) &&
    current.GITHUB_APP_ID && current.GITHUB_APP_INSTALLATION_ID &&
    current.GITHUB_APP_PRIVATE_KEY && current.GITHUB_REPOSITORY_ID,
  );
}

async function installationToken(environment: DeploymentEnvironment): Promise<string> {
  const current = config(environment);
  const key = await importPKCS8(current.privateKey, "RS256");
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
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${jwt}`,
        "content-type": "application/json",
        "x-github-api-version": "2026-03-10",
        "user-agent": "PandD-Deployment-Control-Plane",
      },
      body: JSON.stringify({
        repositories: ["GameLauncher"],
        permissions: { actions: "write", contents: "read" },
      }),
    },
  );
  const result = await response.json() as { token?: string; message?: string };
  if (!response.ok || !result.token) {
    throw new Error(result.message ?? "GitHub App installation tokenを取得できませんでした");
  }
  return result.token;
}

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
  if (response.status !== 204) {
    const result = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(result.message ?? `${environment} workflowを開始できませんでした`);
  }
}
