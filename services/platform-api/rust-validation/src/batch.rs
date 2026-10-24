use std::collections::HashSet;

use chrono::{DateTime, NaiveDate, NaiveDateTime, Timelike};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::{valid_daily, valid_outcome, valid_timing};

// スキーマだけで検証できる認証情報と版情報は所有文字列として複製せず読み飛ばす
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Batch {
    installation_id: String,
    sessions: Vec<Session>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    session_id: String,
    game_id: String,
    environment: String,
    started_at: String,
    last_observed_at: String,
    ended_at: Option<String>,
    duration_seconds: u32,
    outcome: String,
    exit_code: Option<i32>,
    crashed: Option<bool>,
    daily_durations: Vec<DailyDuration>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DailyDuration {
    date: String,
    duration_seconds: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Normalization {
    installation_id: String,
    sessions: Vec<NormalizedSession>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedSession {
    session_id: String,
    started_at: String,
    last_observed_at: String,
    ended_at: Option<String>,
}

/// スキーマ検証済み UTC 文字列を既存の Date.parse と同じミリ秒に変換する
///
/// # 引数
/// * `value` - UTC の ISO 8601 文字列
///
/// # 戻り値
/// Unix ミリ秒 解析不能または閏秒の場合は既存の時刻エラー
fn timestamp(value: &str) -> Result<f64, &'static str> {
    // JavaScript が受け付けない閏秒は Chrono が解析できても拒否する
    let parsed = NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S%.fZ")
        .map_err(|_| "invalid session timing")?;

    if parsed.nanosecond() >= 1_000_000_000 {
        return Err("invalid session timing");
    }

    // ミリ秒単位の既存 ABI に変換する
    Ok(parsed.and_utc().timestamp_millis() as f64)
}

/// JavaScript の trim と同じ空白集合で許可ゲーム ID の端を取り除く
///
/// # 引数
/// * `value` - カンマ区切りから切り出したゲーム ID
///
/// # 戻り値
/// ECMAScript の空白と改行を端から除いた文字列
fn trim_id(value: &str) -> &str {
    // Rust の標準空白判定と異なる BOM と NEXT LINE の扱いを明示する
    value.trim_matches(|c| {
        matches!(c,
        '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
        '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' |
        '\u{205f}' | '\u{3000}' | '\u{feff}')
    })
}

/// 検証済み時刻を従来と同じ UTC ミリ秒精度に正規化する
///
/// # 引数
/// * `millis` - 検証済みの Unix ミリ秒
///
/// # 戻り値
/// ISO 8601 文字列 変換不能なら既存の時刻エラー
fn normalized(millis: f64) -> Result<String, &'static str> {
    // 有効範囲の時刻だけを整形し既存の末尾 .000Z も維持する
    DateTime::from_timestamp_millis(millis as i64)
        .map(|date| date.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
        .ok_or("invalid session timing")
}

/// バッチ全体の意味検証と正規化を既存の順序で実行する
///
/// # 引数
/// * `batch` - JSON Schema に適合したバッチ
/// * `allowed_ids` - カンマ区切りの許可ゲーム ID
/// * `environment` - Worker の実行環境
/// * `now` - 検証時刻の Unix ミリ秒
///
/// # 戻り値
/// 正規化したバッチ 最初の違反では既存のエラーメッセージ
fn validate(
    mut batch: Batch,
    allowed_ids: &str,
    environment: &str,
    now: f64,
) -> Result<Batch, &'static str> {
    // 許可リストを正規化しセッション ID の重複をバッチ単位で記録する
    let allowed: HashSet<&str> = allowed_ids
        .split(',')
        .map(trim_id)
        .filter(|id| !id.is_empty())
        .collect();
    let mut ids = HashSet::new();
    batch.installation_id.make_ascii_lowercase();

    for session in &mut batch.sessions {
        // ゲームと環境と重複のエラーを時刻エラーより先に返す
        session.session_id.make_ascii_lowercase();

        if !allowed.contains(session.game_id.as_str())
            || session.environment != environment
            || !ids.insert(session.session_id.clone())
        {
            return Err("unknown game, environment, or duplicate session");
        }

        // 時刻を解析して Part1 の意味検証を再利用する
        let start = timestamp(&session.started_at)?;
        let observed = timestamp(&session.last_observed_at)?;
        let ended = session.ended_at.as_deref().map(timestamp).transpose()?;

        if valid_timing(
            start,
            observed,
            ended.unwrap_or(f64::NAN),
            now,
            session.duration_seconds as f64,
            i32::from(session.outcome == "running"),
        ) == 0
        {
            return Err("invalid session timing");
        }

        // 終了状態を Part1 の数値判定へ渡して終了コードとの整合性を確認する
        let outcome = match session.outcome.as_str() {
            "running" => 0,
            "normal" => 1,
            "abnormal" => 2,
            "interrupted" => 3,
            "launch_failed" => 4,
            _ => -1,
        };

        if valid_outcome(
            outcome,
            session.exit_code.map(f64::from).unwrap_or(f64::NAN),
            session.crashed.map(i32::from).unwrap_or(-1),
            session.duration_seconds as f64,
        ) == 0
        {
            return Err("invalid session outcome");
        }

        // 日付の重複と観測区間への配分上限を順に検証する
        let mut dates = HashSet::new();
        let mut total = 0_u32;

        for part in &session.daily_durations {
            // 日本時間午前零時を Unix ミリ秒に変換する
            let day_start = NaiveDate::parse_from_str(&part.date, "%Y-%m-%d")
                .ok()
                .and_then(|date| date.and_hms_opt(0, 0, 0))
                .map(|date| date.and_utc().timestamp_millis() as f64 - 32_400_000.0)
                .ok_or("invalid daily duration")?;

            if !dates.insert(part.date.as_str())
                || valid_daily(start, observed, day_start, part.duration_seconds as f64) == 0
            {
                return Err("invalid daily duration");
            }

            // 上限を検証した配分だけをセッション合計へ加える
            total += part.duration_seconds;
        }

        // 日別配分の合計と累積時間の不一致を既存の専用エラーで返す
        if total != session.duration_seconds {
            return Err("daily duration total does not match session");
        }

        // 検証を通過したセッションだけを既存の形式へ正規化する
        session.started_at = normalized(start)?;
        session.last_observed_at = normalized(observed)?;
        session.ended_at = ended.map(normalized).transpose()?;
    }

    // 全セッションを検証したバッチを返す
    Ok(batch)
}

/// JSON 境界でバッチ全体を検証し標準の wasm-bindgen で文字列を受け渡す
///
/// # 引数
/// * `json` - ホスト側の正規スキーマで検証した JSON
/// * `allowed_ids` - カンマ区切りの許可ゲーム ID
/// * `environment` - Worker の実行環境
/// * `now` - 検証時刻の Unix ミリ秒
///
/// # 戻り値
/// 正規化したフィールドだけの JSON 解析不能または意味検証の違反では既存のエラーメッセージを送出する
#[wasm_bindgen]
pub fn validate_batch(
    json: &str,
    allowed_ids: &str,
    environment: &str,
    now: f64,
) -> Result<String, String> {
    // 型付きデータへ変換しバッチ全体の検証を行う
    let batch: Batch = serde_json::from_str(json).map_err(|_| "invalid session payload")?;
    let validated = validate(batch, allowed_ids, environment, now)?;

    // 未変更の日別配列を再転送せず正規化したフィールドだけを型付きで抽出する
    let normalization = Normalization {
        installation_id: validated.installation_id,
        sessions: validated
            .sessions
            .into_iter()
            .map(|session| NormalizedSession {
                session_id: session.session_id,
                started_at: session.started_at,
                last_observed_at: session.last_observed_at,
                ended_at: session.ended_at,
            })
            .collect(),
    };

    // シリアライズは標準ライブラリに委ね独自のメモリ管理を持たない
    serde_json::to_string(&normalization).map_err(|_| "invalid session payload".to_string())
}
