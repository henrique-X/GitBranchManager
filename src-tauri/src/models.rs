use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Repo {
    /// 平台内唯一键: github/gitee = "owner/name"; gitlab = 数字 id 字符串
    pub id: String,
    pub name: String,
    /// owner/name 或 path_with_namespace
    pub full_name: String,
    pub platform: String,
    /// 是否组织/群组仓库
    pub is_org: bool,
    /// 来源描述: 个人 / 组织名 / 群组名
    pub source_label: String,
    /// private / public / internal
    pub visibility: String,
    pub default_branch: Option<String>,
    pub web_url: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepoPage {
    pub repos: Vec<Repo>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Branch {
    pub name: String,
    pub sha: Option<String>,
    pub message: Option<String>,
    pub author: Option<String>,
    pub date: Option<String>,
    /// None = 无法识别保护状态（按冻结需求：视为保护分支，不可删）
    pub protected: Option<bool>,
}
