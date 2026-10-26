import type { EmailChangeStatus } from "../../../../contracts/lt/v1.ts";
export type EmailTransport = (action: string, body?: unknown) => Promise<EmailChangeStatus>;

/** @brief メール変更の操作順序と再試行の同一性を管理する */
export class EmailChangeFlow {
  current: EmailChangeStatus = null;
  pending: {
    action: string;
    body: { expectedVersion: number; operationId: string; data: Record<string, unknown> };
  } | null = null;
  busy = false;
  blocked = false;
  applicationVersion: number;
  readonly transport: EmailTransport;
  /**
   * 申請バージョンと通信処理を保持する
   *
   * @param applicationVersion 現在の申請バージョン
   * @param transport メール変更 API を呼び出す関数
   * @returns EmailChangeFlow のインスタンス
   */
  constructor(applicationVersion: number, transport: EmailTransport) {
    this.applicationVersion = applicationVersion;
    this.transport = transport;
  }

  private refreshing: Promise<void> | null = null;

  /**
   * 現在のメール変更要求を再取得し、古い操作の再利用を止める
   *
   * @returns 状態の再取得が完了した時点で解決する Promise
   */
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    if (this.busy) return Promise.reject(new Error("処理中の操作結果を先に確認してください"));
    this.busy = true;
    this.refreshing = (async () => {
      try {
        const value = await this.transport("");
        if (
          this.pending &&
          (value?.id !== this.current?.id ||
            value?.version !== this.current?.version ||
            value?.applicationVersion !== this.applicationVersion)
        )
          this.pending = null;
        this.current = value;
        if (value) this.applicationVersion = value.applicationVersion;
        this.blocked = false;
      } finally {
        this.busy = false;
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  /**
   * 操作を固定し、通信結果不明の再送には同じ操作 ID を使う
   *
   * @param action 実行するメール変更操作
   * @param data 本人確認記録の作成に渡す入力
   * @returns 処理終了時に解決する Promise、処理中の重複呼出は何もしない
   */
  async act(action: string, data: Record<string, unknown> = {}): Promise<void> {
    if (this.busy) return;
    if (this.blocked) throw new Error("再読込して現在の状態を確認してください");
    if (this.pending && this.pending.action !== action)
      throw new Error("結果不明の操作を再試行するか、再読込してください");

    // 結果不明の再送では本文と操作 ID を変えず、新規操作だけを組み立てる
    if (!this.pending) {
      if (action === "confirm" && this.current?.state !== "verified")
        throw new Error("新アドレスの確認が必要です");
      if (action !== "investigate" && !this.current) throw new Error("本人確認記録が必要です");
      this.pending = {
        action,
        body: {
          expectedVersion: this.applicationVersion,
          operationId: crypto.randomUUID(),
          data:
            action === "investigate"
              ? { ...data }
              : { requestId: this.current!.id, expectedRequestVersion: this.current!.version },
        },
      };
    }
    this.busy = true;
    try {
      const value = await this.transport(this.pending.action, this.pending.body);
      this.current = value;
      if (value) this.applicationVersion = value.applicationVersion;
      this.pending = null;
    } catch (error) {
      // 契約上の拒否なら操作を破棄し、通信障害なら同一操作で再試行可能にする
      const status = (error as { status?: number }).status;
      if (status && status >= 400 && status < 500) {
        this.pending = null;
        this.blocked = [401, 403, 409].includes(status);
      }
      throw error;
    } finally {
      this.busy = false;
    }
  }
}
