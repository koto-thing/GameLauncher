-- この開発DB導入前の終了日時が不明な架空回だけ、導入観測時刻を保持開始の提案値にする
-- 公開アーカイブは変更せず、削除もしない
UPDATE lt_events SET state=state WHERE state IN ('ended','cancelled') AND private_expires IS NULL;
