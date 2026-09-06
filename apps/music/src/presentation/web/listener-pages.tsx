import { Link, useParams } from "react-router-dom";
import { useSite } from "./context";
import { AdSlot, Artwork, PlayerControls, timeLabel } from "./components";
import { GameDesignSurface } from "./design-surface";
import { SoundtrackCarousel } from "./soundtrack-carousel";

/** @brief 作品数に関係なく聴き始められる静かなライブラリを表示する。 */
export function HomePage() {
  const { catalogue, loading } = useSite();
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">PANDD ORIGINAL SOUNDTRACKS</p>
          <h1>
            ゲームの余韻を、
            <br />
            <em>音楽と。</em>
          </h1>
          <p>
            あの景色、あの瞬間。
            <br />
            ゲームの世界を彩る音楽を、いつでもここで。
          </p>
          <a href="#library" className="text-link">
            作品を選んで聴く <span>↘</span>
          </a>
        </div>
        <SoundtrackCarousel games={catalogue} />
        <div className="hero-note" aria-hidden="true">
          PRESS PLAY.
          <br />
          STAY A LITTLE.
        </div>
      </section>
      <section id="library">
        <div className="section-heading">
          <div>
            <p className="eyebrow">THE COLLECTION</p>
            <h2>サウンドトラック</h2>
          </div>
          <span>{catalogue.length} 作品</span>
        </div>
        {loading ? (
          <p role="status">作品を読み込んでいます…</p>
        ) : !catalogue.length ? (
          <p className="empty">
            サウンドトラックを準備しています。公開後、このページから聴けます。
          </p>
        ) : (
          <div className="game-grid">
            {catalogue.map(
              /** @brief 架空の人気値を表示せず作品そのものを紹介する。 */ (
                game,
                index,
              ) => (
                <Link
                  className="game-card"
                  key={game.id}
                  to={`/games/${game.id}`}
                >
                  <div className="cover">
                    <Artwork
                      assetId={game.imageAssetId}
                      alt={game.imageAlt || game.title}
                    />
                    <span className="cover-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="card-meta">
                    <small>
                      ORIGINAL SOUNDTRACK · {game.tracks.length} TRACKS
                    </small>
                    <h3>
                      {game.title}
                      <span aria-hidden="true">↗</span>
                    </h3>
                    <p>{game.description}</p>
                  </div>
                </Link>
              ),
            )}
          </div>
        )}
      </section>
      <AdSlot />
      <section className="listening-note">
        <span>↻</span>
        <div>
          <h2>世界に、もう少し浸る。</h2>
          <p>
            対応曲の「ゲーム内ループ」で、イントロの先にある音楽を繰り返し楽しめます。
          </p>
        </div>
      </section>
    </>
  );
}
/** @brief 作品紹介と曲順を示し、同じ作品のキューで再生する。 */
export function GamePage() {
  const { id } = useParams();
  const { catalogue, player, loading } = useSite();
  const game = catalogue.find(
    /** @brief 直接URLから公開作品を解決する。 */ (item) => item.id === id,
  );
  if (!game)
    return (
      <p className="empty">
        {loading ? "読み込み中…" : "作品が見つからないか、現在非公開です。"}
      </p>
    );
  return (
    <GameDesignSurface design={game.design}>
      <Link className="back-link" to="/">
        ← ライブラリ
      </Link>
      <section className="game-intro">
        <Artwork
          assetId={game.imageAssetId}
          alt={game.imageAlt || game.title}
        />
        <div>
          <p className="eyebrow">ORIGINAL SOUNDTRACK</p>
          <h1>{game.title}</h1>
          <p className="description">{game.description}</p>
          <p className="hint">
            {game.tracks.length} 曲 ·{" "}
            {timeLabel(
              game.tracks.reduce(
                /** @brief 公開曲の合計時間を表示する。 */ (sum, track) =>
                  sum + track.durationSeconds,
                0,
              ),
            )}
          </p>
          <button
            className="primary"
            disabled={!game.tracks.length}
            onClick={
              /** @brief 先頭から作品キューを開始する。 */ () => {
                void player.start(game.tracks[0], game.tracks);
              }
            }
          >
            ▶ OSTを再生
          </button>
          {game.externalUrl && (
            <a
              className="text-link"
              href={game.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              ゲーム紹介 ↗
            </a>
          )}
        </div>
      </section>
      <section>
        <div className="section-heading">
          <h2>収録曲</h2>
          <span>TRACKLIST</span>
        </div>
        {!game.tracks.length && (
          <p className="empty">公開曲を準備しています。</p>
        )}
        <ol className="track-list">
          {game.tracks.map(
            /** @brief 曲詳細URLと直接再生の両方を提供する。 */ (track) => (
              <li key={track.id}>
                <span className="track-number">
                  {String(track.position).padStart(2, "0")}
                </span>
                <Link to={`/tracks/${track.id}`}>
                  <strong>{track.title}</strong>
                  <small>
                    {track.credits
                      .map(
                        /** @brief 登録者アカウントとクレジットを区別する。 */ (
                          credit,
                        ) => `${credit.name} / ${credit.role}`,
                      )
                      .join(" · ")}
                  </small>
                </Link>
                {track.loop && (
                  <span className="loop-badge" title="ゲーム内ループ対応">
                    ↻
                  </span>
                )}
                <span className="duration">
                  {timeLabel(track.durationSeconds)}
                </span>
                <button
                  aria-label={`${track.title}を再生`}
                  onClick={
                    /** @brief 曲を押しても他作品へキューを混ぜない。 */ () => {
                      void player.start(track, game.tracks);
                    }
                  }
                >
                  ▶
                </button>
              </li>
            ),
          )}
        </ol>
      </section>
      <AdSlot />
    </GameDesignSurface>
  );
}
/** @brief 共有URLを開いた時は画像と情報だけを表示し、再生操作を待つ。 */
export function TrackPage() {
  const { id } = useParams();
  const { catalogue, loading } = useSite();
  const game = catalogue.find(
    /** @brief 公開曲から親作品を特定する。 */ (item) =>
      item.tracks.some(
        /** @brief ID一致を検査する。 */ (track) => track.id === id,
      ),
  );
  const track = game?.tracks.find(
    /** @brief 共有URLの対象曲を探す。 */ (item) => item.id === id,
  );
  if (!game || !track)
    return (
      <p className="empty">
        {loading
          ? "読み込み中…"
          : "曲が見つからないか、現在非公開です。管理画面の試聴は管理画面から操作してください。"}
      </p>
    );
  return (
    <GameDesignSurface design={game.design}>
      <Link className="back-link" to={`/games/${game.id}`}>
        ← {game.title}
      </Link>
      <section className="now-playing">
        <div className="listening-image">
          <Artwork
            assetId={track.imageAssetId}
            fallbackId={game.imageAssetId}
            alt={track.imageAlt || game.imageAlt || track.title}
          />
          <p className="eyebrow">PANDD MUSIC · ORIGINAL SOUNDTRACK</p>
        </div>
        <div className="listening-details">
          <p className="eyebrow">{game.title}</p>
          <h1>{track.title}</h1>
          <p>
            {track.credits
              .map(
                /** @brief 複数クレジットを役割付きで表示する。 */ (credit) =>
                  `${credit.role}：${credit.name}`,
              )
              .join(" / ")}
          </p>
          <PlayerControls track={track} queue={game.tracks} />
          {track.comment && (
            <div className="track-comment">
              <h2>この曲について</h2>
              <p>{track.comment}</p>
            </div>
          )}
          <label className="share-url">
            共有URL
            <input
              readOnly
              value={`${window.location.origin}${import.meta.env.BASE_URL}tracks/${track.id}`}
              onFocus={
                /** @brief コピーしやすいようURLを選択する。 */ (event) =>
                  event.target.select()
              }
            />
          </label>
        </div>
      </section>
    </GameDesignSurface>
  );
}
/** @brief 未確定の法務情報を捏造せず利用目的と設定待ちを説明する。 */
export function AboutPage() {
  const { config } = useSite();
  // メール窓口はアドレスをそのまま表示し、利用者がコピーして連絡できるようにする。
  const contactEmail = config?.contactUrl.startsWith("mailto:")
    ? config.contactUrl.slice("mailto:".length)
    : null;
  return (
    <article className="prose">
      <p className="eyebrow">ABOUT PANDD MUSIC</p>
      <h1>音楽と、その世界を。</h1>
      <p>
        PandD
        Musicは、ゲームのオリジナルサウンドトラックを無料・ログイン不要で楽しめるサイトです。音源と画像の権利は各権利者に帰属します。公開されていることは二次利用の許諾を意味しません。
      </p>
      <h2>利用上の注意</h2>
      <p>
        端末・ブラウザー・通信環境により再生できない場合があります。区間ループには音源の読み込みとメモリが必要です。画面ロック中や他のアプリの利用中に、再生が中断される場合があります。
      </p>
      <h2>プライバシー</h2>
      <p>
        投稿者認証にGitHub
        OAuthを使用します。GitHubのユーザーID、ログイン名、サイト内権限、期限付きセッション、編集履歴を保存します。リスナーの会員登録は不要です。初期バナー広告に行動追跡は使用していません。障害対応のためAPIの処理情報を記録します。
      </p>
      <h2>権利・削除依頼とお問い合わせ</h2>
      {config?.contactUrl ? (
        <a
          href={config.contactUrl}
          target={contactEmail ? undefined : "_blank"}
          rel="noopener noreferrer"
        >
          {contactEmail ?? "運営の連絡窓口 ↗"}
        </a>
      ) : (
        <p className="notice">
          連絡窓口は未設定です。本番公開前に運営が実際の窓口と、保存期間・削除方針を設定する必要があります。
        </p>
      )}
    </article>
  );
}
