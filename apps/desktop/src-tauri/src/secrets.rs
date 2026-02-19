/// Encrypted secret store backed by iota_stronghold.
///
/// This provides a simple key-value interface over the Stronghold store API,
/// handling vault initialization, snapshot persistence, and client lifecycle
/// internally. The vault is unlocked automatically at startup using a key
/// derived by the same argon2 path as the tauri-plugin-stronghold plugin.
///
/// All stored values are `Vec<u8>`. Callers are responsible for encoding and
/// decoding (e.g. UTF-8 for API key strings).
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use iota_stronghold::{KeyProvider, SnapshotPath};
use zeroize::Zeroizing;

use crate::error::AppError;

const CLIENT_NAME: &[u8] = b"muppet_secrets_v1";

pub struct SecretStore {
    stronghold: iota_stronghold::Stronghold,
    snapshot_path: SnapshotPath,
    keyprovider: KeyProvider,
    // Serializes multi-step operations (get_client → store op → save) so
    // concurrent Tauri async commands cannot interleave and corrupt the snapshot.
    lock: Mutex<()>,
}

impl SecretStore {
    /// Open (or create) a Stronghold snapshot at `snapshot_path` using the
    /// provided derived `key` bytes.
    pub fn open(snapshot_path: &Path, key: Vec<u8>) -> Result<Self, AppError> {
        let snap = SnapshotPath::from_path(snapshot_path);
        let stronghold = iota_stronghold::Stronghold::default();
        let keyprovider =
            KeyProvider::try_from(Zeroizing::new(key)).map_err(|e| {
                AppError::SecretStore(format!("key provider error: {e}"))
            })?;

        if snap.exists() {
            stronghold
                .load_snapshot(&keyprovider, &snap)
                .map_err(|e| AppError::SecretStore(format!("load snapshot: {e}")))?;
        }

        // Ensure the client exists inside the snapshot.
        // `create_client` is idempotent when the snapshot was just loaded —
        // if it already exists we catch the error and try `load_client`.
        if stronghold.create_client(CLIENT_NAME).is_err() {
            stronghold
                .load_client(CLIENT_NAME)
                .map_err(|e| AppError::SecretStore(format!("load client: {e}")))?;
        }

        Ok(Self {
            stronghold,
            snapshot_path: snap,
            keyprovider,
            lock: Mutex::new(()),
        })
    }

    /// Acquire the operations lock and return the Stronghold client.
    fn locked_client(
        &self,
    ) -> Result<
        (
            std::sync::MutexGuard<'_, ()>,
            iota_stronghold::Client,
        ),
        AppError,
    > {
        let guard = self.lock.lock().expect("secret store lock poisoned");
        let client = self
            .stronghold
            .get_client(CLIENT_NAME)
            .map_err(|e| AppError::SecretStore(format!("get client: {e}")))?;
        Ok((guard, client))
    }

    /// Write a secret under `key`. Overwrites any existing value.
    pub fn insert(&self, key: &str, value: Vec<u8>) -> Result<(), AppError> {
        let (_guard, client) = self.locked_client()?;
        client
            .store()
            .insert(key.as_bytes().to_vec(), value, None)
            .map_err(|e| AppError::SecretStore(format!("store insert: {e}")))?;
        self.save()
    }

    /// Read the secret stored under `key`. Returns `None` if not found.
    pub fn get(&self, key: &str) -> Result<Option<Vec<u8>>, AppError> {
        let (_guard, client) = self.locked_client()?;
        client
            .store()
            .get(key.as_bytes())
            .map_err(|e| AppError::SecretStore(format!("store get: {e}")))
    }

    /// Remove the secret stored under `key`. No-ops if the key does not exist.
    pub fn remove(&self, key: &str) -> Result<(), AppError> {
        let (_guard, client) = self.locked_client()?;
        // Check whether the key exists before deleting — the underlying
        // Stronghold store returns an error when deleting a missing key,
        // but callers expect a silent no-op in that case.
        match client.store().get(key.as_bytes()) {
            Ok(Some(_)) => {}
            Ok(None) => return Ok(()),
            Err(e) => {
                return Err(AppError::SecretStore(format!("store get (pre-delete): {e}")));
            }
        }
        client
            .store()
            .delete(key.as_bytes())
            .map_err(|e| AppError::SecretStore(format!("store delete: {e}")))?;
        self.save()
    }

    /// Flush the in-memory state to the encrypted snapshot on disk.
    fn save(&self) -> Result<(), AppError> {
        self.stronghold
            .commit_with_keyprovider(&self.snapshot_path, &self.keyprovider)
            .map_err(|e| AppError::SecretStore(format!("commit snapshot: {e}")))
    }
}

/// Derive the vault key bytes from the salt file using argon2, matching the
/// derivation used by tauri-plugin-stronghold's `Builder::with_argon2`.
///
/// The salt file is read (or created with random bytes if missing). The fixed
/// password string `VAULT_PASSWORD` is then hashed with argon2 to produce the
/// key.
///
/// Panics if the salt file cannot be read or created (e.g. unwritable path).
pub fn derive_vault_key(salt_path: &Path) -> Vec<u8> {
    use tauri_plugin_stronghold::kdf::KeyDerivation;
    KeyDerivation::argon2(VAULT_PASSWORD, salt_path)
}

/// Snapshot file name for the app's secret store.
pub fn snapshot_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("secrets.hold")
}

// SECURITY NOTE: This password is compiled into the binary. Combined with the
// plaintext salt file stored alongside the encrypted snapshot, the protection
// is equivalent to OS-level file permissions — it prevents casual reads of the
// raw snapshot file, but does NOT protect secrets if an attacker has access to
// both the app data directory and the binary. A user-provided passphrase or
// OS keychain integration would be needed for stronger protection.
const VAULT_PASSWORD: &str = "muppet-internal-vault-v1";
