import React from "react";
import GroupToolbar from "./GroupToolbar";
import { ANALYSIS_GROUP, ANALYSIS_COMPARE } from "../../constants/analysis";

export default function GroupToolbarContainer({
  viewerId,
  isSelecting,
  selectedIds,
  selectedRegions = [],
  points,
  deckRef,
  containerRef,
  toolbar,
  setPopoverCmd,
  setPopoverPos,
  setPopoverOpen,
  clearSelection,
}) {
  const regions = Array.isArray(selectedRegions)
    ? selectedRegions.filter((r) => r && r.size > 0)
    : [];
  const regionCount = regions.length;
  const mode = regionCount >= 2 ? ANALYSIS_COMPARE : ANALYSIS_GROUP;
  const show =
    !isSelecting &&
    selectedIds &&
    selectedIds.size > 1 &&
    (typeof window === "undefined" || window.__selectionOwner === viewerId);

  const onAnalyze = () => {
    try {
      const ids = Array.from(selectedIds || []);
      if (ids.length > 1) {
        const deck = deckRef.current?.deck;
        const viewport = deck?.getViewports?.()[0];
        if (viewport) {
          let cnt = 0,
            sx = 0,
            sy = 0;
          const dpr =
            typeof window !== "undefined" && window.devicePixelRatio
              ? window.devicePixelRatio
              : 1;
          for (const p of points) {
            if (!selectedIds.has(p.id)) continue;
            const [px, py] = viewport.project([p.x, p.y, p.z ?? 0]);
            sx += px / dpr;
            sy += py / dpr;
            cnt++;
          }
          const container = containerRef.current;
          const cssW = container ? container.clientWidth : deck?.width || 0;
          const cx = cnt ? sx / cnt : cssW / 2;
          const cy = cnt ? sy / cnt : 24;
          setPopoverPos({ x: cx, y: cy });
        } else {
          setPopoverPos({ x: toolbar.x || 20, y: toolbar.y || 20 });
        }
        if (mode === ANALYSIS_COMPARE && regionCount >= 2) {
          const idsA = Array.from(regions[regionCount - 2] || []);
          const idsB = Array.from(regions[regionCount - 1] || []);
          setPopoverCmd({ type: ANALYSIS_COMPARE, regions: [idsA, idsB] });
        } else {
          setPopoverCmd({ type: ANALYSIS_GROUP, ids });
        }
        setPopoverOpen(true);
      }
    } catch {}
  };

  return (
    <GroupToolbar
      show={show}
       mode={mode}
      onAnalyze={onAnalyze}
      onClear={() => clearSelection()}
    />
  );
}

