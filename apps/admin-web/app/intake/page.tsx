import type { Metadata } from "next";
import { IntakeUploader } from "./IntakeUploader";
import { ServiceNavigation } from "../ServiceNavigation";

// Intake画面のタイトルと、受け付ける成果物の責務を検索・ブラウザへ伝える
export const metadata: Metadata = {
  title: "PandD Intake Uploader",
  description: "PandDゲーム成果物の検証・非公開Intakeへのアップロード・Sealを行います。",
};

/**
 * Intakeアップローダー画面のルートコンポーネント
 * @returns サービスナビゲーションとアーティファクト受付画面
 */
export default function IntakePage() {
  return (
    <>
      <ServiceNavigation />
      <IntakeUploader />
    </>
  );
}
