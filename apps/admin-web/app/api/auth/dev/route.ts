import {
  createSessionCookie,
  ensureLocalFixtures,
  localDevAuthAvailable,
  localUsers,
  musicLocalUsers,
  upsertUser,
} from "@/lib/auth";

export async function GET(request: Request) {
  if (!localDevAuthAvailable(request)) return new Response("Not found", { status: 404 });
  const selected = new URL(request.url).searchParams.get("as") ?? "admin";
  const template = localUsers[selected] ?? musicLocalUsers[selected];
  if (!template) return new Response("Unknown local user", { status: 400 });
  await ensureLocalFixtures();
  const user = { ...template, authenticatedAt: new Date().toISOString() };
  if (user.gameAccess) await upsertUser(user);
  return new Response(null, {
    status: 302,
    headers: {
      location: user.gameAccess ? "/" : "/music",
      "set-cookie": await createSessionCookie(user, request),
    },
  });
}
