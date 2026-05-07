Place Hunspell dictionary files in this directory for bundling.

Expected layout:

- en_US/en_US.aff
- en_US/en_US.dic
- en_GB/en_GB.aff
- en_GB/en_GB.dic

Tauri bundles `resources/dictionaries/**/*` from `src-tauri/tauri.conf.json`.
