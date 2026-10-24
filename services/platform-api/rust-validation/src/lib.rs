mod batch;

use wasm_bindgen::prelude::*;

const DAY_MS: f64 = 86_400_000.0;

/// 日本時間の暦日番号を返す
///
/// # 引数
/// * `instant` - Unix エポックからのミリ秒
///
/// # 戻り値
/// 日本時間で区切った暦日番号
fn japan_day(instant: f64) -> f64 {
    // 日本時間の時差を加え日単位に切り捨てて暦日番号を返す
    ((instant + 32_400_000.0) / DAY_MS).floor()
}

/// 累積スナップショットの時刻と経過時間の整合性を検証する
///
/// # 引数
/// * `start` - 開始時刻のミリ秒
/// * `observed` - 最終観測時刻のミリ秒
/// * `ended` - 終了時刻のミリ秒 未終了は NaN
/// * `now` - 検証時刻のミリ秒
/// * `duration` - 累積プレイ秒数
/// * `running` - 実行中なら 1 終了済みなら 0
///
/// # 戻り値
/// 保持期間と未来時刻の許容幅を含む条件を満たせば 1 違反すれば 0
#[wasm_bindgen]
pub fn valid_timing(
    start: f64,
    observed: f64,
    ended: f64,
    now: f64,
    duration: f64,
    running: i32,
) -> i32 {
    // 終了時刻の未設定を表す NaN を判別する
    let has_end = !ended.is_nan();

    // 保持期間と未来時刻の許容幅に加え観測時間と終了状態の整合性を判定する
    let valid = start.is_finite()
        && observed.is_finite()
        && (!has_end || ended.is_finite())
        && japan_day(start) >= japan_day(now - 89.0 * DAY_MS)
        && start <= now + 300_000.0
        && observed >= start
        && observed <= now + 300_000.0
        && duration <= ((observed - start) / 1000.0).floor() + 2.0
        && (if running != 0 {
            !has_end
        } else {
            has_end && ended >= start && ended <= observed
        })
        && (!has_end || observed == ended);

    // Wasm 呼出元に判定結果を整数で返す
    i32::from(valid)
}

/// スキーマ検証済みの終了状態と終了コードの組み合わせを検証する
///
/// # 引数
/// * `outcome` - running=0 normal=1 abnormal=2 interrupted=3 launch_failed=4
/// * `exit_code` - 終了コード 未設定は NaN
/// * `crashed` - 未設定は -1 通常終了は 0 クラッシュは 1
/// * `duration` - 累積プレイ秒数
///
/// # 戻り値
/// 終了状態と各フィールドが整合すれば 1 違反すれば 0
#[wasm_bindgen]
pub fn valid_outcome(outcome: i32, exit_code: f64, crashed: i32, duration: f64) -> i32 {
    // 終了状態ごとに終了コードとクラッシュ情報とプレイ時間の組み合わせを判定する
    let valid = match outcome {
        1 => exit_code == 0.0 && crashed == 0,
        2 => crashed != -1 && (crashed == 1 || (!exit_code.is_nan() && exit_code != 0.0)),
        0 | 3 => exit_code.is_nan() && crashed == -1,
        4 => exit_code.is_nan() && crashed == -1 && duration == 0.0,
        _ => false,
    };

    // Wasm 呼出元に判定結果を整数で返す
    i32::from(valid)
}

/// 日本時間の日別配分を実際に観測された区間に制限する
///
/// # 引数
/// * `start` - 開始時刻のミリ秒
/// * `observed` - 最終観測時刻のミリ秒
/// * `day_start` - 配分対象日の日本時間午前零時のミリ秒
/// * `duration` - 配分する秒数
///
/// # 戻り値
/// 対象日と配分時間が許容範囲なら 1 違反すれば 0
#[wasm_bindgen]
pub fn valid_daily(start: f64, observed: f64, day_start: f64, duration: f64) -> i32 {
    // 対象日と観測区間が重なる秒数を求め秒未満の端数を切り上げる
    let available =
        ((observed.min(day_start + DAY_MS) - start.max(day_start)).max(0.0) / 1000.0).ceil();

    // 対象日と配分上限を確認し一秒の許容誤差を含む判定結果を整数で返す
    i32::from(
        day_start.is_finite()
            && japan_day(day_start) >= japan_day(start)
            && japan_day(day_start) <= japan_day(observed)
            && duration <= available + 1.0,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // 許容誤差の境界と未設定の終了時刻を確認する
    /// 時刻検証の境界条件を検証する
    ///
    /// # 戻り値
    /// なし 不一致時はテストを失敗させる
    #[test]
    fn timing_boundaries() {
        let now = 1_792_000_000_000.0;
        assert_eq!(valid_timing(now, now + 1000.0, f64::NAN, now, 3.0, 1), 1);
        assert_eq!(valid_timing(now, now + 1000.0, f64::NAN, now, 4.0, 1), 0);
        assert_eq!(valid_timing(now, now, f64::NAN, now, 0.0, 0), 0);
        assert_eq!(valid_timing(now, now, now, now, 0.0, 1), 0);
        assert_eq!(valid_timing(f64::NAN, now, now, now, 0.0, 0), 0);
    }

    // 異常終了と起動失敗の制約を確認する
    /// 終了状態の既存契約を検証する
    ///
    /// # 戻り値
    /// なし 不一致時はテストを失敗させる
    #[test]
    fn outcome_contract() {
        assert_eq!(valid_outcome(1, 0.0, 0, 10.0), 1);
        assert_eq!(valid_outcome(2, f64::NAN, 1, 10.0), 1);
        assert_eq!(valid_outcome(2, 0.0, 0, 10.0), 0);
        assert_eq!(valid_outcome(4, f64::NAN, -1, 1.0), 0);
        assert_eq!(valid_outcome(4, f64::NAN, -1, 0.0), 1);
    }
}
