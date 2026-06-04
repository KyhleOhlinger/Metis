mod commands;
mod meta;

pub use commands::*;

pub(crate) use meta::{
    build_file_tree, collect_md_files, collect_md_paths, enrich_frontmatter,
    ensure_default_vault_dirs, read_vault_meta, validate_relative_vault_dir, write_vault_meta,
    write_vault_meta_full,
};
