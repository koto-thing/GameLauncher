import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider, Navigate } from "react-router-dom";
import { Player } from "../application/player";
import { BrowserAudio } from "../infrastructure/audio/browser-audio";
import { PLAYER_RUNTIME_DEFAULTS } from "../config/player-runtime.defaults";
import {
  ManagerApp,
  PublicationPage,
  managerAssetUrl,
} from "../presentation/web/manager-app";
import { ManagePage, GameEditorPage } from "../presentation/web/manage-pages";
import { TrackEditorPage } from "../presentation/web/track-editor";
import "../config/design-tokens.css";
import "../presentation/web/style.css";

// control-planeの/musicだけに配置する独立entry。公開ビルドからは参照しない。
/** @brief control-planeのhydration後に1個の管理プレビューを開始する。 @param element mount領域。 @returns 終了関数。 */
export function mountMusicManager(element: HTMLElement): () => void {
  const engine = new BrowserAudio(PLAYER_RUNTIME_DEFAULTS, managerAssetUrl);
  const player = new Player(engine, Math.random);
  const router = createHashRouter([
    {
      path: "/",
      element: <ManagerApp player={player} />,
      children: [
        { index: true, element: <Navigate to="/manage" replace /> },
        { path: "manage", element: <ManagePage /> },
        { path: "manage/games/:id", element: <GameEditorPage /> },
        { path: "manage/tracks/:id", element: <TrackEditorPage /> },
        { path: "publications", element: <PublicationPage /> },
      ],
    },
  ]);
  const root = createRoot(element);
  root.render(<RouterProvider router={router} />);
  return /** @brief 音声とReact購読を残さず終了する。 */ () => {
    root.unmount();
    engine.dispose();
    router.dispose();
  };
}
