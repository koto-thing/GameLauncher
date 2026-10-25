-- 独立ジョブ: 現行実装はfloor(now_ms/3600000)の当時間bucketだけを参照する
-- 境界ちょうどで前bucketは不要。進行中のbucketは維持する
DELETE FROM lt_auth_rate WHERE bucket < CAST(:now_ms / 3600000 AS INTEGER);
