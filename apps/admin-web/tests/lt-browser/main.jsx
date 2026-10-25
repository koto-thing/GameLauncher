import React from "react";
import { createRoot } from "react-dom/client";
import { LtManager } from "../../app/lt/LtManager";
import "../../app/globals.css";

// 本番エントリーから参照しない架空データ専用fixture
const event = { id: "fixture-event", version: 1, state: "scheduled", title: "架空LT会", venue: "架空会場", guidance: "", startsAt: "2026-11-01T01:00:00.000Z", timeZone: "Asia/Tokyo", opensAt: "2026-10-01T01:00:00.000Z", closesAt: "2026-10-31T01:00:00.000Z", capacity: 20, talkMinutes: 10, transitionMinutes: 1 };
const events = [event];
let application = { id: "fixture-application", eventId: event.id, version: 1, content: { title: "架空発表", abstract: "架空の申請原稿", speakers: [{ displayName: "架空登壇者" }] }, materialUrl: "https://example.invalid/slides", representativeEmail: "fixture@example.invalid", review: "pending", withdrawal: "none", firstSubmittedAt: event.opensAt, everApproved: false, slotReserved: false, retentionExpiresAt: null, published: null, operatorNote: "" };
let timetable = { eventId: event.id, version: 1, eventVersion: 1, blocks: [] };
let nextFailure = 0;
let denied = false;
const receipts = new Map();
function fail(status, code) { return Response.json({ error: { code, requestId: "fixture" } }, { status }); }
window.fetch = async (input, init) => {
  const path = String(input); const body = init?.body ? JSON.parse(String(init.body)) : null;
  await new Promise(resolve => setTimeout(resolve, 100));
  if (denied) return fail(403, "FORBIDDEN");
  const parts = path.split("/");
  const currentEvent = events.find(item => item.id === parts[6]) ?? event;
  if (init?.method === "GET" || !init?.method) {
    if (path.endsWith("/applications")) return Response.json({ items: currentEvent.id === application.eventId ? [application] : [], nextCursor: null });
    if (path.endsWith("/timetable")) return Response.json({ ...timetable, eventId: currentEvent.id, eventVersion: currentEvent.version });
    if (path.includes("/applications/")) return Response.json(application);
    if (path.endsWith("/events")) return Response.json({ items: events, nextCursor: null });
    return Response.json(currentEvent);
  }
  if (nextFailure) { const status = nextFailure; nextFailure = 0; return fail(status, status === 403 ? "FORBIDDEN" : "VERSION_CONFLICT"); }
  if (receipts.has(body.operationId)) return Response.json(receipts.get(body.operationId));
  let result;
  if (path.endsWith("/timetable")) {
    if (body.expectedVersion !== timetable.version || body.data.expectedEventVersion !== currentEvent.version) return fail(409, "VERSION_CONFLICT");
    currentEvent.version++;
    result = timetable = { ...timetable, version: timetable.version + 1, eventVersion: currentEvent.version, blocks: body.data.blocks };
  } else if (path.includes("/applications/")) {
    if (body.expectedVersion !== application.version) return fail(409, "VERSION_CONFLICT");
    const action = parts.at(-1);
    if ((action === "approve" || action === "reapprove") && body.data.expectedEventVersion !== event.version) return fail(409, "VERSION_CONFLICT");
    if (action === "approve" && body.data.expectedScheduleVersion !== timetable.version) return fail(409, "VERSION_CONFLICT");
    if (action === "reapprove" && application.review !== "resubmitted") return fail(422, "INVALID_TRANSITION");
    if (action === "reject" && application.everApproved) return fail(422, "INVALID_TRANSITION");
    if (action === "confirm-withdrawal" && application.withdrawal !== "requested") return fail(422, "INVALID_TRANSITION");
    application = { ...application, version: application.version + 1, review: ({ approve: "approved", return: "returned", hold: "held", reject: "rejected", reapprove: "approved", "confirm-withdrawal": "withdrawn" })[action] ?? application.review, everApproved: action === "approve" || application.everApproved };
    if (action === "approve" || action === "reapprove") application.published = { ...application.content, id: application.id, eventId: event.id, version: application.version, startsAt: body.data.startsAt ?? event.startsAt, endsAt: "2026-11-01T01:10:00.000Z", cancelled: false };
    if (action === "confirm-withdrawal") application = { ...application, withdrawal: "confirmed", slotReserved: false, published: null };
    result = application;
  } else {
    if (body.expectedVersion !== currentEvent.version) return fail(409, "VERSION_CONFLICT");
    if (path.endsWith("/copy")) { result = { ...currentEvent, id: "fixture-copy", version: 1, state: "scheduled", title: "架空LT会コピー" }; events.push(result); }
    else { Object.assign(currentEvent, body.data, { version: currentEvent.version + 1, ...(path.endsWith("/cancel") ? { state: "cancelled" } : {}) }); result = currentEvent; }
  }
  receipts.set(body.operationId, structuredClone(result));
  return Response.json(result);
};
function requestWithdrawal() { application = { ...application, version: application.version + 1, everApproved: true, slotReserved: true, review: "approved", withdrawal: "requested" }; }
createRoot(document.getElementById("root")).render(<main className="members-page">
  <p>以下は検証専用操作です</p>
  <button onClick={() => { nextFailure = 409; }}>検証: 次の更新を競合</button><button onClick={() => { nextFailure = 503; }}>検証: 次の更新を失敗</button>
  <button onClick={() => { application = { ...application, version: application.version + 1, review: "resubmitted" }; }}>検証: 本人が再提出</button><button onClick={requestWithdrawal}>検証: 辞退依頼を作成</button><button onClick={() => { application = { ...application, version: application.version + 1, withdrawal: "none" }; }}>検証: 本人が辞退依頼を取消</button>
  <button onClick={() => { denied = true; }}>検証: 権限を失効</button><button onClick={() => { denied = false; }}>検証: 権限を復旧</button>
  <h1>LT会</h1><LtManager />
</main>);
