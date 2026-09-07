import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CommandCode } from "../../../../../contracts/music/command-code-v1";
import { commandSvg } from "../../domain/command-art";
import { displayCommand, encodeCommand } from "../../domain/command-code";
import { api } from "./api-client";
import { useRemote } from "./editor-common";
import { useSite } from "./context";

/** @brief 管理者が予約を確認・発行し、編集画面を含めず曲名付きで印刷する */
export function CommandManager({
  trackId,
  gameId,
  title,
}: {
  trackId: string;
  gameId: string;
  title: string;
}) {
  const { session, config } = useSite();
  const remote = useRemote<CommandCode | null>(
    `/manage/tracks/${trackId}/command-code`,
  );
  const [issued, setIssued] = useState<CommandCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const printImage = useRef<HTMLImageElement>(null);
  const assignment = issued ?? remote.data;
  const code = assignment
    ? displayCommand(encodeCommand(assignment.codeId))
    : "";
  const image = assignment
    ? `data:image/svg+xml,${encodeURIComponent(commandSvg(assignment.codeId))}`
    : "";
  const publicUrl = config?.publicUrl
    ? `${config.publicUrl}tracks/${trackId}`
    : "";

  /** @brief 永久予約だけを作り、下書きや公開内容は変更しない */
  async function issue() {
    setBusy(true);
    setMessage("");
    try {
      setIssued(
        await api<CommandCode>(`/manage/tracks/${trackId}/command-code`, {
          method: "POST",
          body: {},
          csrf: session!.csrf,
        }),
      );
      setMessage(
        "コードを発行しました。公開版への反映後に読み取れるようになります。",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "コードを発行できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }

  /** @brief 保存前の編集内容を公開せず、作品の公開済み曲へコードだけを反映する */
  async function sync() {
    setBusy(true);
    setMessage("");
    try {
      await api(`/manage/games/${gameId}/command-codes`, {
        method: "POST",
        body: { dryRun: false },
        csrf: session!.csrf,
      });
      setMessage(
        "作品の公開済み曲へコードを反映しました。非公開の曲は公開されません。",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "コードを反映できませんでした。",
      );
    } finally {
      setBusy(false);
    }
  }

  /** @brief SVGの描画完了を待ち、空白のコードを印刷しない */
  async function print() {
    setBusy(true);
    setMessage("");
    try {
      await printImage.current?.decode();
      window.print();
    } catch {
      setMessage("印刷を開始できませんでした。再試行してください。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="command-manager" aria-label="コマンドコード管理">
      <h2>コマンドコード</h2>
      <p>
        曲の案内や掲示用に、コードを確認・印刷できます。同じ曲には同じコードを使います。
      </p>
      {remote.error && (
        <>
          <p role="alert" className="error">
            {remote.error}
          </p>
          <button
            type="button"
            onClick={
              /** @brief 一時的な通信失敗から読み直す */ () =>
                void remote.reload()
            }
          >
            コード確認を再試行
          </button>
        </>
      )}
      {assignment ? (
        <>
          <img
            className="command-image"
            src={image}
            alt={`コマンドコード ${code}`}
          />
          <p className="command-text">{code}</p>
          <button
            type="button"
            disabled={busy}
            onClick={
              /** @brief 曲名とコードだけの印刷ダイアログを開く */ () =>
                void print()
            }
          >
            曲名付きで印刷
          </button>
          <p className="hint">
            印刷ダイアログからPDF保存もできます。公開版への反映前や、曲・作品の非公開中は読み取っても曲を開けません。
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={
              /** @brief 作品内の公開済み曲に限定してコードを同期する */ () =>
                void sync()
            }
          >
            作品の公開済み曲へコードだけ反映
          </button>
          <p className="hint">
            この作品の公開済み曲が対象です。編集中の下書きは公開しません。
          </p>
          {publicUrl && (
            <a href={publicUrl} target="_blank" rel="noreferrer">
              公開ページで確認 ↗
            </a>
          )}
          {createPortal(
            <article className="command-print-sheet" aria-hidden="true">
              <p>PandD Music</p>
              <h1>{title}</h1>
              <img ref={printImage} src={image} alt="" />
              <p className="command-text">{code}</p>
              <p>
                PandD
                Musicの「コードを読み取る」で、カメラ・画像・手入力から開けます。
              </p>
              {publicUrl && <p className="command-print-url">{publicUrl}</p>}
            </article>,
            document.body,
          )}
        </>
      ) : remote.loaded ? (
        <>
          <p>コードは未発行です。発行しても曲は公開されません。</p>
          <button
            type="button"
            disabled={busy || !!remote.error}
            onClick={
              /** @brief 明示操作時にだけ予約を発行する */ () => void issue()
            }
          >
            コマンドコードを発行
          </button>
        </>
      ) : (
        !remote.error && <p role="status">コードを確認中…</p>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
