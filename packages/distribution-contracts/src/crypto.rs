use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signature, VerifyingKey};

/// Base64 を厳密に検証して固定の Ed25519 公開鍵を復号する
///
/// # 引数
///
/// * `encoded` - Base64 形式の鍵または署名
///
/// # 戻り値
///
/// 復号した Ed25519 公開鍵
pub fn public_key(encoded: &str) -> Result<VerifyingKey> {
    // Base64 を復号して Ed25519 公開鍵の長さに制限する
    let bytes: [u8; 32] = STANDARD
        .decode(encoded)
        .context("invalid public key Base64")?
        .try_into()
        .map_err(|_| anyhow::anyhow!("Ed25519 public key must contain 32 bytes"))?;

    // 鍵の表現を検証して暗号処理用の型へ変換する
    VerifyingKey::from_bytes(&bytes).context("invalid Ed25519 public key")
}

/// 不正な文字やパディングを拒否して署名を復号する
///
/// # 引数
///
/// * `encoded` - Base64 形式の鍵または署名
///
/// # 戻り値
///
/// 復号した Ed25519 署名
pub fn signature(encoded: &str) -> Result<Signature> {
    let bytes = STANDARD
        .decode(encoded)
        .context("invalid signature Base64")?;

    // 署名の長さを確認して固定長の署名へ変換する
    ensure!(bytes.len() == 64, "Ed25519 signature must contain 64 bytes");
    Ok(Signature::from_slice(&bytes)?)
}

/// 固定公開鍵と厳密な Ed25519 検証で元のバイト列の署名を確認する
///
/// # 引数
///
/// * `payload` - 署名または検証の対象となる元のバイト列
/// * `encoded_signature` - Base64 形式の Ed25519 署名
/// * `encoded_key` - Base64 形式の固定公開鍵
///
/// # 戻り値
///
/// 検証に成功した場合は Ok(())
pub fn verify(payload: &[u8], encoded_signature: &str, encoded_key: &str) -> Result<()> {
    public_key(encoded_key)?
        .verify_strict(payload, &signature(encoded_signature)?)
        .context("manifest signature is invalid")
}

/// Publisher 向けビルドで PKCS#8 秘密鍵を使い元のバイト列に署名する
///
/// # 引数
///
/// * `payload` - 署名または検証の対象となる元のバイト列
/// * `private_key_pem` - PKCS#8 PEM 形式の Ed25519 秘密鍵
///
/// # 戻り値
///
/// Base64 形式の Ed25519 署名
#[cfg(feature = "signing")]
pub fn sign(payload: &[u8], private_key_pem: &str) -> Result<String> {
    use ed25519_dalek::{Signer, SigningKey, pkcs8::DecodePrivateKey};
    let key = SigningKey::from_pkcs8_pem(private_key_pem)
        .context("invalid Ed25519 PKCS#8 signing key")?;
    Ok(STANDARD.encode(key.sign(payload).to_bytes()))
}
