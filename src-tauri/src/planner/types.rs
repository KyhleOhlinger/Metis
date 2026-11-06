use serde::Serialize;

pub(crate) const PLANNER_MAX_JSON_BYTES: usize = 16 * 1024 * 1024;

pub const PLANNER_FILE_MANIFEST: &str = "manifest.json";
pub const PLANNER_FILE_TEMPLATES: &str = "templates.json";
pub const PLANNER_FILE_LAYOUT: &str = "layout-templates.json";
pub const PLANNER_FILE_GOALS: &str = "goals.json";
pub const PLANNER_FILE_REVIEWS: &str = "reviews.json";
pub const PLANNER_FILE_FIELD_HEIGHTS: &str = "field-heights.json";

pub(crate) const PLANNER_FILES: &[&str] = &[
    PLANNER_FILE_MANIFEST,
    PLANNER_FILE_TEMPLATES,
    PLANNER_FILE_LAYOUT,
    PLANNER_FILE_GOALS,
    PLANNER_FILE_REVIEWS,
    PLANNER_FILE_FIELD_HEIGHTS,
];

#[derive(Serialize)]
pub struct PlannerConfig {
    pub active_dir: String,
    pub legacy_adoption_pending: bool,
}

