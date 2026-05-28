/** Lightweight fixed-position context menu (used inside CodeMirror handlers). */

const MENU_ID = "metis-dom-context-menu";

export function removeDomContextMenu() {
  document.getElementById(MENU_ID)?.remove();
}

export function openDomContextMenu(
  clientX: number,
  clientY: number,
  items: Array<{ label: string; onClick: () => void; disabled?: boolean }>,
) {
  removeDomContextMenu();

  const menu = document.createElement("div");
  menu.id = MENU_ID;
  menu.style.cssText = [
    "position:fixed",
    "z-index:10050",
    `left:${Math.min(clientX, window.innerWidth - 200)}px`,
    `top:${Math.min(clientY, window.innerHeight - 48)}px`,
    "min-width:180px",
    "padding:4px 0",
    "border-radius:8px",
    "border:1px solid rgba(148,163,184,0.35)",
    "background:#1e1f24",
    "box-shadow:0 8px 24px rgba(0,0,0,0.45)",
    "font-size:12px",
  ].join(";");

  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = item.label;
    btn.disabled = Boolean(item.disabled);
    btn.style.cssText =
      "display:block;width:100%;text-align:left;padding:8px 12px;background:transparent;border:none;color:#e2e8f0;cursor:pointer;";
    if (item.disabled) {
      btn.style.opacity = "0.45";
      btn.style.cursor = "not-allowed";
    }
    btn.onmouseenter = () => {
      if (!btn.disabled) btn.style.background = "rgba(124,58,237,0.25)";
    };
    btn.onmouseleave = () => {
      btn.style.background = "transparent";
    };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeDomContextMenu();
      if (!item.disabled) item.onClick();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);

  const dismiss = (e: MouseEvent) => {
    if (menu.contains(e.target as Node)) return;
    removeDomContextMenu();
    window.removeEventListener("mousedown", dismiss, true);
    window.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    removeDomContextMenu();
    window.removeEventListener("mousedown", dismiss, true);
    window.removeEventListener("keydown", onKey, true);
  };
  setTimeout(() => {
    window.addEventListener("mousedown", dismiss, true);
    window.addEventListener("keydown", onKey, true);
  }, 0);
}
