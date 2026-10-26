-- 私有申請と公開版を分離し、全体中止は親の状態で遮断する
CREATE TABLE lt_events(id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('draft','scheduled','started','ended','cancelled')));
CREATE TABLE lt_public_events(event_id TEXT PRIMARY KEY REFERENCES lt_events(id), dto TEXT NOT NULL CHECK(json_valid(dto)));
CREATE TABLE lt_public_talks(id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES lt_events(id), dto TEXT NOT NULL CHECK(json_valid(dto)));
