/// アップロード受付の容量・ダイジェスト・形式を検証する
///
/// # 引数
/// * `bytes` - 申告容量
/// * `limit` - 用途に対応する上限
/// * `audio` - 音声用途か
/// * `digest` - SHA256 の小文字十六進表現
/// * `mime` - 申告 MIME
///
/// # 戻り値
/// 0 は許可、1 は容量違反、2 は形式違反
fn validate(bytes: f64, limit: f64, audio: bool, digest: &[u8], mime: &[u8]) -> u32 {
    // JavaScript の安全な正整数と既存の上限比較を維持する
    if !bytes.is_finite()
        || bytes.fract() != 0.0
        || bytes <= 0.0
        || bytes > 9_007_199_254_740_991.0
        || bytes > limit
    {
        return 1;
    }

    // 用途ごとの許可形式と SHA256 の表記を照合する
    let allowed = if audio {
        matches!(mime, b"audio/mpeg" | b"audio/wav")
    } else {
        matches!(mime, b"image/jpeg" | b"image/png" | b"image/webp")
    };
    if digest.len() != 64
        || !digest
            .iter()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))
        || !allowed
    {
        return 2;
    }
    0
}

// 同期呼び出し専用の入力領域を固定し、リクエスト由来のメモリ確保を避ける
static mut INPUT: [u8; 128] = [0; 128];

/// 入力領域の先頭を返す
///
/// # 戻り値
/// 128 バイトの固定領域のアドレス
#[unsafe(no_mangle)]
pub extern "C" fn upload_input() -> *mut u8 {
    core::ptr::addr_of_mut!(INPUT).cast()
}

/// 固定領域のダイジェストと MIME に受付ポリシーを適用する
///
/// # 引数
/// `bytes` と `limit` は容量、`audio` は用途、残りは各入力のバイト長
///
/// # 戻り値
/// 0 は許可、1 は容量違反、2 は形式違反
#[unsafe(no_mangle)]
pub extern "C" fn validate_upload(
    bytes: f64,
    limit: f64,
    audio: u32,
    digest_len: u32,
    mime_len: u32,
) -> u32 {
    // 容量エラーを形式エラーより先に返す契約を保持する
    let capacity = validate(bytes, limit, audio != 0, &[], &[]);
    if capacity == 1 {
        return 1;
    }
    if digest_len > 64 || mime_len > 64 {
        return 2;
    }

    // 呼び出し側は同期処理中だけ入力領域を使用する
    let input = unsafe { core::slice::from_raw_parts(upload_input(), 128) };
    validate(
        bytes,
        limit,
        audio != 0,
        &input[..digest_len as usize],
        &input[64..64 + mime_len as usize],
    )
}
