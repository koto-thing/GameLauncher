import { useState, useSyncExternalStore, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { Asset, PublicTrack, Track } from "../../domain/models";
import { createLoopRegion, trackContent } from "../../domain/rules";
import { PLAYER_RUNTIME_DEFAULTS } from "../../config/player-runtime.defaults";
import { useSite } from "./context";
import { api, uploadFile } from "./api-client";
import { Artwork, PlayerControls } from "./components";
import {
  audioUploadHint,
  imageUploadHint,
  Field,
  TaskNotice,
  useEditorTask,
  useRemote,
  useUnsaved,
} from "./editor-common";

interface TrackData {
  track: Track;
  audio: PublicTrack | null;
}
/** @brief 曲URLを認可された管理データへ解決する。 */
export function TrackEditorPage() {
  const { id } = useParams();
  const remote = useRemote<TrackData>(`/manage/tracks/${id}`);
  return (
    <>
      {remote.error && (
        <p role="alert" className="error">
          {remote.error}
        </p>
      )}
      {remote.data ? (
        <TrackEditor
          key={`${id}:${remote.data.track.version}`}
          initial={remote.data}
          onSaved={remote.reload}
        />
      ) : (
        !remote.error && <p role="status">曲を読み込み中…</p>
      )}
    </>
  );
}
/** @brief 下書き保存・ループ微調整・公開反映を同じ作品権限で操作する。 */
function TrackEditor({
  initial,
  onSaved,
}: {
  initial: TrackData;
  onSaved(): Promise<void>;
}) {
  const { player, config, session, refresh } = useSite();
  const state = useSyncExternalStore(player.subscribe, player.snapshot);
  const track = initial.track;
  const [draft, setDraft] = useState(track.draft);
  const [position, setPosition] = useState(track.position);
  const [audio, setAudio] = useState(initial.audio);
  const [progress, setProgress] = useState<number | null>(null);
  const task = useEditorTask();
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(track.draft) ||
    position !== track.position;
  useUnsaved(dirty);
  const pcmBytes = audio
    ? audio.durationSeconds *
      PLAYER_RUNTIME_DEFAULTS.decodeSampleRateHz *
      audio.channels *
      4
    : 0;
  const overBudget = pcmBytes > PLAYER_RUNTIME_DEFAULTS.decodedAudioBudgetBytes;
  /** @brief 現在の入力を共有Domainルールと検証済み音源長で確認する。 */
  function previewData(): PublicTrack {
    if (!audio || !config) throw new Error("先に音源を登録してください。");
    const content = trackContent(draft, config.policy);
    if (content.loop)
      createLoopRegion(
        content.loop.startSeconds,
        content.loop.endSeconds,
        audio.durationSeconds,
        config.policy.loop.minimumLengthSeconds,
      );
    return {
      ...audio,
      ...content,
      id: track.id,
      gameId: track.gameId,
      position,
    };
  }
  /** @brief 不正ループをUIでも検出したうえでAPIの再検証へ送る。 */
  function save(event: FormEvent): void {
    event.preventDefault();
    void task.run(async () => /** @brief 保存だけでは公開版に触れない。 */ {
      if (audio) previewData();
      await api(`/manage/tracks/${track.id}`, {
        method: "PUT",
        body: { draft, position, version: track.version },
        csrf: session!.csrf,
      });
      await onSaved();
    }, "下書きを保存しました。公開中の内容は「更新を反映」で切り替わります。");
  }
  /** @brief 画像と音源を逐次登録し、音源差し替え時には旧ループを解除する。 */
  function upload(kind: "audio" | "image", file?: File): void {
    if (!file) return;
    void task.run(
      async () => /** @brief 進捗の後に検証されたメタデータだけを採用する。 */ {
        setProgress(0);
        const asset = await uploadFile<Asset>(
          track.gameId,
          kind,
          file,
          session!.csrf,
          setProgress,
        );
        setProgress(null);
        if (kind === "image")
          setDraft({
            ...draft,
            imageAssetId: asset.id,
            rightsConfirmed: false,
          });
        else {
          const content = {
            ...draft,
            audioAssetId: asset.id,
            loop: null,
            rightsConfirmed: false,
          };
          setDraft(content);
          setAudio({
            ...content,
            id: track.id,
            gameId: track.gameId,
            position,
            durationSeconds: asset.durationSeconds!,
            sampleRateHz: asset.sampleRateHz!,
            channels: asset.channels!,
            audioBytes: asset.bytes,
          });
        }
      },
      kind === "audio"
        ? "音源を登録しました。先に下書きを保存し、その後ループを設定・試聴してください。"
        : "画像を登録しました。代替テキストを入力して保存してください。",
    );
  }
  /** @brief 未保存入力を混ぜず保存済みリビジョンを公開する。 */
  function publish(value: boolean): void {
    void task.run(
      async () => /** @brief 担当者本人の操作で公開版を原子的に切り替える。 */ {
        await api(`/manage/tracks/${track.id}/publication`, {
          method: "POST",
          body: { publish: value, version: track.version },
          csrf: session!.csrf,
        });
        await onSaved();
        await refresh();
      },
      value
        ? "曲の公開版を反映しました。作品も公開すると一般に聴けます。"
        : "曲を非公開にしました。",
    );
  }
  return (
    <>
      <Link className="back-link" to={`/manage/games/${track.gameId}`}>
        ← 作品の編集
      </Link>
      <p className="eyebrow">TRACK EDITOR</p>
      <h1>{track.draft.title}</h1>
      <p className="status-line">
        {track.published ? "公開版あり / 編集内容は下書きに保存" : "下書き"} ·
        revision {track.version}
      </p>
      <div className="editor-columns">
        <form onSubmit={save} className="editor-form">
          <fieldset disabled={task.busy}>
            <Field label="曲名" name="title" error={task.error}>
              <input
                required
                maxLength={config?.policy.text.titleMax}
                value={draft.title}
                onChange={
                  /** @brief 公開版とは別の入力状態を更新する。 */ (event) =>
                    setDraft({ ...draft, title: event.target.value })
                }
              />
            </Field>
            <Field
              label="曲順（同じ番号はID順、公開反映時に適用）"
              name="position"
              error={task.error}
            >
              <input
                type="number"
                min="1"
                step="1"
                value={position}
                onChange={
                  /** @brief ドラッグに依存せず曲順を変更する。 */ (event) =>
                    setPosition(Number(event.target.value))
                }
              />
            </Field>
            <div className="field">
              <span>クレジット（公開名・役割）</span>
              {draft.credits.map(
                /** @brief 複数人のクレジットをログインアカウントから独立して編集する。 */ (
                  credit,
                  index,
                ) => (
                  <div className="credit-row" key={index}>
                    <input
                      aria-label={`クレジット${index + 1}の公開名`}
                      placeholder="公開名"
                      required
                      value={credit.name}
                      onChange={
                        /** @brief 指定したクレジットの名前だけを変更する。 */ (
                          event,
                        ) =>
                          setDraft({
                            ...draft,
                            credits: draft.credits.map(
                              /** @brief 他の担当者名を維持する。 */ (
                                item,
                                at,
                              ) =>
                                at === index
                                  ? { ...item, name: event.target.value }
                                  : item,
                            ),
                          })
                      }
                    />
                    <input
                      aria-label={`クレジット${index + 1}の役割`}
                      placeholder="作曲 / 編曲"
                      required
                      value={credit.role}
                      onChange={
                        /** @brief 役割を自由な公開テキストとして記録する。 */ (
                          event,
                        ) =>
                          setDraft({
                            ...draft,
                            credits: draft.credits.map(
                              /** @brief 対象行の役割だけを更新する。 */ (
                                item,
                                at,
                              ) =>
                                at === index
                                  ? { ...item, role: event.target.value }
                                  : item,
                            ),
                          })
                      }
                    />
                    <button
                      type="button"
                      aria-label={`クレジット${index + 1}を削除`}
                      onClick={
                        /** @brief 下書きのクレジット行を外す。 */ () =>
                          setDraft({
                            ...draft,
                            credits: draft.credits.filter(
                              /** @brief 指定行以外を残す。 */ (_, at) =>
                                at !== index,
                            ),
                          })
                      }
                    >
                      ×
                    </button>
                  </div>
                ),
              )}
              <button
                type="button"
                disabled={
                  draft.credits.length >= (config?.policy.text.creditMax ?? 0)
                }
                onClick={
                  /** @brief 最大人数内で公開名を追加する。 */ () =>
                    setDraft({
                      ...draft,
                      credits: [...draft.credits, { name: "", role: "作曲" }],
                    })
                }
              >
                クレジットを追加
              </button>
              {task.error?.field === "credits" && (
                <span className="error">{task.error.message}</span>
              )}
            </div>
            <Field label="制作コメント" name="comment" error={task.error}>
              <textarea
                maxLength={config?.policy.text.descriptionMax}
                value={draft.comment}
                onChange={
                  /** @brief 改行を含む制作コメントを記録する。 */ (event) =>
                    setDraft({ ...draft, comment: event.target.value })
                }
              />
            </Field>
            <Field
              label={`音源（${audioUploadHint(config?.policy)}）`}
              name="audioAssetId"
              error={task.error}
            >
              <input
                type="file"
                accept=".mp3,.wav"
                onChange={
                  /** @brief 送信と検証を別状態で表示する。 */ (event) =>
                    upload("audio", event.target.files?.[0])
                }
              />
            </Field>
            {audio && (
              <p className="hint">
                {audio.durationSeconds.toFixed(3)}秒 / {audio.sampleRateHz}Hz /{" "}
                {audio.channels}ch · 推定PCM{" "}
                {(pcmBytes / 1024 / 1024).toFixed(1)}MiB（作業バッファ別）
              </p>
            )}
            <Field label={`曲の代表画像（${imageUploadHint(config?.policy)}）`}>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={
                  /** @brief 曲固有画像を作品画像と別に登録する。 */ (event) =>
                    upload("image", event.target.files?.[0])
                }
              />
            </Field>
            <Field
              label="代表画像の代替テキスト"
              name="imageAlt"
              error={task.error}
            >
              <input
                value={draft.imageAlt}
                maxLength={config?.policy.text.imageAltMax}
                onChange={
                  /** @brief 曲の情景をテキストでも伝える。 */ (event) =>
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
                    /** @brief 共有素材は削除せず下書きから外す。 */ () =>
                      setDraft({ ...draft, imageAssetId: null })
                  }
                >
                  曲画像を外す
                </button>
              </>
            )}
            <section className="loop-editor">
              <h2>ゲーム内ループ</h2>
              <label className="check">
                <input
                  type="checkbox"
                  checked={Boolean(draft.loop)}
                  disabled={
                    !audio ||
                    overBudget ||
                    draft.audioAssetId !== track.draft.audioAssetId
                  }
                  onChange={
                    /** @brief 音源差し替え後は一度保存してから区間を設定する。 */ (
                      event,
                    ) =>
                      setDraft({
                        ...draft,
                        loop: event.target.checked
                          ? {
                              startSeconds: 0,
                              endSeconds: audio!.durationSeconds,
                            }
                          : null,
                      })
                  }
                />
                この音源の区間ループを有効にする
              </label>
              {overBudget && (
                <p className="notice">
                  PCM予算を超えるため通常再生のみを選んでください。区間ループには短い音源への差し替えが必要です。
                </p>
              )}
              {draft.audioAssetId !== track.draft.audioAssetId && (
                <p className="hint">
                  音源を差し替えました。先に下書きを保存し、ループを再設定・試聴してください。
                </p>
              )}
              {draft.loop && (
                <>
                  <div className="two-fields">
                    <Field label="開始位置（秒）">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={draft.loop.startSeconds}
                        onChange={
                          /** @brief 小数精度を保ったまま開始秒を編集する。 */ (
                            event,
                          ) =>
                            setDraft({
                              ...draft,
                              loop: {
                                ...draft.loop!,
                                startSeconds: Number(event.target.value),
                              },
                            })
                        }
                      />
                    </Field>
                    <Field label="終了位置（秒）">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={draft.loop.endSeconds}
                        onChange={
                          /** @brief 小数精度を保ったまま終了秒を編集する。 */ (
                            event,
                          ) =>
                            setDraft({
                              ...draft,
                              loop: {
                                ...draft.loop!,
                                endSeconds: Number(event.target.value),
                              },
                            })
                        }
                      />
                    </Field>
                  </div>
                  <div className="button-row">
                    <button
                      type="button"
                      disabled={state.track?.id !== track.id}
                      onClick={
                        /** @brief 実際の音声クロック位置を開始値にする。 */ () =>
                          setDraft({
                            ...draft,
                            loop: {
                              ...draft.loop!,
                              startSeconds: state.positionSeconds,
                            },
                          })
                      }
                    >
                      現在位置を開始にする
                    </button>
                    <button
                      type="button"
                      disabled={state.track?.id !== track.id}
                      onClick={
                        /** @brief 実際の音声クロック位置を終了値にする。 */ () =>
                          setDraft({
                            ...draft,
                            loop: {
                              ...draft.loop!,
                              endSeconds: state.positionSeconds,
                            },
                          })
                      }
                    >
                      現在位置を終了にする
                    </button>
                    <button
                      type="button"
                      onClick={
                        /** @brief 通常プレーヤーを置き換え、二重再生なしで継ぎ目を確認する。 */ () => {
                          void task.run(
                            async () => /** @brief 保存前のループ境界もDomainで検証する。 */ {
                              await player.preview(
                                previewData(),
                                PLAYER_RUNTIME_DEFAULTS.loopPreviewLeadInSeconds,
                              );
                            },
                            "終了地点の少し前から区間ループを試聴しています。",
                          );
                        }
                      }
                    >
                      つなぎ目を試聴
                    </button>
                  </div>
                  {task.error?.field === "loop" && (
                    <p className="error">{task.error.message}</p>
                  )}
                </>
              )}
            </section>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.rightsConfirmed}
                onChange={
                  /** @brief 公開と広告付きサイト利用について投稿者の確認を記録する。 */ (
                    event,
                  ) =>
                    setDraft({
                      ...draft,
                      rightsConfirmed: event.target.checked,
                    })
                }
              />
              音源・画像・クレジットの公開と、広告掲載のあるサイトでの利用に必要な確認を行いました
            </label>
            <button className="primary" disabled={!dirty}>
              下書きを保存
            </button>
          </fieldset>
        </form>
        <div className="preview-panel">
          <Artwork
            assetId={draft.imageAssetId}
            alt={draft.imageAlt || draft.title}
          />
          <h2>下書きプレビュー</h2>
          <p>公開前の音源も、現在の担当者だけが試聴できます。</p>
          <button
            disabled={task.busy || !audio}
            onClick={
              /** @brief 通常プレーヤーと同じインスタンスで試聴する。 */ () => {
                void task.run(
                  async () => /** @brief 現在の入力で再生を始める。 */ {
                    const value = previewData();
                    await player.start(value, [value]);
                  },
                  "下書きを試聴しています。",
                );
              }
            }
          >
            ▶ 下書きを試聴
          </button>
          {audio && state.track?.id === track.id && (
            <PlayerControls
              track={{ ...audio, ...draft }}
              queue={[{ ...audio, ...draft }]}
            />
          )}
          <div className="publication">
            <h2>公開版への反映</h2>
            <p>
              保存済みの音源・画像・クレジット・ループを一度に切り替えます。
            </p>
            <button
              className="primary"
              disabled={task.busy || dirty}
              onClick={
                /** @brief 担当者の判断で公開する。 */ () => publish(true)
              }
            >
              {track.published ? "更新を反映する" : "この曲を公開する"}
            </button>
            <button
              disabled={task.busy || dirty || !track.published}
              onClick={
                /** @brief 新しい音源・画像アクセスを止める。 */ () =>
                  publish(false)
              }
            >
              この曲を非公開にする
            </button>
            {dirty && (
              <p className="hint">公開の前に下書きを保存してください。</p>
            )}
            <Link to={`/tracks/${track.id}`}>公開ページを確認 ↗</Link>
          </div>
        </div>
      </div>
      {progress !== null && (
        <p role="status">
          アップロード {progress}%{" "}
          {progress === 100 && "· サーバーで素材を検証中…"}
        </p>
      )}
      <TaskNotice task={task} />
    </>
  );
}
