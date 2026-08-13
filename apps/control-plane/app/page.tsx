import type { Metadata } from "next";
import { ControlPlane } from "./ControlPlane";

export const metadata: Metadata = {
  title: "PandD Deploy Control",
  description: "PandDゲーム公開の申請・指名承認・監査を一つの場所で管理します。",
};

export default function Home() {
  return <ControlPlane />;
}
