import { ThemeToggle } from "./ThemeToggle";
import "./legal.css";

/** 全画面に運営情報とポリシーへの導線を表示する */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <strong>PandD LT</strong>
        <nav aria-label="サイト情報">
          <a href="/privacy">プライバシーポリシー</a>
          <a href="/disclaimer">免責事項・著作権</a>
          <a href="mailto:panddmail@gmail.com">お問い合わせ</a>
        </nav>
        <small>運営：PandD</small>
      </div>
    </footer>
  );
}

/** 申請情報の取扱いとサイト利用上の案内を公開する */
export function LegalPage({ privacy }: { privacy: boolean }) {
  return (
    <>
      <header className="applicant-header">
        <a href="/">PandD LT</a>
        <a href="/">開催案内へ</a>
        <ThemeToggle />
      </header>
      <main className="legal-page">
        <h1>{privacy ? "プライバシーポリシー" : "免責事項・著作権"}</h1>
        <p className="legal-date">最終更新日：2026年10月27日</p>
        {privacy ? (
          <>
            <p>
              PandD（以下「運営」）は、PandD
              LTの開催案内・登壇申請サイトで取り扱う個人情報を、次の目的と範囲で利用します。
            </p>
            <section>
              <h2>取得する情報と利用目的</h2>
              <ul>
                <li>
                  メールアドレス：本人確認、登壇申請の管理、審査結果や開催に関する連絡、お問い合わせへの対応に利用します。
                </li>
                <li>
                  登壇者名・所属・プロフィール・SNS等のリンク、発表内容・分類・資料URL：登壇審査、プログラムの編成、発表・登壇者の紹介に利用します。
                </li>
                <li>
                  認証・申請の操作記録：ログイン状態の管理、申請処理の確認、不正利用の防止、障害対応に利用します。
                </li>
              </ul>
            </section>
            <section>
              <h2>公開する情報</h2>
              <ul>
                <li>
                  承認された発表のタイトル・概要・発表日時・分野などの発表情報と、登壇者名・所属・プロフィール・登録されたSNS等のリンクを公開します。
                </li>
                <li>公開内容は過去の開催記録として掲載する場合があります。</li>
                <li>認証・連絡用のメールアドレスは公開しません。</li>
                <li>
                  公開欄には、公開を希望しない情報や、許可を得ていない第三者の個人情報を入力しないでください。
                </li>
              </ul>
            </section>
            <section>
              <h2>Cookie等の利用</h2>
              <ul>
                <li>ライト／ダークモードの選択を、お使いのブラウザー内に保存します。</li>
                <li>本人確認とログイン状態の維持、安全な操作のためにCookie等を使用します。</li>
                <li>Cookieを無効にすると、登壇申請など一部の機能が利用できない場合があります。</li>
              </ul>
            </section>
            <section>
              <h2>外部サービスと第三者への提供</h2>
              <ul>
                <li>
                  サイトの配信・データ管理にはCloudflare、メール送信にはロリポップ！、お問い合わせの受信にはGmailを利用します。
                </li>
                <li>各サービスでは、処理に必要な情報が取り扱われます。</li>
                <li>
                  運営は、これらの運用に必要な取扱いと法令に基づく場合を除き、本人の同意なく個人情報を第三者に提供しません。
                </li>
                <li>リンク先の外部サイトには、そのサイトのプライバシーポリシーが適用されます。</li>
              </ul>
            </section>
            <section>
              <h2>管理・保管</h2>
              <ul>
                <li>
                  申請情報へのアクセスを運営上必要な範囲に制限し、不正アクセスや情報漏えいの防止に努めます。
                </li>
                <li>
                  情報は開催運営・問い合わせ対応などの目的に必要な期間保管し、不要になった情報は削除等の対象とします。
                </li>
                <li>公開済みの開催記録の掲載停止をご希望の場合も、運営へご連絡ください。</li>
              </ul>
            </section>
            <section>
              <h2>確認・訂正・削除のお問い合わせ</h2>
              <ul>
                <li>
                  ご自身の情報の確認・訂正・削除、利用停止、公開情報の掲載停止をご希望の場合は、
                  <a href="mailto:panddmail@gmail.com">panddmail@gmail.com</a>
                  へご連絡ください。
                </li>
                <li>必要に応じて本人確認を行い、法令と対応可能な範囲に従って対応します。</li>
              </ul>
            </section>
            <section>
              <h2>方針の変更</h2>
              <ul>
                <li>運用の変更等に応じて、この方針を更新する場合があります。</li>
                <li>
                  変更後の内容と更新日は本ページに掲載し、利用目的の変更など、別途通知や同意が必要な場合は適切に対応します。
                </li>
              </ul>
            </section>
          </>
        ) : (
          <>
            <section>
              <h2>掲載情報・開催内容</h2>
              <ul>
                <li>
                  情報の正確性と更新に努めますが、掲載内容の完全性や最新性を保証するものではありません。
                </li>
                <li>開催日時・登壇者・発表内容は変更または中止となる場合があります。</li>
                <li>最新の開催案内をご確認ください。</li>
              </ul>
            </section>
            <section>
              <h2>発表内容・外部リンク</h2>
              <ul>
                <li>発表内容や意見は各登壇者に帰属し、運営の見解を示すものではありません。</li>
                <li>資料やSNS等の外部リンク先は各提供者が管理しています。</li>
                <li>内容を確認のうえ、ご自身の判断でご利用ください。</li>
              </ul>
            </section>
            <section>
              <h2>サービスの停止・責任の範囲</h2>
              <ul>
                <li>保守や障害等により、サイトや申請機能を一時停止する場合があります。</li>
                <li>
                  サイトの利用や掲載情報に関連して生じた損害について、運営は法令上認められる範囲で責任を負いません。ただし、運営の故意・重大な過失による場合や、法令上免責が認められない場合を除きます。
                </li>
              </ul>
            </section>
            <section>
              <h2>著作権</h2>
              <ul>
                <li>文章・画像・発表資料等の権利は、運営または各権利者に帰属します。</li>
                <li>
                  引用など法令で認められる利用を除き、無断での転載・複製・再配布はお控えください。
                </li>
                <li>
                  発表の撮影・録音・公開については、当日の案内と登壇者の意向に従ってください。
                </li>
              </ul>
            </section>
            <section>
              <h2>お問い合わせ</h2>
              <ul>
                <li>
                  掲載内容や権利に関するご連絡は、PandD（
                  <a href="mailto:panddmail@gmail.com">panddmail@gmail.com</a>）までお願いします。
                </li>
              </ul>
            </section>
          </>
        )}
      </main>
    </>
  );
}
