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
