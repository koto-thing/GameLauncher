"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type Actor = {
  githubUserId: string;
  login: string;
  avatarUrl: string;
  isAdmin: boolean;
  authSource: "github" | "local-development";
};

type User = {
  githubUserId: string;
  login: string;
  isAdmin: boolean;
  grants: string[];
};

type DeploymentRequest = {
  requestId: string;
  environment: string;
  artifactId: string;
  artifactSha256: string;
  gameId: string;
  version: string;
  requesterGithubUserId: string;
  requesterLogin: string;
  state: string;
  createdAt: string;
  submittedAt: string | null;
  sourceStagingRequestId: string | null;
  productionEligibleUntil: string | null;
  productionEligible: boolean;
  sizeBytes: number;
  fileCount: number;
  approvers: { githubUserId: string; login: string }[];
  decisions: { githubUserId: string; decision: string; reason: string; decidedAt: string }[];
  attempts: { attemptId: string; attemptNumber: number; githubRunId: string | null; stage: string; result: string; createdAt: string; finishedAt: string | null }[];
};

type AuditEvent = {
  eventId: string;
  requestId: string | null;
  sequence: number;
  eventType: string;
  actorLogin: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  eventHash: string;
};

type Dashboard = {
  actor: Actor;
  system: { dispatchConfigured: { staging: boolean; production: boolean } };
  permissions: { canRequest: boolean; canApprove: boolean; canRequestProduction: boolean; canAdminister: boolean };
  users: User[];
  requests: DeploymentRequest[];
  events: AuditEvent[];
};

type DashboardResponse = {
  authenticated: boolean;
  githubAuthConfigured: boolean;
  localDevAuthAvailable: boolean;
  dashboard?: Dashboard;
  error?: string;
};

const UPLOADER_DOWNLOAD_URL = "https://github.com/koto-thing/GameLauncher/releases/download/uploader-v0.1.0/PandDIntakeUploader.exe";
const ACTIVE_EXECUTION_STATES = new Set(["dispatched", "running", "publishing_pointers", "verifying"]);
const EXECUTION_REFRESH_INTERVAL_MS = 4_000;

const statusText: Record<string, string> = {
  ready: "提出準備完了",
  pending_approval: "指名承認待ち",
  approved: "実行承認済み",
  rejected: "却下",
  succeeded: "公開完了",
  dispatched: "Actions起動済み",
  running: "実行中",
  publishing_pointers: "公開確定中",
  verifying: "公開検証中",
  failed_retryable: "再試行可能",
  failed_terminal: "実行停止",
  recovery_required: "復旧実行が必要",
  cancelled: "キャンセル済み",
};

const eventText: Record<string, string> = {
  request_created: "申請を作成",
  production_request_created: "Production申請を作成",
  approver_designated: "承認者を指名",
  request_submitted: "承認を申請",
  request_approved: "申請を承認",
  request_rejected: "申請を却下",
  request_cancelled: "申請をキャンセル",
  approval_waived: "申請権限により承認を省略",
  policy_grant_added: "権限を付与",
  policy_grant_revoked: "権限を取消",
  workflow_dispatch_requested: "Actions実行を要求",
  actions_cancellation_confirmed: "Actionsのキャンセルを確認",
  actions_preflight_passed: "Actions preflight成功",
  actions_preflight_rejected: "Actions preflight拒否",
  execution_stage: "実行工程を更新",
  execution_finished: "実行結果を記録",
  recovery_retry_authorized: "復旧後の再試行を許可",
  artifact_upload_started: "Intake upload開始",
  artifact_sealed: "Artifactをseal",
  artifact_upload_cancelled: "Intake uploadをキャンセル",
};

/** 申請一覧に表示する容量を読みやすい単位へ変換する */
function formatBytes(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  return `${value.toLocaleString("ja-JP")} bytes`;
}

/** ISO日時を管理画面向けの日本語表示へ変換する */
function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/** 監査画面で長いハッシュを省略表示する */
function shortHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

