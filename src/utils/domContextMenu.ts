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
  menu.className = "metis-dom-context-menu";
  menu.style.left = `${Math.min(clientX, window.innerWidth - 200)}px`;
  menu.style.top = `${Math.min(clientY, window.innerHeight - 48)}px`;

  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = item.label;
    btn.disabled = Boolean(item.disabled);
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
