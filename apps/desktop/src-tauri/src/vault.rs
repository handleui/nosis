use tracing::error;
use zeroize::Zeroize;

use crate::error::AppError;

const CLIENT_NAME: &[u8] = b"api-keys";

pub struct ApiKeyVault {
    pub stronghold: iota_stronghold::Stronghold,
    pub snapshot_path: iota_stronghold::SnapshotPath,
    pub vault_key: zeroize::Zeroizing<Vec<u8>>,
}

impl ApiKeyVault {
    pub fn client(&self) -> Result<iota_stronghold::Client, AppError> {
        self.stronghold.get_client(CLIENT_NAME).map_err(|e| {
            error!(error = ?e, "failed to get stronghold client");
            AppError::Internal("Vault operation failed".into())
        })
    }

    pub fn commit(&self) -> Result<(), AppError> {
        let keyprovider =
            iota_stronghold::KeyProvider::try_from(self.vault_key.clone()).map_err(|e| {
                error!(error = ?e, "failed to create key provider");
                AppError::Internal("Vault operation failed".into())
            })?;

        self.stronghold
            .commit_with_keyprovider(&self.snapshot_path, &keyprovider)
            .map_err(|e| {
                error!(error = ?e, "failed to commit stronghold snapshot");
                AppError::Internal("Failed to persist API key".into())
            })
    }

    pub fn read_key(&self, provider: &str) -> Result<Option<String>, AppError> {
        let client = self.client()?;
        let store_key = format!("api_key:{provider}");

        match client.store().get(store_key.as_bytes()) {
            Ok(Some(data)) => match String::from_utf8(data) {
                Ok(value) => Ok(Some(value)),
                Err(e) => {
                    e.into_bytes().zeroize();
                    Err(AppError::Internal("Corrupted API key data".into()))
                }
            },
            Ok(None) => Ok(None),
            Err(e) => {
                error!(error = ?e, "failed to read from stronghold store");
                Err(AppError::Internal("Failed to retrieve API key".into()))
            }
        }
    }

    pub fn store_key(&self, provider: &str, key_bytes: Vec<u8>) -> Result<(), AppError> {
        let client = self.client()?;
        let store_key = format!("api_key:{provider}");
        client
            .store()
            .insert(store_key.into_bytes(), key_bytes, None)
            .map_err(|e| {
                error!(error = ?e, "failed to insert into stronghold store");
                AppError::Internal("Failed to store API key".into())
            })?;
        self.commit()
    }

    pub fn delete_key(&self, provider: &str) -> Result<(), AppError> {
        let client = self.client()?;
        let store_key = format!("api_key:{provider}");
        let _ = client.store().delete(store_key.as_bytes());
        self.commit()
    }
}
