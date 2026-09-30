import { test, expect } from "@playwright/test";
import { commandSvg } from "../../src/domain/command-art";
import { displayCommand, encodeCommand } from "../../src/domain/command-code";

test("share export, real image recognition, manual input, lazy loading and no autoplay", /** @brief 実公開ページで全入力方法が同じ曲へ戻ることを確認する */ async ({
  page,
}) => {
  const games = await (await page.request.get("/api/public/catalogue")).json(),
    track = games[0].tracks[0],
    code = encodeCommand(track.commandCode.codeId);
  const requests: string[] = [];
  page.on(
    "request",
    /** @brief 手入力まで認識chunkを要求しないことを記録する */ (r) =>
      requests.push(r.url()),
  );
  await page.goto(`/tracks/${track.id}`);
  await expect(
    page.getByRole("button", { name: "コマンドコード", exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "再生", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "共有", exact: true }).click();
  await page
    .getByRole("button", { name: "コマンドコード", exact: true })
    .click();
  await expect(page.locator(".command-image")).toBeVisible();
  for (const name of ["SVG保存", "PNG保存"]) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name, exact: true }).click();
    expect((await download).suggestedFilename()).toContain(code);
  }
  await page.evaluate(
    /** @brief OSの共有クリップボードを変更せずコピー内容を検査する */ () => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText:
            /** @brief アダプター境界だけでテキストを捕捉する */ async (
              value: string,
            ) => {
              (window as unknown as { copied: string }).copied = value;
            },
        },
      });
    },
  );
  for (const [label, value] of [
    ["記号文字列コピー", displayCommand(code)],
    ["曲URLコピー", `http://127.0.0.1:8088/tracks/${track.id}`],
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    expect(
      await page.evaluate(
        /** @brief コピーに渡した値がコード・URLと一致する */ () =>
          (window as unknown as { copied: string }).copied,
      ),
    ).toBe(value);
  }
  await page.getByLabel("コードの背景").selectOption("color");
  await page.getByLabel("背景色", { exact: true }).fill("#336699");
  const preview = await page.locator(".command-image").getAttribute("src");
  expect(decodeURIComponent(preview ?? "")).toContain('fill="#336699"');
  await page.getByLabel("PNG保存幅").selectOption("1200");
  await expect(page.getByLabel("PNG保存幅")).toHaveValue("1200");
  expect(
    requests.some(
      /** @brief 通常共有では認識器をロードしない */ (url) =>
        url.includes("recognizer-"),
    ),
  ).toBe(false);
  await page.goto("/scan");
  await page.reload();
  await page.getByLabel("記号またはASCIIを貼り付け").fill(displayCommand(code));
  await page.getByRole("button", { name: "入力枠へ反映" }).click();
  await page.getByRole("button", { name: "読み込む", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/tracks/${track.id}$`));
  expect(
    requests.some(
      /** @brief 手入力も画像処理依存なし */ (url) =>
        url.includes("recognizer-"),
    ),
  ).toBe(false);
  const svg = commandSvg(track.commandCode.codeId);
  const png = await page.evaluate(
    /** @brief 画像内データを描画して実PNGを作る */ async (svg) => {
      const img = new Image();
      img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 960;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      return canvas.toDataURL("image/png").split(",")[1];
    },
    svg,
  );
  await page.goto("/scan");
  await page.getByRole("button", { name: "画像を選ぶ", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "unrelated-filename.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await expect(page).toHaveURL(new RegExp(`/tracks/${track.id}$`));
  await expect(
    page.getByRole("button", { name: "再生", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "共有", exact: true }).click();
  await page
    .getByRole("button", { name: "コマンドコード", exact: true })
    .click();
  await page.screenshot({
    path: `build/command-code/share-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(
    requests.filter(
      /** @brief 外部認識サービスやWorkersへの要求がない */ (url) =>
        /^https?:/.test(url) && new URL(url).origin !== "http://127.0.0.1:8088",
    ),
  ).toEqual([]);
});

test("invalid input, unsupported camera, denied permission and failed lookup", /** @brief 失敗時は曲を開かず日本語で入力方法を案内する。 */ async ({
  page,
}) => {
  await page.goto("/scan");
  await page.getByLabel("記号またはASCIIを貼り付け").fill("????????????");
  await page.getByRole("button", { name: "入力枠へ反映" }).click();
  await expect(page.getByRole("alert")).toContainText("使用できる記号");
  await page.getByRole("button", { name: "画像を選ぶ", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "bad.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.locator(".command-scan")).toContainText("有効な画像");
  await page.evaluate(
    /** @brief 実機の権限設定を変更せずAPIの拒否だけを再現する */ () => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia:
            /** @brief APIが無いWebKitでも拒否応答の案内を独立検証する */ () =>
              Promise.reject(new DOMException("denied", "NotAllowedError")),
        },
      });
    },
  );
  await page.getByRole("button", { name: "カメラ", exact: true }).click();
  await page.getByRole("button", { name: "カメラを起動" }).click();
  await expect(page.locator(".command-scan")).toContainText("許可が拒否");
  await page.evaluate(
    /** @brief カメラAPIがないブラウザーを再現する */ () =>
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: undefined,
      }),
  );
  await page.getByRole("button", { name: "カメラを起動" }).click();
  await expect(page.locator(".command-scan")).toContainText("対応していません");
  await page.getByRole("button", { name: "コマンド入力", exact: true }).click();
  await page.getByLabel("記号またはASCIIを貼り付け").fill("UUUUUUUULUBY");
  await page.getByRole("button", { name: "入力枠へ反映" }).click();
  await page.route(
    "**/command-codes/**",
    /** @brief 通信切断を再現する */ (route) => route.abort(),
  );
  await page.getByRole("button", { name: "読み込む", exact: true }).click();
  await expect(page).toHaveURL(/\/scan$/);
});