/** 申請状態と環境から利用者向けの次の操作説明を作る */
function nextStepText(request: DeploymentRequest, skipApproval: boolean): string {
  if (skipApproval && ["ready", "pending_approval"].includes(request.state)) return "「公開する」で承認なしに公開処理を開始できます";
  if (request.state === "ready") return "次: Adminが承認者を指名し、申請者が提出します";
  if (request.state === "pending_approval") return "次: 指名された別アカウントが内容を確認して承認します";
  if (request.state === "approved") return `次: ${request.environment === "production" ? "Production" : "Staging"}へ実行します`;
  if (request.state === "succeeded" && request.environment === "staging" && !request.productionEligible) return "Production申請期限が終了しました。本番へ進めるにはStagingからやり直してください";
  if (request.state === "succeeded" && request.environment === "staging") return "確認後、「Production申請を作成」で同じArtifactを本番へ進めます";
  if (request.state === "succeeded") return "完了: Productionの公開URLでゲームを確認してください";
  if (request.state === "failed_retryable") return "一時的な失敗です。原因を確認して再試行できます";
  if (request.state === "recovery_required") return "公開確定中の失敗です。R2の状態を確認するまで再実行しないでください";
  if (request.state === "cancelled") return "終了: この申請から公開処理は起動できません";
  return "処理状況は監査ログとGitHub Actionsから更新されます";
}

/**
 * 公開申請、権限設定、監査ログを操作するControl Plane画面
 * @returns 申請・アクセス・監査の各ワークスペース
 */
