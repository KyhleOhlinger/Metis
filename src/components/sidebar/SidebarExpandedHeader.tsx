import { Search } from "lucide-react";
import { FoldVertical, UnfoldVertical } from "lucide-react";
import { ChevronLeft, ActionButton } from "./sidebarIcons";
import { todayString } from "./dailyNote";
import { useCorePluginEnabled } from "@/plugins/usePluginStore";

interface SidebarExpandedHeaderProps {
  vaultPath: string | null;
  loading: boolean;
  sidebarView: string;
  allCollapsed: boolean;
  onCreateVault: () => void;
  onOpenVault: () => void;
  onNewNote: () => void;
  onNewFolder: () => void;
  onDailyNote: () => void;
  onToggleSearch: () => void;
  onToggleExpandAll: () => void;
  onCollapseSidebar: () => void;
}

export function SidebarExpandedHeader({
  vaultPath,
  loading,
  sidebarView,
  allCollapsed,
  onCreateVault,
  onOpenVault,
  onNewNote,
  onNewFolder,
  onDailyNote,
  onToggleSearch,
  onToggleExpandAll,
  onCollapseSidebar,
}: SidebarExpandedHeaderProps) {
  const dailyEnabled = useCorePluginEnabled("daily-notes");
  const searchEnabled = useCorePluginEnabled("search");
  return (
    <div className="border-b border-border px-2 py-2">
      <div className="flex items-center justify-between">
        <span className="max-w-[110px] truncate text-[10px] font-semibold uppercase tracking-widest text-text-muted">
          {vaultPath ? vaultPath.split("/").pop() : "No Vault"}
        </span>
        <div className="flex items-center gap-0.5">
          <ActionButton title="Create new vault" onClick={onCreateVault}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </ActionButton>
          <ActionButton title="Open existing vault" onClick={onOpenVault} disabled={loading}>
            {loading ? <span className="text-[10px]">…</span> : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            )}
          </ActionButton>
          {vaultPath && (
            <>
              <ActionButton title="New note" onClick={onNewNote}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
                </svg>
              </ActionButton>
              <ActionButton title="New folder" onClick={onNewFolder}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
                </svg>
              </ActionButton>
            </>
          )}
          {vaultPath && dailyEnabled && (
            <ActionButton
              title={`Open / create today's daily note (${todayString()})`}
              onClick={onDailyNote}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
                <line x1="8" y1="14" x2="8.01" y2="14" />
                <line x1="12" y1="14" x2="12.01" y2="14" />
                <line x1="16" y1="14" x2="16.01" y2="14" />
              </svg>
            </ActionButton>
          )}
          {vaultPath && searchEnabled && (
            <ActionButton
              title="Search vault (Cmd+Shift+F)"
              onClick={onToggleSearch}
              className={sidebarView === "search" ? "text-accent" : "text-text-muted"}
            >
              <Search size={12} />
            </ActionButton>
          )}
          {vaultPath && (
            <ActionButton
              title={allCollapsed ? "Expand all folders" : "Collapse all folders"}
              onClick={onToggleExpandAll}
            >
              {allCollapsed ? <UnfoldVertical size={12} /> : <FoldVertical size={12} />}
            </ActionButton>
          )}
          <button
            type="button"
            onClick={onCollapseSidebar}
            title="Collapse sidebar"
            className="rounded p-1 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
          >
            <ChevronLeft />
          </button>
        </div>
      </div>
    </div>
  );
}
