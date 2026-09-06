import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PandD Deploy Control",
  description: "PandDゲーム公開の申請・指名承認・監査を一つの場所で管理します。",
};

export default function Home() {
  /* eslint-disable @next/next/no-html-link-for-pages -- 独立した管理アプリをページ単位で読み込む。 */
  return (
    <main className="service-home">
      <header><p className="eyebrow">PandD / CONTROL PLANE</p><h1>アップロードと管理</h1><p>管理するサービスを選んでください。</p></header>
      <div className="service-cards">
        <section className="service-card" aria-labelledby="game-service">
          <h2 id="game-service">GameLauncher</h2>
          <p>ゲームのビルドと画像をアップロードし、公開申請・承認・権限設定を管理します。</p>
          <a className="primary-link" href="/intake">Web Uploader / Intaker を開く →</a>
          <a className="service-settings" href="/game">公開申請・設定を開く →</a>
        </section>
        <section className="service-card" aria-labelledby="music-service">
          <h2 id="music-service">Music</h2>
          <p>楽曲やアートワークをアップロードし、音楽の公開と表示設定を管理します。</p>
          <a className="primary-link" href="/music">Music Uploader を開く →</a>
        </section>
      </div>
      <p className="service-home-note">各サービスの利用にはGitHubログインと権限が必要です。</p>
    </main>
  );
}
