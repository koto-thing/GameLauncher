import type { Metadata } from "next";
import { ControlPlane } from "../ControlPlane";
import { ServiceNavigation } from "../ServiceNavigation";

// 静的メタデータ定義
export const metadata: Metadata = { title: "GameLauncher 公開申請・設定 | PandD" };

/**
 * GameLauncher公開申請・権限管理画面のルートコンポーネント
 * @returns サービスナビゲーションとControl Plane画面
 */
export default function GamePage() {
  return (
    <>
      <ServiceNavigation />
      <ControlPlane />
    </>
  );
}
