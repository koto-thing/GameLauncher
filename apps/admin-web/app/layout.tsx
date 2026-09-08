import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// 管理画面全体で共有するフォント設定
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// 管理画面全体の静的メタデータ定義
export const metadata: Metadata = {
  title: "PandD Deploy Control",
  icons: { icon: "/favicon.png" },
  description: "PandDゲーム公開の申請・指名承認・監査を管理するcontrol plane。",
};

/**
 * 全ページへ言語、共通フォント、グローバルスタイルを適用するルートレイアウト
 * @param children 現在のルートで表示するページ内容
 * @returns 管理画面共通のHTML・body構造
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
