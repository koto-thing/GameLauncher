import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Recognition } from "../../application/scan-command";
import type { ScanCommand } from "../../application/scan-command";
import { CommandManual } from "./command-manual";

export interface ScanDevice {
  start(video: HTMLVideoElement): Promise<boolean>;
  stop(): void;
  video(video: HTMLVideoElement): Recognition;
  image(file: File): Promise<Recognition>;
}

/** @brief 入力方法を切り替えても同じ照会Use Caseへ接続する */
export function CommandScan({
  createScan,
  loadDevice,
  intervalMs,
}: {
  createScan: () => ScanCommand;
  loadDevice: () => Promise<ScanDevice>;
  intervalMs: number;
}) {
  const navigate = useNavigate(),
    [mode, setMode] = useState<"camera" | "image" | "manual">("manual"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [running, setRunning] = useState(false);
  const [scan] = useState(createScan),
    device = useRef<ScanDevice | null>(null),
    video = useRef<HTMLVideoElement>(null),
    generation = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    locked = useRef(false);
  /** @brief 許可待ち・読み取り中・照会中を同時に取り消す */
  const stop = useCallback(
    /** @brief 同じ停止関数をeffectと操作の両方で共有する */ () => {
      generation.current++;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      device.current?.stop();
      scan.cancel();
      locked.current = false;
    },
    [scan],
  );
  useEffect(
    /** @brief ページ非表示では停止し、自動再開しない */ () => {
      /** @brief タブが隠れたらカメラの使用を終了する */
      function visibility() {
        if (document.hidden) {
          stop();
          setRunning(false);
          setBusy(false);
          setMessage(
            "読み取りを停止しました。再開するにはボタンを押してください。",
          );
        }
      }
      document.addEventListener("visibilitychange", visibility);
      return /** @brief 離脱時の遅延応答も無効にする */ () => {
        stop();
        document.removeEventListener("visibilitychange", visibility);
      };
      // この画面のscanと参照はマウント中に変化しない
    },
    [stop],
  );
  /** @brief 成功した照会だけで一度遷移するカメラ由来URLは使用しない */
  async function submit(code: string) {
    const token = generation.current;
    setBusy(true);
    try {
      const id = await scan.resolve(code);
      if (id && token === generation.current) {
        stop();
        navigate(`/tracks/${encodeURIComponent(id)}`);
      }
    } catch (e) {
      if (token === generation.current) {
        stop();
        setRunning(false);
        setBusy(false);
        setMessage(e instanceof Error ? e.message : "照会に失敗しました。");
      }
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  /** @brief 遅延ロード中にもキャンセルでき、古い読み取りを再開しない */
  async function getDevice(token: number) {
    const value = device.current ?? (await loadDevice());
    if (token !== generation.current) {
      value.stop();
      return null;
    }
    device.current = value;
    return value;
  }
  /** @brief 200ms間隔で処理し、処理中の次フレームを積み上げない */
  function frame(token: number) {
    if (token !== generation.current || !video.current || !device.current)
      return;
    try {
      const result = device.current.video(video.current);
      const code = scan.frame(result);
      if (code) {
        setMessage("曲を確認しています…");
        void submit(code);
        return;
      }
      setMessage(
        result.kind === "multiple"
          ? "コードを1つだけ画面に入れてください。"
          : "四隅の枠全体を明るく、正面に近づけて映してください。",
      );
    } catch {
      setMessage("映像を読み取れません。位置を調整してください。");
    }
    timer.current = setTimeout(
      /** @brief 完了したフレームの後でだけ次を予約する */ () => frame(token),
      intervalMs,
    );
  }
  /** @brief 許可要求はこの利用者操作だけから実行する */
  async function start() {
    if (locked.current) return;
    stop();
    locked.current = true;
    const token = generation.current;
    setRunning(true);
    setMessage(
      "カメラの許可を待っています。停止して他の入力方法にも切り替えられます。",
    );
    try {
      const d = await getDevice(token);
      if (
        d &&
        video.current &&
        (await d.start(video.current)) &&
        token === generation.current
      )
        frame(token);
    } catch (e) {
      if (token === generation.current) {
        stop();
        setRunning(false);
        setMessage((e as Error).message);
      }
    }
  }
  /** @brief 選択画像を送信せず画素認識し、静止画には3連続条件を課さない */
  async function image(file: File) {
    stop();
    const token = generation.current;
    setBusy(true);
    setMessage("画像を端末内で読み取っています…");
    try {
      const d = await getDevice(token);
      if (!d) return;
      const result = await d.image(file);
      if (token !== generation.current) return;
      if (result.kind === "code") await submit(result.code);
      else
        setMessage(
          result.kind === "multiple"
            ? "コードが複数あります。1つに切り取ってください。"
            : "読み取れません。枠・四隅・12記号が鮮明な画像を選んでください。",
        );
    } catch (e) {
      if (token === generation.current) setMessage((e as Error).message);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  return (
    <section className="command-scan">
      <p className="eyebrow">PANDD COMMAND CODE · v1</p>
      <h1>コードを読み取る</h1>
      <p>画像は端末内で処理し、サーバーには送信しません。</p>
      <div className="command-actions" aria-label="読み取り方法">
        {(
          [
            ["camera", "カメラ"],
            ["image", "画像を選ぶ"],
            ["manual", "コマンド入力"],
          ] as const
        ).map(
          /** @brief 入力方法を変更する前にすべて停止する */ ([
            key,
            label,
          ]) => (
            <button
              key={key}
              aria-pressed={mode === key}
              onClick={
                /** @brief 手動で選ばれた方法だけを表示する */ () => {
                  stop();
                  setMode(key);
                  setMessage("");
                  setRunning(false);
                  setBusy(false);
                }
              }
            >
              {label}
            </button>
          ),
        )}
      </div>
      {mode === "manual" && (
        <CommandManual
          submit={
            /** @brief 共通照会へ入力を渡す */ (code) => void submit(code)
          }
          busy={busy}
        />
      )}
      {mode === "image" && (
        <label className="command-file">
          JPEG / PNG / WebP（10MiB・20MP以下）
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={
              /** @brief ファイル名ではなく画像内容を読み取る */ (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void image(file);
              }
            }
          />
        </label>
      )}
      {mode === "camera" && (
        <div>
          <video className="command-video" ref={video} playsInline muted />
          <div className="command-actions">
            <button
              disabled={running}
              onClick={/** @brief 二重起動を拒否する */ () => void start()}
            >
              カメラを起動
            </button>
            <button
              onClick={
                /** @brief 許可待ちも停止できる */ () => {
                  stop();
                  setRunning(false);
                  setBusy(false);
                  setMessage("カメラを停止しました。");
                }
              }
            >
              停止・キャンセル
            </button>
          </div>
        </div>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
