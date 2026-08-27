import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../..", import.meta.url);

async function source(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

test("production workflow is isolated from staging and gated by the production environment", async () => {
  const workflow = await source(".github/workflows/deploy-game-production.yml");
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /PRODUCTION_BUCKET: pandd-launcher-production/);
  assert.match(workflow, /PRODUCTION_BASE_URL: https:\/\/downloads\.koto-thing\.com/);
  assert.match(workflow, /MANIFEST_PRIVATE_KEY_PEM: \$\{\{ secrets\.MANIFEST_PRIVATE_KEY_PEM \}\}/);
  assert.doesNotMatch(workflow, /pandd-launcher-staging|STAGING_BASE_URL/);
  assert.doesNotMatch(workflow, /actions\/(?:upload|download)-artifact/);
  assert.match(workflow, /python -m scripts\.deployment\.actions_control_plane authorize/);
  assert.match(workflow, /Download the private artifact directly from intake/);
  assert.match(
    workflow,
    /upload-immutable[\s\S]*promote-pointers[\s\S]*python -m scripts\.deployment\.verify_game_publication/,
  );
});

test("production requests require recent staging and allow audited Admin bypass", async () => {
  const controlPlane = await source("apps/admin-web/lib/control-plane.ts");
  const actions = await source("apps/admin-web/lib/actions.ts");
  assert.match(controlPlane, /source\.environment !== "staging" \|\| source\.state !== "succeeded"/);
  assert.match(controlPlane, /Production申請期限を過ぎています/);
  assert.match(controlPlane, /if \(actor\.isAdmin\)/);
  assert.match(controlPlane, /environment: asString\(request\.environment\)/);
  assert.match(actions, /identity\.deploymentEnvironment === "production"/);
  assert.match(actions, /number\(row\.requester_is_admin\) === 1/);
  assert.match(actions, /Admin bypass監査記録が見つかりません/);
  assert.match(actions, /Production用の有効な指名承認を確認できません/);
  assert.match(actions, /production_eligible_until = \?/);
});

test("staging and production dispatches have independent kill switches", async () => {
  const githubApp = await source("apps/admin-web/lib/github-app.ts");
  const workerConfig = await source("apps/admin-web/wrangler.jsonc");
  assert.match(githubApp, /STAGING_DISPATCH_ENABLED/);
  assert.match(githubApp, /PRODUCTION_DISPATCH_ENABLED/);
  assert.match(workerConfig, /"STAGING_DISPATCH_ENABLED": "(?:true|false)"/);
  assert.match(workerConfig, /"PRODUCTION_DISPATCH_ENABLED": "(?:true|false)"/);
});

test("private intake archives are never copied into GitHub Actions artifacts", async () => {
  for (const workflowPath of [
    ".github/workflows/deploy-game-staging.yml",
    ".github/workflows/deploy-game-production.yml",
  ]) {
    const workflow = await source(workflowPath);
    assert.doesNotMatch(workflow, /actions\/(?:upload|download)-artifact/);
    assert.match(workflow, /python -m scripts\.deployment\.actions_control_plane authorize/);
    assert.match(workflow, /environment: (?:staging|production)[\s\S]*Download the private artifact directly from intake/);
  }
});

test("a successful external dispatch cannot be rolled back by a cosmetic database update", async () => {
  const controlPlane = await source("apps/admin-web/lib/control-plane.ts");
  assert.match(
    controlPlane,
    /try \{\s*await dispatchDeploymentWorkflow\(environment, input\.requestId, attemptId\);\s*} catch \(error\)/s,
  );
  assert.doesNotMatch(
    controlPlane,
    /await dispatchDeploymentWorkflow[\s\S]{0,300}UPDATE execution_attempts SET stage = 'preflight'/,
  );
});

test("intake sealing is retry-safe and request metadata stays bound to the upload", async () => {
  const intake = await source("apps/admin-web/lib/intake.ts");
  const controlPlane = await source("apps/admin-web/lib/control-plane.ts");
  assert.match(intake, /let object = await bucket\(\)\.head\(objectKey\);\s*if \(!object\)/s);
  assert.match(intake, /text\(existing\.game_id\) !== descriptor\.gameId/);
  assert.match(intake, /text\(existing\.version\) !== descriptor\.version/);
  assert.match(controlPlane, /JOIN intake_uploads u ON u\.artifact_id = a\.artifact_id/);
  assert.match(controlPlane, /asString\(artifact\.game_id\) !== gameId/);
  assert.match(controlPlane, /asString\(artifact\.version\) !== version/);
});
