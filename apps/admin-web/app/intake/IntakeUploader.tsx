"use client";

import { useEffect, useRef, useState, type DragEvent, type ChangeEvent } from "react";
import Link from "next/link";
import type { ArtifactDescriptor } from "@/lib/artifact-limits";
import { DEFAULT_PROFILE_LOCALES } from "@/lib/profile-locales";
import { validateDescriptorSchema } from "@/lib/descriptor-validator";
import {
  uploadArtifact,
  validateDescriptorAndZip,
  verifyZipSha256,
  IntakeCancelledError,
  IntakeClientError,
} from "@/lib/intake-client";
import {
  buildArtifact,
  validateDraft,
  validateAndCollectBuildFiles,
  computeLaunchPaths,
  GAME_ID_PATTERN,
  VERSION_PATTERN,
  SAVE_NAME_PATTERN,
  LOCALE_TAG_PATTERN,
  IMAGE_EXTENSIONS,
  getFileExtension,
  ArtifactBuildCancelledError,
  ArtifactValidationError,
  type BuildInputFile,
  type ImageInputFile,
  type ReleaseDraft,
  type ReleasePreview,
  type ArtifactBuildResult,
} from "@/lib/artifact-builder";

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

type PublishedGameOption = {
  gameId: string;
  name: string;
  environment: "production" | "staging";
};

type PublishedGameProfile = {
  gameId: string;
  environment: "production" | "staging";
  translations: Record<string, { name: string; summary: string }>;
  heroUrl: string;
  thumbnailUrl: string;
  heroFocalPoint: { x: number; y: number };
  error?: string;
};

type IntakeMode = "create" | "existing";

type UploadStage =
  | "idle"
  | "validating"
  | "metadata"
  | "zipping"
  | "hashing"
  | "reading"
  | "validating_schema"
  | "verifying_hash"
  | "creating_session"
  | "uploading_parts"
  | "sealing"
  | "completed"
  | "cancelled"
  | "error";

/**
 * バイト数を画面表示用の単位へ変換する
 * @param bytes バイト数
 * @returns GiB、MiB、KiB、またはバイト単位の表示文字列
 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes.toLocaleString("ja-JP")} bytes`;
}

/**
 * SHA-256などの長いハッシュを先頭・末尾だけの短い表示へ変換する
 * @param hash 表示対象のハッシュ文字列
 * @returns 省略表示したハッシュ文字列
 */
function shortHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/**
 * ブラウザのFileをArtifactBuilder用のビルド入力へ変換する
 * @param file ファイル選択で取得したブラウザファイル
 * @returns 相対パスとストリーム操作を備えたビルド入力
 */
