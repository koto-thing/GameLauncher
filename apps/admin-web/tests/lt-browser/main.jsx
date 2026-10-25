import React from "react";
import { createRoot } from "react-dom/client";
import { LtManager } from "../../app/lt/LtManager";
import "../../app/globals.css";

// 本番エントリーから参照しないブラウザー検証専用fixture
const event = { id: "fixture-event", version: 1, state: "scheduled", title: "架空LT会", venue: "架空会場", guidance: "", startsAt: "2026-11-01T01:00:00.000Z", timeZone: "Asia/Tokyo", opensAt: "2026-10-01T01:00:00.000Z", closesAt: "2026-10-31T01:00:00.000Z", capacity: 20, talkMinutes: 10, transitionMinutes: 1 };
let application = { id: "fixture-application", eventId: event.id, version: 1, content: { title: "架空発表", abstract: "架空の申請原稿", speakers: [{ displayName: "架空登壇者" }] }, materialUrl: "https://example.invalid/slides", representativeEmail: "fixture@example.invalid", review: "pending", withdrawal: "none", firstSubmittedAt: event.opensAt, everApproved: false, slotReserved: false, retentionExpiresAt: null, published: null, operatorNote: "" };
let timetable = { eventId: event.id, version: 1, eventVersion: 1, blocks: [] };
let nextFailure = 0;
window.fetch = async (input, init) => {
  const path = String(input); const body = init?.body ? JSON.parse(String(init.body)) : null;
  await new Promise(resolve => setTimeout(resolve, 100));
  if (init?.method === "GET" || !init?.method) {
    if (path.endsWith("/applications")) return Response.json({ items: [application], nextCursor: null });
    if (path.endsWith("/timetable")) return Response.json(timetable);
    if (path.includes("/applications/")) return Response.json(application);
    if (path.endsWith("/events")) return Response.json({ items: [event], nextCursor: null });
    return Response.json(event);
  }
  if (nextFailure) { const status = nextFailure; nextFailure = 0; return Response.json({ error: { code: "VERSION_CONFLICT", requestId: "fixture" } }, { status }); }
  if (path.endsWith("/timetable")) { timetable = { ...timetable, version: timetable.version + 1, blocks: body.data.blocks }; return Response.json(timetable); }
  if (path.includes("/applications/")) {
    if (body.expectedVersion !== application.version) return Response.json({ error: { code: "VERSION_CONFLICT", requestId: "fixture" } }, { status: 409 });
    const action = path.split("/").pop();
    application = { ...application, version: application.version + 1, review: ({ approve: "approved", return: "returned", hold: "held", reject: "rejected", reapprove: "approved" })[action] ?? application.review, everApproved: action === "approve" || application.everApproved };
    if (action === "approve" || action === "reapprove") application.published = { ...application.content, id: application.id, eventId: event.id, version: application.version, startsAt: body.data.startsAt ?? event.startsAt, endsAt: "2026-11-01T01:10:00.000Z", cancelled: false };
    return Response.json(application);
  }
  Object.assign(event, body.data, { version: event.version + 1 }); return Response.json(event);
};
createRoot(document.getElementById("root")).render(<main className="members-page"><button onClick={() => { nextFailure = 409; }}>検証: 次の更新を競合</button><button onClick={() => { nextFailure = 503; }}>検証: 次の更新を失敗</button><h1>LT会</h1><LtManager /></main>);



