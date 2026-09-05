import { useCallback, useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import type { Player } from "../../application/player";
import type { Session } from "../../application/ports";
import type { PublicGame } from "../../domain/models";
import { SiteContext, type SiteConfig } from "./context";
import { api } from "./api-client";
import { MiniPlayer } from "./components";

/** @brief ルート遷移で破棄されないプレーヤーとサイトの共通枠を提供する。 */
export function App({ player }: { player: Player }) {
  const [notice, setNotice] = useState("");
  useEffect(
    /** @brief 保存後のリビジョン切替で編集コンポーネントが再作成されても結果を保持する。 */ () => {
      /** @brief 保存完了を共通枠へ表示する。 */
      function onNotice(event: Event): void {
        setNotice((event as CustomEvent<string>).detail);
      }
      window.addEventListener("music-notice", onNotice);
      return /** @brief アプリ終了時に購読を外す。 */ () =>
        window.removeEventListener("music-notice", onNotice);
    },
    [],
  );
  const [catalogue, setCatalogue] = useState<PublicGame[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(
    /** @brief 作品公開後も同じプレーヤーを保持したまま一覧を更新する。 */ async () => {
      try {
        const [games, account, settings] = await Promise.all([
          api<PublicGame[]>("/public/catalogue"),
          api<Session | null>("/auth/me"),
          api<SiteConfig>("/public/config"),
        ]);
        setCatalogue(games);
        setSession(account);
        setConfig(settings);
        setError("");
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "読み込みに失敗しました。",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );
  useEffect(
    /** @brief 初回URLを開いただけでは再生を開始しない。 */ () => {
      void refresh();
    },
    [refresh],
  );
  return (
    <SiteContext.Provider
      value={{ player, catalogue, session, config, loading, refresh }}
    >
      <a className="skip-link" href="#main">
        本文へ
      </a>
      <header className="site-header">
        <Link to="/" className="brand">
          PandD <span>Music</span>
          <small>GAME SOUNDTRACKS</small>
        </Link>
        <nav aria-label="メインナビゲーション">
          <NavLink to="/" end>
            ライブラリ
          </NavLink>
          <NavLink to="/about">このサイトについて</NavLink>
          <NavLink to="/manage">投稿者</NavLink>
        </nav>
      </header>
      {config?.local && (
        <div className="local-label">
          LOCAL DEMO · 検証用環境 / 実作品の音源ではありません
        </div>
      )}
      <main id="main">
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button
              onClick={
                /** @brief 通信を再試行する。 */ () => {
                  void refresh();
                }
              }
            >
              再読込
            </button>
          </div>
        )}
        <Outlet />
      </main>
      <footer>
        <span>PandD Music</span>
        <Link to="/about">利用上の注意・プライバシー・連絡先</Link>
        <small>ゲームの余韻を、音楽と。</small>
      </footer>
      <MiniPlayer />
      {notice && (
        <aside className="toast" role="status">
          {notice}
          <button
            aria-label="通知を閉じる"
            onClick={/** @brief 確認済みの通知を閉じる。 */ () => setNotice("")}
          >
            ×
          </button>
        </aside>
      )}
    </SiteContext.Provider>
  );
}
