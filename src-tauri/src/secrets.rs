//! Provider API keys live in the OS keychain. `settings.json` keeps the profile
//! and an empty `apiKey`. Plaintext is removed only after the keychain write
//! succeeds.

const SERVICE: &str = "com.metis.desktop";

fn account(profile_id: &str) -> Result<String, String> {
    if profile_id.is_empty()
        || profile_id.len() > 128
        || !profile_id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.')
    {
        return Err("Provider id cannot be stored in the keychain.".into());
    }
    Ok(format!("ai-provider:{profile_id}"))
}

fn entry(profile_id: &str) -> Result<keyring::Entry, String> {
    let account = account(profile_id)?;
    keyring::Entry::new(SERVICE, &account).map_err(|_| "The keychain is not available.".to_string())
}

pub(crate) fn store_api_key(profile_id: &str, api_key: &str) -> Result<(), String> {
    if api_key.is_empty() {
        delete_api_key(profile_id)?;
        return Ok(());
    }
    entry(profile_id)?
        .set_password(api_key)
        .map_err(|_| "Could not store the API key in the keychain.".to_string())
}

pub(crate) fn load_api_key(profile_id: &str) -> String {
    let Ok(entry) = entry(profile_id) else {
        return String::new();
    };
    match entry.get_password() {
        Ok(secret) => secret,
        Err(_) => String::new(),
    }
}

pub(crate) fn delete_api_key(profile_id: &str) -> Result<(), String> {
    let Ok(entry) = entry(profile_id) else {
        return Ok(());
    };
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Could not remove the API key from the keychain.".into()),
    }
}
