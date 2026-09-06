import type { Metadata } from "next";
import { MusicHost } from "./MusicHost";
import { ServiceNavigation } from "../ServiceNavigation";

export const metadata: Metadata = { title: "PandD Music 管理" };

/** @brief 既存control-planeの同一originにMusic専用の管理entryを配置する。 @returns 管理画面のmount領域。 */
export default function MusicPage() {
  // eslint-disable-next-line @next/next/no-css-tags -- 別entryの生成済みCSSを管理ページだけに読み込む。
  return <><link rel="stylesheet" href="/music-editor/manager.css" /><ServiceNavigation /><MusicHost /></>;
}
