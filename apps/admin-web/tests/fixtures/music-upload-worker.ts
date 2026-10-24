import { Uploads } from "../../music/application/uploads";
import { MusicError } from "../../../music/src/domain/models";
import { DOMAIN_POLICY_DEFAULTS } from "../../../music/src/config/domain-policy.defaults";

export default {
  /** ローカル Worker で受付から保存境界までを検証する */
  async fetch(request: Request): Promise<Response> {
    let stored = false;
    const uploads = new Uploads({
      async begin(...args: unknown[]) { stored = true; return { id: "reserved", args } as never; },
      async get() { return null; },
      async finish() {},
    }, {} as never, DOMAIN_POLICY_DEFAULTS);
    const input = await request.json() as { bytes: number; digest: string; mime: string; authenticated: boolean };
    try {
      const result = await uploads.begin("game", "audio", input.bytes, input.digest, input.mime,
        input.authenticated ? { role: "admin" } as never : null as never);
      return Response.json({ result, stored });
    } catch (error) {
      if (!(error instanceof MusicError)) throw error;
      return Response.json({ code: error.code, stored });
    }
  },
};
