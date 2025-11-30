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
import { buildIconMappingsByChunk, clampPositionToParent } from "../utils/utils";

export default function AnalysisPopover({
  open,
  command, // { type:'t1', q } | { type:'t2', ids:number[] }
  x = 0,
  y = 0,
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
    const clamped = clampPositionToParent(node, pos.x, pos.y, 8);
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

  // Execute analysis when command changes
  useEffect(() => {
    const run = async () => {
      if (!open || !command) return;
      // base position: anchor + offset
      try {
        // Use anchor coordinates directly (relative to the viewer container) to avoid measurement errors before mount
        setPos({ x: Math.round(x + 12), y: Math.round(y + 12) });
      } catch {
        setPos({ x: Math.round(x + 12), y: Math.round(y + 12) });
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
          const ids = command.ids.map((v) => Number(v)).filter((v) => Number.isFinite(v));
          if (ids.length === 0) return;
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
    <div ref={rootRef} className="analysis-popover" style={{ left: pos.x, top: pos.y }}>
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
            points={points}
          />
        )}
      </div>
    </div>
  );
}
