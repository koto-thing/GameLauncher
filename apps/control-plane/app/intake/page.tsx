import type { Metadata } from "next";
import { IntakeUploader } from "./IntakeUploader";

export const metadata: Metadata = {
  title: "PandD Intake Uploader",
  description: "PandDゲーム成果物の検証・非公開Intakeへのアップロード・Sealを行います。",
};

export default function IntakePage() {
  return <IntakeUploader />;
}
