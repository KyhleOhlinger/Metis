import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePluginStore } from "./usePluginStore";

/** Injects vault community `styles.css` for enabled plugins when Restricted Mode is off. */
export function CommunityPluginStyles() {
  const restrictedMode = usePluginStore((s) => s.restrictedMode);
  const enabled = usePluginStore((s) => s.enabled);
  const [cssById, setCssById] = useState<Record<string, string>>({});

  useEffect(() => {
    if (restrictedMode) {
      setCssById({});
      return;
    }
    let cancelled = false;
    const ids = [...enabled];
    void (async () => {
      const next: Record<string, string> = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            const css = await invoke<string>("read_community_plugin_styles", { id });
            if (css.trim()) next[id] = css;
          } catch {
            /* disabled, missing, or unsafe CSS */
          }
        }),
      );
      if (!cancelled) setCssById(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [restrictedMode, enabled]);

  return (
    <>
      {Object.entries(cssById).map(([id, css]) => (
        <style key={id} data-metis-community-plugin={id}>
          {css}
        </style>
      ))}
    </>
  );
}
