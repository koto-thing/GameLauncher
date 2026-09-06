import { useCallback, useEffect, useState } from "react";
import { Link, Outlet } from "react-router-dom";
import type { Player } from "../../application/player";
import type { Session } from "../../application/ports";
import { SiteContext, type SiteConfig } from "./context";
import { api } from "./api-client";
import { ThemeToggle } from "./theme-toggle";

/** @brief 既存control-plane Cookieを利用し、ゲームのダッシュボードを取得せずMusicを開く。 @param props 共有プレビューエンジン。 @returns 管理画面。 */
export function ManagerApp({ player }: { player: Player }) {
  const [state, setState] = useState<{
    session: Session | null;
    config: SiteConfig;
    user: { login: string; gameAccess: boolean } | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(
    /** @brief 最新のMusic所属だけを再取得する。 */ async () => {
      try {
        setState(await api("/session"));
        setError("");
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "管理情報を取得できません。",
        );
      }
    },
    [],
  );
  useEffect(
    /** @brief 初回の共通本人確認と保存通知を接続する。 */ () => {
      void refresh();
      /** @brief 保存結果を画面遷移後も表示する。 @param event 通知。 */
      const onNotice = (event: Event) =>
        setNotice((event as CustomEvent<string>).detail);
      window.addEventListener("music-notice", onNotice);
      return /** @brief 終了時に通知購読とプレビューを止める。 */ () => {
        window.removeEventListener("music-notice", onNotice);
      };
    },
    [refresh],
  );
  return (
    <SiteContext.Provider
      value={{
        player,
        session: state?.session ?? null,
        catalogue: [],
        config: state?.config ?? null,
        loading: !state,
        refresh,
        assetUrl: managerAssetUrl,
      }}
    >
      <header className="site-header">
        <Link className="brand" to="/manage">
          PandD · Music管理
        </Link>
        <nav aria-label="管理機能">
          <Link to="/manage">担当作品</Link>
          <Link to="/publications">公開処理</Link>
        </nav>
        <ThemeToggle />
      </header>
      <main id="main">
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice success" role="status">
            {notice}
          </p>
        )}
        {state?.config.enabled === false ? (
          <p>Music管理は無効です。</p>
        ) : state?.user && !state.session ? (
          <p role="alert">
            {state.user.login}:
            Musicの担当割り当てがありません。Music運営にGitHub数値IDを伝えてください。
          </p>
        ) : (
          <Outlet />
        )}
      </main>
    </SiteContext.Provider>
  );
}
/** @brief 管理試聴を同一originの認可済みpreviewだけへ向ける。 @param id 素材ID。 @returns プレビューURL。 */
export function managerAssetUrl(id: string): string {
  return `/api/music/assets/${encodeURIComponent(id)}`;
}

/** @brief 反映済みと結果不明を区別し、同じ操作IDの再照合・再試行を提供する。 @returns 公開処理一覧。 */
export function PublicationPage() {
  const [operations, setOperations] = useState<
    { id: string; scope: string; state: string; error: string | null }[]
  >([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** @brief 最新状態を取得する。 @returns 取得完了。 */
  const reload = useCallback(async () => {
    try {
      setOperations(await api("/publications"));
    } catch (failure) {
      setError(String(failure));
    }
  }, []);
  useEffect(
    /** @brief 一覧を初回取得し定期ポーリングはしない。 */ () => {
      void reload();
    },
    [reload],
  );
  /** @brief 別操作を作らず元操作を状態照会して再送する。 @param id 操作ID。 @returns 再試行完了。 */
  async function retry(id: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/publications/${id}/retry`, { method: "POST", body: {} });
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "再試行に失敗しました。",
      );
    } finally {
      setBusy(false);
      await reload();
    }
  }
  const labels: Record<string, string> = {
    prepared: "未送信",
    sending: "反映要求中",
    applied: "反映済み",
    failed: "失敗",
    unknown: "結果不明・取り下げ未反映の可能性",
  };
  return (
    <section>
      <h1>公開処理</h1>
      <p>
        結果不明の場合は、元の操作で配信サーバーを照会します。下書きの編集だけでは公開版は変わりません。
      </p>
      <button
        onClick={
          /** @brief 最新の状態を手動取得する。 */ () => {
            void reload();
          }
        }
      >
        状態を更新
      </button>
      {error && <p role="alert">{error}</p>}
      {operations.map(
        /** @brief 各操作の確認済み状態を表示する。 */ (op) => (
          <article className="notice" key={op.id}>
            <strong>{labels[op.state]}</strong>
            <p>{op.id}</p>
            {op.error && <p>{op.error}</p>}
            {op.state !== "applied" && (
              <button
                disabled={busy}
                onClick={
                  /** @brief 同一操作の再照合を開始する。 */ () => {
                    void retry(op.id);
                  }
                }
              >
                状態確認・再試行
              </button>
            )}
          </article>
        ),
      )}
    </section>
  );
}
