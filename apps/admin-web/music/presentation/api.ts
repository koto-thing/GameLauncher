import { env } from "cloudflare:workers";
import { getD1 } from "@/db/initialize";
import {
  readSession,
  localDevAuthAvailable,
  githubAuthConfigured,
} from "@/lib/auth";
import { assertBrowserWrite } from "@/lib/request-security";
import { musicPrincipal, limitMusic } from "../infrastructure/authorization";
import { musicServices } from "../composition/services";
import { MUSIC_RUNTIME } from "../config/settings";
import { DOMAIN_POLICY_DEFAULTS } from "../../../music/src/config/domain-policy.defaults";
import {
  MusicError,
  type Advertisement,
  type Asset,
} from "../../../music/src/domain/models";
import {
  authorize,
  record,
  requireValue,
} from "../../../music/src/domain/rules";
import { readJson } from "../../../music/src/presentation/api/http";

/** @brief 全Music入口で共通本人確認・最新所属・Originを検証する。 @param request HTTP要求。 @returns 管理DTOまたは認可済みストリーム。 */
export async function musicApi(request: Request): Promise<Response> {
  try {
    const path = new URL(request.url).pathname.replace(/^\/api\/music\/?/, "");
    const method = request.method;
    const user = await readSession(request);
    const enabled = (env as Record<string, unknown>).MUSIC_ENABLED === "true";
    if (path === "session" && method === "GET") {
      const principal = enabled ? await musicPrincipal(getD1(), user) : null;
      const publicUrl = String(
        (env as Record<string, unknown>).MUSIC_PUBLIC_URL ?? "",
      );
      return json({
        session: principal
          ? { principal, csrf: "same-origin", expiresAt: Date.now() + 60000 }
          : null,
        config: {
          policy: DOMAIN_POLICY_DEFAULTS,
          local: localDevAuthAvailable(request),
          oauthConfigured: githubAuthConfigured(),
          contactUrl: "",
          enabled,
          publicUrl,
        },
        user: user ? { login: user.login, gameAccess: user.gameAccess } : null,
      });
    }
    if (!enabled) throw new MusicError("UNAVAILABLE", "Music管理は無効です。");
    if (!user)
      throw new MusicError("UNAUTHENTICATED", "ログインしてください。");
    const actor = await musicPrincipal(getD1(), user);
    if (!actor)
      throw new MusicError(
        "FORBIDDEN",
        "Musicの担当割り当てがありません。GitHub数値IDをMusic運営に伝えてください。",
      );
    if (!["GET", "HEAD"].includes(method)) {
      assertBrowserWrite(request);
      await limitMusic(
        getD1(),
        `mutation:${actor.id}`,
        MUSIC_RUNTIME.mutationPerMinute,
      );
    }
    const { music, repository, operations, publications, uploads, storage } =
      musicServices();
    const segments = path.split("/");
    if (segments[0] === "admin") authorize(actor);
    if (path === "publications" && method === "GET")
      return json(
        (await operations.list(actor)).map(
          /** @brief 操作状態以外の内部snapshotを管理一覧に出さない。 */ (
            op,
          ) => ({
            id: op.id,
            scope: op.scope,
            state: op.state,
            error: op.error,
          }),
        ),
      );
    if (
      segments[0] === "publications" &&
      segments.length === 3 &&
      segments[2] === "retry" &&
      method === "POST"
    ) {
      await publications.retry(segments[1], actor);
      return json({ ok: true });
    }
    if (
      segments[0] === "assets" &&
      segments.length === 2 &&
      ["GET", "HEAD"].includes(method)
    ) {
      const asset = await repository.asset(segments[1]);
      if (!asset || asset.status !== "verified")
        throw new MusicError("NOT_FOUND", "素材がありません。");
      authorize(actor, asset.gameId);
      if (method === "HEAD")
        return new Response(null, {
          headers: {
            "Content-Type": asset.mime,
            "Content-Length": String(asset.bytes),
            "Cache-Control": "no-store, private",
          },
        });
      return storage.preview(asset, actor);
    }
    if (
      segments[0] === "uploads" &&
      segments.length === 2 &&
      method === "PUT"
    ) {
      requireValue(request.body, "ファイルを指定してください。");
      await limitMusic(
        getD1(),
        `upload:${actor.id}`,
        MUSIC_RUNTIME.uploadPerMinute,
      );
      const asset = await uploads.transfer(
        segments[1],
        request.body,
        actor,
      );
      return json({ id: asset.id, gameId: asset.gameId, kind: asset.kind, mime: asset.mime, bytes: asset.bytes, status: asset.status, durationSeconds: asset.durationSeconds, sampleRateHz: asset.sampleRateHz, channels: asset.channels, widthPixels: asset.widthPixels, heightPixels: asset.heightPixels, createdAt: asset.createdAt });
    }
    // JSON管理入力だけを容量制限付きで読み、音源本文はここへ入れない。
    const value = ["POST", "PUT"].includes(method)
      ? record(await readJson(request, MUSIC_RUNTIME.jsonMaxBytes))
      : {};
    const id = segments[2];
    if (path === "uploads" && method === "POST") {
      const gameId = String(value.gameId);
      await music.managedGame(gameId, actor);
      requireValue(
        value.kind === "audio" || value.kind === "image",
        "素材用途が不正です。",
      );
      const upload = await uploads.begin(
        gameId,
        value.kind as Asset["kind"],
        Number(value.bytes),
        String(value.digest),
        String(value.mime),
        actor,
      );
      return json({ id: upload.id, assetId: upload.asset.id }, 201);
    }
    if (path === "manage/games") {
      if (method === "GET") return json(await music.managedGames(actor));
      if (method === "POST")
        return json(await music.createGame(value, actor), 201);
    }
    if (segments[0] === "manage" && segments[1] === "games") {
      if (segments.length === 3 && method === "GET") {
        const game = await music.managedGame(id, actor);
        return json({
          game,
          tracks: await repository.tracks(id),
          members: actor.admin ? await repository.memberships(id) : [],
        });
      }
      if (segments.length === 3 && method === "PUT") {
        await music.editGame(id, value.draft, Number(value.version), actor);
        return json({ ok: true });
      }
      if (
        segments[3] === "tracks" &&
        segments.length === 4 &&
        method === "POST"
      )
        return json(
          await music.createTrack(id, String(value.title), actor),
          201,
        );
      if (
        segments[3] === "publication" &&
        segments.length === 4 &&
        method === "POST"
      ) {
        requireValue(
          typeof value.publish === "boolean",
          "公開状態が不正です。",
        );
        await music.publishGame(
          id,
          value.publish,
          Number(value.version),
          actor,
        );
        return json({ ok: true });
      }
    }
    if (segments[0] === "manage" && segments[1] === "tracks") {
      if (segments.length === 3 && method === "GET") {
        const track = await music.managedTrack(id, actor);
        return json({
          track,
          audio: track.draft.audioAssetId
            ? await music.publicTrack(track, true)
            : null,
        });
      }
      if (segments.length === 3 && method === "PUT") {
        await music.editTrack(
          id,
          value.draft,
          Number(value.position),
          Number(value.version),
          actor,
        );
        return json({ ok: true });
      }
      if (
        segments[3] === "preview" &&
        segments.length === 4 &&
        method === "GET"
      )
        return json(
          await music.publicTrack(await music.managedTrack(id, actor), true),
        );
      if (
        segments[3] === "publication" &&
        segments.length === 4 &&
        method === "POST"
      ) {
        requireValue(
          typeof value.publish === "boolean",
          "公開状態が不正です。",
        );
        await music.publishTrack(
          id,
          value.publish,
          Number(value.version),
          actor,
        );
        return json({ ok: true });
      }
    }
    if (path === "admin/settings" && method === "GET")
      return json(await music.adminSettings(actor));
    if (path === "admin/advertisement" && method === "PUT") {
      await music.saveAdvertisement(value as unknown as Advertisement, actor);
      return json({ ok: true });
    }
    if (segments[0] === "admin" && segments[1] === "games") {
      if (
        segments[3] === "members" &&
        segments.length === 5 &&
        method === "PUT"
      ) {
        requireValue(
          typeof value.enabled === "boolean",
          "担当状態が不正です。",
        );
        await music.changeMembership(id, segments[4], value.enabled, actor);
        return json({ ok: true });
      }
      if (
        segments[3] === "suspension" &&
        segments.length === 4 &&
        method === "PUT"
      ) {
        requireValue(
          typeof value.suspended === "boolean",
          "停止状態が不正です。",
        );
        await music.suspendGame(
          id,
          value.suspended,
          Number(value.version),
          actor,
        );
        return json({ ok: true });
      }
    }
    throw new MusicError("NOT_FOUND", "管理APIがありません。");
  } catch (error) {
    if (error instanceof Response) return error;
    const statuses = {
      INVALID: 400,
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      TOO_LARGE: 413,
      RATE_LIMIT: 429,
      UNAVAILABLE: 503,
    };
    if (error instanceof MusicError)
      return json(
        { code: error.code, message: error.message, field: error.field },
        statuses[error.code],
      );
    return json(
      {
        code: "INTERNAL",
        message:
          "Musicの処理に失敗しました。設定・DB適用状態を確認してください。",
      },
      500,
    );
  }
}
/** @brief 管理JSONを常に非キャッシュで返す。 @param value DTO。 @param status HTTP状態。 @returns JSON応答。 */
function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      ...(status === 429 ? { "Retry-After": "60" } : {}),
    },
  });
}
