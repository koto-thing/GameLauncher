use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signature, VerifyingKey};

/// Decode a pinned raw Ed25519 public key with strict Base64 validation
pub fn public_key(encoded: &str) -> Result<VerifyingKey> {
    let bytes: [u8; 32] = STANDARD
        .decode(encoded)
        .context("invalid public key Base64")?
        .try_into()
        .map_err(|_| anyhow::anyhow!("Ed25519 public key must contain 32 bytes"))?;
    VerifyingKey::from_bytes(&bytes).context("invalid Ed25519 public key")
}

/// Decode a signature without accepting ignored characters or noncanonical padding
pub fn signature(encoded: &str) -> Result<Signature> {
    let bytes = STANDARD
        .decode(encoded)
        .context("invalid signature Base64")?;
    ensure!(bytes.len() == 64, "Ed25519 signature must contain 64 bytes");
    Ok(Signature::from_slice(&bytes)?)
}

/// Verify exact payload bytes using the pinned key and strict Ed25519 checks
pub fn verify(payload: &[u8], encoded_signature: &str, encoded_key: &str) -> Result<()> {
    public_key(encoded_key)?
        .verify_strict(payload, &signature(encoded_signature)?)
        .context("manifest signature is invalid")
}

/// Sign exact payload bytes using a PKCS#8 key only in publisher builds
#[cfg(feature = "signing")]
pub fn sign(payload: &[u8], private_key_pem: &str) -> Result<String> {
    use ed25519_dalek::{Signer, SigningKey, pkcs8::DecodePrivateKey};
    let key = SigningKey::from_pkcs8_pem(private_key_pem)
        .context("invalid Ed25519 PKCS#8 signing key")?;
    Ok(STANDARD.encode(key.sign(payload).to_bytes()))
}
