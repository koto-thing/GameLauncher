import { Members } from "./Members";

/** @brief 運営ロールの招待と本人受諾の入口 */
export default function MembersPage() {
  return <main className="members-page">
    <header className="members-page-heading">
      <p className="members-kicker">TEAM MANAGEMENT</p>
      <h1>運営メンバー</h1>
      <p>チームのメンバーと役割、あなたへの招待を管理します。</p>
    </header>
    <Members />
  </main>;
}
