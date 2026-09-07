/**
 * @brief 背景動画をメディアイベント・動きの設定・ページ表示状態へ結び付ける
 * @param video 制御する背景動画要素
 * @returns 購読と再生を停止する後片付け関数
 * @remarks 動きの設定を確認するまでsrcへ移さず、失敗時はポスターを維持する
 */
export function setupVideo(video: HTMLVideoElement): () => void {
  const source = video.dataset.src;

  if (!source) return /** @brief 動画URLがない場合は副作用を登録しない */ () => {};

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const subscriptions = new AbortController();
  const options = { signal: subscriptions.signal };
  let wanted = false;
  let resumeOnVisible = false;
  let failed = false;
  let request = 0;

  /** @brief 保留中の再生要求を無効化し、現在位置を保ったまま停止する */
  function pause(): void {
    request++;
    video.autoplay = false;
    video.pause();
  }

  /** @brief 回復不能な動画失敗後も独立したポスターを表示し続ける */
  function fail(): void {
    if (failed) return;

    failed = true;
    wanted = false;
    resumeOnVisible = false;
    pause();

    // 失敗したsrcを残すと遅延イベントがポスター表示を壊すため、要素から切り離す
    video.classList.remove("has-frame");
    video.removeAttribute("src");
    video.load();
  }

  /** @brief 背景動画を再生または再開し、自動再生拒否時はポスターを残す */
  async function play(): Promise<void> {
    if (failed || document.hidden) return;

    wanted = true;
    const currentRequest = ++request;
    video.muted = true;

    // 動きの設定確認後にだけsrcを設定し、不要なメディア取得を避ける
    if (!video.getAttribute("src")) video.src = source!;

    try {
      await video.play();
    } catch (error) {
      // 停止・設定変更・新しい要求が後から来た場合は、古い失敗結果で状態を戻さない
      if (currentRequest !== request || failed) return;

      if (error instanceof DOMException && error.name === "NotSupportedError") {
        fail();
        return;
      }

      // 自動再生拒否はページを壊さず、静止ポスターだけを残す
      wanted = false;
      pause();
      video.classList.remove("has-frame");
    }
  }

  video.addEventListener("playing", /** @brief 実際に描画できた時だけ動画のフレームを表示する */ () => {
    // 遅れて届いたメディアイベントで停止済み・非表示の動画を復活させない
    if (!wanted || document.hidden) { pause(); return; }
    video.classList.add("has-frame");
  }, options);

  video.addEventListener("error", fail, options);
  document.addEventListener("visibilitychange", /** @brief ページ表示状態に合わせて再生要求を保存・再開する */ () => {
    if (document.hidden) {
      resumeOnVisible = wanted && !video.paused && video.classList.contains("has-frame");
      wanted = false;
      pause();
    } else if (resumeOnVisible) {
      resumeOnVisible = false;
      void play();
    }
  }, options);

  motion.addEventListener("change", /** @brief 動きを減らす設定へ変わったら動画取得と表示を止める */ () => {
    if (motion.matches) {
      wanted = false;
      resumeOnVisible = false;
      pause();
      video.classList.remove("has-frame");
    }
  }, options);

  if (!motion.matches && !document.hidden) {
    video.autoplay = true;
    void play();
  }

  return /** @brief 登録した購読と保留中の再生をすべて終了する */ () => {
    subscriptions.abort();
    pause();
  };
}
