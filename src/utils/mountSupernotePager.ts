import { invoke } from "@tauri-apps/api/core";
import { formatError } from "@/utils/formatError";
import { revealInFinder, revealPlatformLabel } from "@/utils/vaultNavigation";
import { openDomContextMenu } from "@/utils/domContextMenu";
import { onSupernoteFilesChanged } from "@/constants/supernote";
import {
  fetchSupernoteSyncMeta,
  formatPagerCaption,
  markLastShownNow,
  readLastShownMs,
  type SupernoteFileSyncMeta,
} from "@/utils/supernotePagerMeta";

type PageDto = {
  page: number;
  pageCount: number;
  pngBase64: string;
};

/**
 * Compact paged `.note` raster into a host element (Source widgets + Visual preview).
 * SECURITY: `filePath` must already be vault-contained; rendering IPC re-checks.
 */
export function mountSupernotePager(
  host: HTMLElement,
  filePath: string,
  vaultPath: string,
  onResize?: () => void,
): () => void {
  host.replaceChildren();
  host.classList.add("metis-supernote-pager");
  host.style.cssText =
    "display:block;box-sizing:border-box;width:100%;max-width:100%;" +
    "padding:4px 0 8px;";

  const metaLine = document.createElement("p");
  metaLine.style.cssText =
    "margin:0 0 4px;font-size:11px;line-height:1.4;opacity:0.75;text-align:center;" +
    "font-family:ui-sans-serif,system-ui,sans-serif;";

  const bar = document.createElement("div");
  bar.style.cssText =
    "display:flex;align-items:center;justify-content:center;gap:8px;" +
    "padding:4px 0;user-select:none;";

  const prev = document.createElement("button");
  prev.type = "button";
  prev.textContent = "‹";
  prev.title = "Previous page";
  prev.style.cssText =
    "border:none;background:transparent;color:inherit;cursor:pointer;font-size:16px;line-height:1;padding:2px 6px;";

  const label = document.createElement("span");
  label.style.cssText = "font-family:ui-monospace,monospace;font-size:11px;opacity:0.8;";

  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "›";
  next.title = "Next page";
  next.style.cssText = prev.style.cssText;

  bar.append(prev, label, next);

  const status = document.createElement("p");
  status.style.cssText =
    "margin:0;font-size:11px;opacity:0.7;text-align:center;padding:8px 0;";

  const img = document.createElement("img");
  img.alt = "Supernote page";
  img.draggable = false;
  img.style.cssText =
    "display:none;width:100%;max-width:100%;max-height:min(72vh,860px);" +
    "border-radius:6px;object-fit:contain;margin:0 auto;";

  host.append(metaLine, bar, status, img);

  let page = 1;
  let pageCount = 1;
  let cancelled = false;
  const cache = new Map<number, PageDto>();
  let syncMeta: SupernoteFileSyncMeta | null = null;

  const paintCaption = (shownMs: number | null) => {
    metaLine.textContent = formatPagerCaption(syncMeta, shownMs);
  };
  paintCaption(readLastShownMs(filePath));

  const loadMeta = () => {
    void fetchSupernoteSyncMeta(filePath).then((dto) => {
      if (cancelled) return;
      syncMeta = dto;
      paintCaption(readLastShownMs(filePath));
    });
  };
  loadMeta();

  const remasure = () => onResize?.();

  const render = () => {
    prev.disabled = page <= 1;
    next.disabled = page >= pageCount;
    prev.style.opacity = prev.disabled ? "0.3" : "1";
    next.style.opacity = next.disabled ? "0.3" : "1";
    label.textContent = `${page} / ${pageCount}`;

    const hit = cache.get(page);
    if (hit) {
      status.style.display = "none";
      img.style.display = "block";
      img.src = `data:image/png;base64,${hit.pngBase64}`;
      paintCaption(markLastShownNow(filePath));
      remasure();
      return;
    }

    img.style.display = "none";
    status.style.display = "block";
    status.textContent = "Rendering page…";
    status.style.color = "";

    invoke<PageDto>("render_supernote_page", { path: filePath, page })
      .then((dto) => {
        if (cancelled) return;
        cache.set(dto.page, dto);
        pageCount = Math.max(1, dto.pageCount);
        if (page > pageCount) {
          page = pageCount;
        }
        if (dto.page === page || cache.get(page)) render();
      })
      .catch((err) => {
        if (cancelled) return;
        status.textContent = formatError(err);
        status.style.color = "#f87171";
        remasure();
      });
  };

  prev.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (page > 1) {
      page -= 1;
      render();
    }
  });
  next.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (page < pageCount) {
      page += 1;
      render();
    }
  });

  host.oncontextmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openDomContextMenu(e.clientX, e.clientY, [
      {
        label: revealPlatformLabel(),
        onClick: () => revealInFinder(filePath, vaultPath),
      },
    ]);
  };

  img.addEventListener("load", remasure);
  render();

  const stopWatch = onSupernoteFilesChanged(() => {
    if (cancelled) return;
    cache.clear();
    loadMeta();
    render();
  });

  return () => {
    cancelled = true;
    stopWatch();
    host.oncontextmenu = null;
    host.replaceChildren();
  };
}
