-- Optional local-tested indexes; production application requires separate approval
-- Each index also consumes storage and adds rows written on updates
CREATE INDEX analytics_daily_period ON analytics_daily(environment, date, game_id, game_version);
CREATE INDEX session_daily_date ON session_daily_durations(date, session_id);
