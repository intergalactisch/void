use crate::error::VoidError;

const SERVICE_NAME: &str = "void";

/// Store a credential in the system keychain
#[tauri::command]
pub async fn store_credential(key: String, value: String) -> Result<(), VoidError> {
    // Run keyring operations in a blocking task since keyring is not async
    tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new(SERVICE_NAME, &key)
            .map_err(|e| VoidError::Keychain(e.to_string()))?;
        entry
            .set_password(&value)
            .map_err(|e| VoidError::Keychain(e.to_string()))
    })
    .await
    .map_err(|e| VoidError::Keychain(e.to_string()))?
}

/// Get a credential from the system keychain
#[tauri::command]
pub async fn get_credential(key: String) -> Result<Option<String>, VoidError> {
    tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new(SERVICE_NAME, &key)
            .map_err(|e| VoidError::Keychain(e.to_string()))?;

        match entry.get_password() {
            Ok(password) => Ok(Some(password)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(VoidError::Keychain(e.to_string())),
        }
    })
    .await
    .map_err(|e| VoidError::Keychain(e.to_string()))?
}

/// Delete a credential from the system keychain
#[tauri::command]
pub async fn delete_credential(key: String) -> Result<(), VoidError> {
    tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new(SERVICE_NAME, &key)
            .map_err(|e| VoidError::Keychain(e.to_string()))?;

        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()), // Already deleted, that's fine
            Err(e) => Err(VoidError::Keychain(e.to_string())),
        }
    })
    .await
    .map_err(|e| VoidError::Keychain(e.to_string()))?
}

/// Check if a credential exists in the system keychain
#[tauri::command]
pub async fn has_credential(key: String) -> Result<bool, VoidError> {
    tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new(SERVICE_NAME, &key)
            .map_err(|e| VoidError::Keychain(e.to_string()))?;

        match entry.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(VoidError::Keychain(e.to_string())),
        }
    })
    .await
    .map_err(|e| VoidError::Keychain(e.to_string()))?
}