function convertWebFileToBuildInput(file: File): BuildInputFile {
  const relativePath = (file as { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const parts = relativePath.split(/[/\\]/);
  // webkitRelativePathがルートフォルダ名（例：「MyGame_Build/MyGame.exe」）で始まる場合、最上位フォルダを削除
  const strippedRel = parts.length > 1 ? parts.slice(1).join("/") : parts[0];

  return {
    name: file.name,
    size: file.size,
    relativePath: strippedRel,
    slice: (start, end) => file.slice(start, end),
    stream: () => file.stream(),
    arrayBuffer: () => file.arrayBuffer(),
  };
}

/**
 * ブラウザのFileをArtifactBuilder用の画像入力へ変換する
 * @param file 選択された画像ファイル
 * @returns 画像検証に必要なサイズ・読み込み操作を備えた入力
 */
function convertWebFileToImageInput(file: File): ImageInputFile {
  return {
    name: file.name,
    size: file.size,
    slice: (start, end) => file.slice(start, end),
    arrayBuffer: () => file.arrayBuffer(),
  };
}

const AUXILIARY_EXE_PATTERNS = [
  /crashhandler/i,
  /unitycrashhandler/i,
  /unins/i,
  /setup/i,
  /updater/i,
  /helper/i,
];

/**
 * ゲーム情報からArtifactを生成する機能と、既存Artifactを検証して送信する機能を提供するIntake画面
 * @returns 認証状態、入力内容、検証結果、アップロード進捗を表示する画面
 */
export function IntakeUploader() {
  const [mode, setMode] = useState<IntakeMode>("create");
  const [authResponse, setAuthResponse] = useState<SessionResponse | null>(null);

  // Artifactを新規生成するモードの入力値・公開済みプロフィール再利用状態
  const [gameId, setGameId] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [minimumLauncherVersion, setMinimumLauncherVersion] = useState("1.0.1");
  const [engine, setEngine] = useState("unity");
  const [saveDirectoryName, setSaveDirectoryName] = useState("");
  const [publishedGames, setPublishedGames] = useState<PublishedGameOption[]>([]);
  const [selectedPublishedGame, setSelectedPublishedGame] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);

  const [translations, setTranslations] = useState<Record<string, { name: string; summary: string }>>({
    "ja-JP": { name: "", summary: "" },
  });

  const [heroFile, setHeroFile] = useState<File | null>(null);
  const [heroPreviewUrl, setHeroPreviewUrl] = useState<string | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState<string | null>(null);
  const [focalPoint, setFocalPoint] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.5 });

  const [buildFiles, setBuildFiles] = useState<BuildInputFile[]>([]);
  const [detectedExecutables, setDetectedExecutables] = useState<string[]>([]);
  const [entrypointRelativePath, setEntrypointRelativePath] = useState("");
  const [buildScanErrors, setBuildScanErrors] = useState<string[]>([]);
  const [buildScanStats, setBuildScanStats] = useState<{ count: number; bytes: number } | null>(null);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [builtResult, setBuiltResult] = useState<ArtifactBuildResult | null>(null);

  // 既存のdescriptorとZIPを送信するモードの入力値・整合性検証結果
  const [descriptorFile, setDescriptorFile] = useState<File | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [descriptorData, setDescriptorData] = useState<ArtifactDescriptor | null>(null);
  const [descriptorErrors, setDescriptorErrors] = useState<string[]>([]);
  const [zipCheckError, setZipCheckError] = useState<string | null>(null);

  // 両モードで共有するアップロード進捗・結果・キャンセル状態
  const [stage, setStage] = useState<UploadStage>("idle");
  const [stageText, setStageText] = useState("ファイルまたはゲーム情報を入力してください");
  const [detailText, setDetailText] = useState("");
  const [progressPercent, setProgressPercent] = useState(0);
  const [uploadedParts, setUploadedParts] = useState(0);
  const [totalParts, setTotalParts] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sealedArtifactId, setSealedArtifactId] = useState<string | null>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const [isHeroDragOver, setIsHeroDragOver] = useState(false);
  const [isThumbnailDragOver, setIsThumbnailDragOver] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const heroImageRef = useRef<HTMLImageElement | null>(null);

  // 初回表示時にセッション情報を取得し、未認証でもログイン導線を表示できるようにする
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

  // 認証済みの場合だけ、前回の公開情報を再利用できるゲーム一覧を取得する
  useEffect(() => {
    if (!authResponse?.authenticated) return;
    let active = true;
    fetch("/api/intake/profiles", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("公開済みゲーム一覧を取得できませんでした");
        return response.json() as Promise<{ games: PublishedGameOption[] }>;
      })
      .then(({ games }) => { if (active) setPublishedGames(games); })
      .catch(() => { if (active) setPublishedGames([]); });

    return () => {
      active = false;
    };
  }, [authResponse?.authenticated]);

  // 画像差し替え時や画面破棄時に、プレビュー用Object URLを解放する
  useEffect(() => {
    return () => {
      if (heroPreviewUrl) URL.revokeObjectURL(heroPreviewUrl);
      if (thumbnailPreviewUrl) URL.revokeObjectURL(thumbnailPreviewUrl);
    };
  }, [heroPreviewUrl, thumbnailPreviewUrl]);

  // 新規Artifact作成モードの入力変更・画像選択・ビルドフォルダ検証

  /**
   * 入力項目ごとの形式を検証し、項目単位のエラー表示を更新する
   * @param key 検証対象の項目名
   * @param value 入力値
   */
  function validateField(key: string, value: unknown) {
    const errors = { ...fieldErrors };

    if (key === "gameId") {
      const val = typeof value === "string" ? value.trim() : "";
      if (!val) {
        errors.gameId = "ゲームIDを入力してください";
      } else if (!GAME_ID_PATTERN.test(val)) {
        errors.gameId = "3～64文字の英小文字・数字・ハイフンで入力してください";
      } else {
        delete errors.gameId;
      }
    } else if (key === "version") {
      const val = typeof value === "string" ? value.trim() : "";
      if (!val) {
        errors.version = "バージョンを入力してください";
      } else if (!VERSION_PATTERN.test(val)) {
        errors.version = "1.0.0 形式のセマンティックバージョンで入力してください";
      } else {
        delete errors.version;
      }
    } else if (key === "minimumLauncherVersion") {
      const val = typeof value === "string" ? value.trim() : "";
      if (!val) {
        errors.minimumLauncherVersion = "最小ランチャーバージョンを入力してください";
      } else if (!VERSION_PATTERN.test(val)) {
        errors.minimumLauncherVersion = "1.0.0 形式のバージョンで入力してください";
      } else {
        delete errors.minimumLauncherVersion;
      }
    } else if (key === "saveDirectoryName") {
      const val = typeof value === "string" ? value.trim() : "";
      if (!val) {
        errors.saveDirectoryName = "セーブディレクトリ名を入力してください";
      } else if (!SAVE_NAME_PATTERN.test(val)) {
        errors.saveDirectoryName = "2～64文字の英数字・_・-で入力してください";
      } else {
        delete errors.saveDirectoryName;
      }
    }

    setFieldErrors(errors);
  }

  /** Hero画像を検証して選択状態とプレビューを更新する */
  function handleHeroSelected(file: File) {
    const ext = getFileExtension(file.name);
    if (!IMAGE_EXTENSIONS.has(ext)) {
      setFieldErrors((prev) => ({ ...prev, hero: "PNG、JPEG、WebP画像を選択してください" }));
      return;
    }
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.hero;
      return next;
    });
    if (heroPreviewUrl) URL.revokeObjectURL(heroPreviewUrl);
    setHeroFile(file);
    setHeroPreviewUrl(URL.createObjectURL(file));
  }

  /** Thumbnail画像を検証して選択状態とプレビューを更新する */
  function handleThumbnailSelected(file: File) {
    const ext = getFileExtension(file.name);
    if (!IMAGE_EXTENSIONS.has(ext)) {
      setFieldErrors((prev) => ({ ...prev, thumbnail: "PNG、JPEG、WebP画像を選択してください" }));
      return;
    }
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.thumbnail;
      return next;
    });
    if (thumbnailPreviewUrl) URL.revokeObjectURL(thumbnailPreviewUrl);
    setThumbnailFile(file);
    setThumbnailPreviewUrl(URL.createObjectURL(file));
  }

  /** 画像ドロップ領域へのドラッグ中表示を有効にする */
  function handleImageDragOver(event: DragEvent<HTMLDivElement>, setDragOver: (value: boolean) => void) {
    event.preventDefault();
    if (!isProcessing) setDragOver(true);
  }

  /** 子要素間の移動では表示を維持し、領域外へ出た場合だけドラッグ中表示を解除する */
  function handleImageDragLeave(event: DragEvent<HTMLDivElement>, setDragOver: (value: boolean) => void) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragOver(false);
  }

  /** 画像ドロップから先頭ファイルを取り出し、選択処理へ渡す */
  function handleImageDrop(
    event: DragEvent<HTMLDivElement>,
    setDragOver: (value: boolean) => void,
    onSelected: (file: File) => void,
  ) {
    event.preventDefault();
    setDragOver(false);
    if (isProcessing) return;

    const file = event.dataTransfer.files.item(0);
    if (file) onSelected(file);
  }

  /** Hero画像上のクリック位置を0〜1の焦点座標へ変換する */
  function handleHeroImageClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setFocalPoint({
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
    });
  }

  /**
   * Buildフォルダの全ファイルを入力へ変換し、起動候補の抽出と安全性検証を行う
   * @param fileList フォルダ選択またはドロップで取得したファイル一覧
   */
  function handleFolderFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setErrorMessage(null);
    setBuildScanErrors([]);

    const inputs: BuildInputFile[] = [];
    const exes: string[] = [];

    for (let i = 0; i < fileList.length; i += 1) {
      const file = fileList[i];
      const converted = convertWebFileToBuildInput(file);
      inputs.push(converted);

      if (converted.relativePath.toLowerCase().endsWith(".exe")) {
        exes.push(converted.relativePath);
      }
    }

    // CrashHandlerやアップデーターなどの補助exeを後ろへ回し、主ゲームexeを優先する
    exes.sort((a, b) => {
      const aAux = AUXILIARY_EXE_PATTERNS.some((p) => p.test(a));
      const bAux = AUXILIARY_EXE_PATTERNS.some((p) => p.test(b));
      if (aAux && !bAux) return 1;
      if (!aAux && bAux) return -1;
      return a.localeCompare(b);
    });

    setBuildFiles(inputs);
    setDetectedExecutables(exes);

    // 最優先のexeを起動ファイルとして仮選択する
    if (exes.length > 0) {
      setEntrypointRelativePath(exes[0]);
    } else {
      setEntrypointRelativePath("");
    }

    // 収集したファイルのパス安全性・重複・容量を検証する
    try {
      const validated = validateAndCollectBuildFiles(inputs);
      setBuildScanStats({ count: validated.files.length, bytes: validated.totalBytes });
      if (exes.length === 0) {
        setBuildScanErrors(["ビルドフォルダ内にWindows起動exe (.exe) が見つかりません"]);
      }
    } catch (err) {
      setBuildScanStats(null);
      setBuildScanErrors([err instanceof Error ? err.message : "ビルドフォルダの検証に失敗しました"]);
    }
  }

  /** 言語タグを検証して翻訳入力行を追加する */
  function addTranslationLocale(newLocale: string = "") {
    const loc = newLocale.trim();
    if (!loc) return;
    if (!LOCALE_TAG_PATTERN.test(loc)) {
      setErrorMessage(`言語タグが不正です (例: en-US, ko-KR): ${loc}`);
      return;
    }
    if (loc in translations) {
      setErrorMessage(`言語タグ ${loc} は既に追加されています`);
      return;
    }
    setErrorMessage(null);
    setTranslations((prev) => ({ ...prev, [loc]: { name: "", summary: "" } }));
  }

  /** 必須のja-JPを残したまま、任意の翻訳入力行を削除する */
  function removeTranslationLocale(locale: string) {
    if (locale === "ja-JP") return;
    setTranslations((prev) => {
      const next = { ...prev };
      delete next[locale];
      return next;
    });
  }

  /** 指定ロケールのゲーム名または概要を更新する */
  function updateTranslation(locale: string, field: "name" | "summary", val: string) {
    setTranslations((prev) => ({
      ...prev,
      [locale]: {
        ...prev[locale],
        [field]: val,
      },
    }));
  }

  /**
   * 公開済みゲームの翻訳・画像・Hero焦点位置を取得し、新規Artifactの入力へ反映する
   */
  async function reusePublishedProfile() {
    if (!selectedPublishedGame) return;
    setProfileLoading(true);
    setProfileNotice(null);
    setErrorMessage(null);
    try {
      const locales = [...new Set([...DEFAULT_PROFILE_LOCALES, ...Object.keys(translations)])].join(",");
      const response = await fetch(
        `/api/intake/profiles?gameId=${encodeURIComponent(selectedPublishedGame)}&locales=${encodeURIComponent(locales)}`,
        { cache: "no-store" },
      );
      const profile = await response.json() as PublishedGameProfile;
      if (!response.ok) throw new Error(profile.error ?? "前回の公開情報を取得できませんでした");

      const loadImage = async (sourceUrl: string, prefix: string) => {
        const imageResponse = await fetch(`/api/intake/profiles/image?url=${encodeURIComponent(sourceUrl)}`);
        if (!imageResponse.ok) throw new Error("前回の公開画像を取得できませんでした");
        const blob = await imageResponse.blob();
        const extension = new URL(sourceUrl).pathname.match(/\.(png|jpe?g|webp)$/i)?.[0] ?? ".png";
        return new File([blob], `${prefix}${extension.toLowerCase()}`, { type: blob.type });
      };
      const [hero, thumbnail] = await Promise.all([
        loadImage(profile.heroUrl, "hero"),
        loadImage(profile.thumbnailUrl, "thumbnail"),
      ]);

      setGameId(profile.gameId);
      setTranslations((current) => ({ ...current, ...profile.translations }));
      handleHeroSelected(hero);
      handleThumbnailSelected(thumbnail);
      setFocalPoint(profile.heroFocalPoint);
      setFieldErrors((current) => {
        const next = { ...current };
        delete next.gameId;
        return next;
      });
      setProfileNotice(
        `${profile.environment === "production" ? "Production" : "Staging"} の前回情報を読み込みました。必要な箇所だけ編集してください。`,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "前回の公開情報を取得できませんでした");
    } finally {
      setProfileLoading(false);
    }
  }

  // 入力が揃った時点でArtifactの構成を検証し、アップロード前プレビューを計算する
  let previewSummary: ReleasePreview | null = null;
  let draftValidationErrorMessage: string | null = null;

  if (mode === "create" && heroFile && thumbnailFile && buildFiles.length > 0 && entrypointRelativePath) {
    try {
      const draft: ReleaseDraft = {
        gameId,
        version,
        minimumLauncherVersion,
        engine,
        saveDirectoryName,
        translations,
        hero: convertWebFileToImageInput(heroFile),
        thumbnail: convertWebFileToImageInput(thumbnailFile),
        focalPoint,
        buildFiles,
        entrypointRelativePath,
      };
      previewSummary = validateDraft(draft);
    } catch (err) {
      draftValidationErrorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  // 既存Artifactモードのdescriptor・ZIP読み込みと整合性検証

  /** descriptor JSONを読み込み、スキーマと選択済みZIPとの整合性を検証する */
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

  /** ZIPを選択状態へ登録し、descriptorの申告内容とファイル名・容量を照合する */
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

  /** 既存Artifactモードのドロップ内容をdescriptorとZIPに振り分ける */
  function handleExistingDropFiles(files: FileList | null) {
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

  // 画面全体のドロップ領域をモード別のファイル処理へ振り分ける

  /** ドロップ領域上でファイルを受け付けていることを表示する */
  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(true);
  }

  /** ドロップ領域から離れたときの表示を解除する */
  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
  }

  /** 現在のモードに応じてBuildフォルダまたは既存Artifactを処理する */
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (mode === "create") {
      handleFolderFiles(e.dataTransfer.files);
    } else {
      handleExistingDropFiles(e.dataTransfer.files);
    }
  }

  // 新規Artifactの生成からIntakeへの分割アップロード、Sealまでを実行する

  /**
   * 入力されたゲーム情報からArtifactを生成し、検証済みZIPをIntakeへ送信する
   * @remarks 生成進捗と分割アップロード進捗を共通のステージ表示へ反映する
   */
  async function startBuildAndUpload() {
    const actor = authResponse?.dashboard?.actor;
    if (!authResponse?.authenticated || !actor) {
      setErrorMessage("アップロードにはGitHubログインが必要です");
      return;
    }

    if (!heroFile || !thumbnailFile) {
      setErrorMessage("Hero画像とThumbnail画像を選択してください");
      return;
    }

    if (buildFiles.length === 0 || !entrypointRelativePath) {
      setErrorMessage("Buildフォルダと起動exeを選択してください");
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setErrorMessage(null);
    setSealedArtifactId(null);
    setBuiltResult(null);

    try {
      const draft: ReleaseDraft = {
        gameId,
        version,
        minimumLauncherVersion,
        engine,
        saveDirectoryName,
        translations,
        hero: convertWebFileToImageInput(heroFile),
        thumbnail: convertWebFileToImageInput(thumbnailFile),
        focalPoint,
        buildFiles,
        entrypointRelativePath,
      };

      // Step 1〜4: ブラウザ上で入力検証、メタデータ生成、ZIP作成、SHA-256計算、descriptor生成を行う
      setStage("validating");
      setStageText("Buildフォルダを検証しています");
      setProgressPercent(2);

      const buildRes = await buildArtifact(draft, {
        signal: abortController.signal,
        onProgress: (p) => {
          setProgressPercent(Math.round(p.percent * 0.88)); // 0% -> 88%
          setStageText(p.stageText);
          setDetailText(p.detailText);
          if (p.stage === "zipping") setStage("zipping");
          if (p.stage === "hashing") setStage("hashing");
        },
      });

      setBuiltResult(buildRes);

      // Step 5: Intakeセッションを作成し、分割アップロード完了後にArtifactをSealする
      setStage("creating_session");
      setStageText("Upload sessionを作成しています");
      setProgressPercent(88);
      setDetailText(`artifact ${buildRes.artifactId.slice(0, 8)} のセッションを初期化中…`);

      const zipFileObject = new File([buildRes.zipBlob], buildRes.artifactFile, {
        type: "application/zip",
      });

      const uploadRes = await uploadArtifact(buildRes.descriptor, zipFileObject, {
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
      setStageText("Uploadが完了しました");
      setDetailText(`artifact ${uploadRes.artifactId} を正常にsealしました。`);
      setProgressPercent(100);
      setSealedArtifactId(uploadRes.artifactId);
    } catch (err) {
      if (err instanceof ArtifactBuildCancelledError || err instanceof IntakeCancelledError) {
        setStage("cancelled");
        setStageText("アップロードをキャンセルしました");
        setDetailText("処理を中断し、未完了のセッションを破棄しました。");
      } else {
        setStage("error");
        const msg =
          err instanceof ArtifactValidationError
            ? err.message
            : err instanceof IntakeClientError
              ? err.message
              : err instanceof Error
                ? err.message
                : "処理に失敗しました";
        setErrorMessage(msg);
        setStageText("エラーが発生しました");
        setDetailText(msg);
      }
    } finally {
      abortControllerRef.current = null;
    }
  }

  /** 既存descriptorとZIPを検証し、問題がなければIntakeへ分割アップロードする */
  async function startExistingUpload() {
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
      setStage("reading");
      setStageText("ファイルを確認しています");
      setDetailText("選択された descriptor と ZIP ファイルの整合性を確認中…");
      setProgressPercent(10);

      const { descriptor } = await validateDescriptorAndZip(descriptorData, zipFile);

      setStage("verifying_hash");
      setStageText("artifactのSHA-256を検証しています");
      setProgressPercent(15);

      await verifyZipSha256(
        descriptor,
        zipFile,
        (pct, processed, total) => {
          const scaledPct = 15 + Math.round((pct / 100) * 70);
          setProgressPercent(scaledPct);
          setDetailText(`${formatBytes(processed)} / ${formatBytes(total)} (${pct}%)`);
        },
        abortController.signal,
      );

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
        const msg =
          err instanceof IntakeClientError
            ? err.message
            : err instanceof Error
              ? err.message
              : "アップロードに失敗しました";
        setErrorMessage(msg);
        setStageText("エラーが発生しました");
        setDetailText(msg);
      }
    } finally {
      abortControllerRef.current = null;
    }
  }

  /** 実行中の生成・検証・アップロード処理へキャンセルを通知する */
  function cancelOperation() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }

  /** 生成済みdescriptorをローカルファイルとして保存する */
  function downloadGeneratedDescriptor() {
    if (!builtResult) return;
    const jsonStr = JSON.stringify(builtResult.descriptor, null, 2) + "\n";
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${builtResult.artifactId}.pandd-artifact.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** 生成済みArtifact ZIPをローカルファイルとして保存する */
  function downloadGeneratedZip() {
    if (!builtResult) return;
    const url = URL.createObjectURL(builtResult.zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = builtResult.artifactFile;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** 完了・エラー表示を初期状態へ戻し、次のArtifactを受け付けられるようにする */
  function resetForm() {
    setStage("idle");
    setStageText("ファイルまたはゲーム情報を入力してください");
    setDetailText("");
    setProgressPercent(0);
    setUploadedParts(0);
    setTotalParts(0);
    setErrorMessage(null);
    setSealedArtifactId(null);
    setBuiltResult(null);
  }

  // 処理中は入力切り替えや重複送信を防ぐため、画面操作を制限する
  const isProcessing =
    stage === "validating" ||
    stage === "metadata" ||
    stage === "zipping" ||
    stage === "hashing" ||
    stage === "reading" ||
    stage === "validating_schema" ||
    stage === "verifying_hash" ||
    stage === "creating_session" ||
    stage === "uploading_parts" ||
    stage === "sealing";

  // 新規作成はプレビュー・入力検証・認証のすべてを満たした場合だけ送信可能
  const canSubmitBuilder =
    Boolean(
      previewSummary &&
        !draftValidationErrorMessage &&
        buildScanErrors.length === 0 &&
        Object.keys(fieldErrors).length === 0 &&
        authResponse?.authenticated,
    ) && !isProcessing;

  // 既存ArtifactはdescriptorとZIPの検証が完了した場合だけ送信可能
  const canSubmitExisting =
    Boolean(descriptorData && zipFile && !zipCheckError && descriptorErrors.length === 0) &&
    !isProcessing;

  const actor = authResponse?.dashboard?.actor;
  const [newLocaleInput, setNewLocaleInput] = useState("");

  // 認証、入力モード、検証結果、進捗を一つのIntakeワークスペースとして表示する
  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="PandD Deploy Control ホーム">
          <span className="brand-mark brand-logo" aria-hidden="true" />
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
              <Link className="text-button" href="/game" style={{ textDecoration: "none", marginRight: 8 }}>
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
          <p className="eyebrow">INTAKE / ARTIFACT BUILDER & UPLOADER</p>
          <h1>
            Buildフォルダから、<br />
            <em>ブラウザで一括公開</em>へ。
          </h1>
          <p className="hero-copy">
            ゲームのビルドフォルダと情報を選択するだけで、ブラウザ上で release.json・ZIP64 artifact・descriptor
            を自動生成し、非公開intakeへ直接アップロードしてsealします。
          </p>
        </div>
        <div className="hero-stats" aria-label="Intake 仕様">
          <div>
            <span>ZIP64</span>
            <small>決定論的ZIP64生成</small>
          </div>
          <div>
            <span>64 MB</span>
            <small>Part分割転送</small>
          </div>
          <div>
            <span>SHA-256</span>
            <small>インクリメンタル完全性検証</small>
          </div>
        </div>
      </section>

      {/* Artifact新規作成と既存Artifact送信を切り替えるタブ */}
      <div className="intake-mode-switcher" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "create"}
          className={`mode-tab-button ${mode === "create" ? "active" : ""}`}
          onClick={() => {
            if (!isProcessing) setMode("create");
          }}
          disabled={isProcessing}
        >
          <span>Artifactを作成してアップロード</span>
          <span className="badge">推奨</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "existing"}
          className={`mode-tab-button ${mode === "existing" ? "active" : ""}`}
          onClick={() => {
            if (!isProcessing) setMode("existing");
          }}
          disabled={isProcessing}
        >
          <span>既存Artifactをアップロード</span>
        </button>
      </div>

      <div className="workspace">
        {/* 未認証時はアップロード権限を得るためのログイン導線を表示 */}
        {authResponse && !authResponse.authenticated && (
          <div className="setup-note" style={{ margin: "0 0 28px 0", padding: "18px" }}>
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

        {/* 入力検証やアップロードで発生した共通エラーを表示 */}
        {errorMessage && (
          <div className="notice error" role="alert" style={{ margin: "0 0 24px 0" }}>
            {errorMessage}
          </div>
        )}

        {/* モード1: Artifactを生成してアップロード */}
        {mode === "create" && (
          <div className="builder-steps-container">
            {/* STEP 1: ゲーム基本情報 */}
            <section className="builder-step-card">
              <div className="step-header">
                <span className="step-num-badge">STEP 1</span>
                <div className="step-title-group">
                  <h3>GAME / ゲーム基本情報</h3>
                  <p>公開するゲームの一意なID、バージョン、エンジン、セーブフォルダ名を入力します。</p>
                </div>
              </div>

              {publishedGames.length > 0 && (
                <div className="published-profile-loader">
                  <div>
                    <strong>公開済みゲームの情報を再利用</strong>
                    <small>タイトル、説明文、Hero画像、Thumbnail画像、焦点位置を前回の公開内容から復元します。</small>
                  </div>
                  <select
                    aria-label="公開済みゲーム"
                    value={selectedPublishedGame}
                    disabled={isProcessing || profileLoading}
                    onChange={(event) => setSelectedPublishedGame(event.target.value)}
                  >
                    <option value="">ゲームを選択</option>
                    {publishedGames.map((game) => (
                      <option key={game.gameId} value={game.gameId}>
                        {game.name} ({game.gameId}) — {game.environment === "production" ? "Production" : "Staging"}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={isProcessing || profileLoading || !selectedPublishedGame}
                    onClick={reusePublishedProfile}
                  >
                    {profileLoading ? "読み込み中…" : "前回の情報を使用"}
                  </button>
                  {profileNotice && <p role="status">{profileNotice}</p>}
                </div>
              )}

              <div className="builder-form-grid">
                <div className="form-field-group">
                  <label htmlFor="game-id-input">
                    <span>ゲームID *</span>
                    <span className="field-tip">英小文字・数字・ハイフン (3～64文字)</span>
                  </label>
                  <input
                    id="game-id-input"
                    type="text"
                    placeholder="例: pixel-pile"
                    value={gameId}
                    disabled={isProcessing}
                    className={fieldErrors.gameId ? "input-with-error" : ""}
                    onChange={(e) => {
                      setGameId(e.target.value);
                      validateField("gameId", e.target.value);
                    }}
                  />
                  {fieldErrors.gameId && <span className="field-error-msg">{fieldErrors.gameId}</span>}
                </div>

                <div className="form-field-group">
                  <label htmlFor="version-input">
                    <span>バージョン *</span>
                    <span className="field-tip">メジャー.マイナー.パッチ</span>
                  </label>
                  <input
                    id="version-input"
                    type="text"
                    placeholder="1.0.0"
                    value={version}
                    disabled={isProcessing}
                    className={fieldErrors.version ? "input-with-error" : ""}
                    onChange={(e) => {
                      setVersion(e.target.value);
                      validateField("version", e.target.value);
                    }}
                  />
                  {fieldErrors.version && <span className="field-error-msg">{fieldErrors.version}</span>}
                </div>

                <div className="form-field-group">
                  <label htmlFor="min-launcher-input">
                    <span>最小ランチャーバージョン *</span>
                    <span className="field-tip">ランチャー下限</span>
                  </label>
                  <input
                    id="min-launcher-input"
                    type="text"
                    placeholder="1.0.1"
                    value={minimumLauncherVersion}
                    disabled={isProcessing}
                    className={fieldErrors.minimumLauncherVersion ? "input-with-error" : ""}
                    onChange={(e) => {
                      setMinimumLauncherVersion(e.target.value);
                      validateField("minimumLauncherVersion", e.target.value);
                    }}
                  />
                  {fieldErrors.minimumLauncherVersion && (
                    <span className="field-error-msg">{fieldErrors.minimumLauncherVersion}</span>
                  )}
                </div>

                <div className="form-field-group">
                  <label htmlFor="engine-select">
                    <span>ゲームエンジン *</span>
                  </label>
                  <select
                    id="engine-select"
                    value={engine}
                    disabled={isProcessing}
                    onChange={(e) => setEngine(e.target.value)}
                  >
                    <option value="unity">unity</option>
                    <option value="godot">godot</option>
                    <option value="siv3d">siv3d</option>
                  </select>
                </div>

                <div className="form-field-group full-width">
                  <label htmlFor="save-dir-input">
                    <span>セーブディレクトリ名 *</span>
                    <span className="field-tip">英数字・_・- (2～64文字)</span>
                  </label>
                  <input
                    id="save-dir-input"
                    type="text"
                    placeholder="例: PixelPile"
                    value={saveDirectoryName}
                    disabled={isProcessing}
                    className={fieldErrors.saveDirectoryName ? "input-with-error" : ""}
                    onChange={(e) => {
                      setSaveDirectoryName(e.target.value);
                      validateField("saveDirectoryName", e.target.value);
                    }}
                  />
                  {fieldErrors.saveDirectoryName && (
                    <span className="field-error-msg">{fieldErrors.saveDirectoryName}</span>
                  )}
                </div>
              </div>
            </section>

            {/* STEP 2: 多言語表示情報と画像 */}
            <section className="builder-step-card">
              <div className="step-header">
                <span className="step-num-badge">STEP 2</span>
                <div className="step-title-group">
                  <h3>DISPLAY / 多言語表示情報・画像</h3>
                  <p>ランチャーに表示する言語別のゲーム名・説明文、Hero画像、Thumbnail画像を設定します。</p>
                </div>
              </div>

              {/* 言語別のゲーム名・概要入力 */}
              <div className="form-field-group" style={{ marginBottom: "22px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "12px", fontWeight: 680, color: "#344054" }}>言語別表示テキスト *</span>
                  <span className="field-tip">ja-JPは必須です。必要に応じて言語行を追加できます。</span>
                </div>

                <div className="translations-table-wrap">
                  <table className="translations-table">
                    <thead>
                      <tr>
                        <th style={{ width: "110px" }}>言語タグ</th>
                        <th style={{ width: "240px" }}>ゲーム名 (1〜100文字)</th>
                        <th>概要 (1〜500文字)</th>
                        <th style={{ width: "60px", textAlign: "center" }}>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.keys(translations).map((loc) => (
                        <tr key={loc}>
                          <td>
                            <strong>{loc}</strong>
                            {loc === "ja-JP" && <small style={{ display: "block", color: "var(--muted)" }}>必須</small>}
                          </td>
                          <td>
                            <input
                              type="text"
                              placeholder={`${loc} のゲーム名`}
                              value={translations[loc].name}
                              disabled={isProcessing}
                              onChange={(e) => updateTranslation(loc, "name", e.target.value)}
                            />
                          </td>
                          <td>
                            <textarea
                              placeholder={`${loc} の説明・概要`}
                              value={translations[loc].summary}
                              disabled={isProcessing}
                              onChange={(e) => updateTranslation(loc, "summary", e.target.value)}
                            />
                          </td>
                          <td style={{ textAlign: "center" }}>
                            {loc !== "ja-JP" ? (
                              <button
                                type="button"
                                className="text-button"
                                style={{ color: "var(--red)" }}
                                disabled={isProcessing}
                                onClick={() => removeTranslationLocale(loc)}
                              >
                                削除
                              </button>
                            ) : (
                              <span style={{ color: "var(--muted)", fontSize: "11px" }}>固定</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: "10px", display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="text"
                    placeholder="追加言語タグ (例: en-US, ko-KR)"
                    value={newLocaleInput}
                    disabled={isProcessing}
                    style={{ width: "220px", marginTop: 0 }}
                    onChange={(e) => setNewLocaleInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={isProcessing || !newLocaleInput.trim()}
                    onClick={() => {
                      addTranslationLocale(newLocaleInput);
                      setNewLocaleInput("");
                    }}
                  >
                    + 言語を追加
                  </button>
                </div>
              </div>

              {/* Hero・Thumbnail画像とHero焦点位置 */}
              <div className="image-picker-row">
                {/* Hero画像カード */}
                <div
                  className={`image-picker-card image-picker-card--drop-target ${isHeroDragOver ? "dragover" : ""}`}
                  title="ランチャーでゲームを選択したとき、ゲーム詳細画面の背景に表示されます。"
                  onDragOver={(event) => handleImageDragOver(event, setIsHeroDragOver)}
                  onDragLeave={(event) => handleImageDragLeave(event, setIsHeroDragOver)}
                  onDrop={(event) => handleImageDrop(event, setIsHeroDragOver, handleHeroSelected)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "12px", fontWeight: 680, color: "#344054" }}>Hero画像 *</span>
                    <span className="field-tip">PNG / JPEG / WebP</span>
                  </div>

                  <div
                    className="image-preview-box"
                    role="button"
                    tabIndex={0}
                    onClick={handleHeroImageClick}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        setFocalPoint({ x: 0.5, y: 0.5 });
                      }
                    }}
                    title="画像上をクリックして焦点位置（切り抜き中心）を指定できます"
                  >
                    {heroPreviewUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          ref={heroImageRef}
                          src={heroPreviewUrl}
                          alt="Hero Preview"
                          className="image-preview-img"
                        />
                        <div
                          className="focal-crosshair"
                          style={{
                            left: `${focalPoint.x * 100}%`,
                            top: `${focalPoint.y * 100}%`,
                          }}
                        />
                      </>
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: "12px" }}>
                        Hero画像をここへドラッグ＆ドロップ、または選択してください (クリックで焦点設定)
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label className="secondary-button" style={{ cursor: "pointer", display: "inline-block" }}>
                      <span>Hero画像を選択</span>
                      <input
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp"
                        style={{ display: "none" }}
                        disabled={isProcessing}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleHeroSelected(f);
                        }}
                      />
                    </label>

                    <div className="focal-inputs-row">
                      <span>焦点 X:</span>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        value={focalPoint.x}
                        disabled={isProcessing}
                        onChange={(e) =>
                          setFocalPoint((p) => ({
                            ...p,
                            x: Math.max(0, Math.min(1, Number(e.target.value))),
                          }))
                        }
                      />
                      <span>Y:</span>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        value={focalPoint.y}
                        disabled={isProcessing}
                        onChange={(e) =>
                          setFocalPoint((p) => ({
                            ...p,
                            y: Math.max(0, Math.min(1, Number(e.target.value))),
                          }))
                        }
                      />
                    </div>
                  </div>
                  {fieldErrors.hero && <span className="field-error-msg">{fieldErrors.hero}</span>}
                </div>

                {/* Thumbnail画像カード */}
                <div
                  className={`image-picker-card image-picker-card--drop-target ${isThumbnailDragOver ? "dragover" : ""}`}
                  title="ランチャーのゲーム一覧に表示されるゲームカードのサムネイルです。"
                  onDragOver={(event) => handleImageDragOver(event, setIsThumbnailDragOver)}
                  onDragLeave={(event) => handleImageDragLeave(event, setIsThumbnailDragOver)}
                  onDrop={(event) => handleImageDrop(event, setIsThumbnailDragOver, handleThumbnailSelected)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "12px", fontWeight: 680, color: "#344054" }}>Thumbnail画像 *</span>
                    <span className="field-tip">PNG / JPEG / WebP</span>
                  </div>

                  <div className="image-preview-box" style={{ cursor: "default" }}>
                    {thumbnailPreviewUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={thumbnailPreviewUrl}
                        alt="Thumbnail Preview"
                        className="image-preview-img"
                      />
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: "12px" }}>
                        Thumbnail画像をここへドラッグ＆ドロップ、または選択してください
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="secondary-button" style={{ cursor: "pointer", display: "inline-block" }}>
                      <span>Thumbnail画像を選択</span>
                      <input
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp"
                        style={{ display: "none" }}
                        disabled={isProcessing}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleThumbnailSelected(f);
                        }}
                      />
                    </label>
                  </div>
                  {fieldErrors.thumbnail && <span className="field-error-msg">{fieldErrors.thumbnail}</span>}
                </div>
              </div>
            </section>

            {/* STEP 3: ビルドフォルダと起動ファイル */}
            <section className="builder-step-card">
              <div className="step-header">
                <span className="step-num-badge">STEP 3</span>
                <div className="step-title-group">
                  <h3>BUILD / ゲームビルドフォルダ & 起動ファイル</h3>
                  <p>ゲームの実行に必要な全ファイルを含むフォルダを選択し、起動用exeを指定します。</p>
                </div>
              </div>

              {/* ビルドフォルダの選択・ドロップ領域 */}
              <div
                className={`intake-dropzone ${isDragOver ? "dragover" : ""}`}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                style={{ marginBottom: "18px" }}
              >
                <div className="intake-dropzone-inner">
                  <span className="dropzone-icon" aria-hidden="true">📁</span>
                  <div>
                    <h3>ゲームのBuildフォルダを選択またはドロップ</h3>
                    <p>Unity、Godot、Siv3Dなどのビルド出力フォルダ全体を一括選択します。</p>
                  </div>
                  <div className="dropzone-buttons">
                    <label className="primary-button dropzone-btn">
                      <span>Buildフォルダを選択</span>
                      <input
                        type="file"
                        {...{ webkitdirectory: "" }}
                        multiple
                        style={{ display: "none" }}
                        disabled={isProcessing}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleFolderFiles(e.target.files)}
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* ビルド検証結果と起動EXEの選択 */}
              {buildScanStats ? (
                <div className="build-scan-box">
                  <div className="build-scan-stats">
                    <div className="build-stat-item">
                      <span>{buildScanStats.count.toLocaleString()} 件</span>
                      <small>検出ファイル数 (上限 50,000)</small>
                    </div>
                    <div className="build-stat-item">
                      <span>{formatBytes(buildScanStats.bytes)}</span>
                      <small>非圧縮合計容量 (上限 5 GiB)</small>
                    </div>
                    <div className="build-stat-item">
                      <span style={{ color: "var(--green)" }}>✓ 正常</span>
                      <small>パス安全性・重複チェック</small>
                    </div>
                  </div>

                  {buildScanErrors.length > 0 ? (
                    <div className="intake-error-box">
                      <strong>ビルド検証エラー:</strong>
                      <ul>
                        {buildScanErrors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="form-field-group" style={{ marginTop: "10px" }}>
                      <label htmlFor="entrypoint-select">
                        <span>起動EXE (Entrypoint) *</span>
                        <span className="field-tip">ゲーム起動用のメイン実行ファイル</span>
                      </label>
                      <select
                        id="entrypoint-select"
                        value={entrypointRelativePath}
                        disabled={isProcessing}
                        onChange={(e) => setEntrypointRelativePath(e.target.value)}
                      >
                        {detectedExecutables.map((exe) => (
                          <option key={exe} value={exe}>
                            {exe}
                          </option>
                        ))}
                      </select>
                      {entrypointRelativePath && (
                        <span className="input-help">
                          Artifact内パス: <code>build/{entrypointRelativePath}</code> (Working Directory:{" "}
                          <code>build/{computeLaunchPaths(entrypointRelativePath).workingDirectory}</code>)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ) : buildScanErrors.length > 0 ? (
                <div className="intake-error-box">
                  <strong>ビルド検証エラー:</strong>
                  <ul>
                    {buildScanErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            {/* STEP 4: 生成内容の確認と送信 */}
            <section className="builder-step-card">
              <div className="step-header">
                <span className="step-num-badge">STEP 4</span>
                <div className="step-title-group">
                  <h3>REVIEW / プレビュー & アップロード</h3>
                  <p>生成されるArtifactの構成内容を確認し、生成と非公開Intakeへのアップロードを実行します。</p>
                </div>
              </div>

              {previewSummary ? (
                <div className="review-preview-card">
                  <div className="review-grid">
                    <div>
                      <span>ゲームID</span>
                      <strong>{gameId}</strong>
                    </div>
                    <div>
                      <span>バージョン</span>
                      <strong>{version}</strong>
                    </div>
                    <div>
                      <span>ゲームエンジン</span>
                      <strong>{engine}</strong>
                    </div>
                    <div>
                      <span>起動EXE</span>
                      <code>build/{previewSummary.entrypoint}</code>
                    </div>
                    <div>
                      <span>総ファイル数</span>
                      <strong>{(previewSummary.files + 3).toLocaleString()} 件 (metadata含む)</strong>
                    </div>
                    <div>
                      <span>非圧縮総容量</span>
                      <strong>{formatBytes(previewSummary.totalBytes)}</strong>
                    </div>
                    <div>
                      <span>対応言語</span>
                      <strong>{previewSummary.locales.join(", ")}</strong>
                    </div>
                    <div>
                      <span>セーブディレクトリ</span>
                      <code>{saveDirectoryName}</code>
                    </div>
                    <div>
                      <span>Hero焦点位置</span>
                      <code>X: {focalPoint.x}, Y: {focalPoint.y}</code>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="intake-card-placeholder">
                  STEP 1〜3 の必須項目を入力・選択するとプレビューが表示されます。
                </p>
              )}

              {draftValidationErrorMessage && (
                <div className="notice error" style={{ margin: "14px 0" }}>
                  {draftValidationErrorMessage}
                </div>
              )}

              {/* 生成・アップロード・キャンセル操作 */}
              <div className="intake-actions-bar" style={{ marginTop: "20px" }}>
                {stage !== "completed" && (
                  <>
                    <button
                      type="button"
                      className="primary-button"
                      style={{ padding: "14px 28px", fontSize: "15px" }}
                      disabled={!canSubmitBuilder}
                      onClick={startBuildAndUpload}
                    >
                      {isProcessing ? "処理中…" : "Artifactを作成してアップロード"}
                    </button>
                    {isProcessing && (
                      <button type="button" className="danger-outline-button" onClick={cancelOperation}>
                        処理をキャンセル
                      </button>
                    )}
                  </>
                )}

                {/* 生成物のローカル保存（確認用） */}
                {builtResult && (
                  <div style={{ display: "flex", gap: "10px", marginLeft: "auto" }}>
                    <button type="button" className="secondary-button" onClick={downloadGeneratedDescriptor}>
                      Descriptorを保存 (.json)
                    </button>
                    <button type="button" className="secondary-button" onClick={downloadGeneratedZip}>
                      Artifact ZIPを保存 (.zip)
                    </button>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* モード2: 既存Artifactを検証してアップロード */}
        {mode === "existing" && (
          <div>
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
                  <p>既存の生成済みファイルを2つ同時にドロップするか、下のボタンから個別に選択してください。</p>
                </div>
                <div className="dropzone-buttons">
                  <label className="secondary-button dropzone-btn">
                    <span>Descriptor JSON を選択</span>
                    <input
                      type="file"
                      accept=".json,.pandd-artifact.json"
                      style={{ display: "none" }}
                      disabled={isProcessing}
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
                      disabled={isProcessing}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleZipSelected(f);
                      }}
                    />
                  </label>
                </div>
              </div>
            </section>

            <div className="intake-files-grid">
              {/* descriptor検証結果カード */}
              <article
                className={`intake-card ${descriptorData ? "valid" : descriptorErrors.length > 0 ? "invalid" : ""}`}
              >
                <div className="intake-card-header">
                  <span className="file-badge">DESCRIPTOR</span>
                  <strong>{descriptorFile ? descriptorFile.name : "未選択"}</strong>
                </div>
                {descriptorData ? (
                  <div className="intake-meta-list">
                    <div>
                      <span>Artifact ID:</span> <code>{descriptorData.artifactId}</code>
                    </div>
                    <div>
                      <span>ゲーム:</span> <b>{descriptorData.gameId}</b> (v{descriptorData.version})
                    </div>
                    <div>
                      <span>対象ZIP:</span> <code>{descriptorData.artifactFile}</code>
                    </div>
                    <div>
                      <span>申告容量:</span> {formatBytes(descriptorData.sizeBytes)} (
                      {descriptorData.fileCount.toLocaleString()} ファイル)
                    </div>
                    <div>
                      <span>SHA-256:</span>{" "}
                      <code title={descriptorData.sha256}>{shortHash(descriptorData.sha256)}</code>
                    </div>
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

              {/* Artifact ZIP整合性カード */}
              <article
                className={`intake-card ${zipFile && !zipCheckError ? "valid" : zipCheckError ? "invalid" : ""}`}
              >
                <div className="intake-card-header">
                  <span className="file-badge">ARTIFACT ZIP</span>
                  <strong>{zipFile ? zipFile.name : "未選択"}</strong>
                </div>
                {zipFile ? (
                  <div className="intake-meta-list">
                    <div>
                      <span>実ファイル容量:</span> {formatBytes(zipFile.size)}
                    </div>
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

            <section className="intake-action-section">
              {stage !== "completed" && (
                <div className="intake-actions-bar">
                  <button
                    type="button"
                    className="primary-button"
                    style={{ padding: "14px 28px", fontSize: "15px" }}
                    disabled={!canSubmitExisting || !authResponse?.authenticated}
                    onClick={startExistingUpload}
                  >
                    {isProcessing ? "処理中…" : "Artifactを検証してアップロードを開始"}
                  </button>
                  {isProcessing && (
                    <button type="button" className="danger-outline-button" onClick={cancelOperation}>
                      アップロードをキャンセル
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>
        )}

        {/* STEP 5: 生成・検証・アップロードの進捗と結果 */}
        {(isProcessing || stage === "completed" || stage === "cancelled" || stage === "error") && (
          <section className="intake-action-section" style={{ marginTop: "32px" }}>
            <div className={`intake-progress-card ${stage === "completed" ? "completed" : ""}`} role="status">
              <div className="progress-header">
                <div>
                  <span className="eyebrow" style={{ margin: 0 }}>
                    STATUS
                  </span>
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

              {/* Seal完了後の成功バナー */}
              {stage === "completed" && sealedArtifactId && (
                <div className="intake-completed-box">
                  <div className="completed-icon">✓</div>
                  <div>
                    <h4>Artifactの受付が完了しました（Sealed）</h4>
                    <p>
                      Artifact ID <code>{sealedArtifactId}</code> をControl PlaneのStaging申請で使用できます。
                    </p>
                    <div style={{ marginTop: "14px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
                      <Link className="primary-button" href="/game" style={{ textDecoration: "none" }}>
                        Control Planeで公開申請を作成
                      </Link>
                      <button type="button" className="secondary-button" onClick={resetForm}>
                        別のArtifactを作成 / アップロード
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* ローカル開発時だけ表示する認証ユーザー切り替え */}
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
