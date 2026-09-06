import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker } from "react-router-dom";
import { api, ApiError } from "./api-client";
import type { DomainPolicy } from "../../domain/models";

/** @brief 音源の入力案内をサーバーと同じ設定値から作る。 */
export function audioUploadHint(policy?: DomainPolicy): string {
  return policy
    ? `MP3 / PCM WAV、${policy.media.maxAudioFileBytes / 1024 / 1024}MiB・${policy.media.maxAudioDurationSeconds / 60}分まで`
    : "設定読込中";
}
/** @brief 画像の入力案内をサーバーと同じ設定値から作る。 */
export function imageUploadHint(policy?: DomainPolicy): string {
  return policy
    ? `JPEG / PNG / WebP、${policy.media.maxImageFileBytes / 1024 / 1024}MiB・${policy.media.maxImageEdgePixels}pxまで`
    : "設定読込中";
}

/** @brief 遅れて届いた別ページの応答を捨てる管理用読込Hook。 */
export function useRemote<T>(path: string) {
  const [value, setValue] = useState<{ path: string; data: T } | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const reload = useCallback(
    /** @brief 現在のリクエストだけを画面へ反映する。 */ async () => {
      const current = ++generation.current;
      try {
        const data = await api<T>(path);
        if (current === generation.current) {
          setValue({ path, data });
          setError("");
        }
      } catch (failure) {
        if (current === generation.current)
          setError(
            failure instanceof Error
              ? failure.message
              : "読み込みに失敗しました。",
          );
      }
    },
    [path],
  );
  useEffect(
    /** @brief 管理ページの対象変更時に取得し直す。 */ () => {
      void reload();
      return /** @brief 古い応答の書き戻しを防ぐ。 */ () => {
        generation.current++;
      };
    },
    [reload],
  );
  return { data: value?.path === path ? value.data : null, error, reload };
}
/** @brief 保存・アップロードの二重送信を同期ロックでも防止する。 */
export function useEditorTask() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  /** @brief 操作結果を明示し、入力エラーの項目名を維持する。 */
  async function run(
    action: () => Promise<void>,
    success = "保存しました。",
  ): Promise<void> {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    setError(null);
    try {
      await action();
      setMessage(success);
      window.dispatchEvent(
        new CustomEvent("music-notice", { detail: success }),
      );
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure
          : new ApiError(
              failure instanceof Error
                ? failure.message
                : "処理に失敗しました。",
              "INVALID",
            ),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { busy, message, error, run };
}
/** @brief 未保存の変更を画面移動とタブ終了から保護する。 */
export function useUnsaved(dirty: boolean): void {
  const blocker = useBlocker(dirty);
  useEffect(
    /** @brief ブラウザー内の移動でも保存前の入力破棄を確認する。 */ () => {
      if (blocker.state === "blocked") {
        if (window.confirm("未保存の変更を破棄して移動しますか？"))
          blocker.proceed();
        else blocker.reset();
      }
    },
    [blocker],
  );
  useEffect(
    /** @brief タブを閉じる操作にも未保存状態を知らせる。 */ () => {
      /** @brief ブラウザー標準の離脱確認を有効にする。 */
      function beforeUnload(event: BeforeUnloadEvent): void {
        if (dirty) {
          event.preventDefault();
          event.returnValue = "";
        }
      }
      window.addEventListener("beforeunload", beforeUnload);
      return /** @brief 保存済み・破棄後のイベントを解除する。 */ () =>
        window.removeEventListener("beforeunload", beforeUnload);
    },
    [dirty],
  );
}
/** @brief ラベルと該当項目のエラーを関連する入力の隣に表示する。 */
export function Field({
  label,
  name,
  error,
  children,
}: {
  label: string;
  name?: string;
  error?: ApiError | null;
  children: ReactNode;
}) {
  return (
    <label className="field">
      {label}
      {children}
      {error && name && error.field === name && (
        <span className="error" role="alert">
          {error.message}
        </span>
      )}
    </label>
  );
}
/** @brief 保存成功・失敗と409時の復旧方法を表示する。 */
export function TaskNotice({
  task,
}: {
  task: ReturnType<typeof useEditorTask>;
}) {
  return (
    <div aria-live="polite">
      {task.busy && <p role="status">処理中です…</p>}
      {task.error && (
        <p className="notice error" role="alert">
          {task.error.message}
          {task.error.code === "CONFLICT" &&
            " 入力を控えたうえでページを再読込し、最新の内容に適用してください。"}
        </p>
      )}
      {task.message && (
        <p className="notice success" role="status">
          {task.message}
        </p>
      )}
    </div>
  );
}
