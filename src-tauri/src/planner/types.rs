use serde::{Deserialize, Serialize};

pub(crate) const PLANNER_MAX_JSON_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const MIRROR_REGISTRY_FILE: &str = "mirror-registry.json";

pub const PLANNER_FILE_MANIFEST: &str = "manifest.json";
pub const PLANNER_FILE_TEMPLATES: &str = "templates.json";
pub const PLANNER_FILE_LAYOUT: &str = "layout-templates.json";
pub const PLANNER_FILE_GOALS: &str = "goals.json";
pub const PLANNER_FILE_REVIEWS: &str = "reviews.json";
pub const PLANNER_FILE_FIELD_HEIGHTS: &str = "field-heights.json";
pub const PLANNER_FILE_MIRROR_STATE: &str = "mirror-state.json";

pub(crate) const PLANNER_FILES: &[&str] = &[
    PLANNER_FILE_MANIFEST,
    PLANNER_FILE_TEMPLATES,
    PLANNER_FILE_LAYOUT,
    PLANNER_FILE_GOALS,
    PLANNER_FILE_REVIEWS,
    PLANNER_FILE_FIELD_HEIGHTS,
];

#[derive(Serialize, Deserialize, Default)]
pub(crate) struct MirrorRegistry {
    pub(crate) vault_paths: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct MirrorState {
    pub(crate) last_synced_unix: u64,
    pub(crate) source: String,
    pub(crate) read_only: bool,
}

#[derive(Serialize)]
pub struct PlannerSaveResult {
    pub mirror_error: Option<String>,
}

#[derive(Serialize)]
pub struct PlannerConfig {
    pub mode: String,
    pub setup_required: bool,
    pub active_dir: String,
    pub mirror_dir: String,
    pub mirror_last_synced_unix: Option<u64>,
}

#[derive(Serialize)]
pub struct PlannerMirrorStatus {
    pub mode: String,
    pub mirror_dir: String,
    pub mirror_last_synced_unix: Option<u64>,
    pub registered_vault_count: usize,
}

#[derive(Serialize)]
pub struct PlannerRestoreCheck {
    pub offer_restore: bool,
    pub vault_mirror_has_data: bool,
    pub shared_empty: bool,
}

