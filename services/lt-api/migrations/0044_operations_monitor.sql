-- 定期処理だけが更新する稼働記録
CREATE TABLE lt_maintenance_status (
 id INTEGER PRIMARY KEY CHECK(id=1),
 started_at INTEGER,
 completed_at INTEGER,
 succeeded_at INTEGER,
 outcome TEXT NOT NULL DEFAULT 'never' CHECK(outcome IN ('never','running','ok','failed'))
);
INSERT INTO lt_maintenance_status(id) VALUES(1);
