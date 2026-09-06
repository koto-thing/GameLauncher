import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  Account,
  Advertisement,
  Asset,
  AuditEntry,
  Game,
  GameContent,
  Track,
} from "../../domain/models";
import { useSite } from "./context";
import { api, uploadFile } from "./api-client";
import { Artwork } from "./components";
import { GameDesignEditor, GameDesignSurface } from "./game-design";
import { GAME_DESIGN_DEFAULTS } from "../../config/game-design.defaults";
import {
  audioUploadHint,
  imageUploadHint,
  Field,
  TaskNotice,
  useEditorTask,
  useRemote,
  useUnsaved,
} from "./editor-common";

const emptyGame: GameContent = {
  title: "",
  description: "",
  imageAssetId: null,
  imageAlt: "",
  externalUrl: "",
  rightsConfirmed: false,
};
interface AdminSettings {
  accounts: Account[];
  advertisement: Advertisement;
  audit: AuditEntry[];
}
interface ManagedGame {
  game: Game;
  tracks: Track[];
  members: string[];
}

/** @brief 投稿者ログインと担当作品・運営機能への入口を表示する。 */
export function ManagePage() {
  const { session, config, refresh } = useSite();
  const task = useEditorTask();
  if (!session)
    return (
      <section className="prose">
        <p className="eyebrow">CREATOR STUDIO</p>
        <h1>作品の音楽を、届ける。</h1>
        <p>
          adminからGitHub数値IDで作品の編集権限を受け取ると、自分の判断で登録・公開できます。
        </p>
        {config?.oauthConfigured ? (
          <a className="button primary" href="/api/auth/github/start">
            GitHubでログイン
          </a>
        ) : (
          <p className="notice">
            GitHub
            OAuthは外部設定待ちです。ローカル検証は専用のデモサーバーで利用できます。
          </p>
        )}
        {config?.local && <LocalLogin onDone={refresh} />}
      </section>
    );
  return (
    <>
      <div className="section-heading">
        <div>
          <p className="eyebrow">CREATOR STUDIO</p>
          <h1>担当作品</h1>
          <p>
            {session.principal.login} ·{" "}
            {session.principal.admin ? "運営" : "投稿者"} / GitHub ID:{" "}
            {session.principal.id}
          </p>
        </div>
        <button
          disabled={task.busy}
          onClick={
            /** @brief セッションを明示的に無効化する。 */ () => {
              void task.run(
                async () => /** @brief ログアウト後に公開状態へ戻す。 */ {
                  await api("/auth/logout", {
                    method: "POST",
                    csrf: session.csrf,
                  });
                  await refresh();
                },
                "ログアウトしました。",
              );
            }
          }
        >
          ログアウト
        </button>
      </div>
      <ManagedGameList />
      {session.principal.admin && <AdminPanel />}
      <TaskNotice task={task} />
    </>
  );
}
/** @brief 既存control-planeのローカルログインだけを利用する。 */
function LocalLogin({ onDone: _onDone }: { onDone(): Promise<void> }) {
  return <div className="local-login"><h2>ローカル検証専用ログイン</h2>{["music-admin","music-a","music-b","outsider","admin"].map(/** @brief 固定fixtureを選ぶ。 */ account => <a className="button" key={account} href={`/api/auth/dev?as=${account}`}>{account}</a>)}</div>;
}
/** @brief 現在割り当てられた作品だけを表示する。 */
function ManagedGameList() {
  const { data, error, reload } = useRemote<Game[]>("/manage/games");
  return (
    <section>
      {error && (
        <p role="alert">
          {error}
          <button
            onClick={
              /** @brief 権限変更後も一覧を再取得する。 */ () => {
                void reload();
              }
            }
          >
            再読込
          </button>
        </p>
      )}
      {data?.length === 0 && (
        <p className="empty">
          担当作品がありません。上記GitHub
          IDを運営に伝えて割り当てを依頼してください。
        </p>
      )}
      <div className="manage-list">
        {data?.map(
          /** @brief 下書き・公開停止を明確に表示する。 */ (game) => (
            <Link key={game.id} to={`/manage/games/${game.id}`}>
              <strong>{game.draft.title}</strong>
              <span>
                {game.suspended
                  ? "運営による停止中"
                  : game.published
                    ? "公開中"
                    : "下書き"}
              </span>
            </Link>
          ),
        )}
      </div>
    </section>
  );
}
/** @brief 作品作成・広告と履歴をMusic運営だけに表示する。 */
function AdminPanel() {
  const navigate = useNavigate();
  const { session, config } = useSite();
  const { data, error, reload } = useRemote<AdminSettings>("/admin/settings");
  const task = useEditorTask();
  const [title, setTitle] = useState("");
  /** @brief 空作品を作成して担当者の割り当て可能な状態にする。 */
  function create(event: FormEvent): void {
    event.preventDefault();
    void task.run(async () => /** @brief 作成完了を一覧へ反映する。 */ {
      const game = await api<Game>("/manage/games", {
        method: "POST",
        csrf: session!.csrf,
        body: { ...emptyGame, title },
      });
      navigate(`/manage/games/${game.id}`);
    });
  }
  return (
    <section className="admin-panel">
      <p className="eyebrow">SITE OPERATIONS</p>
      <h2>運営設定</h2>
      {error && <p className="error">{error}</p>}
      <form onSubmit={create} className="inline-form">
        <Field label="新しい作品名">
          <input
            value={title}
            onChange={
              /** @brief 新作品の名前を入力する。 */ (event) =>
                setTitle(event.target.value)
            }
            required
            maxLength={config?.policy.text.titleMax}
          />
        </Field>
        <button className="primary" disabled={task.busy || !title.trim()}>
          作品を作成
        </button>
      </form>
      {data && (
        <>
          <h3>GitHubアカウント</h3>
          <p>
            Music運営は明示登録されたアカウントです。作品の編集権限は各作品の運営設定からGitHub数値IDで付与できます。
          </p>
          <ul className="account-list">
            {data.accounts.map(
              /** @brief 名前だけでなく安定IDを併記する。 */ (account) => (
                <li key={account.id}>
                  <span>
                    {account.login} <small>ID {account.id}</small>
                  </span>
                  <small>
                    {account.admin ? "Music運営" : "投稿者"}
                  </small>
                </li>
              ),
            )}
          </ul>
          <AdvertisementEditor
            key={data.advertisement.version}
            initial={data.advertisement}
            onSaved={reload}
          />
          <h3>最近の更新履歴</h3>
          <div className="audit-list">
            {data.audit.map(
              /** @brief 内部履歴は運営画面内だけに表示する。 */ (entry) => (
                <p key={entry.id}>
                  <time>{new Date(entry.at).toLocaleString("ja-JP")}</time>{" "}
                  <strong>{entry.action}</strong>
                  <small>
                    {entry.actor} → {entry.target}
                  </small>
                </p>
              ),
            )}
          </div>
        </>
      )}
      <TaskNotice task={task} />
    </section>
  );
}
/** @brief バナー素材は既存の作品アップロードから選び任意コードを実行させない。 */
function AdvertisementEditor({
  initial,
  onSaved,
}: {
  initial: Advertisement;
  onSaved(): Promise<void>;
}) {
  const { session, config } = useSite();
  const [ad, setAd] = useState(initial);
  const task = useEditorTask();
  useUnsaved(JSON.stringify(ad) !== JSON.stringify(initial));
  /** @brief バナー設定を原子的に保存する。 */
  function save(event: FormEvent): void {
    event.preventDefault();
    void task.run(async () => /** @brief 保存後に最新versionを取り直す。 */ {
      await api("/admin/advertisement", {
        method: "PUT",
        csrf: session!.csrf,
        body: ad,
      });
      await onSaved();
    });
  }
  return (
    <form onSubmit={save} className="editor-form">
      <h3>バナー広告</h3>
      <p className="hint">
        作品編集の画像登録で得た素材IDを指定します。初期状態はOFFです。登録画像は公開作品と独立して、広告ONの間だけ一般配信されます。
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={ad.enabled}
          onChange={
            /** @brief 広告表示の有効・無効を選ぶ。 */ (event) =>
              setAd({ ...ad, enabled: event.target.checked })
          }
        />
        広告を表示する
      </label>
      <Field label="広告画像の素材ID">
        <input
          value={ad.imageAssetId ?? ""}
          onChange={
            /** @brief 画像の検証はAPIでも実施する。 */ (event) =>
              setAd({ ...ad, imageAssetId: event.target.value || null })
          }
        />
      </Field>
      <Field label="リンク先（HTTPS）">
        <input
          type="url"
          value={ad.href}
          onChange={
            /** @brief 安全なリンクを入力する。 */ (event) =>
              setAd({ ...ad, href: event.target.value })
          }
        />
      </Field>
      <Field label="広告画像の代替テキスト">
        <input
          maxLength={config?.policy.text.imageAltMax}
          value={ad.alt}
          onChange={
            /** @brief 広告の意味をテキストでも説明する。 */ (event) =>
              setAd({ ...ad, alt: event.target.value })
          }
        />
      </Field>
      <button disabled={task.busy}>広告設定を保存</button>
      <TaskNotice task={task} />
    </form>
  );
}
/** @brief 作品・曲一覧を現在の権限で読み込む。 */
export function GameEditorPage() {
  const { id } = useParams();
  const remote = useRemote<ManagedGame>(`/manage/games/${id}`);
  return (
    <>
      <Link to="/manage" className="back-link">
        ← 担当作品
      </Link>
      {remote.error && (
        <p role="alert" className="error">
          {remote.error}
        </p>
      )}
      {remote.data ? (
        <GameEditor
          key={`${id}:${remote.data.game.version}`}
          initial={remote.data}
          onSaved={remote.reload}
        />
      ) : (
        !remote.error && <p role="status">読み込み中…</p>
      )}
    </>
  );
}
/** @brief 作品下書きと公開操作、逐次一括曲登録を分けて扱う。 */
function GameEditor({
  initial,
  onSaved,
}: {
  initial: ManagedGame;
  onSaved(): Promise<void>;
}) {
  const { session, refresh, config } = useSite();
  const [draft, setDraft] = useState(initial.game.draft);
  const [title, setTitle] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [batch, setBatch] = useState<string[]>([]);
  const task = useEditorTask();
  const game = initial.game;
  const dirty = JSON.stringify(draft) !== JSON.stringify(game.draft);
  useUnsaved(dirty);
  /** @brief 保存と公開は別操作にし公開版を保持する。 */
  function save(event: FormEvent): void {
    event.preventDefault();
    void task.run(async () => /** @brief 最新versionへ切り替える。 */ {
      await api(`/manage/games/${game.id}`, {
        method: "PUT",
        body: { draft, version: game.version },
        csrf: session!.csrf,
      });
      await onSaved();
    });
  }
  /** @brief 保存済みの作品情報だけを公開・取り下げする。 */
  function publish(value: boolean): void {
    void task.run(
      async () => /** @brief 原子的公開後に一般一覧も更新する。 */ {
        await api(`/manage/games/${game.id}/publication`, {
          method: "POST",
          body: { publish: value, version: game.version },
          csrf: session!.csrf,
        });
        await onSaved();
        await refresh();
      },
      value ? "作品を公開しました。" : "作品を非公開にしました。",
    );
  }
  /** @brief 画像アップロードは公開せず下書き参照に追加する。 */
  function image(file?: File, background = false): void {
    if (!file) return;
    void task.run(
      async () => /** @brief 進捗と検証後の素材IDを取得する。 */ {
        setProgress(0);
        const asset = await uploadFile<Asset>(
          game.id,
          "image",
          file,
          session!.csrf,
          setProgress,
        );
        setDraft(
          background
            ? {
                ...draft,
                design: {
                  ...GAME_DESIGN_DEFAULTS,
                  ...draft.design,
                  backgroundAssetId: asset.id,
                },
                rightsConfirmed: false,
              }
            : { ...draft, imageAssetId: asset.id, rightsConfirmed: false },
        );
        setProgress(null);
      },
      background
        ? "背景画像を登録しました。権利確認後に下書きを保存してください。"
        : "画像を登録しました。代替テキストを入力して下書きを保存してください。",
    );
  }
  /** @brief 複数ファイルを1件ずつ下書き登録し、個別の成否を残す。 */
  function uploadBatch(files: FileList | null): void {
    if (!files?.length) return;
    void task.run(
      async () => /** @brief 並列アップロードと自動公開を避ける。 */ {
        const results: string[] = [];
        for (const file of Array.from(files)) {
          try {
            const track = await api<Track>(`/manage/games/${game.id}/tracks`, {
              method: "POST",
              body: {
                title: file.name
                  .replace(/\.[^.]+$/, "")
                  .slice(0, config?.policy.text.titleMax),
              },
              csrf: session!.csrf,
            });
            setProgress(0);
            const asset = await uploadFile<Asset>(
              game.id,
              "audio",
              file,
              session!.csrf,
              setProgress,
            );
            await api(`/manage/tracks/${track.id}`, {
              method: "PUT",
              body: {
                draft: { ...track.draft, audioAssetId: asset.id },
                position: track.position,
                version: track.version,
              },
              csrf: session!.csrf,
            });
            results.push(`${file.name}：下書き登録済み`);
          } catch (failure) {
            results.push(
              `${file.name}：失敗（${failure instanceof Error ? failure.message : "再試行してください"}）。作成済みの下書きから音源を再登録できます。`,
            );
          }
          setBatch([...results]);
        }
        setProgress(null);
        await onSaved();
      },
      "一括登録を処理しました。各曲のクレジット・ループ・権利確認後に公開してください。",
    );
  }
  return (
    <>
      <p className="eyebrow">GAME EDITOR</p>
      <h1>{game.draft.title}</h1>
      <p className="status-line">
        {game.suspended
          ? "運営により公開停止中"
          : game.published
            ? "公開版あり"
            : "下書き"}{" "}
        · revision {game.version}
      </p>
      <div className="editor-columns">
        <form className="editor-form" onSubmit={save}>
          <fieldset disabled={task.busy}>
            <Field label="作品名" name="title" error={task.error}>
              <input
                required
                maxLength={config?.policy.text.titleMax}
                value={draft.title}
                onChange={
                  /** @brief 作品名の下書きだけを変更する。 */ (event) =>
                    setDraft({ ...draft, title: event.target.value })
                }
              />
            </Field>
            <Field label="作品紹介" name="description" error={task.error}>
              <textarea
                maxLength={config?.policy.text.descriptionMax}
                value={draft.description}
                onChange={
                  /** @brief 紹介の改行を維持する。 */ (event) =>
                    setDraft({ ...draft, description: event.target.value })
                }
              />
            </Field>
            <Field label="ゲーム紹介URL（任意・HTTPS）">
              <input
                type="url"
                value={draft.externalUrl}
                onChange={
                  /** @brief 任意リンクを保存する。 */ (event) =>
                    setDraft({ ...draft, externalUrl: event.target.value })
                }
              />
            </Field>
            <Field label={`作品画像（${imageUploadHint(config?.policy)}）`}>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={
                  /** @brief 画像を1件ずつ登録する。 */ (event) =>
                    image(event.target.files?.[0])
                }
              />
            </Field>
            <Field
              label="画像の代替テキスト"
              name="imageAlt"
              error={task.error}
            >
              <input
                maxLength={config?.policy.text.imageAltMax}
                value={draft.imageAlt}
                onChange={
                  /** @brief 見えない利用者にも情景を伝える。 */ (event) =>
                    setDraft({ ...draft, imageAlt: event.target.value })
                }
              />
            </Field>
            {draft.imageAssetId && (
              <>
                <small className="asset-id">素材ID: {draft.imageAssetId}</small>
                <button
                  type="button"
                  onClick={
                    /** @brief 素材本体は削除せず下書き参照だけを外す。 */ () =>
                      setDraft({ ...draft, imageAssetId: null })
                  }
                >
                  画像を外す
                </button>
              </>
            )}
            <GameDesignEditor
              value={draft.design}
              onChange={
                /** @brief デザインも公開版から独立した下書きに保持する。 */ (
                  design,
                ) => setDraft({ ...draft, design })
              }
              onUpload={
                /** @brief 背景画像にも通常画像と同じ検証と作品認可を使う。 */ (
                  file,
                ) => image(file, true)
              }
              error={task.error}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={draft.rightsConfirmed}
                onChange={
                  /** @brief 担当者自身の確認として記録する。 */ (event) =>
                    setDraft({
                      ...draft,
                      rightsConfirmed: event.target.checked,
                    })
                }
              />
              画像・文章の公開と広告付きサイトでの利用を確認しました
            </label>
            <button className="primary" disabled={!dirty}>
              下書きを保存
            </button>
          </fieldset>
        </form>
        <div>
          <h2>ページデザインのプレビュー</h2>
          <GameDesignSurface design={draft.design}>
            <h3>{draft.title || "作品名"}</h3>
            <p>
              {draft.description ||
                "背景は作品ページと曲ページに反映されます。"}
            </p>
            <Artwork
              assetId={draft.imageAssetId}
              alt={draft.imageAlt || draft.title}
            />
          </GameDesignSurface>
          <div className="publication">
            <h2>公開</h2>
            <p>保存した内容をまとめて反映します。運営の事前承認は不要です。</p>
            <button
              className="primary"
              disabled={task.busy || dirty || game.suspended}
              onClick={/** @brief 保存後だけ公開できる。 */ () => publish(true)}
            >
              {game.published ? "作品の更新を反映" : "作品を公開"}
            </button>
            <button
              disabled={task.busy || dirty || !game.published}
              onClick={
                /** @brief 新しい一般アクセスを停止する。 */ () =>
                  publish(false)
              }
            >
              作品を非公開にする
            </button>
            {dirty && <p className="hint">先に下書きを保存してください。</p>}
            {config?.publicUrl && <a href={`${config.publicUrl}games/${game.id}`} target="_blank" rel="noreferrer">公開ページを確認 ↗</a>}
          </div>
        </div>
      </div>
      {progress !== null && (
        <p role="status">
          アップロード {progress}% {progress === 100 && "· 素材を検証中…"}
        </p>
      )}
      <TaskNotice task={task} />
      <section>
        <div className="section-heading">
          <h2>収録曲の編集</h2>
          <span>{initial.tracks.length} 曲</span>
        </div>
        <div className="manage-list">
          {initial.tracks.map(
            /** @brief 曲順は数値編集でも操作できる入口を作る。 */ (track) => (
              <Link key={track.id} to={`/manage/tracks/${track.id}`}>
                <strong>
                  {track.position}. {track.draft.title}
                </strong>
                <span>{track.published ? "公開版あり" : "下書き"} →</span>
              </Link>
            ),
          )}
        </div>
        <div className="inline-form">
          <Field label="新しい曲名">
            <input
              value={title}
              maxLength={config?.policy.text.titleMax}
              onChange={
                /** @brief 新曲の初期名を入力する。 */ (event) =>
                  setTitle(event.target.value)
              }
            />
          </Field>
          <button
            disabled={task.busy || !title.trim() || dirty}
            onClick={
              /** @brief 未保存作品を破棄せず曲の下書きを追加する。 */ () => {
                void task.run(
                  async () => /** @brief 追加後の一覧を取得する。 */ {
                    await api(`/manage/games/${game.id}/tracks`, {
                      method: "POST",
                      body: { title },
                      csrf: session!.csrf,
                    });
                    setTitle("");
                    await onSaved();
                  },
                  "曲の下書きを作成しました。",
                );
              }
            }
          >
            曲を追加
          </button>
        </div>
        <Field
          label={`音源をまとめて下書き登録（各${audioUploadHint(config?.policy)}）`}
        >
          <input
            type="file"
            multiple
            accept=".mp3,.wav"
            disabled={task.busy || dirty}
            onChange={
              /** @brief 一括処理は逐次実行へ渡す。 */ (event) =>
                uploadBatch(event.target.files)
            }
          />
        </Field>
        <ul>
          {batch.map(
            /** @brief 部分成功と失敗を明記する。 */ (message, index) => (
              <li key={index}>{message}</li>
            ),
          )}
        </ul>
      </section>
      {session?.principal.admin && (
        <GameOperations
          game={game}
          members={initial.members}
          onSaved={onSaved}
          disabled={dirty}
        />
      )}
    </>
  );
}
/** @brief 担当者割り当てと運営停止を作品単位で実施する。 */
function GameOperations({
  game,
  members,
  onSaved,
  disabled,
}: {
  game: Game;
  members: string[];
  onSaved(): Promise<void>;
  disabled: boolean;
}) {
  const { session, refresh } = useSite();
  const { data } = useRemote<AdminSettings>("/admin/settings");
  const task = useEditorTask();
  const [accountId, setAccountId] = useState("");
  return (
    <section className="admin-panel">
      <h2>作品の運営設定</h2>
      <p>
        GitHub数値アカウントIDを指定して、この作品の編集・公開権限を渡します。担当者の事前ログインは不要です。
      </p>
      <form
        className="inline-form"
        onSubmit={
          /** @brief 未ログインの担当者もGitHub本人IDを検証して割り当てる。 */ (
            event,
          ) => {
            event.preventDefault();
            void task.run(
              async () => /** @brief 付与後に担当一覧を更新する。 */ {
                await api(
                  `/admin/games/${game.id}/members/${accountId.trim()}`,
                  {
                    method: "PUT",
                    body: { enabled: true },
                    csrf: session!.csrf,
                  },
                );
                setAccountId("");
                await onSaved();
              },
              "作品の編集権限を付与しました。",
            );
          }
        }
      >
        <Field label="担当者のGitHub数値ID" name="accountId" error={task.error}>
          <input
            inputMode="numeric"
            pattern="[1-9][0-9]*"
            maxLength={16}
            required
            value={accountId}
            placeholder="例：12345678"
            onChange={
              /** @brief ユーザー名でなく数値IDを入力する。 */ (event) =>
                setAccountId(event.target.value)
            }
          />
        </Field>
        <button
          className="primary"
          disabled={task.busy || disabled || !accountId.trim()}
        >
          編集権限を付与
        </button>
      </form>
      <ul className="account-list">
        {data?.accounts.map(
          /** @brief 現在の所属をサーバーの結果から表示する。 */ (account) => (
            <li key={account.id}>
              <span>
                {account.login} <small>ID {account.id}</small>
              </span>
              <button
                disabled={task.busy || disabled}
                onClick={
                  /** @brief 割り当て・解除を即時適用する。 */ () => {
                    void task.run(
                      async () => /** @brief 運営認可付きAPIで担当を変更する。 */ {
                        await api(
                          `/admin/games/${game.id}/members/${account.id}`,
                          {
                            method: "PUT",
                            body: { enabled: !members.includes(account.id) },
                            csrf: session!.csrf,
                          },
                        );
                        await onSaved();
                      },
                    );
                  }
                }
              >
                {members.includes(account.id) ? "担当を解除" : "担当に割り当て"}
              </button>
            </li>
          ),
        )}
      </ul>
      <button
        disabled={task.busy || disabled}
        className="danger"
        onClick={
          /** @brief 作品全体の公開入口を緊急停止する。 */ () => {
            void task.run(
              async () => /** @brief 停止状態を公開カタログにも反映する。 */ {
                await api(`/admin/games/${game.id}/suspension`, {
                  method: "PUT",
                  body: { suspended: !game.suspended, version: game.version },
                  csrf: session!.csrf,
                });
                await onSaved();
                await refresh();
              },
            );
          }
        }
      >
        {game.suspended ? "運営による停止を解除" : "この作品の公開を緊急停止"}
      </button>
      <TaskNotice task={task} />
    </section>
  );
}
