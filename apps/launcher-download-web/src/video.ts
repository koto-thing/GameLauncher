/**
 * Bind decorative video playback to actual media events, motion preferences and page visibility.
 * The source stays in data-src until motion preferences have been checked. Returns cleanup.
 */
export function setupVideo(video: HTMLVideoElement): () => void {
  const source = video.dataset.src;
  if (!source) return () => {};
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const subscriptions = new AbortController();
  const options = { signal: subscriptions.signal };
  let wanted = false;
  let resumeOnVisible = false;
  let failed = false;
  let request = 0;


  /** Cancel pending play attempts without discarding the current playback position. */
  function pause(): void {
    request++;
    video.autoplay = false;
    video.pause();
  }

  /** Keep the independent poster visible after a definitive source/decode/network failure. */
  function fail(): void {
    if (failed) return;
    failed = true;
    wanted = false;
    resumeOnVisible = false;
    pause();
    video.classList.remove("has-frame");
    video.removeAttribute("src");
    video.load();
  }

  /** Start or resume playback, leaving the poster visible when autoplay is denied. */
  async function play(): Promise<void> {
    if (failed || document.hidden) return;
    wanted = true;
    const currentRequest = ++request;
    video.muted = true;
    if (!video.getAttribute("src")) video.src = source!;
    try {
      await video.play();
    } catch (error) {
      // A pause, preference change or newer request owns state after cancellation.
      if (currentRequest !== request || failed) return;
      if (error instanceof DOMException && error.name === "NotSupportedError") {
        fail();
        return;
      }
      wanted = false;
      pause();
      video.classList.remove("has-frame");
    }
  }

  video.addEventListener("playing", () => {
    // A late media event must not revive a stopped or backgrounded video.
    if (!wanted || document.hidden) { pause(); return; }
    video.classList.add("has-frame");
  }, options);
  video.addEventListener("error", fail, options);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      resumeOnVisible = wanted && !video.paused && video.classList.contains("has-frame");
      wanted = false;
      pause();
    } else if (resumeOnVisible) {
      resumeOnVisible = false;
      void play();
    }
  }, options);
  motion.addEventListener("change", () => {
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
  return () => { subscriptions.abort(); pause(); };
}
