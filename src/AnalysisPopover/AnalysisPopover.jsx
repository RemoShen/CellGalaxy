import React, { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import "./AnalysisPopover.css";
import { fetchT1, fetchT2 } from "../api/api";
import { CellAnalysisPanel, GroupAnalysisPanel } from "../AnalysisPanels";
import { ANALYSIS_SINGLE, ANALYSIS_GROUP } from "../analysis/commands";
import { buildIconMappingsByChunk } from "../utils";

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
  const [mode, setMode] = useState("none"); // 'none' | 't1' | 't2'
  const [t1, setT1] = useState(null);
  const [t2, setT2] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // Clamp into viewport after mount or when size changes
  const clampIntoViewport = () => {
    const node = rootRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const parent = node.offsetParent || document.body;
    const prect = parent.getBoundingClientRect();
    const margin = 8;
    // coordinates are relative to offsetParent; clamp within parent box
    let nx = pos.x;
    let ny = pos.y;
    const maxX = Math.max(margin, prect.width - rect.width - margin);
    const maxY = Math.max(margin, prect.height - rect.height - margin);
    if (nx > maxX) nx = maxX;
    if (ny > maxY) ny = maxY;
    if (nx < margin) nx = margin;
    if (ny < margin) ny = margin;
    if (nx !== pos.x || ny !== pos.y) setPos({ x: nx, y: ny });
  };
  useLayoutEffect(() => {
    if (!open) return;
    clampIntoViewport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, t1, t2]);
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
        // 先直接使用锚点坐标（相对 viewer 容器），避免在尚未挂载时测量错误
        setPos({ x: Math.round(x + 12), y: Math.round(y + 12) });
      } catch {
        setPos({ x: Math.round(x + 12), y: Math.round(y + 12) });
      }
      setBusy(true);
      try {
        if (command.type === ANALYSIS_SINGLE && Number.isFinite(command.q)) {
          setMode("single");
          setT2(null);
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
          const ids = command.ids.map((v) => Number(v)).filter((v) => Number.isFinite(v));
          if (ids.length === 0) return;
          const res = await fetchT2(ids, undefined);
          if (!res || res.error) return;
          setT2(res);
        } else {
          setMode("none");
          setT1(null);
          setT2(null);
        }
      } finally {
        setBusy(false);
      }
    };
    run();
  }, [open, command, setSelectedIds]);

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
            points={points}
          />
        ) : (
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
        )}
      </div>
    </div>
  );
}


