-- 起動確認も開催前の固定時刻で実行し、実行日による募集終了を防ぐ
UPDATE lt_clock SET now_ms=unixepoch('2026-10-25T12:00:00.000Z')*1000 WHERE id=1;
INSERT INTO lt_events(id,state,public_opens_at) VALUES('open','scheduled',0);
INSERT INTO lt_public_events VALUES('open','{"version": 1, "title": "架空LT", "venue": "試験会場", "guidance": "試験", "startsAt": "2026-11-01T01:00:00.000Z", "endsAt": "2026-11-01T02:00:00.000Z", "timeZone": "Asia/Tokyo", "recruitment": "open", "schedule": [], "id": "open"}');
INSERT INTO lt_events(id,state,public_opens_at) VALUES('hidden','draft',0);
INSERT INTO lt_public_events VALUES('hidden','{"version": 1, "title": "架空LT", "venue": "試験会場", "guidance": "試験", "startsAt": "2026-11-01T01:00:00.000Z", "endsAt": "2026-11-01T02:00:00.000Z", "timeZone": "Asia/Tokyo", "recruitment": "open", "schedule": [], "id": "hidden"}');
INSERT INTO lt_events(id,state,public_opens_at) VALUES('cancelled','cancelled',0);
INSERT INTO lt_public_events VALUES('cancelled','{"version": 1, "title": "架空LT", "venue": "試験会場", "guidance": "試験", "startsAt": "2026-11-01T01:00:00.000Z", "endsAt": "2026-11-01T02:00:00.000Z", "timeZone": "Asia/Tokyo", "recruitment": "open", "schedule": [], "id": "cancelled"}');
