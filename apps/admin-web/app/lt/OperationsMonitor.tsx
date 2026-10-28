"use client";
import { useEffect, useRef, useState } from "react";
import type { OperationsSnapshot, PushSettings } from "../../lib/lt/monitor-types";

const settingsPath = "/api/lt/notifications";
const reasonNames = { withdrawal: "辞退依頼の確認", vacancy: "空き枠あり・キャンセル待ちの繰り上げ", material: "資料期限超過（未提出・未確認）" };
const statusNames = { ok: "稼働中", disabled: "停止設定", stale: "実行未確認・5分以上の遅延", failed: "直近の処理が失敗" };

/**
 * 認証済みAPIを取得し、失敗時に画面表示用のエラーを返す
 * @param path 同一サイトのAPIパス
 * @param init リクエスト設定
 * @returns APIのJSON応答
 * @throws ログイン切れや通信失敗の場合
 */
async function read<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15000), ...init });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "ログインと運営権限を確認してください" : "状態を取得・保存できませんでした。再試行してください。");
  return response.json() as Promise<T>;
}

/**
 * UTCミリ秒を利用者の現地時刻に変換する
 * @param value 記録された時刻、未実行はnull
 * @returns 画面に表示する時刻
 */
function time(value: number | null | undefined): string {
  return value == null ? "記録なし" : new Date(value).toLocaleString("ja-JP");
}

/**
 * 運営の要対応事項、定期実行の状態と本人の通知設定を表示する
 * @param props 要対応事項から開催回・申請を開く処理
 * @returns 運営監視パネル
 */
