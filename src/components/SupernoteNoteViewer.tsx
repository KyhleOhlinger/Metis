import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { onSupernoteFilesChanged } from "@/constants/supernote";
import { revealInFinder, revealPlatformLabel } from "@/utils/vaultNavigation";
import { openDomContextMenu } from "@/utils/domContextMenu";
import { formatError } from "@/utils/formatError";
import {
  fetchSupernoteSyncMeta,
  formatPagerCaption,
  markLastShownNow,
  readLastShownMs,
  type SupernoteFileSyncMeta,
} from "@/utils/supernotePagerMeta";
import type { MouseEvent } from "react";

type PageDto = {
  page: number;
  pageCount: number;
  width: number;
  height: number;
  pngBase64: string;
};

interface Props {
  filePath: string;
  vaultPath: string;
  bgColor?: string;
}

export function SupernoteNoteViewer({ filePath, vaultPath, bgColor }: Props) {
  const [page, setPage] = useState(1);
  const [cache, setCache] = useState<Map<number, PageDto>>(() => new Map());
  const [pageCount, setPageCount] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [reloadTick, setReloadTick] = useState(0);
  const [syncMeta, setSyncMeta] = useState<SupernoteFileSyncMeta | null>(null);
  const [lastShownMs, setLastShownMs] = useState<number | null>(() => readLastShownMs(filePath));

  useEffect(() => onSupernoteFilesChanged(() => {
    setCache(new Map());
    setReloadTick((n) => n + 1);
  }), []);

  useEffect(() => {
    let cancelled = false;
    void fetchSupernoteSyncMeta(filePath).then((dto) => {
      if (!cancelled) setSyncMeta(dto);
    });
    setLastShownMs(readLastShownMs(filePath));
    return () => {
      cancelled = true;
    };
  }, [filePath, reloadTick]);

  useEffect(() => {
    let cancelled = false;
    const hit = cache.get(page);
    if (hit) {
      setLoading(false);
      setPageCount(hit.pageCount);
      setLastShownMs(markLastShownNow(filePath));
      return;
    }
    setLoading(true);
    setError(null);
    invoke<PageDto>("render_supernote_page", { path: filePath, page })
      .then((dto) => {
        if (cancelled) return;
        setCache((prev) => {
          const next = new Map(prev);
          next.set(dto.page, dto);
          return next;
        });
        setPageCount(dto.pageCount);
        setLastShownMs(markLastShownNow(filePath));
      })
      .catch((err) => {
        if (!cancelled) setError(formatError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // reloadTick clears cache after Nomad sync so the open viewer re-rasters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, page, reloadTick]);

  const current = cache.get(page);
  const src = current ? `data:image/png;base64,${current.pngBase64}` : "";

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    openDomContextMenu(e.clientX, e.clientY, [
      {
        label: revealPlatformLabel(),
        onClick: () => revealInFinder(filePath, vaultPath),
      },
    ]);
  };

  return (
    <div
      className="absolute inset-0 z-20 flex min-h-0 flex-col"
      style={bgColor ? { backgroundColor: bgColor } : undefined}
      onContextMenu={onContextMenu}
    >
      <div className="flex shrink-0 items-center justify-center gap-2 border-b border-border px-2 py-1">
        <button
          type="button"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="rounded p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30"
          title="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="font-mono text-[11px] text-text-secondary">
          {page} / {pageCount}
        </span>
        <button
          type="button"
          disabled={page >= pageCount || loading}
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          className="rounded p-0.5 text-text-muted hover:text-text-primary disabled:opacity-30"
          title="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <p className="shrink-0 px-3 py-1 text-center text-[11px] leading-snug text-text-muted">
        {formatPagerCaption(syncMeta, lastShownMs)}
      </p>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        {error ? (
          <p className="max-w-sm text-center text-[11px] leading-relaxed text-red-400">{error}</p>
        ) : loading && !src ? (
          <p className="text-[11px] text-text-muted">Rendering page…</p>
        ) : src ? (
          <img
            src={src}
            alt={`Page ${page}`}
            className="max-h-full max-w-full rounded-md object-contain shadow-lg"
            draggable={false}
          />
        ) : null}
      </div>
    </div>
  );
}
