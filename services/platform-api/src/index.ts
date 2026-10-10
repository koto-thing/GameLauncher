import { readAnalytics } from "./analytics.ts";
import { archiveDetails, deleteInstallation, saveBatch } from "./storage.ts";
import type { AnalyticsEnv } from "./types.ts";
import { validateBatch } from "./validation.ts";

// Return uncached JSON without exposing installations or credentials
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

// Compare read credentials with constant work for equal-length strings
function sameSecret(actual: string, expected: string): boolean {
  const length = Math.max(actual.length, expected.length);
  let difference = actual.length ^ expected.length;

  for (let index = 0; index < length; index++) {
    difference |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }

  return difference === 0;
}

// Bound request bodies while streaming rather than trusting Content-Length
async function requestBody(request: Request): Promise<unknown> {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !request.body) {
    throw new Error("invalid session payload");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const { value, done } = await reader.read();

    if (done) break;

    length += value.length;

    if (length > 1_048_576) {
      await reader.cancel();
      throw new Error("request body too large");
    }

    chunks.push(value);
  }

  const body = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body));
  } catch {
    throw new Error("invalid session payload");
  }
}

// Serve opt-in ingestion, authenticated deletion, and administrator-only aggregate reads
export async function handleRequest(request: Request, env: AnalyticsEnv, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);

  try {
    if (request.method === "GET" && url.pathname === "/v1/analytics/games") {
      const credential = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";

      if (!env.ANALYTICS_READ_TOKEN || env.ANALYTICS_READ_TOKEN.length < 32 || !sameSecret(credential, env.ANALYTICS_READ_TOKEN)) {
        return json({ error: "unauthorized" }, 401);
      }

      return json(await readAnalytics(env, url, now));
    }

    const deletionMatch = /^\/v1\/installations\/([a-fA-F0-9-]{36})$/.exec(url.pathname);

    if ((request.method === "POST" && url.pathname === "/v1/play-sessions") || (request.method === "DELETE" && deletionMatch)) {
      if (!env.INGEST_RATE_LIMITER || !(await env.INGEST_RATE_LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") ?? "local" })).success) {
        return json({ error: "rate limited" }, 429);
      }

      if (request.method === "DELETE" && deletionMatch) {
        const token = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";

        if (!/^[a-f0-9]{64}$/.test(token) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deletionMatch[1])) {
          return json({ error: "unauthorized" }, 401);
        }

        await deleteInstallation(env, deletionMatch[1].toLowerCase(), token, now);

        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      }

      const batch = validateBatch(await requestBody(request), env, now);

      return json({ accepted: await saveBatch(env, batch, now) });
    }

    return json({ error: "not found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (message === "credential rejected") return json({ error: "unauthorized" }, 401);

    if (message.includes("session conflict")) return json({ error: "session conflict" }, 409);

    if (message === "request body too large") return json({ error: message }, 413);

    if (message.startsWith("invalid ") || message.startsWith("unknown ") || message.startsWith("daily duration")) return json({ error: message }, 400);

    // Never write request bodies, installation identifiers, or credentials to logs
    return json({ error: "analytics unavailable" }, 503);
  }
}

export default {
  // Keep the Workers execution context separate from the testable clock argument
  fetch(request: Request, env: AnalyticsEnv): Promise<Response> {
    return handleRequest(request, env);
  },

  // Rotate detailed sessions into anonymous aggregates every Japanese calendar day
  async scheduled(controller: ScheduledController, env: AnalyticsEnv, context: ExecutionContext): Promise<void> {
    context.waitUntil(archiveDetails(env, controller.scheduledTime));
  },
};