export function OperationsMonitor({ onOpen }: { onOpen: (eventId: string, applicationId: string | null) => void }) {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [settings, setSettings] = useState<PushSettings | null>(null);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  /**
   * このブラウザーの購読とサーバー設定を照合する
   * @returns 本人の通知設定
   */
  async function loadSettings(): Promise<PushSettings> {
    const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/lt") : undefined;
    const subscription = await registration?.pushManager.getSubscription();
    return read<PushSettings>(settingsPath + (subscription ? `?endpoint=${encodeURIComponent(subscription.endpoint)}` : ""));
  }

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    /**
     * 重複取得を避けて60秒ごとに最新状態を読む
     * @returns 戻り値なし
     */
    async function refresh() {
      try {
        // 稼働APIの障害中でも、本人が通知を停止できるよう設定は独立して反映する
        const [next, preference] = await Promise.allSettled([read<OperationsSnapshot>("/api/lt/v1/operator/monitor"), loadSettings()]);
        if (active && !lock.current) {
          setSupported("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
          if (next.status === "fulfilled") setSnapshot(next.value);
          if (preference.status === "fulfilled") setSettings(preference.value);
          const failed = next.status === "rejected" ? next : preference.status === "rejected" ? preference : null;
          setError(failed ? failed.reason instanceof Error ? failed.reason.message : "状態を確認できませんでした" : "");
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "状態を確認できませんでした");
      } finally {
        if (active) timer = setTimeout(refresh, 60000);
      }
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, []);

  /**
   * 本人の操作からブラウザー許可を取得し、全端末の受信設定を保存する
   * @param enabled 通知を受け取る場合true、全端末で停止する場合false
   * @returns 戻り値なし
   */
  async function changeNotifications(enabled: boolean) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      if (enabled) {
        if (!settings?.publicKey) throw new Error("通知の配信設定が未完了です");
        // 許可ダイアログはボタン操作時にだけ表示する
        if (await Notification.requestPermission() !== "granted") throw new Error("ブラウザーの通知が許可されていません。サイトの通知設定を確認してください。");
        const registration = await navigator.serviceWorker.register("/lt-notifications.js", { scope: "/lt" });
        if (!registration.active) await new Promise<void>((resolve, reject) => {
          const worker = registration.installing ?? registration.waiting;
          if (!worker) { reject(new Error("通知の準備に失敗しました")); return; }
          worker.addEventListener("statechange", () => { if (worker.state === "activated") resolve(); if (worker.state === "redundant") reject(new Error("通知の準備に失敗しました")); });
        });
        const key = Uint8Array.from(atob(settings.publicKey.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
        const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        await read(settingsPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true, subscription }) });
      } else {
        await read(settingsPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
        const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/lt") : undefined;
        await (await registration?.pushManager.getSubscription())?.unsubscribe();
      }
      setSettings(await loadSettings());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "通知設定を保存できませんでした"); }
    finally { lock.current = false; setBusy(false); }
  }

  return <section id="lt-monitor" className="lt-panel" aria-label="自動運営と通知">
    <h2>自動運営と通知</h2>
    {error && <p role="alert">{error} 最新状態は未確認です。</p>}
    {!snapshot && !error && <p>稼働状況を確認しています…</p>}
    {snapshot && <>
      <p><strong>定期処理：{statusNames[snapshot.maintenance.status]}</strong></p>
      <p>最終成功：{time(snapshot.maintenance.heartbeat.succeededAt)} ／ 最終実行：{time(snapshot.maintenance.heartbeat.startedAt)}</p>
      <p>メール配送：{snapshot.mail.mode === "http" && snapshot.mail.configured ? "有効" : "停止・設定未完了"}{snapshot.mail.testRecipientOnly && "（試験宛先のみ）"} ／ 送信待ち {snapshot.mail.backlog.count} 件</p>
      {snapshot.mail.states.filter(item => ["failed", "uncertain"].includes(item.state)).map(item => <p key={item.state} role="status">{item.state === "failed" ? "送信失敗" : "送信結果不明（再送前に配送結果の確認が必要）"}：{item.count} 件</p>)}
      {snapshot.mail.backlog.oldestAt !== null && snapshot.checkedAt - snapshot.mail.backlog.oldestAt > 900000 && <p role="status">15分以上待機しているメールがあります。</p>}
      <h3>要対応事項（全開催回）</h3>
      {snapshot.items.length ? <ul>{snapshot.items.map(item => <li key={item.key}><button onClick={() => onOpen(item.eventId, item.applicationId)}>{item.title}：{reasonNames[item.reason]}</button></li>)}</ul> : <p>現在、辞退依頼・繰り上げ可能な空き枠・資料期限超過はありません。</p>}
      <p>確認時刻：{time(snapshot.checkedAt)}（60秒ごとに更新）</p>
    </>}
    <h3>自分へのデスクトップ通知</h3>
    <p>受信設定：{settings ? settings.enabled ? "有効" : "無効" : "確認中"} ／ このブラウザー：{settings?.registered ? "登録済み" : "未登録"}</p>
    <p>初期状態は無効です。有効にすると、画面を閉じていても要対応事項の変化を通知します。配信確認は5分ごとです。</p>
    {!supported && <p>このブラウザーはプッシュ通知に対応していません。</p>}
    {settings && !settings.publicKey && <p>サーバーの通知配信設定が未完了です。</p>}
    {supported && <button disabled={busy || !settings?.publicKey || settings.registered && settings.enabled} onClick={() => void changeNotifications(true)}>このブラウザーで通知を有効にする</button>}
    <button disabled={busy || !settings?.enabled} onClick={() => void changeNotifications(false)}>自分の全端末で通知を停止</button>
    {settings?.failures ? <p role="status">通知の配信に失敗した端末が {settings.failures} 件あります。5分後に再試行します。</p> : null}
    <p>通知確認処理：{settings?.status?.outcome === "ok" && (snapshot?.checkedAt ?? Infinity) - (settings.status.checked_at ?? 0) <= 900000 ? "正常" : settings?.status?.outcome === "failed" ? "失敗" : "未稼働・設定未完了"} ／ 最終確認：{time(settings?.status?.checked_at)}</p>
  </section>;
}
