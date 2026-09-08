import type { CommandLookup } from "../../application/scan-command";
/** @brief Cookieなしで同一originのPHPだけを照会する */
export class PhpCommandLookup implements CommandLookup {
  /** @brief basePathと通信上限を結線する */
  constructor(
    private base: string,
    private timeoutMs: number,
  ) {}
  /** @brief 必要最小限の復号コードだけを送る画像の送信経路は持たない */
  async resolve(
    version: 1,
    code: string,
    signal: AbortSignal,
  ): Promise<string> {
    let response: Response;
    try {
      response = await fetch(
        `${this.base}api/public/command-codes/v${version}/${encodeURIComponent(code)}`,
        {
          credentials: "omit",
          cache: "no-store",
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(this.timeoutMs),
          ]),
        },
      );
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error(
        "曲を照会できません。通信状態を確認して再試行してください。",
        {
          cause: error,
        },
      );
    }
    if (response.status === 404)
      throw new Error("曲が見つからないか、現在非公開です。");
    if (!response.ok)
      throw new Error(
        "曲を照会できません。通信状態を確認して再試行してください。",
      );
    try {
      const value = (await response.json()) as { trackId: string };
      return value.trackId;
    } catch (error) {
      throw new Error(
        "照会結果を読み取れません。時間をおいて再試行してください。",
        {
          cause: error,
        },
      );
    }
  }
}
