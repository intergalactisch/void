use crate::error::VoidError;
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

const ALGORITHM: &str = "AES-256-GCM";
const VERSION: u8 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedStringEnvelope {
    pub version: u8,
    pub algorithm: String,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WrappedKeyMaterial {
    pub version: u8,
    pub algorithm: String,
    pub nonce: String,
    pub ciphertext: String,
    pub kdf: String,
    pub salt: Option<String>,
}

#[tauri::command]
pub async fn protection_generate_key() -> Result<String, VoidError> {
    let mut key = Zeroizing::new([0u8; 32]);
    OsRng.fill_bytes(key.as_mut());
    Ok(STANDARD.encode(key.as_slice()))
}

#[tauri::command]
pub async fn protection_random_id(prefix: String) -> Result<String, VoidError> {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    let hex = bytes
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect::<String>();
    Ok(format!("{}_{}", sanitize_prefix(&prefix), hex))
}

#[tauri::command]
pub async fn protection_encrypt_string(
    plaintext: String,
    key: String,
    associated_data: String,
) -> Result<EncryptedStringEnvelope, VoidError> {
    encrypt_with_key(&plaintext, &key, associated_data.as_bytes())
}

#[tauri::command]
pub async fn protection_decrypt_string(
    envelope: EncryptedStringEnvelope,
    key: String,
    associated_data: String,
) -> Result<String, VoidError> {
    decrypt_with_key(&envelope, &key, associated_data.as_bytes())
}

#[tauri::command]
pub async fn protection_wrap_key_with_passphrase(
    key_to_wrap: String,
    passphrase: String,
    associated_data: String,
) -> Result<WrappedKeyMaterial, VoidError> {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let wrapping_key = derive_passphrase_key(&passphrase, &salt)?;
    let encrypted = encrypt_with_key(&key_to_wrap, &STANDARD.encode(wrapping_key.as_slice()), associated_data.as_bytes())?;
    Ok(WrappedKeyMaterial {
        version: encrypted.version,
        algorithm: encrypted.algorithm,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        kdf: "argon2id".to_string(),
        salt: Some(STANDARD.encode(salt)),
    })
}

#[tauri::command]
pub async fn protection_unwrap_key_with_passphrase(
    wrapped: WrappedKeyMaterial,
    passphrase: String,
    associated_data: String,
) -> Result<String, VoidError> {
    let salt = wrapped
        .salt
        .as_deref()
        .ok_or_else(|| VoidError::Keychain("Recovery material is missing a salt".to_string()))?;
    let salt_bytes = STANDARD
        .decode(salt)
        .map_err(|_| VoidError::Keychain("Recovery salt is invalid".to_string()))?;
    let wrapping_key = derive_passphrase_key(&passphrase, &salt_bytes)?;
    decrypt_with_key(
        &EncryptedStringEnvelope {
            version: wrapped.version,
            algorithm: wrapped.algorithm,
            nonce: wrapped.nonce,
            ciphertext: wrapped.ciphertext,
        },
        &STANDARD.encode(wrapping_key.as_slice()),
        associated_data.as_bytes(),
    )
}

fn encrypt_with_key(
    plaintext: &str,
    key_b64: &str,
    associated_data: &[u8],
) -> Result<EncryptedStringEnvelope, VoidError> {
    let key = decode_key(key_b64)?;
    let cipher = Aes256Gcm::new_from_slice(key.as_slice())
        .map_err(|_| VoidError::Keychain("Protection key is invalid".to_string()))?;

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext.as_bytes(),
                aad: associated_data,
            },
        )
        .map_err(|_| VoidError::Keychain("Encryption failed".to_string()))?;

    Ok(EncryptedStringEnvelope {
        version: VERSION,
        algorithm: ALGORITHM.to_string(),
        nonce: STANDARD.encode(nonce_bytes),
        ciphertext: STANDARD.encode(ciphertext),
    })
}

fn decrypt_with_key(
    envelope: &EncryptedStringEnvelope,
    key_b64: &str,
    associated_data: &[u8],
) -> Result<String, VoidError> {
    if envelope.version != VERSION || envelope.algorithm != ALGORITHM {
        return Err(VoidError::Keychain(
            "Protected envelope version or algorithm is not supported".to_string(),
        ));
    }

    let key = decode_key(key_b64)?;
    let nonce = STANDARD
        .decode(&envelope.nonce)
        .map_err(|_| VoidError::Keychain("Protection nonce is invalid".to_string()))?;
    let ciphertext = STANDARD
        .decode(&envelope.ciphertext)
        .map_err(|_| VoidError::Keychain("Protection ciphertext is invalid".to_string()))?;

    let cipher = Aes256Gcm::new_from_slice(key.as_slice())
        .map_err(|_| VoidError::Keychain("Protection key is invalid".to_string()))?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad: associated_data,
            },
        )
        .map_err(|_| VoidError::Keychain("Protected content could not be decrypted".to_string()))?;

    String::from_utf8(plaintext)
        .map_err(|_| VoidError::Keychain("Protected content was not UTF-8".to_string()))
}

fn decode_key(key_b64: &str) -> Result<Zeroizing<Vec<u8>>, VoidError> {
    let key = STANDARD
        .decode(key_b64)
        .map_err(|_| VoidError::Keychain("Protection key is not valid base64".to_string()))?;
    if key.len() != 32 {
        return Err(VoidError::Keychain(
            "Protection key must be 32 bytes".to_string(),
        ));
    }
    Ok(Zeroizing::new(key))
}

fn derive_passphrase_key(passphrase: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, VoidError> {
    let mut output = Zeroizing::new([0u8; 32]);
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), salt, output.as_mut())
        .map_err(|_| VoidError::Keychain("Could not derive recovery key".to_string()))?;
    Ok(output)
}

fn sanitize_prefix(prefix: &str) -> String {
    let sanitized = prefix
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
        .collect::<String>();
    if sanitized.is_empty() {
        "id".to_string()
    } else {
        sanitized
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn roundtrip_detects_tamper() {
        let key = protection_generate_key().await.unwrap();
        let aad = "void:test".to_string();
        let envelope = protection_encrypt_string("SECRET=value".to_string(), key.clone(), aad.clone())
            .await
            .unwrap();
        let plain = protection_decrypt_string(envelope.clone(), key.clone(), aad.clone())
            .await
            .unwrap();
        assert_eq!(plain, "SECRET=value");

        let mut tampered = envelope;
        tampered.ciphertext.push('A');
        assert!(protection_decrypt_string(tampered, key, aad).await.is_err());
    }

    #[tokio::test]
    async fn recovery_passphrase_wraps_workspace_key() {
        let key = protection_generate_key().await.unwrap();
        let wrapped = protection_wrap_key_with_passphrase(
            key.clone(),
            "correct horse battery staple".to_string(),
            "void:recovery".to_string(),
        )
        .await
        .unwrap();
        let restored = protection_unwrap_key_with_passphrase(
            wrapped,
            "correct horse battery staple".to_string(),
            "void:recovery".to_string(),
        )
        .await
        .unwrap();
        assert_eq!(restored, key);
    }
}
