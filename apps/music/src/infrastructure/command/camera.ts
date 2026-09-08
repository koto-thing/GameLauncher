/** @brief 利用者操作で開始したカメラの所有権と遅い許可応答を管理する */
export class CommandCamera {
  private generation = 0;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  /** @brief 全trackと映像参照を必ず解放する許可待ちも世代を無効にする */
  stop(): void {
    this.generation++;
    this.stream
      ?.getTracks()
      .forEach(/** @brief 音声trackを含め全資源を停止する */ (t) => t.stop());
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      this.video = null;
    }
  }
  /** @brief HTTPSとAPIを確認し、背面カメラを理想値として要求する */
  async start(video: HTMLVideoElement): Promise<boolean> {
    this.stop();
    const generation = this.generation;
    if (!window.isSecureContext)
      throw new Error(
        "カメラにはHTTPS接続が必要です。画像選択か手入力も利用できます。",
      );
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "このブラウザーはカメラに対応していません。画像選択か手入力を利用してください。",
      );
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      if (generation !== this.generation) {
        stream
          .getTracks()
          .forEach(
            /** @brief キャンセル後に許可されたstreamも即停止する */ (t) =>
              t.stop(),
          );
        return false;
      }
      this.stream = stream;
      this.video = video;
      video.srcObject = stream;
      await video.play();
      return generation === this.generation;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.stop();
      const name = error instanceof Error ? error.name : "";
      const messages: Record<string, string> = {
        NotAllowedError:
          "カメラの許可が拒否されました。ブラウザーの設定を確認してください。",
        NotFoundError: "利用できるカメラが見つかりません。",
        NotReadableError:
          "カメラを開始できません。他のアプリで使用中でないか確認してください。",
        OverconstrainedError:
          "このカメラでは撮影条件を満たせません。画像選択か手入力を利用してください。",
        AbortError: "カメラの起動が中断されました。",
      };
      throw new Error(
        messages[name] ??
          "カメラ映像を再生できません。画像選択か手入力を利用してください。",
        { cause: error },
      );
    }
  }
}