test("camera decodes real frames three times and releases stream; late permission is stopped", /** @brief 合成カメラは実機検証と区別し、実画素のデコーダーを使う。 */ async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "合成映像のcaptureStream試験はChromiumで実行。実機Safari/Androidは別手順。",
  );
  const games = await (await page.request.get("/api/public/catalogue")).json(),
    track = games[0].tracks[0];
  await page.addInitScript(
    /** @brief 映像取得APIだけを差し替え、認識器は差し替えない */ ({ svg }) => {
      const state = window as unknown as {
        cameraCalls: number;
        cameraStops: number;
        delay: boolean;
        grant?: () => void;
      };
      state.cameraCalls = 0;
      state.cameraStops = 0;
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: /** @brief Canvasの実画素をMediaStreamとして返す */ async () => {
          state.cameraCalls++;
          const canvas = document.createElement("canvas");
          canvas.width = 800;
          canvas.height = 480;
          const ctx = canvas.getContext("2d")!,
            img = new Image();
          img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
          await img.decode();
          ctx.drawImage(img, 0, 0, 800, 480);
          const stream = canvas.captureStream(5);
          for (const track of stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.stop = /** @brief 実trackの停止回数だけを記録する */ () => {
              state.cameraStops++;
              stop();
            };
          }
          if (state.delay)
            await new Promise<void>(
              /** @brief 試験操作が許可するまで応答を保留する */ (resolve) => {
                state.grant = resolve;
              },
            );
          return stream;
        },
      });
    },
    { svg: commandSvg(track.commandCode.codeId) },
  );
  await page.goto("/scan");
  expect(
    await page.evaluate(
      /** @brief 初回アクセスで許可要求しない */ () =>
        (window as unknown as { cameraCalls: number }).cameraCalls,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "カメラ", exact: true }).click();
  await page.getByRole("button", { name: "カメラを起動" }).click();
  await expect(page).toHaveURL(new RegExp(`/tracks/${track.id}$`));
  expect(
    await page.evaluate(
      /** @brief 成功した映像の停止数を読む */ () =>
        (window as unknown as { cameraStops: number }).cameraStops,
    ),
  ).toBe(1);
  await page
    .getByRole("link", { name: "コードを読み取る", exact: true })
    .click();
  await page.evaluate(
    /** @brief 次の許可応答だけ保留する */ () => {
      (window as unknown as { delay: boolean }).delay = true;
    },
  );
  await page.getByRole("button", { name: "カメラ", exact: true }).click();
  await page.getByRole("button", { name: "カメラを起動" }).click();
  await expect
    .poll(
      /** @brief 保留中の許可要求ができるまで待つ */ () =>
        page.evaluate(
          () => typeof (window as unknown as { grant?: () => void }).grant,
        ),
    )
    .toBe("function");
  await page.getByRole("button", { name: "コマンド入力", exact: true }).click();
  await page.evaluate(
    /** @brief 入力方法を離れた後に許可応答を返す */ () =>
      (window as unknown as { grant: () => void }).grant(),
  );
  await expect
    .poll(
      /** @brief 遅れて届いたstreamも解放される */ () =>
        page.evaluate(
          () => (window as unknown as { cameraStops: number }).cameraStops,
        ),
    )
    .toBe(2);
});
