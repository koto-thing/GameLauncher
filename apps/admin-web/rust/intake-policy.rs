#![cfg_attr(not(test), no_std)]

/// 分割アップロードのパートサイズを返す
///
/// # 引数
/// なし
///
/// # 戻り値
/// パートサイズのバイト数
#[unsafe(no_mangle)]
pub extern "C" fn intake_part_size() -> u32 {
    64 * 1024 * 1024
}

/// 署名付きアップロード URL の有効期間を返す
///
/// # 引数
/// なし
///
/// # 戻り値
/// 有効期間の秒数
#[unsafe(no_mangle)]
pub extern "C" fn presigned_url_seconds() -> u32 {
    15 * 60
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 現行 API のアップロード条件が維持されることを確認する
    #[test]
    fn preserves_upload_contract() {
        assert_eq!(intake_part_size(), 67_108_864);
        assert_eq!(presigned_url_seconds(), 900);
    }
}

/// パニック時に Worker の処理を中断する
///
/// # 引数
/// * `_info` - パニックの詳細
///
/// # 戻り値
/// 呼び出し元へ戻らない
#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

/// パート番号の安全な整数と範囲を検証する
///
/// # 引数
/// * `part` - 受信したパート番号
/// * `count` - 保存済みパート数
///
/// # 戻り値
/// 有効なら 1、それ以外は 0
#[unsafe(no_mangle)]
pub extern "C" fn valid_part_number(part: f64, count: f64) -> u32 {
    // JavaScript の安全な整数判定と比較順を維持する
    (part.is_finite() && part.abs() <= 9_007_199_254_740_991.0
        && (part as i64) as f64 == part && part >= 1.0 && !(part > count)) as u32
}

/// 保存済みサイズからパートの期待容量を求める
///
/// # 引数
/// * `part` - 検証済みパート番号
/// * `count` - パート数
/// * `size` - 全体容量
/// * `part_size` - 通常パート容量
///
/// # 戻り値
/// 最終パートの残量または通常パート容量
#[unsafe(no_mangle)]
pub extern "C" fn expected_part_size(part: f64, count: f64, size: f64, part_size: f64) -> f64 {
    // 整数変換せず既存の倍精度演算を維持する
    if part == count { size - part_size * (count - 1.0) } else { part_size }
}
