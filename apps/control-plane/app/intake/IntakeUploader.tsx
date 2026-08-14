"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import type { ArtifactDescriptor } from "@/lib/artifact-limits";
import { validateDescriptorSchema } from "@/lib/descriptor-validator";
import {
  uploadArtifact,
  validateDescriptorAndZip,
  verifyZipSha256,
  IntakeCancelledError,
  IntakeClientError,
} from "@/lib/intake-client";

type Actor = {
  githubUserId: string;
  login: string;
  avatarUrl: string;
  isAdmin: boolean;
  authSource: "github" | "local-development";
};

type SessionResponse = {
  authenticated: boolean;
  githubAuthConfigured: boolean;
  localDevAuthAvailable: boolean;
  dashboard?: {
    actor: Actor;
    permissions: {
      canRequest: boolean;
      canApprove: boolean;
      canRequestProduction: boolean;
      canAdminister: boolean;
    };
  };
};

type UploadStage =
  | "idle"
  | "reading"
  | "validating_schema"
  | "verifying_hash"
  | "creating_session"
  | "uploading_parts"
  | "sealing"
  | "completed"
  | "cancelled"
  | "error";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes.toLocaleString("ja-JP")} bytes`;
}

function shortHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export function IntakeUploader() {
  const [authResponse, setAuthResponse] = useState<SessionResponse | null>(null);
  const [descriptorFile, setDescriptorFile] = useState<File | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);

  const [descriptorData, setDescriptorData] = useState<ArtifactDescriptor | null>(null);
  const [descriptorErrors, setDescriptorErrors] = useState<string[]>([]);
  const [zipCheckError, setZipCheckError] = useState<string | null>(null);

  const [stage, setStage] = useState<UploadStage>("idle");
  const [stageText, setStageText] = useState("ファイルを選択してください");
  const [detailText, setDetailText] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [uploadedParts, setUploadedParts] = useState(0);
  const [totalParts, setTotalParts] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sealedArtifactId, setSealedArtifactId] = useState<string | null>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard", { cache: "no-store" })
      .then((res) => res.json() as Promise<SessionResponse>)
      .then((data) => {
        if (active) setAuthResponse(data);
      })
      .catch(() => {
        if (active) {
          setAuthResponse({
            authenticated: false,
            githubAuthConfigured: false,
            localDevAuthAvailable: false,
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleDescriptorSelected(file: File) {
    setErrorMessage(null);
    setDescriptorFile(file);
    setDescriptorData(null);
    setDescriptorErrors([]);
    setZipCheckError(null);

    try {
      if (file.size > 1024 * 1024) {
        throw new Error("descriptorファイルが大きすぎます (1 MiB以下)");
      }
      const text = await file.text();
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new Error("descriptorが正しいJSON形式ではありません");
      }

      const validated = validateDescriptorSchema(raw);
      if (!validated.valid) {
        setDescriptorErrors(validated.errors);
        return;
      }

      setDescriptorData(validated.descriptor);

      // If zip already selected, verify match
      if (zipFile) {
        if (zipFile.name !== validated.descriptor.artifactFile) {
          setZipCheckError(
            `ZIPファイル名 (${zipFile.name}) が descriptor (${validated.descriptor.artifactFile}) と一致しません`,
          );
        } else if (zipFile.size !== validated.descriptor.sizeBytes) {
          setZipCheckError(
            `ZIP容量 (${formatBytes(zipFile.size)}) が descriptor (${formatBytes(validated.descriptor.sizeBytes)}) と一致しません`,
          );
        } else {
          setZipCheckError(null);
        }
      }
    } catch (err) {
      setDescriptorErrors([err instanceof Error ? err.message : "ファイルの読み込みに失敗しました"]);
    }
  }

  function handleZipSelected(file: File) {
    setErrorMessage(null);
    setZipFile(file);
    setZipCheckError(null);

    if (descriptorData) {
      if (file.name !== descriptorData.artifactFile) {
        setZipCheckError(
          `ZIPファイル名 (${file.name}) が descriptor (${descriptorData.artifactFile}) と一致しません`,
        );
      } else if (file.size !== descriptorData.sizeBytes) {
        setZipCheckError(
          `ZIP容量 (${formatBytes(file.size)}) が descriptor (${formatBytes(descriptorData.sizeBytes)}) と一致しません`,
        );
      }
    }
  }

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      if (file.name.endsWith(".json") || file.name.endsWith(".pandd-artifact.json")) {
        handleDescriptorSelected(file);
      } else if (file.name.endsWith(".zip")) {
        handleZipSelected(file);
      }
    }
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  async function startUpload() {
    if (!descriptorFile || !zipFile || !descriptorData) {
      setErrorMessage("descriptorとZIPファイルの両方を選択してください");
      return;
    }

    const actor = authResponse?.dashboard?.actor;
    if (!authResponse?.authenticated || !actor) {
      setErrorMessage("アップロードにはGitHubログインが必要です");
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setErrorMessage(null);
    setSealedArtifactId(null);

    try {
      // Step 1: File check
      setStage("reading");
      setStageText("ファイルを確認しています");
      setDetailText("選択された descriptor と ZIP ファイルの整合性を確認中…");
      setProgressPercent(10);

      const { descriptor } = await validateDescriptorAndZip(descriptorData, zipFile);

      // Step 2: SHA-256 verification in chunks
      setStage("verifying_hash");
      setStageText("artifactのSHA-256を検証しています");
      setProgressPercent(15);

      await verifyZipSha256(
        descriptor,
        zipFile,
        (pct, processed, total) => {
          const scaledPct = 15 + Math.round((pct / 100) * 70); // 15% -> 85%
          setProgressPercent(scaledPct);
          setDetailText(
            `${formatBytes(processed)} / ${formatBytes(total)} (${pct}%)`,
          );
        },
        abortController.signal,
      );

      // Step 3: Create upload session & multipart upload & seal
      setStage("creating_session");
      setStageText("upload sessionを作成しています");
      setProgressPercent(88);
      setDetailText("非公開intakeセッションを初期化中…");

      const result = await uploadArtifact(descriptor, zipFile, {
        signal: abortController.signal,
        maxConcurrency: 4,
        onProgress: (percent, currentStageText, currentDetailText, upParts, totParts) => {
          setProgressPercent(percent);
          setStageText(currentStageText);
          setDetailText(currentDetailText);
          setUploadedParts(upParts);
          setTotalParts(totParts);
          if (percent >= 90 && percent < 99) {
            setStage("uploading_parts");
          } else if (percent >= 99 && percent < 100) {
            setStage("sealing");
          }
        },
      });

      setStage("completed");
      setStageText("uploadが完了しました");
      setDetailText(`artifact ${result.artifactId} を正常にsealしました。`);
      setProgressPercent(100);
      setSealedArtifactId(result.artifactId);
    } catch (err) {
      if (err instanceof IntakeCancelledError) {
        setStage("cancelled");
        setStageText("アップロードをキャンセルしました");
        setDetailText("未完了のupload sessionを破棄しました。");
      } else {
        setStage("error");
        const msg = err instanceof IntakeClientError ? err.message : (err instanceof Error ? err.message : "アップロードに失敗しました");
        setErrorMessage(msg);
        setStageText("エラーが発生しました");
        setDetailText(msg);
      }
    } finally {
      abortControllerRef.current = null;
    }
  }

  function cancelUpload() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }

  function resetForm() {
    setDescriptorFile(null);
    setZipFile(null);
    setDescriptorData(null);
    setDescriptorErrors([]);
    setZipCheckError(null);
    setStage("idle");
    setStageText("ファイルを選択してください");
    setDetailText("");
    setProgressPercent(0);
    setUploadedParts(0);
    setTotalParts(0);
    setErrorMessage(null);
    setSealedArtifactId(null);
  }

  const isUploading =
    stage === "reading" ||
    stage === "validating_schema" ||
    stage === "verifying_hash" ||
    stage === "creating_session" ||
    stage === "uploading_parts" ||
    stage === "sealing";

  const canSubmit =
    Boolean(descriptorData && zipFile && !zipCheckError && descriptorErrors.length === 0) &&
    !isUploading;

  const actor = authResponse?.dashboard?.actor;

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="PandD Deploy Control ホーム">
          <span className="brand-mark">P</span>
          <span>
            <strong>PandD</strong>
            <small>DEPLOY CONTROL</small>
          </span>
        </Link>
        <div className="environment-lock connected">
          <span /> INTAKE UPLOADER (WEB)
        </div>
        <div className="account">
          {actor ? (
            <>
              <div className="avatar" aria-hidden="true">
                {actor.login.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <strong>@{actor.login}</strong>
                <small>{actor.isAdmin ? "Repository Admin" : "Authorized Operator"}</small>
              </div>
              <Link className="text-button" href="/" style={{ textDecoration: "none", marginRight: 8 }}>
                Control Planeへ
              </Link>
            </>
          ) : (
            <a className="primary-button" href="/api/auth/github/start" style={{ padding: "7px 12px", fontSize: "12px" }}>
              GitHubログイン
            </a>
          )}
        </div>
      </header>

      <section className="hero" id="top" style={{ paddingBottom: "24px" }}>
        <div>
          <p className="eyebrow">INTAKE / PRIVATE ARTIFACT UPLOADER</p>
          <h1>
            Artifactを、<br />
            <em>ブラウザから受付</em>へ。
          </h1>
          <p className="hero-copy">
            ローカルのビルド成果物（descriptor JSON と ZIP）を検証し、非公開intakeへ分割アップロードしてsealします。
          </p>
        </div>
        <div className="hero-stats" aria-label="Intake 仕様">
          <div>
            <span>64 MB</span>
            <small>Partサイズ</small>
          </div>
          <div>
            <span>4 並列</span>
            <small>最大転送並列数</small>
          </div>
          <div>
            <span>SHA-256</span>
            <small>完全性検証</small>
          </div>
        </div>
      </section>

      <div className="workspace">
        {/* Drop zone / File Selection */}
        <section
          className={`intake-dropzone ${isDragOver ? "dragover" : ""}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          aria-label="ファイル選択エリア"
        >
          <div className="intake-dropzone-inner">
            <span className="dropzone-icon" aria-hidden="true">📦</span>
            <div>
              <h3>descriptor JSON と artifact ZIP をここにドロップ</h3>
              <p>2つのファイルを同時にドロップするか、下のボタンから個別に選択してください。</p>
            </div>
            <div className="dropzone-buttons">
              <label className="secondary-button dropzone-btn">
                <span>Descriptor JSON を選択</span>
                <input
                  type="file"
                  accept=".json,.pandd-artifact.json"
                  style={{ display: "none" }}
                  disabled={isUploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleDescriptorSelected(f);
                  }}
                />
              </label>
              <label className="secondary-button dropzone-btn">
                <span>Artifact ZIP を選択</span>
                <input
                  type="file"
                  accept=".zip"
                  style={{ display: "none" }}
                  disabled={isUploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleZipSelected(f);
                  }}
                />
              </label>
            </div>
          </div>
        </section>

        {/* Selected files overview cards */}
        <div className="intake-files-grid">
          {/* Descriptor card */}
          <article className={`intake-card ${descriptorData ? "valid" : descriptorErrors.length > 0 ? "invalid" : ""}`}>
            <div className="intake-card-header">
              <span className="file-badge">DESCRIPTOR</span>
              <strong>{descriptorFile ? descriptorFile.name : "未選択"}</strong>
            </div>
            {descriptorData ? (
              <div className="intake-meta-list">
                <div><span>Artifact ID:</span> <code>{descriptorData.artifactId}</code></div>
                <div><span>ゲーム:</span> <b>{descriptorData.gameId}</b> (v{descriptorData.version})</div>
                <div><span>対象ZIP:</span> <code>{descriptorData.artifactFile}</code></div>
                <div><span>申告容量:</span> {formatBytes(descriptorData.sizeBytes)} ({descriptorData.fileCount.toLocaleString()} ファイル)</div>
                <div><span>SHA-256:</span> <code title={descriptorData.sha256}>{shortHash(descriptorData.sha256)}</code></div>
                <div className="status-badge success">✓ スキーマ検証合格</div>
              </div>
            ) : descriptorErrors.length > 0 ? (
              <div className="intake-error-box">
                <strong>スキーマ検証エラー:</strong>
                <ul>
                  {descriptorErrors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="intake-card-placeholder"><code>*.pandd-artifact.json</code> を選択してください</p>
            )}
          </article>

          {/* ZIP card */}
          <article className={`intake-card ${zipFile && !zipCheckError ? "valid" : zipCheckError ? "invalid" : ""}`}>
            <div className="intake-card-header">
              <span className="file-badge">ARTIFACT ZIP</span>
              <strong>{zipFile ? zipFile.name : "未選択"}</strong>
            </div>
            {zipFile ? (
              <div className="intake-meta-list">
                <div><span>実ファイル容量:</span> {formatBytes(zipFile.size)}</div>
                {zipCheckError ? (
                  <div className="status-badge error">✕ {zipCheckError}</div>
                ) : descriptorData ? (
                  <div className="status-badge success">✓ ファイル名・容量一致</div>
                ) : (
                  <div className="status-badge warning">descriptorを選択して整合性を確認してください</div>
                )}
              </div>
            ) : (
              <p className="intake-card-placeholder"><code>*.zip</code> ファイルを選択してください</p>
            )}
          </article>
        </div>

        {/* Global error / Notice */}
        {errorMessage && (
          <div className="notice error" role="alert" style={{ margin: "20px 0" }}>
            {errorMessage}
          </div>
        )}

        {/* Auth prompt if not logged in */}
        {authResponse && !authResponse.authenticated && (
          <div className="setup-note" style={{ margin: "24px 0", padding: "18px" }}>
            <strong>ログインが必要です</strong>
            <span>Intakeへのアップロード権限を確認するため、GitHubアカウントでログインしてください。</span>
            <div style={{ marginTop: "12px", display: "flex", gap: "10px" }}>
              {authResponse.githubAuthConfigured && (
                <a className="primary-button" href="/api/auth/github/start">
                  GitHubでログイン
                </a>
              )}
              {authResponse.localDevAuthAvailable && (
                <>
                  <a className="secondary-button" href="/api/auth/dev?as=maintainer">
                    申請者 (Dev) としてログイン
                  </a>
                  <a className="secondary-button" href="/api/auth/dev?as=admin">
                    Admin (Dev) としてログイン
                  </a>
                </>
              )}
            </div>
          </div>
        )}

        {/* Upload Control and Progress Panel */}
        <section className="intake-action-section">
          {stage !== "completed" && (
            <div className="intake-actions-bar">
              <button
                className="primary-button"
                style={{ padding: "14px 28px", fontSize: "15px" }}
                disabled={!canSubmit || !authResponse?.authenticated}
                onClick={startUpload}
              >
                {isUploading ? "処理中…" : "Artifactを検証してアップロードを開始"}
              </button>
              {isUploading && (
                <button className="danger-outline-button" onClick={cancelUpload}>
                  アップロードをキャンセル
                </button>
              )}
            </div>
          )}

          {/* Progress Display */}
          {(isUploading || stage === "completed" || stage === "cancelled" || stage === "error") && (
            <div className={`intake-progress-card ${stage === "completed" ? "completed" : ""}`} role="status">
              <div className="progress-header">
                <div>
                  <span className="eyebrow" style={{ margin: 0 }}>STATUS</span>
                  <h3 style={{ margin: "4px 0 0 0", fontSize: "18px" }}>{stageText}</h3>
                </div>
                <span className="progress-pct-badge">{progressPercent}%</span>
              </div>

              <div className="intake-progress-bar-wrap">
                <div
                  className={`intake-progress-bar-fill ${stage === "completed" ? "fill-success" : stage === "error" || stage === "cancelled" ? "fill-danger" : ""}`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <div className="progress-footer">
                <span>{detailText}</span>
                {totalParts > 0 && (
                  <span className="parts-counter">
                    {uploadedParts} / {totalParts} parts
                  </span>
                )}
              </div>

              {/* Completed Success Banner */}
              {stage === "completed" && sealedArtifactId && descriptorData && (
                <div className="intake-completed-box">
                  <div className="completed-icon">✓</div>
                  <div>
                    <h4>Artifactの受付が完了しました（Sealed）</h4>
                    <p>
                      Artifact ID <code>{sealedArtifactId}</code> をControl PlaneのStaging申請で使用できます。
                    </p>
                    <div style={{ marginTop: "14px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
                      <Link className="primary-button" href="/" style={{ textDecoration: "none" }}>
                        Control Planeで公開申請を作成
                      </Link>
                      <button className="secondary-button" onClick={resetForm}>
                        別のArtifactをアップロード
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Local Dev switcher */}
      {authResponse?.localDevAuthAvailable && (
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
