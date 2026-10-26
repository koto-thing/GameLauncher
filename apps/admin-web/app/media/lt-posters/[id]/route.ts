import { posterType } from "@/lib/lt/poster-upload";
import { env } from "cloudflare:workers";

/** @brief 公開ポスター専用のキーだけを画像として配信する */
export async function GET(_request: Request, context: {params: Promise<{id:string}>}): Promise<Response> {
  const {id} = await context.params;
  if (!/^[a-f0-9]{64}$/.test(id)) return new Response("Not found",{status:404});
  const bucket = (env as unknown as {LT_POSTERS: R2Bucket}).LT_POSTERS;
  if (!bucket) return new Response("Unavailable",{status:503});
  const object = await bucket.get(id);
  if (!object) return new Response("Not found",{status:404});
  const bytes = await object.arrayBuffer();
  return new Response(bytes, {headers:{
    "Content-Type":posterType(new Uint8Array(bytes)) ?? "application/octet-stream",
    "Cache-Control":"public, max-age=31536000, immutable",
    "X-Content-Type-Options":"nosniff",
    "Cross-Origin-Resource-Policy":"cross-origin",
    "ETag":`"${id}"`,
  }});
}
