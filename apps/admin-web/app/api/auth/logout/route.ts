import { clearSessionCookie } from "@/lib/auth";
import { assertBrowserWrite } from "@/lib/request-security";

export async function POST(request: Request) {
  try {
    assertBrowserWrite(request);
    return new Response(null, {
      status: 204,
      headers: { "set-cookie": clearSessionCookie(request) },
    });
  } catch (error) {
    return error instanceof Response ? error : new Response("Logout failed", { status: 400 });
  }
}
