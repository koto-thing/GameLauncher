import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Player } from "../application/player";
import { BrowserAudio } from "../infrastructure/audio/browser-audio";
import { PLAYER_RUNTIME_DEFAULTS } from "../config/player-runtime.defaults";
import { App } from "../presentation/web/app";
import {
  AboutPage,
  GamePage,
  HomePage,
  TrackPage,
} from "../presentation/web/listener-pages";
import { ManagePage, GameEditorPage } from "../presentation/web/manage-pages";
import { TrackEditorPage } from "../presentation/web/track-editor";
import "../config/design-tokens.css";
import "../presentation/web/style.css";

// ルートの外で1回だけ生成し、ブラウザー履歴や画面遷移でも再生を維持する。
const engine = new BrowserAudio(PLAYER_RUNTIME_DEFAULTS);
const player = new Player(engine, Math.random);
const router = createBrowserRouter([
  {
    path: "/",
    element: <App player={player} />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "games/:id", element: <GamePage /> },
      { path: "tracks/:id", element: <TrackPage /> },
      { path: "about", element: <AboutPage /> },
      { path: "manage", element: <ManagePage /> },
      { path: "manage/games/:id", element: <GameEditorPage /> },
      { path: "manage/tracks/:id", element: <TrackEditorPage /> },
      { path: "*", element: <p className="empty">ページが見つかりません。</p> },
    ],
  },
]);
createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
// 対応するブラウザーだけにOSの再生操作を接続する。
if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler(
    "play",
    /** @brief OSから共通エンジンを再開する。 */ () => {
      void engine.play();
    },
  );
  navigator.mediaSession.setActionHandler(
    "pause",
    /** @brief OSから共通エンジンを停止する。 */ () => engine.pause(),
  );
  navigator.mediaSession.setActionHandler(
    "nexttrack",
    /** @brief OS操作も通常のキュー規則に従う。 */ () => {
      void player.move(1);
    },
  );
  navigator.mediaSession.setActionHandler(
    "previoustrack",
    /** @brief OSから前曲へ移動する。 */ () => {
      void player.move(-1);
    },
  );
}
