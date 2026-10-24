/// 公開ポインターの契約を検証する
///
/// # 引数
/// - `version`: バージョンのUTF-8バイト列
/// - `digest`: SHA-256の小文字16進バイト列
/// - `schema`: スキーマ番号
/// - `size`: 成果物のバイト数
///
/// # 戻り値
/// 全項目が契約を満たす場合はtrue、それ以外はfalse
fn valid(version: &[u8], digest: &[u8], schema: f64, size: f64) -> bool {
    // 先頭ゼロのない数値3要素を検証する
    let mut parts = version.split(|byte| *byte == b'.');
    let semver = (0..3).all(|_| {
        parts.next().is_some_and(|part| {
            !part.is_empty()
                && part.iter().all(u8::is_ascii_digit)
                && (part.len() == 1 || part[0] != b'0')
        })
    }) && parts.next().is_none();

    // ダイジェストとJavaScriptの安全整数範囲を検証する
    semver
        && digest.len() == 64
        && digest
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
        && schema == 1.0
        && size.is_finite()
        && size > 0.0
        && size <= 9_007_199_254_740_991.0
        && size.fract() == 0.0
}

// Workerは入力のコピーから検証までawaitを挟まず同期実行する
static mut INPUT: [u8; 8192] = [0; 8192];

/// 入力バッファーの先頭アドレスを取得する
///
/// # 引数
/// なし
///
/// # 戻り値
/// 8192バイトのWasm入力領域を指すアドレス
#[no_mangle]
pub extern "C" fn input_ptr() -> *mut u8 {
    std::ptr::addr_of_mut!(INPUT).cast()
}

/// 入力バッファー内のポインター項目を検証する
///
/// # 引数
/// - `version_len`: 先頭に格納したバージョンのバイト数
/// - `digest_len`: バージョン直後に格納したダイジェストのバイト数
/// - `schema`: スキーマ番号
/// - `size`: 成果物のバイト数
///
/// # 戻り値
/// 正常時は1、長さ超過または契約違反時は0
#[no_mangle]
pub extern "C" fn validate(version_len: u32, digest_len: u32, schema: f64, size: f64) -> u32 {
    // スライス生成前に入力領域の境界を確認する
    let length = u64::from(version_len) + u64::from(digest_len);
    if length > 8192 {
        return 0;
    }

    // 長さ確認済みの静的領域を同期的に読み取る
    let bytes = unsafe { std::slice::from_raw_parts(input_ptr(), length as usize) };
    valid(
        &bytes[..version_len as usize],
        &bytes[version_len as usize..],
        schema,
        size,
    ) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 有効値と契約違反を検証する
    ///
    /// # 引数
    /// なし
    ///
    /// # 戻り値
    /// なし、契約に反する結果の場合はテストを失敗させる
    #[test]
    fn pointer_contract() {
        let digest = [b'a'; 64];
        assert!(valid(b"0.1.999", &digest, 1.0, 9_007_199_254_740_991.0));
        for version in [
            "",
            "1.2",
            "1.2.3.4",
            "01.2.3",
            "1.2.3\n",
            "../../bad",
            "1.2.3-beta",
        ] {
            assert!(!valid(version.as_bytes(), &digest, 1.0, 3.0));
        }
        for size in [
            0.0,
            -1.0,
            0.5,
            f64::NAN,
            f64::INFINITY,
            9_007_199_254_740_992.0,
        ] {
            assert!(!valid(b"1.2.3", &digest, 1.0, size));
        }
        assert!(!valid(b"1.2.3", &[b'A'; 64], 1.0, 3.0));
        assert!(!valid(b"1.2.3", &digest, 2.0, 3.0));
        assert_eq!(validate(u32::MAX, 64, 1.0, 3.0), 0);
    }
}
