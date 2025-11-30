import React, { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import "./AnalysisPopover.css";
import {
  fetchT1,
  fetchT2,
  fetchViolinGlobalKDE,
  fetchViolinSelectionKDE,
  fetchRegionRepresentatives,
} from "../api/api";
import CellAnalysisPanel from "../FeaturePanel/LocalFeaturePanel/LocalFeaturePanel";
import GroupAnalysisPanel from "../FeaturePanel/GroupFeaturePanel/GroupFeaturePanel";
import CompareAnalysisPanel from "../FeaturePanel/CompareFeaturePanel/CompareFeaturePanel";
import { ANALYSIS_SINGLE, ANALYSIS_GROUP, ANALYSIS_COMPARE } from "../constants/analysis";
import { buildIconMappingsByChunk, clampPositionToViewport } from "../utils/utils";

export default function AnalysisPopover({
  open,
  command, // { type:'t1', q } | { type:'t2', ids:number[] }
  x = 0,
  y = 0,
  selectionBounds = null,
  onClose = () => {},
  // rendering context
  meta,
  chunkUV,
  atlasURL,
  atlasByChannel,
  channels,
  colors,
  alphas,
  windows,
  pointsRaw = [],
  pointsUMAP = [],
  useUMAP = false,
  viewerId = "raw", // 用于决定聚焦到哪个 viewer
  // selection highlight hook
  selectedIds = new Set(),
  setSelectedIds = () => {},
}) {
  const iconMappingsByChunk = useMemo(
    () => buildIconMappingsByChunk(meta, chunkUV),
    [meta, chunkUV]
  );
  const rootRef = useRef(null);
  const [mode, setMode] = useState("none"); // 'none' | 't1' | 't2' | 'compare'
  const [t1, setT1] = useState(null);
  const [t2, setT2] = useState(null);
  const [tCompare, setTCompare] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const globalKDECache = useRef({ key: "", data: null });

  // Clamp into viewport after mount or when size changes
  const clampIntoViewport = () => {
    const node = rootRef.current;
    if (!node) return;
    const clamped = clampPositionToViewport(node, pos.x, pos.y, 12);
    if (clamped.x !== pos.x || clamped.y !== pos.y) setPos(clamped);
  };
  useLayoutEffect(() => {
    if (!open) return;
    clampIntoViewport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, t1, t2, tCompare]);
  useEffect(() => {
    const onResize = () => clampIntoViewport();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // 简单拖拽：允许用户用顶部细条拖动弹窗位置
  const handleDragMouseDown = (e) => {
    e.preventDefault();
    const node = rootRef.current;
    if (!node) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = { ...pos };
    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const next = clampPositionToViewport(node, startPos.x + dx, startPos.y + dy, 12);
      setPos(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Execute analysis when command changes
  useEffect(() => {
    const run = async () => {
      if (!open || !command) return;
      // 根据选区包围盒 + 锚点自动定位弹窗，尽量避免覆盖选中的 cluster。
      try {
        const viewportW = window.innerWidth || 1920;
        const viewportH = window.innerHeight || 1080;
        const approxWidth = Math.min(520, viewportW * 0.6);
        const approxHeight = Math.min(360, viewportH * 0.55);

        let nx = x;
        let ny = y;

        // 如果有选区包围盒，用简单打分在「上/下/左/右」四个候选位置里选一个与包围盒重叠最小的
        if (selectionBounds && typeof selectionBounds.x0 === "number" && typeof selectionBounds.y0 === "number") {
          const sb = selectionBounds;
          const cxSel = (sb.x0 + sb.x1) / 2;
          const cySel = (sb.y0 + sb.y1) / 2;
          const margin = 16;
          const candidates = [
            // 上方
            { x: cxSel - approxWidth / 2, y: sb.y0 - approxHeight - margin },
            // 下方
            { x: cxSel - approxWidth / 2, y: sb.y1 + margin },
            // 左侧
            { x: sb.x0 - approxWidth - margin, y: cySel - approxHeight / 2 },
            // 右侧
            { x: sb.x1 + margin, y: cySel - approxHeight / 2 },
          ];
          const score = (cand) => {
            const x0 = cand.x;
            const y0 = cand.y;
            const x1 = cand.x + approxWidth;
            const y1 = cand.y + approxHeight;
            // 重叠面积
            const ix0 = Math.max(x0, sb.x0);
            const iy0 = Math.max(y0, sb.y0);
            const ix1 = Math.min(x1, sb.x1);
            const iy1 = Math.min(y1, sb.y1);
            const w = ix1 - ix0;
            const h = iy1 - iy0;
            const overlap = w > 0 && h > 0 ? w * h : 0;
            // 超出视口的惩罚
            const outLeft = Math.max(0, -x0);
            const outRight = Math.max(0, x1 - viewportW);
            const outTop = Math.max(0, -y0);
            const outBottom = Math.max(0, y1 - viewportH);
            const overflow = outLeft + outRight + outTop + outBottom;
            return overlap + overflow * 1000;
          };
          let best = candidates[0];
          let bestScore = score(best);
          for (let i = 1; i < candidates.length; i++) {
            const s = score(candidates[i]);
            if (s < bestScore) {
              bestScore = s;
              best = candidates[i];
            }
          }
          nx = best.x;
          ny = best.y;
        } else {
          // 没有包围盒就退回到基于锚点的简单逻辑
          const preferRight = x < viewportW / 2;
          const preferBelow = y < viewportH / 2;
          nx = preferRight ? x + 24 : x - approxWidth - 24;
          ny = preferBelow ? y + 24 : y - approxHeight - 24;
        }
        if (!Number.isFinite(nx)) nx = 40;
        if (!Number.isFinite(ny)) ny = 40;
        setPos({ x: Math.round(nx), y: Math.round(ny) });
      } catch {
        setPos({ x: Math.round(x + 24), y: Math.round(Math.max(24, y - 80)) });
      }
      setBusy(true);
      try {
        if (command.type === ANALYSIS_SINGLE && Number.isFinite(command.q)) {
          setMode("single");
          setT2(null);
          setTCompare(null);
          const res = await fetchT1(Number(command.q), 30, undefined);
          if (!res || res.error) return;
          setT1(res);
          // Highlight query + neighbors
          try {
            const neighborIds = (res.neighbors || []).map((n) => n.id);
            const all = new Set([Number(command.q), ...neighborIds]);
            setSelectedIds(all);
          } catch {}
        } else if (command.type === ANALYSIS_GROUP && Array.isArray(command.ids)) {
          setMode("group");
          setT1(null);
          setTCompare(null);
          let ids = command.ids.map((v) => Number(v)).filter((v) => Number.isFinite(v));
          if (ids.length === 0) return;

          // 大 group 分析的主要瓶颈在 /features/t2 里做谱排序和相似度矩阵（O(n^2)）。
          // 这里在前端对 ids 做一次随机下采样，让计算量基本保持在几千级别：
          //   - small  (<= 2500): 使用全部 ids
          //   - medium (2500~8000): 控制在 ~4000
          //   - large  (> 8000): 控制在 ~5000
          const total = ids.length;
          let maxGroup = 2500;
          if (total > 8000) {
            maxGroup = 5000;
          } else if (total > 2500) {
            maxGroup = 4000;
          }
          if (total > maxGroup) {
            const tmp = ids.slice();
            for (let i = tmp.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              const t = tmp[i];
              tmp[i] = tmp[j];
              tmp[j] = t;
            }
            ids = tmp.slice(0, maxGroup);
          }

          const res = await fetchT2(ids, undefined);
          if (!res || res.error) return;
          setT2(res);
        } else if (command.type === ANALYSIS_COMPARE && Array.isArray(command.regions)) {
          setMode("compare");
          setT1(null);
          setT2(null);
          setTCompare(null);
          const regions = command.regions
            .map((arr) => (Array.isArray(arr) ? arr.map((v) => Number(v)).filter((v) => Number.isFinite(v)) : []))
            .filter((arr) => arr.length > 0);
          if (regions.length < 2) return;
          const idsA = regions[regions.length - 2];
          const idsB = regions[regions.length - 1];
          const activeChs = Array.isArray(channels) && channels.length > 0 ? channels.map((c) => Number(c)) : [];
          if (activeChs.length === 0) return;
          const chKey = activeChs.join(",");
          const gkdePromise =
            globalKDECache.current.key === chKey && globalKDECache.current.data
              ? Promise.resolve(globalKDECache.current.data)
              : fetchViolinGlobalKDE(100000, 99.0, 0.1, activeChs, 256, undefined).then((res) => {
                  if (res && !res.error) {
                    globalKDECache.current = { key: chKey, data: res };
                  }
                  return res;
                });
          const [gkde, selA, selB, reps] = await Promise.all([
            gkdePromise,
            fetchViolinSelectionKDE(idsA, 100000, 99.0, 0.1, activeChs, 256, undefined),
            fetchViolinSelectionKDE(idsB, 100000, 99.0, 0.1, activeChs, 256, undefined),
            fetchRegionRepresentatives([idsA, idsB], "cosine_centered", undefined),
          ]);
          if (!gkde || gkde.error || !selA || selA.error || !selB || selB.error) return;
          const repsArr = Array.isArray(reps?.regions) ? reps.regions : [];
          setTCompare({
            global_kde: gkde,
            regions: [
              {
                ids: idsA,
                sel_kde: selA,
                representative: repsArr[0]?.representative ?? null,
                representative_similarity: repsArr[0]?.representative_similarity ?? null,
                compactness: repsArr[0]?.compactness ?? null,
                size: repsArr[0]?.size ?? idsA.length,
              },
              {
                ids: idsB,
                sel_kde: selB,
                representative: repsArr[1]?.representative ?? null,
                representative_similarity: repsArr[1]?.representative_similarity ?? null,
                compactness: repsArr[1]?.compactness ?? null,
                size: repsArr[1]?.size ?? idsB.length,
              },
            ],
          });
        } else {
          setMode("none");
          setT1(null);
          setT2(null);
          setTCompare(null);
        }
      } finally {
        setBusy(false);
      }
    };
    run();
  }, [open, command, setSelectedIds, channels]);

  if (!open || mode === "none") return null;
  const points = useUMAP ? pointsUMAP : pointsRaw;

  return (
    <div
      ref={rootRef}
      className="analysis-popover"
      style={{ left: pos.x, top: pos.y }}
      // 在分析弹窗上悬停时，阻断下方 viewer 的 hover 事件，避免 HoverPreview 继续显示。
      onMouseEnter={(e) => {
        try {
          e.stopPropagation();
        } catch (_) {}
      }}
    >
      <div className="analysis-drag-handle" onMouseDown={handleDragMouseDown}>
        <div className="analysis-drag-pill" />
      </div>
      <div className="analysis-body">
        {busy ? (
          <div className="loading">Calculating...</div>
        ) : mode === "single" ? (
          <CellAnalysisPanel
            data={t1}
            iconMappingsByChunk={iconMappingsByChunk}
            chunkUV={chunkUV}
            atlasByChannel={atlasByChannel}
            atlasURL={atlasURL}
            channels={channels}
            colors={colors}
            alphas={alphas}
            windows={windows}
            points={points}
            viewerId={viewerId}
          />
        ) : mode === "group" ? (
          <GroupAnalysisPanel
            data={t2}
            iconMappingsByChunk={iconMappingsByChunk}
            chunkUV={chunkUV}
            atlasByChannel={atlasByChannel}
            atlasURL={atlasURL}
            channels={channels}
            colors={colors}
            alphas={alphas}
            points={points}
          />
        ) : (
          <CompareAnalysisPanel
            data={tCompare}
            iconMappingsByChunk={iconMappingsByChunk}
            chunkUV={chunkUV}
            atlasByChannel={atlasByChannel}
            atlasURL={atlasURL}
            channels={channels}
            colors={colors}
            alphas={alphas}
            windows={windows}
            points={points}
          />
        )}
      </div>
    </div>
  );
}