export function ControlPlane() {
  const [response, setResponse] = useState<DashboardResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [tab, setTab] = useState<"requests" | "access" | "audit">("requests");

  const showSignIn = useCallback(() => {
    setResponse((current) => ({
      authenticated: false,
      githubAuthConfigured: current?.githubAuthConfigured ?? false,
      localDevAuthAvailable: current?.localDevAuthAvailable ?? false,
      error: "GitHubの認証が期限切れです。もう一度ログインしてください。",
    }));
  }, []);

  const refresh = useCallback(async () => {
    const result = await fetch("/api/dashboard", { cache: "no-store" });
    const payload = await result.json() as DashboardResponse;
    setResponse(payload);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard", { cache: "no-store" })
      .then((result) => result.json() as Promise<DashboardResponse>)
      .then((payload) => { if (active) setResponse(payload); })
      .catch(() => {
        if (active) setResponse({
          authenticated: false,
          githubAuthConfigured: false,
          localDevAuthAvailable: false,
          error: "control planeへ接続できませんでした",
        });
      });

    return () => {
      active = false;
    };
  }, []);

  const executionInProgress = response?.dashboard?.requests.some((request) =>
    ACTIVE_EXECUTION_STATES.has(request.state)
  ) ?? false;

  useEffect(() => {
    if (!executionInProgress) return;

    const refreshWhileVisible = () => {
      if (document.visibilityState === "visible") void refresh().catch(() => undefined);
    };
    const intervalId = window.setInterval(refreshWhileVisible, EXECUTION_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshWhileVisible);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshWhileVisible);
    };
  }, [executionInProgress, refresh]);

  async function runAction(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await fetch("/api/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (result.status === 401 || result.status === 403) {
        showSignIn();
        return;
      }
      const body = await result.json() as { error?: string; dispatchError?: string };
      if (!result.ok) throw new Error(body.error ?? "操作を完了できませんでした");
      setNotice(body.dispatchError
        ? { tone: "error", text: `申請は保存済みです。${body.dispatchError}。申請一覧から実行できます` }
        : { tone: "success", text: success });
      await refresh();
    } catch (error) {
      await refresh();
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "操作に失敗しました" });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    await refresh();
  }

  if (!response) {
    return (
      <main className="loading-shell" aria-live="polite">
        <p>安全な公開状態を読み込んでいます…</p>
      </main>
    );
  }

  if (!response.authenticated || !response.dashboard) {
    return (
      <SignIn response={response} />
    );
  }

  const dashboard = response.dashboard;
  const anyDispatchConfigured = dashboard.system.dispatchConfigured.staging ||
    dashboard.system.dispatchConfigured.production;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="PandD Deploy Control ホーム">
          <span className="brand-mark brand-logo" aria-hidden="true" />
          <span><strong>PandD</strong><small>DEPLOY CONTROL</small></span>
        </a>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <a className="secondary-button" href="/intake" style={{ fontSize: "12px", padding: "6px 12px", textDecoration: "none" }}>
            Web版 Intake Uploader
          </a>
          <div className={`environment-lock ${anyDispatchConfigured ? "connected" : ""}`}><span /> {anyDispatchConfigured ? `ACTIONS: ${dashboard.system.dispatchConfigured.staging ? "S" : "-"}/${dashboard.system.dispatchConfigured.production ? "P" : "-"}` : "ACTIONS実行は無効"}</div>
        </div>

        <div className="account">
          <div className="avatar" aria-hidden="true">{dashboard.actor.login.slice(0, 1).toUpperCase()}</div>
          <div><strong>@{dashboard.actor.login}</strong><small>{dashboard.actor.isAdmin ? "Repository Admin" : "Authorized operator"}</small></div>
          <button className="text-button" onClick={logout}>ログアウト</button>
        </div>
      </header>

      <section className="page-heading" id="top" aria-labelledby="control-plane-title">
        <h1 id="control-plane-title">公開申請</h1>

        <div className="uploader-actions" aria-label="Uploaderを開く">
          <a className="download-button" href="/intake">
            Web版 Uploader を開く（推奨） <span>ブラウザ完結</span>
          </a>

          <a className="download-button secondary" href={UPLOADER_DOWNLOAD_URL}>
            Windows版 exe をダウンロード <span>28.3 MB</span>
          </a>
        </div>
      </section>

      <nav className="tabs" aria-label="control planeセクション">
        <button className={tab === "requests" ? "active" : ""} onClick={() => setTab("requests")}>申請</button>

        {dashboard.permissions.canAdminister && <button className={tab === "access" ? "active" : ""} onClick={() => setTab("access")}>権限</button>}

        <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>監査ログ</button>
      </nav>

      {notice && <div className={`notice ${notice.tone}`} role="status">{notice.text}</div>}

      {tab === "requests" && (
        <RequestWorkspace dashboard={dashboard} busy={busy} runAction={runAction} />
      )}

      {tab === "access" && dashboard.permissions.canAdminister && (
        <AccessWorkspace dashboard={dashboard} busy={busy} runAction={runAction} />
      )}

      {tab === "audit" && <AuditWorkspace events={dashboard.events} />}

      {response.localDevAuthAvailable && (
        <aside className="dev-switcher" aria-label="ローカル開発者切り替え">
          <span>LOCAL</span>
          <a href="/api/auth/dev?as=admin">Admin</a>
          <a href="/api/auth/dev?as=maintainer">申請者</a>
          <a href="/api/auth/dev?as=reviewer">承認者</a>
        </aside>
      )}
    </main>
  );
}

