import { decodeCommand } from "../domain/command-code";

export interface CommandLookup {
  resolve(version: 1, code: string, signal: AbortSignal): Promise<string>;
}
export interface ScanSettings {
  consecutiveFrames: number;
}
export type Recognition =
  { kind: "code"; code: string } | { kind: "none" | "multiple" };
export interface PixelFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
export interface ImageRecognizer {
  recognize(frame: PixelFrame): Recognition;
}

/** @brief 全入力方法で同じ検査・照会・世代管理を使用する */
export class ScanCommand {
  private previous = "";
  private count = 0;
  private controller: AbortController | null = null;
  private completed = false;
  /** @brief HTTPをPortとして注入し、状態遷移をUIなしで試験可能にする */
  constructor(
    private lookup: CommandLookup,
    private settings: ScanSettings,
  ) {}
  /** @brief 離脱・停止時に照会を中断し、遅い応答からの遷移を無効にする */
  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    this.previous = "";
    this.count = 0;
  }
  /** @brief 低確信度フレームも連続一致をリセットする */
  frame(result: Recognition): string | null {
    if (result.kind !== "code") {
      this.previous = "";
      this.count = 0;
      return null;
    }
    decodeCommand(1, result.code);
    this.count = result.code === this.previous ? this.count + 1 : 1;
    this.previous = result.code;
    return this.count >= this.settings.consecutiveFrames ? result.code : null;
  }
  /** @brief CRC通過後だけ一度照会し、安全な曲IDだけを返す再生は操作しない */
  async resolve(code: string): Promise<string | null> {
    decodeCommand(1, code);
    if (this.controller || this.completed) return null;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const id = await this.lookup.resolve(1, code, controller.signal);
      if (controller.signal.aborted || this.controller !== controller)
        return null;
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
          id,
        )
      )
        throw new Error("曲の応答が不正です。");
      this.completed = true;
      return id;
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }
}
