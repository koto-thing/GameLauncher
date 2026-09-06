"use client";
import { useEffect, useRef, useState } from "react";

/** @brief control-planeのhydration完了後に管理アプリをmountする。 @returns 安定したmount領域。 */
export function MusicHost() {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(/** @brief 独立entryを読み込み、画面を閉じると音声・購読も破棄する。 */ () => {
    let active = true;
    let dispose: (() => void) | undefined;
    const script = document.createElement("script");
    script.src = "/music-editor/manager.js";
    script.onload = /** @brief 固定の管理bundleをhydration後の領域へmountする。 */ () => {
      const editor = (window as Window & { PandDMusicManager?: { mountMusicManager(element: HTMLElement): () => void } }).PandDMusicManager;
      if (active && host.current && editor) dispose = editor.mountMusicManager(host.current);
    };
    script.onerror = /** @brief build未実行を無限読込にせず示す。 */ () => { if (active) setError("Music管理を読み込めません。管理用buildを確認してください。"); };
    document.body.appendChild(script);
    return /** @brief 遅い読み込みと多重mountを無効化する。 */ () => { active = false; dispose?.(); script.remove(); };
  }, []);
  return <>{error && <p role="alert">{error}</p>}<div ref={host} id="music-manager" /></>;
}
