const SERVICE: &str = "GitBranchManager";

pub fn credential_key(platform: &str, id: i64) -> String {
    format!("{SERVICE}/{platform}/{id}")
}

fn entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, key).map_err(|e| format!("访问凭据管理器失败: {e}"))
}

pub fn set_pat(key: &str, pat: &str) -> Result<(), String> {
    entry(key)?
        .set_password(pat)
        .map_err(|e| format!("保存 PAT 到凭据管理器失败: {e}"))
}

pub fn get_pat(key: &str) -> Result<String, String> {
    entry(key)?
        .get_password()
        .map_err(|e| format!("读取 PAT 失败: {e}"))
}

pub fn delete_pat(key: &str) -> Result<(), String> {
    match entry(key)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(e) => {
            let msg = e.to_string().to_lowercase();
            if msg.contains("not found") || msg.contains("no entry") {
                Ok(()) // 凭据本就不存在，视为删除成功
            } else {
                Err(format!("清除凭据管理器中的 PAT 失败: {e}"))
            }
        }
    }
}
