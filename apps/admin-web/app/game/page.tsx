import type { Metadata } from "next";
import { ControlPlane } from "../ControlPlane";
import { ServiceNavigation } from "../ServiceNavigation";

export const metadata: Metadata = { title: "GameLauncher 公開申請・設定 | PandD" };

export default function GamePage() {
  return <><ServiceNavigation /><ControlPlane /></>;
}