/** 未認証時のログイン案内と、認証設定状況を表示する */
function SignIn({ response }: { response: DashboardResponse }) {
  return (
    <main className="signin-shell">
      <section className="signin-card">
        <div className="brand signin-brand"><span className="brand-mark brand-logo" aria-hidden="true" /><span><strong>PandD</strong><small>DEPLOY CONTROL</small></span></div>

        <p className="eyebrow">IDENTITY REQUIRED</p>
        <h1>GitHubアカウントで<br />公開責任を確認します。</h1>
        <p>個人リポジトリのOwnerと、Adminが許可したCollaboratorだけが操作できます。</p>
        <a href="/access">利用を申請する・申請状況を確認する</a>

        {response.githubAuthConfigured ? (
          <a className="primary-link" href="/api/auth/github/start">GitHubでログイン</a>
        ) : (
          <div className="setup-note"><strong>GitHub Appは未設定です</strong><span>ローカル開発ログインでPhase 1を確認できます。</span></div>
        )}

        {response.localDevAuthAvailable && (
          <div className="dev-login">
            <a href="/api/auth/dev?as=admin">Adminとして確認</a>
            <a href="/api/auth/dev?as=maintainer">申請者として確認</a>
            <a href="/api/auth/dev?as=reviewer">承認者として確認</a>
          </div>
        )}

        {response.error && <p className="error-copy">{response.error}</p>}
      </section>
      <p className="signin-foot">STAGINGとPRODUCTIONの秘密情報はこのアプリへ渡されません。</p>
    </main>
  );
}

