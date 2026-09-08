import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  initSync,
  TrackMeter,
} from "../../../../packages/music-loudness/generated/music_loudness.js";
import {
  normalizationGainDb,
  trackLoudness,
} from "../../src/domain/loudness.ts";
import { trackContent } from "../../src/domain/rules.ts";
import { DOMAIN_POLICY_DEFAULTS } from "../../src/config/domain-policy.defaults.ts";

initSync({
  module: await readFile(
    new URL(
      "../../../../packages/music-loudness/generated/music_loudness_bg.wasm",
      import.meta.url,
    ),
  ),
});

/** @brief 独立した正弦波を固定WASMで全曲測定する */
function measure(
  amplitude: number,
  channels = 1,
  frames = 96000,
  chunkFrames = 4096,
) {
  const meter = new TrackMeter(48000, channels, frames / 48000);
  try {
    for (let offset = 0; offset < frames; offset += chunkFrames) {
      const count = Math.min(chunkFrames, frames - offset);
      const samples = new Float32Array(count * channels);
      for (let frame = 0; frame < count; frame++)
        for (let channel = 0; channel < channels; channel++)
          samples[frame * channels + channel] =
            amplitude *
            Math.sin((2 * Math.PI * 1000 * (offset + frame)) / 48000);
      meter.process(samples);
    }
    meter.finish();
    return {
      audioAssetId: "tone",
      integratedLufs: meter.integrated_lufs() ?? null,
      truePeakDbtp: meter.true_peak_dbtp() ?? null,
    };
  } finally {
    meter.free();
  }
}

test("real LoudnessMeter WASM equalizes tracks 20 dB apart without changing dynamics", /** @brief 独立生成した大小の音源を補正後のLUFSで比較する */ () => {
  const quiet = measure(0.05);
  const loud = measure(0.5);
  assert.ok(
    Math.abs(loud.integratedLufs! - quiet.integratedLufs! - 20) < 0.001,
  );
  assert.ok(Math.abs(loud.truePeakDbtp! - quiet.truePeakDbtp! - 20) < 0.001);
  for (const source of [quiet, loud]) {
    const gain = normalizationGainDb(source, "tone");
    assert.ok(Math.abs(source.integratedLufs! + gain + 18) < 0.001);
    const result = measure((source === quiet ? 0.05 : 0.5) * 10 ** (gain / 20));
    assert.ok(Math.abs(result.integratedLufs! + 18) < 0.01);
    assert.ok(result.truePeakDbtp! <= -1);
  }
});

test("stereo weighting and partial chunks are measured consistently", /** @brief ステレオのエネルギー加算と最終端数ブロックを実WASMで検証する */ () => {
  const mono = measure(0.1, 1, 97321, 128);
  const stereo = measure(0.1, 2, 97321, 4096);
  assert.ok(
    Math.abs(
      stereo.integratedLufs! - mono.integratedLufs! - 10 * Math.log10(2),
    ) < 0.001,
  );
  assert.ok(Math.abs(stereo.truePeakDbtp! - mono.truePeakDbtp!) < 0.001);
  assert.deepEqual(measure(0.1, 1, 97321, 4096), mono);
});

test("silence, short audio, peak ceiling and maximum boost do not cause runaway gain", /** @brief 測定不能を有限LUFSに捏造せず、増幅を制限する */ () => {
  for (const source of [measure(0), measure(0.2, 1, 4000)]) {
    assert.equal(source.integratedLufs, null);
    assert.equal(normalizationGainDb(source, "tone"), 0);
  }
  assert.equal(
    normalizationGainDb(
      { audioAssetId: "a", integratedLufs: -30, truePeakDbtp: -2 },
      "a",
    ),
    1,
  );
  assert.equal(
    normalizationGainDb(
      { audioAssetId: "a", integratedLufs: -60, truePeakDbtp: -50 },
      "a",
    ),
    12,
  );
  assert.equal(normalizationGainDb(undefined, "a"), 0);
});

test("metadata survives draft validation and rejects stale IDs or invalid metrics", /** @brief 差し替え前の測定値、NaN、文字列を保存させない */ () => {
  const value = { audioAssetId: "a", integratedLufs: -24, truePeakDbtp: -3 };
  const draft = {
    title: "test",
    credits: [],
    comment: "",
    audioAssetId: "a",
    imageAssetId: null,
    imageAlt: "",
    loop: null,
    rightsConfirmed: false,
    loudness: value,
  };
  assert.deepEqual(trackContent(draft, DOMAIN_POLICY_DEFAULTS).loudness, value);
  for (const invalid of [
    { ...value, audioAssetId: "b" },
    { ...value, integratedLufs: NaN },
    { ...value, truePeakDbtp: Infinity },
    { ...value, truePeakDbtp: null },
    { ...value, integratedLufs: "-24" },
  ]) {
    assert.throws(
      /** @brief 不正な音量データを拒否する */ () =>
        trackLoudness(invalid, "a"),
    );
  }
});
