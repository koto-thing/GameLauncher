import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { MusicService } from "../../application/music-service";
import type { AuthService } from "../../application/auth-service";
import type { Session } from "../../application/ports";
import { MusicError, type Advertisement } from "../../domain/models";
import {
  assetId,
  authorize,
  record,
  requireValue,
  textValue,
} from "../../domain/rules";
import type { MusicEnv, ServerConfig } from "../../config/server-config";
import { byteRange, readJson } from "./http";

export interface Services {
  music: MusicService;
  auth: AuthService;
  config: ServerConfig;
}
type Api = {
  Bindings: MusicEnv;
  Variables: { services: Services; session: Session | null };
};
/** @brief APIへの依存をリクエストごとに接続し、公開と管理の境界を分ける。 */
export function createApi(compose: (env: MusicEnv) => Services): Hono<Api> {
  const app = new Hono<Api>();
  app.use(
    "/api/*",
    /** @brief すべてのAPI応答を非キャッシュ化し認証を解決する。 */ async (
      c,
      next,
    ) => {
      c.header("Cache-Control", "no-store, private");
      c.header("X-Content-Type-Options", "nosniff");
      c.header("Referrer-Policy", "same-origin");
      c.header("X-Frame-Options", "DENY");
      const services = compose(c.env);
      c.set("services", services);
      const session = await services.auth.session(
        getCookie(c, "music_session") ?? "",
      );
      c.set("session", session);
      if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
        services.auth.csrf(
          session,
          c.req.header("Origin") ?? "",
          c.req.header("X-CSRF-Token") ?? "",
        );
        await services.auth.limit(
          `mutation:${session!.principal.id}`,
          services.config.mutationPerMinute,
        );
      }
      await next();
    },
  );
  app.get(
    "/api/public/catalogue",
    /** @brief リスナーには公開DTOだけを返す。 */ async (c) =>
      c.json(await c.get("services").music.catalogue()),
  );
  app.get(
    "/api/public/config",
    /** @brief 公開連絡先と入力ルールだけを公開する。 */ (c) => {
      const { config, music } = c.get("services");
      return c.json({
        contactUrl: config.contactUrl,
        policy: music.policy,
        local: config.environment === "local",
        oauthConfigured: Boolean(
          config.githubClientId && config.githubClientSecret,
        ),
      });
    },
  );
  app.get(
    "/api/public/ad",
    /** @brief 広告OFF時は内部素材IDも返さない。 */ async (c) => {
      const ad = await c.get("services").music.repository.advertisement();
      return c.json(
        ad.enabled
          ? {
              enabled: true,
              imageAssetId: ad.imageAssetId,
              href: ad.href,
              alt: ad.alt,
            }
          : { enabled: false },
      );
    },
  );
  app.get(
    "/api/auth/me",
    /** @brief CSRF値は同一オリジンのログイン済み画面だけに返す。 */ (c) =>
      c.json(c.get("session")),
  );
  app.get(
    "/api/auth/login",
    /** @brief 認証開始を回数制限しHttpOnly state Cookieを発行する。 */ async (
      c,
    ) => {
      const { auth, config } = c.get("services");
      await auth.limit(
        `oauth:${c.req.header("CF-Connecting-IP") ?? "local"}`,
        config.authPerMinute,
      );
      const result = await auth.begin();
      setCookie(c, "music_oauth", result.state, {
        httpOnly: true,
        secure: config.origin.startsWith("https:"),
        sameSite: "Lax",
        path: "/api/auth",
        maxAge: config.flowSeconds,
      });
      return c.redirect(result.url);
    },
  );
  app.get(
    "/api/auth/callback",
    /** @brief 固定callbackでstateを消費し安全なセッションへ切り替える。 */ async (
      c,
    ) => {
      const { auth, config } = c.get("services");
      await auth.limit(
        `callback:${c.req.header("CF-Connecting-IP") ?? "local"}`,
        config.authPerMinute,
      );
      const result = await auth.complete(
        c.req.query("code") ?? "",
        c.req.query("state") ?? "",
        getCookie(c, "music_oauth") ?? "",
      );
      setCookie(c, "music_oauth", "", { path: "/api/auth", maxAge: 0 });
      setCookie(c, "music_session", result.token, {
        httpOnly: true,
        secure: config.origin.startsWith("https:"),
        sameSite: "Lax",
        path: "/",
        maxAge: config.sessionSeconds,
      });
      return c.redirect("/manage");
    },
  );
  app.post(
    "/api/auth/logout",
    /** @brief CookieとDBの両方を無効にする。 */ async (c) => {
      await c.get("services").auth.logout(getCookie(c, "music_session") ?? "");
      setCookie(c, "music_session", "", { path: "/", maxAge: 0 });
      return c.json({ ok: true });
    },
  );
  app.on(
    ["GET", "HEAD"],
    "/api/assets/:id",
    /** @brief 認可を先に済ませてからRangeまたは全本文を配信する。 */ async (
      c,
    ) => {
      const { music } = c.get("services");
      const asset = await music.readableAsset(
        c.req.param("id"),
        c.get("session")?.principal ?? null,
      );
      const range =
        c.req.method === "HEAD"
          ? null
          : byteRange(c.req.header("Range") ?? null, asset.bytes);
      const headers = new Headers({
        "Content-Type": asset.mime,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
      });
      if (range === false) {
        headers.set("Content-Range", `bytes */${asset.bytes}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set("Content-Length", String(range ? range.length : asset.bytes));
      if (range)
        headers.set(
          "Content-Range",
          `bytes ${range.offset}-${range.offset + range.length - 1}/${asset.bytes}`,
        );
      if (c.req.method === "HEAD") return new Response(null, { headers });
      const stored = await music.storage.get(asset.key, range ?? undefined);
      if (!stored)
        throw new MusicError(
          "NOT_FOUND",
          "音源・画像が見つかりません。運営に連絡してください。",
        );
      return new Response(stored.body, { status: range ? 206 : 200, headers });
    },
  );
  app.get(
    "/api/manage/games",
    /** @brief 担当一覧を返す。 */ async (c) =>
      c.json(
        await c
          .get("services")
          .music.managedGames(c.get("session")?.principal ?? null),
      ),
  );
  app.get(
    "/api/manage/games/:id",
    /** @brief 認可後だけ下書きと所属情報を取得する。 */ async (c) => {
      const music = c.get("services").music;
      const game = await music.managedGame(
        c.req.param("id"),
        c.get("session")?.principal ?? null,
      );
      return c.json({
        game,
        tracks: await music.repository.tracks(game.id),
        members: await music.repository.memberships(game.id),
      });
    },
  );
  app.post(
    "/api/manage/games",
    /** @brief 作品作成は運営権限をユースケースで確認する。 */ async (c) => {
      const { music, config } = c.get("services");
      return c.json(
        await music.createGame(
          await readJson(c.req.raw, config.jsonMaxBytes),
          c.get("session")?.principal ?? null,
        ),
        201,
      );
    },
  );
  app.put(
    "/api/manage/games/:id",
    /** @brief 下書きだけを競合検出付きで保存する。 */ async (c) => {
      const { music, config } = c.get("services");
      const value = record(await readJson(c.req.raw, config.jsonMaxBytes));
      await music.editGame(
        c.req.param("id"),
        value.draft,
        Number(value.version),
        c.get("session")?.principal ?? null,
      );
      return c.json({ ok: true });
    },
  );
  app.post(
    "/api/manage/games/:id/publication",
    /** @brief 担当者自身の判断で作品公開を切り替える。 */ async (c) => {
      const { music, config } = c.get("services");
      const value = record(await readJson(c.req.raw, config.jsonMaxBytes));
      requireValue(typeof value.publish === "boolean", "公開状態が不正です。");
      await music.publishGame(
        c.req.param("id"),
        value.publish,
        Number(value.version),
        c.get("session")?.principal ?? null,
      );
      return c.json({ ok: true });
    },
  );
  app.post(
    "/api/manage/games/:id/tracks",
    /** @brief 初回曲登録を下書きとして保存する。 */ async (c) => {
      const { music, config } = c.get("services");
      const value = record(await readJson(c.req.raw, config.jsonMaxBytes));
      return c.json(
        await music.createTrack(
          c.req.param("id"),
          textValue(value.title, music.policy.text.titleMax, "title", true),
          c.get("session")?.principal ?? null,
        ),
        201,
      );
    },
  );
  app.put(
    "/api/manage/tracks/:id",
    /** @brief サーバーで音源・画像・ループの所属を再検証する。 */ async (
      c,
    ) => {
      const { music, config } = c.get("services");
      const value = record(await readJson(c.req.raw, config.jsonMaxBytes));
      await music.editTrack(
        c.req.param("id"),
        value.draft,
        Number(value.position),
        Number(value.version),
        c.get("session")?.principal ?? null,
      );
      return c.json({ ok: true });
    },
  );
  app.post(
    "/api/manage/tracks/:id/publication",
    /** @brief 公開操作を単一スナップショット更新へ委譲する。 */ async (c) => {
      const { music, config } = c.get("services");
      const value = record(await readJson(c.req.raw, config.jsonMaxBytes));
      requireValue(typeof value.publish === "boolean", "公開状態が不正です。");
      await music.publishTrack(
        c.req.param("id"),
        value.publish,
        Number(value.version),
        c.get("session")?.principal ?? null,
      );
      return c.json({ ok: true });
    },
  );
  app.get(
    "/api/manage/tracks/:id/preview",
    /** @brief 現在の担当者だけに下書きプレビューを許可する。 */ async (c) => {
      const music = c.get("services").music;
      const track = await music.managedTrack(
        c.req.param("id"),
        c.get("session")?.principal ?? null,
      );
      return c.json(await music.publicTrack(track, true));
    },
  );
  app.post(
    "/api/manage/games/:id/assets/:kind",
    /** @brief アップロードは認可後に容量制限付きのストリームで受け取る。 */ async (
      c,
    ) => {
      const { music, auth, config } = c.get("services");
      const actor = c.get("session")!.principal;
      const kind = c.req.param("kind");
      requireValue(
        kind === "audio" || kind === "image",
        "素材用途が不正です。",
      );
      requireValue(c.req.raw.body, "ファイルを選択してください。");
      await auth.limit(`upload:${actor.id}`, config.uploadPerMinute);
      const asset = await music.upload(
        c.req.param("id"),
        kind,
        Number(c.req.header("Content-Length")),
        c.req.raw.body,
        actor,
      );
      const { key: _key, ...dto } = asset;
      return c.json(dto, 201);
    },
  );
  app.use(
    "/api/admin/*",
    /** @brief 運営APIはすべて共通のロール検査を通す。 */ async (c, next) => {
      authorize(c.get("session")?.principal ?? null);
      await next();
    },
  );
  app.get(
    "/api/admin/settings",
    /** @brief 広告・アカウント・履歴を運営だけに返す。 */ async (c) => {
      return c.json(
        await c
          .get("services")
          .music.adminSettings(c.get("session")!.principal),
      );
    },
  );
  app.put(
    "/api/admin/advertisement",
    /** @brief 安全なバナー設定だけを受け付ける。 */ async (c) => {
      const { music, config } = c.get("services");
      const value = record(await readJson(c.req.raw, config.jsonMaxBytes));
      const ad: Advertisement = {
        enabled: value.enabled === true,
        imageAssetId: assetId(value.imageAssetId),
        href: String(value.href),
        alt: String(value.alt),
        version: Number(value.version),
      };
      await music.saveAdvertisement(ad, c.get("session")!.principal);
      return c.json({ ok: true });
    },
  );
  app.put(
    "/api/admin/games/:id/members/:accountId",
    /** @brief 安定IDによる担当追加・解除を記録する。 */ async (c) => {
      const { music, config } = c.get("services");
      const value = record(await readJson(c.req.raw, config.jsonMaxBytes));
      requireValue(typeof value.enabled === "boolean", "担当状態が不正です。");
      await music.changeMembership(
        c.req.param("id"),
        c.req.param("accountId"),
        value.enabled,
        c.get("session")!.principal,
      );
      return c.json({ ok: true });
    },
  );
  app.put(
    "/api/admin/accounts/:id",
    /** @brief クライアントが送る自己ロールは信用しない。 */ async (c) => {
      const { music, config } = c.get("services");
      const value = record(await readJson(c.req.raw, config.jsonMaxBytes));
      requireValue(typeof value.admin === "boolean", "権限が不正です。");
      await music.changeAdmin(
        c.req.param("id"),
        value.admin,
        c.get("session")!.principal,
      );
      return c.json({ ok: true });
    },
  );
  app.put(
    "/api/admin/games/:id/suspension",
    /** @brief 全曲・画像配信を止める作品停止を適用する。 */ async (c) => {
      const { music, config } = c.get("services");
      const value = record(await readJson(c.req.raw, config.jsonMaxBytes));
      requireValue(
        typeof value.suspended === "boolean",
        "停止状態が不正です。",
      );
      await music.suspendGame(
        c.req.param("id"),
        value.suspended,
        Number(value.version),
        c.get("session")!.principal,
      );
      return c.json({ ok: true });
    },
  );
  app.get(
    "/api/manage/tracks/:id",
    /** @brief 認可済みの曲下書きと再生メタデータを返す。 */ async (c) => {
      const music = c.get("services").music;
      const track = await music.managedTrack(
        c.req.param("id"),
        c.get("session")?.principal ?? null,
      );
      return c.json({
        track,
        audio: track.draft.audioAssetId
          ? await music.publicTrack(track, true)
          : null,
      });
    },
  );
  app.notFound(
    /** @brief 未知のAPIをSPAのHTMLで成功扱いにしない。 */ (c) =>
      c.json({ code: "NOT_FOUND", message: "ページが見つかりません。" }, 404),
  );
  app.onError(
    /** @brief SQL・Cookie・OAuthコードをレスポンスにもログにも出さない。 */ (
      error,
      c,
    ) => {
      const statuses: Record<MusicError["code"], ContentfulStatusCode> = {
        INVALID: 400,
        UNAUTHENTICATED: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        CONFLICT: 409,
        TOO_LARGE: 413,
        RATE_LIMIT: 429,
        UNAVAILABLE: 503,
      };
      if (error instanceof MusicError) {
        if (error.code === "RATE_LIMIT") c.header("Retry-After", "60");
        return c.json(
          { code: error.code, message: error.message, field: error.field },
          statuses[error.code],
        );
      }
      console.error(
        JSON.stringify({
          event: "music.request.failed",
          method: c.req.method,
          path: c.req.path,
          requestId: crypto.randomUUID(),
        }),
      );
      return c.json(
        {
          code: "INTERNAL",
          message: "処理に失敗しました。再試行してください。",
        },
        500,
      );
    },
  );
  return app;
}