/** 申請一覧と申請作成・承認操作をまとめて表示する */
function RequestWorkspace({ dashboard, busy, runAction }: {
  dashboard: Dashboard;
  busy: boolean;
  runAction: (payload: Record<string, unknown>, success: string) => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const requestListRef = useRef<HTMLDivElement>(null);
  const approvers = dashboard.users.filter((user) => user.grants.includes("approver"));

  // カードの可変高さと画面幅に合わせて一覧を先頭4件分の高さに制限する
  useEffect(() => {
    const list = requestListRef.current;
    if (!list || dashboard.requests.length <= 4) return;

    const cards = Array.from(list.children).slice(0, 4) as HTMLElement[];

    // 4件目の下端まで表示し、残りは一覧内でスクロールする
    const updateHeight = () => {
      const first = cards[0].getBoundingClientRect();
      const fourth = cards[3].getBoundingClientRect();
      list.style.setProperty("--request-list-height", `${fourth.bottom - first.top}px`);
    };

    const observer = new ResizeObserver(updateHeight);
    cards.forEach((card) => observer.observe(card));
    updateHeight();

    return () => {
      observer.disconnect();
      list.style.removeProperty("--request-list-height");
    };
  }, [dashboard.requests]);

  return (
    <section className="workspace">
      <div className="section-heading">
        <div><p className="eyebrow">DEPLOYMENT REQUESTS</p><h2>Staging / Production 公開申請</h2><p className="section-copy">カード内の「次にすること」を上から順に進めてください。Maintain相当以上は申請と同時に公開処理を開始します。Production申請は成功したStagingからだけ作成できます。</p></div>

        {dashboard.permissions.canRequest && <button className="primary-button" onClick={() => setShowForm((value) => !value)}>{showForm ? "閉じる" : "新しい申請"}</button>}
      </div>

      {showForm && <RequestForm busy={busy} runAction={runAction} onDone={() => setShowForm(false)} />}

      <div className="readiness-grid" aria-label="公開環境の準備状況">
        <article className={dashboard.system.dispatchConfigured.staging ? "ready" : "locked"}>
          <span>STAGING</span>
          <div><strong>{dashboard.system.dispatchConfigured.staging ? "実行できます" : "安全停止中"}</strong><p>{dashboard.system.dispatchConfigured.staging ? "Maintain相当以上は承認なしでテスト公開できます。" : "Environmentと秘密情報を設定してからAdminが有効化します。"}</p></div>
        </article>
        <article className={dashboard.system.dispatchConfigured.production ? "ready" : "locked"}>
          <span>PRODUCTION</span>
          <div><strong>{dashboard.system.dispatchConfigured.production ? "実行できます" : "安全停止中"}</strong><p>{dashboard.system.dispatchConfigured.production ? "成功済みStagingから本番公開できます。Maintain相当以上は承認不要です。" : "Production設定が揃うまで、本番実行ボタンは表示されません。"}</p></div>
        </article>
      </div>

      <div ref={requestListRef} className={`request-list${dashboard.requests.length > 4 ? " request-list-scrollable" : ""}`} role="region" aria-label="公開申請一覧">
        {dashboard.requests.length === 0 && <div className="empty-state"><strong>申請はまだありません</strong><span>最初のartifact情報を登録すると、監査記録がここから始まります。</span></div>}
        {dashboard.requests.map((request) => (
          <RequestCard key={request.requestId} request={request} dashboard={dashboard} approvers={approvers} busy={busy} runAction={runAction} />
        ))}
      </div>
    </section>
  );
}

/** descriptorを指定したStaging/Production申請の作成フォーム */
function RequestForm({ busy, runAction, onDone }: {
  busy: boolean;
  runAction: (payload: Record<string, unknown>, success: string) => Promise<void>;
  onDone: () => void;
}) {
  const [artifactId, setArtifactId] = useState("");
  const [gameId, setGameId] = useState("");
  const [version, setVersion] = useState("");
  const [sha, setSha] = useState("");
  const [sizeBytes, setSizeBytes] = useState(0);
  const [fileCount, setFileCount] = useState(0);
  const [descriptorName, setDescriptorName] = useState("");
  const [descriptorError, setDescriptorError] = useState("");

  async function loadDescriptor(file: File | undefined) {
    if (!file) return;
    setDescriptorError("");
    if (file.size > 64 * 1024) throw new Error("descriptorは64 KiB以下である必要があります");
    const descriptor = JSON.parse(await file.text()) as Record<string, unknown>;
    if (descriptor.schemaVersion !== 1 || typeof descriptor.artifactId !== "string" ||
        typeof descriptor.gameId !== "string" || typeof descriptor.version !== "string" ||
        typeof descriptor.sha256 !== "string" || typeof descriptor.sizeBytes !== "number" ||
        typeof descriptor.fileCount !== "number") {
      throw new Error("PandD artifact descriptorの形式が不正です");
    }
    setArtifactId(descriptor.artifactId);
    setGameId(descriptor.gameId);
    setVersion(descriptor.version);
    setSha(descriptor.sha256);
    setSizeBytes(descriptor.sizeBytes);
    setFileCount(descriptor.fileCount);
    setDescriptorName(file.name);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction({
      action: "create_request",
      artifactId,
      gameId,
      version,
      artifactSha256: sha,
      sizeBytes,
      fileCount,
    }, "ステージング申請を作成し、公開処理を開始しました");
    onDone();
  }

  return (
    <form className="request-form" onSubmit={submit}>
      <div className="form-intro"><span>01</span><div><strong>Artifactを固定</strong><small>Web版またはデスクトップ版のUploaderが生成した受付票（descriptor）を読み込みます。未アップロードの場合は先に <a href="/intake" style={{ color: "var(--accent-ink)", textDecoration: "underline" }}>Web版 Intake Uploader</a> でZIPを送信してください。</small></div></div>

      <label className="wide">PandD artifact descriptor<input type="file" accept=".json,.pandd-artifact.json" onChange={(event) => loadDescriptor(event.target.files?.[0]).catch((error: unknown) => setDescriptorError(error instanceof Error ? error.message : "descriptorを読み込めませんでした"))} required /><small className="input-help">uploaderの完了画面で保存した <code>*.pandd-artifact.json</code> を選んでください。ゲーム本体を選ぶ場所ではありません。</small></label>

      {descriptorError && <p className="field-error wide" role="alert">{descriptorError}</p>}

      {descriptorName && <div className="descriptor-loaded wide"><strong>{descriptorName}</strong><span>artifact {artifactId.slice(0, 8)} を読み込みました</span></div>}

      <label>ゲームID<input name="gameId" value={gameId} readOnly required /></label>
      <label>バージョン<input name="version" value={version} readOnly required /></label>

      <label className="wide">Artifact SHA-256<input name="sha" value={sha} readOnly minLength={64} maxLength={64} required /><small className="input-help">公開物を識別する指紋です。descriptorから自動入力されるため、手入力は不要です。</small></label>

      <label>容量（bytes）<input name="sizeBytes" type="number" value={sizeBytes || ""} readOnly required /></label>
      <label>ファイル数<input name="fileCount" type="number" value={fileCount || ""} readOnly required /></label>

      <div className="form-actions wide"><button className="primary-button" disabled={busy || !artifactId}>申請してStagingへ公開</button></div>
    </form>
  );
}

/** 個別申請の状態、承認操作、実行結果を表示するカード */
function RequestCard({ request, dashboard, approvers, busy, runAction }: {
  request: DeploymentRequest;
  dashboard: Dashboard;
  approvers: User[];
  busy: boolean;
  runAction: (payload: Record<string, unknown>, success: string) => Promise<void>;
}) {
  const [selectedApprover, setSelectedApprover] = useState(approvers[0]?.githubUserId ?? "");
  const [reason, setReason] = useState("");
  const [safetyReason, setSafetyReason] = useState("");

  const isOwner = request.requesterGithubUserId === dashboard.actor.githubUserId;
  const requester = dashboard.users.find((user) => user.githubUserId === request.requesterGithubUserId);
  const skipApproval = Boolean(dashboard.actor.isAdmin || requester?.isAdmin || requester?.grants.includes("requester"));
  const isDesignated = request.approvers.some((item) => item.githubUserId === dashboard.actor.githubUserId);
  const canDispatch = dashboard.actor.isAdmin || isOwner;
  const canCancel = (dashboard.actor.isAdmin || isOwner) &&
    ["ready", "pending_approval", "approved", "failed_retryable"].includes(request.state);
  const latestAttempt = request.attempts[0];
  const productionRequestExists = dashboard.requests.some((candidate) =>
    candidate.environment === "production" && candidate.sourceStagingRequestId === request.requestId);
  const canCreateProduction = request.environment === "staging" && request.state === "succeeded" &&
    request.productionEligible &&
    dashboard.permissions.canRequestProduction && !productionRequestExists;

  const environmentLabel = request.environment === "production" ? "PRODUCTION" : "STAGING";
  const dispatchConfigured = request.environment === "production"
    ? dashboard.system.dispatchConfigured.production
    : dashboard.system.dispatchConfigured.staging;
  return (
    <article className={`request-card request-${request.environment}`}>
      <div className="request-main">
        <div className="request-title"><span className={`environment-pill environment-${request.environment}`}>{environmentLabel}</span><span className={`state-pill state-${request.state}`}>{statusText[request.state] ?? request.state}</span><h3>{request.gameId}</h3><strong>v{request.version}</strong></div>
        <div className="request-meta"><span>申請者 <b>@{request.requesterLogin}</b></span><span>{formatBytes(request.sizeBytes)}</span><span>{request.fileCount.toLocaleString("ja-JP")} files</span><span>{formatDate(request.createdAt)}</span>{request.environment === "staging" && request.productionEligibleUntil && <span>本番申請期限 <b>{formatDate(request.productionEligibleUntil)}</b></span>}</div>
        <div className="fingerprint"><span>SHA-256</span><code title={request.artifactSha256}>{shortHash(request.artifactSha256)}</code><small>artifact {request.artifactId.slice(0, 8)}</small></div>

        <div className="approval-line">
          <span>{skipApproval ? "承認不要（Admin／Maintain相当）" : "指名承認者"}</span>
          {skipApproval ? null : request.approvers.length ? request.approvers.map((item) => <b key={item.githubUserId}>@{item.login}</b>) : <em>未指名</em>}
          {request.decisions.map((decision) => <span className={`decision ${decision.decision}`} key={decision.githubUserId}>{decision.decision === "approved" ? "承認済み" : "却下"}</span>)}
        </div>

        {latestAttempt && <div className="approval-line"><span>実行 #{latestAttempt.attemptNumber}</span><b>{latestAttempt.stage}</b><em>{latestAttempt.result}</em>{latestAttempt.githubRunId && <span>run {latestAttempt.githubRunId}</span>}</div>}
        <p className="next-step"><strong>次にすること</strong>{nextStepText(request, skipApproval)}</p>
      </div>
      <div className="request-actions">
        {request.environment === "production" && <div className="production-warning"><strong>本番公開</strong><span>公開URLの内容が更新されます。Stagingで動作確認した同じSHA-256か確認してください。</span></div>}

        {!skipApproval && dashboard.permissions.canAdminister && request.state === "ready" && approvers.length > 0 && (
          <div className="inline-action"><select aria-label="指名承認者" value={selectedApprover} onChange={(event) => setSelectedApprover(event.target.value)}>{approvers.map((user) => <option key={user.githubUserId} value={user.githubUserId}>@{user.login}</option>)}</select><button disabled={busy || !selectedApprover} onClick={() => runAction({ action: "designate_approver", requestId: request.requestId, approverGithubUserId: selectedApprover }, "承認者を指名しました")}>指名</button></div>
        )}

        {canDispatch && (request.state === "ready" || (skipApproval && request.state === "pending_approval")) && (
          <div className="submit-request-action">
            <button className="primary-button submit-request-button" disabled={busy} onClick={() => runAction({ action: "submit_request", requestId: request.requestId, reason }, skipApproval ? "公開処理を開始しました" : "指名承認を申請しました")}>
              <span>{skipApproval ? "公開する" : "提出する"}</span>
              <small>{skipApproval ? "承認なしで公開処理を開始" : "指名承認へ送信"}</small>
            </button>
          </div>
        )}

        {!skipApproval && isDesignated && request.state === "pending_approval" && (
          <div className="decision-actions"><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="却下時は理由が必須" /><button disabled={busy} onClick={() => runAction({ action: "decide_request", requestId: request.requestId, decision: "rejected", reason }, "申請を却下しました")}>却下</button><button className="approve-button" disabled={busy} onClick={() => runAction({ action: "decide_request", requestId: request.requestId, decision: "approved", reason }, "申請を承認しました")}>承認</button></div>
        )}

        {canDispatch && dispatchConfigured && ["approved", "failed_retryable"].includes(request.state) && <button className={request.environment === "production" ? "danger-button" : "primary-button"} disabled={busy} onClick={() => runAction({ action: "dispatch_request", requestId: request.requestId }, request.state === "approved" ? `${environmentLabel} Actionsを開始しました` : `${environmentLabel} Actionsを再試行しました`)}>{request.state === "approved" ? `${environmentLabel}へ実行` : "再試行"}</button>}

        {canDispatch && !dispatchConfigured && request.state === "approved" && <div className="phase-block"><span>○</span><p><strong>{environmentLabel} Actions設定待ち</strong><small>GitHub Environmentと秘密情報の設定後にAdminが有効化します。</small></p></div>}

        {["dispatched", "running", "publishing_pointers", "verifying"].includes(request.state) && <div className="phase-block"><span>↻</span><p><strong>GitHub Actionsで実行中</strong><small>状態は監査callbackから更新されます。</small></p></div>}

        {canDispatch && latestAttempt?.githubRunId && ["dispatched", "running", "publishing_pointers", "verifying"].includes(request.state) && <button className="secondary-button" disabled={busy} onClick={() => runAction({ action: "reconcile_cancelled_run", requestId: request.requestId }, "キャンセルを確認しました。次の操作を選んでください")}>Actionsの状態を確認</button>}

        {canCreateProduction && <button className="danger-outline-button" disabled={busy} onClick={() => runAction({ action: "create_production_request", sourceStagingRequestId: request.requestId }, "Production申請を作成しました。承認者を指名してください")}>Production申請を作成</button>}

        {productionRequestExists && request.environment === "staging" && request.state === "succeeded" && <div className="phase-block"><span>✓</span><p><strong>Production申請作成済み</strong><small>一覧のPRODUCTIONカードを進めてください。</small></p></div>}

        {dashboard.permissions.canAdminister && ["recovery_required", "failed_terminal"].includes(request.state) && <div className="inline-action vertical"><input value={safetyReason} onChange={(event) => setSafetyReason(event.target.value)} placeholder="復旧確認内容（10文字以上）" /><button className="danger-outline-button" disabled={busy} onClick={() => runAction({ action: "authorize_recovery", requestId: request.requestId, reason: safetyReason }, "復旧確認を記録し、再試行可能にしました")}>復旧後の再試行を許可</button></div>}

        {canCancel && <div className="inline-action vertical"><input value={safetyReason} onChange={(event) => setSafetyReason(event.target.value)} placeholder="キャンセル理由（3文字以上）" /><button className="secondary-button" disabled={busy} onClick={() => runAction({ action: "cancel_request", requestId: request.requestId, reason: safetyReason }, "申請をキャンセルしました")}>この申請をキャンセル</button></div>}
      </div>
    </article>
  );
}

/** ユーザーへのゲーム管理権限の付与・取消画面 */
function AccessWorkspace({ dashboard, busy, runAction }: {
  dashboard: Dashboard;
  busy: boolean;
  runAction: (payload: Record<string, unknown>, success: string) => Promise<void>;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await runAction({ action: "set_grant", githubUserId: data.get("githubUserId"), grantType: data.get("grantType"), enabled: true }, "権限を付与しました");
    form.reset();
  }

  return (
    <section className="workspace access-grid">
      <div><p className="eyebrow">ACCESS POLICY</p><h2>個別アカウント権限</h2><p className="section-copy">個人所有リポジトリのCollaboratorから、PandDで操作できる人だけを明示的に許可します。</p></div>

      <form className="access-form" onSubmit={submit}>
        <a href="/access">利用申請を審査する →</a>
        <label>登録済みユーザー<select name="githubUserId" required><option value="">ユーザーを選択</option>{dashboard.users.map((user) => <option key={user.githubUserId} value={user.githubUserId}>@{user.login}</option>)}</select></label>
        <label>付与する権限<select name="grantType"><option value="requester">Maintain相当申請者</option><option value="approver">指名承認者候補</option><option value="production_requester">Production申請者</option></select></label>
        <button className="primary-button" disabled={busy}>権限を付与</button>
      </form>

      <div className="user-table">
        {dashboard.users.map((user) => <div className="user-row" key={user.githubUserId}><span className="avatar small">{user.login.slice(0, 1).toUpperCase()}</span><div><strong>@{user.login}</strong></div><div className="grant-list">{user.isAdmin && <span>ADMIN</span>}{user.grants.map((grant) => <button type="button" disabled={busy} title={`${grant}を取り消す`} key={grant} onClick={() => runAction({ action: "set_grant", githubUserId: user.githubUserId, grantType: grant, enabled: false }, "権限を取り消しました")}>{grant.replaceAll("_", " ")} ×</button>)}</div></div>)}
      </div>
    </section>
  );
}

/** 申請に紐づく改ざん検知用監査ログを表示する */
function AuditWorkspace({ events }: { events: AuditEvent[] }) {
  return (
    <section className="workspace audit-workspace">
      <div><p className="eyebrow">APPEND-ONLY LEDGER</p><h2>監査ログ</h2><p className="section-copy">各イベントは直前のhashを含み、申請ごとの判断順序を検証できます。</p></div>

      <div className="audit-list">
        {events.length === 0 && <div className="empty-state"><strong>監査イベントはありません</strong></div>}
        {events.map((event) => <article key={event.eventId}><span className="audit-dot" /><div><strong>{eventText[event.eventType] ?? event.eventType}</strong><p>@{event.actorLogin} · {formatDate(event.occurredAt)}</p></div><code title={event.eventHash}>{shortHash(event.eventHash)}</code><small>#{event.sequence}</small></article>)}
      </div>
    </section>
  );
}
