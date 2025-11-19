// =============================
// Viewer.jsx  (screen-space lasso overlay + accurate selection in 2D/3D)
// =============================
import React, { useMemo, useState, useEffect, useRef } from "react";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer, PathLayer } from "@deck.gl/layers";
import WindowedIconLayer from "../layers/WindowedIconLayer";
import AnalysisPopover from "../AnalysisPopover/AnalysisPopover";
import SelectionOverlay from "../SelectionOverlay/SelectionOverlay";
import { defaultRegionColors, makeRegionIndexGetter } from "../SelectionOverlay/selectionUtils";
import { ANALYSIS_SINGLE, ANALYSIS_GROUP } from "../constants/analysis";
import { SELECTION_NONE, SELECTION_BOX, SELECTION_LASSO } from "../constants/selection";
import {
  OrthographicView,
  OrbitView,
  OrthographicController,
  OrbitController,
  LinearInterpolator,
} from "@deck.gl/core";
import {
  computeCenter,
  ease,
  buildIconMappingsByChunk,
  getEventCoordinates,
  computeSelectionBounds,
  performBoxSelection,
  performLassoSelection,
} from "../utils";
import { clusterColor, buildOutlineData2D, projectOutlines3D } from "../utils/clustering";
import "./Viewer.css";
import buildTooltipHTML from "../TooltipPreview/TooltipPreview";
import ClickToolbar from "../ToolBar/ClickToolbar/ClickToolbar";
import GroupToolbar from "../ToolBar/GroupToolbar/GroupToolbar";

const Viewer = ({
  viewerId = "viewer",
  meta,
  points,
  chunkUV,
  atlasURL,
  atlasByChannel,
  channels = [],
  colors = {},
  alphas = {},
  // Window (min/max for each channel, unit: raw values, e.g. 0..65535)
  windows = {},
  renderMode = "sprites",
  is3D = false,
  imageSize = 4,
  setImageSize = () => {},

  // Selection
  selectionMode = "none",
  selectedIds = new Set(),
  setSelectedIds = () => {},
  selectedRegions = [],
  setSelectedRegions = () => {},
  clearSelection = () => {},
  filteredIds = new Set(),
  // Clustering overlay
  clusterColorOn = false,
  clusterOpacity = 0.25,
  clusterLineWidth = 1.5,
  clusterOutlineOn = false,
  // Shared zoom (optional): when provided, viewers sync zoom level
  sharedZoom,
  setSharedZoom,
}) => {
  const center = useMemo(() => computeCenter(points), [points]);

  const [viewState, setViewState] = useState(() => ({
    target: [0, 0, 0],
    zoom: typeof sharedZoom === 'number' ? sharedZoom : 8,
    rotationX: 0,
    rotationOrbit: 0,
    transitionDuration: 0,
    transitionEasing: undefined,
    transitionInterpolator: undefined,
  }));

  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current && points.length) {
      setViewState((prev) => ({ ...prev, target: center }));
      initialized.current = true;
    }
  }, [center, points.length]);

  // If parent provides sharedZoom, keep local viewState.zoom in sync
  useEffect(() => {
    if (typeof sharedZoom === 'number' && sharedZoom !== viewState.zoom) {
      setViewState((prev) => ({ ...prev, zoom: sharedZoom }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedZoom]);

  // Clean up timer
  useEffect(() => {
    return () => {
      if (zoomTimeoutRef.current) {
        clearTimeout(zoomTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setViewState((prev) => ({
      ...prev,
      rotationX: is3D ? 45 : 0,
      transitionDuration: 600,
      transitionEasing: ease,
      // Exclude 'zoom' from transitions to avoid post-gesture wobble
      transitionInterpolator: new LinearInterpolator([
        "rotationX",
        "rotationOrbit",
        "target",
      ]),
    }));
  }, [is3D]);

  // Zoom sensitivity control - improved trackpad support
  // const zoomSensitivity = 0.8; // Reduce zoom sensitivity for smoother trackpad
  // Note: keep sprite size independent from camera zoom to avoid double scaling
  const zoomTimeoutRef = useRef(null);
  
  const handleViewStateChange = ({ viewState: next }) => {
    const isZoomChange = next.zoom !== viewState.zoom;
    setViewState((prev) => ({
      ...next,
      // Avoid animating zoom updates; other transitions remain
      transitionDuration: isZoomChange ? 0 : (next.transitionDuration ?? prev.transitionDuration),
    }));

    // Propagate zoom to shared state if provided
    if (typeof setSharedZoom === 'function' && next.zoom !== sharedZoom) {
      setSharedZoom(next.zoom);
    }
  };

  const iconMappingsByChunk = useMemo(
    () => buildIconMappingsByChunk(meta, chunkUV),
    [meta, chunkUV]
  );

  // —— Selection (using screen coordinates) ——
  const deckRef = useRef(null);
  const containerRef = useRef(null);
  const [toolbar, setToolbar] = useState({ show: false, x: 0, y: 0, object: null });
  // Analysis popover state
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverCmd, setPopoverCmd] = useState(null);
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });
  // Distinct highlight colors for up to two regions
  const regionColors = defaultRegionColors;
  const getRegionIndexForId = useMemo(
    () => makeRegionIndexGetter(selectedRegions),
    [selectedRegions]
  );

  const onClick = (info) => {
    if (!info?.object) {
      clearSelection();
      if (toolbar.show) setToolbar({ show: false, x: 0, y: 0, object: null });
      setPopoverOpen(false);
      return;
    }
    // Auto-enter single-cell analysis: set the clicked cell as the current selection
    try {
      const id = info?.object?.id;
      if (id != null) {
        const one = new Set([id]);
        setSelectedRegions([one]);
        setSelectedIds(one);
        try { window.__selectionOwner = viewerId; } catch {}
      }
    } catch {}
    // Keep the lightweight toolbar (can be closed)
    const { x, y } = getEventCoordinates(info, containerRef);
    setToolbar({ show: true, x, y, object: info.object });
  };

  // Establish a baseline zoom the first time we render. We map size by 2^(zoom-delta)
  const baseZoomRef = useRef(null);
  if (baseZoomRef.current == null) baseZoomRef.current = viewState.zoom;
  const zoomScale = Math.pow(2, (viewState.zoom ?? 0) - (baseZoomRef.current ?? 0));
  const computedImageSize = Math.max(1, Math.min(2048, imageSize * zoomScale));

  // Create base layer configuration
  const createBaseLayerConfig = (chunkId, arr, mapping) => ({
    data: arr.map((d) => ({ ...d, icon: `t_${d.local_index}` })),
    iconMapping: mapping,
    getIcon: (d) => d.icon,
    getPosition: (d) => [d.x, d.y, d.z ?? 0],
    // Keep sprite size synchronized with camera zoom
    getSize: computedImageSize,
    sizeScale: 1,
    fovy: 45,
    near: 0.1,
    far: 1000,
    distanceFadeEnabled: is3D,
    sizeUnits: "pixels",
    billboard: true,
    pickable: true,
    autoHighlight: true,
    loadOptions: { image: { type: 'imagebitmap' } },
    transitions: {
      getPosition: { duration: 600, easing: ease },
      getSize: { duration: 300, easing: ease },
    },
    updateTriggers: {
      getSize: [computedImageSize]
    }
  });

  // Build clustering outlines (convex hulls) lazily
  const outlineData = useMemo(() => {
    if (!clusterOutlineOn || is3D || !points || points.length < 3) return [];
    return buildOutlineData2D(points);
  }, [clusterOutlineOn, is3D, points]);

  // —— 3D mode: screen-space hulls (recomputed on view change) ——
  const [screenOutlines, setScreenOutlines] = useState([]);
  useEffect(() => {
    if (!is3D || !clusterOutlineOn) { setScreenOutlines([]); return; }
    try {
      const deck = deckRef.current?.deck;
      const viewport = deck?.getViewports?.()[0];
      if (!viewport || !points || points.length < 3) { setScreenOutlines([]); return; }
      const paths = projectOutlines3D(viewport, points, filteredIds);
      setScreenOutlines(paths);
    } catch {
      setScreenOutlines([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is3D, clusterOutlineOn, points, filteredIds, viewState.zoom, viewState.rotationX, viewState.rotationOrbit, viewState.target]);

  const layers = useMemo(() => {
    if (!meta) return [];

    if (renderMode === "sprites") {
      const byChunk = new Map();
      for (const p of points ?? []) {
        const cid = p.chunk_id ?? 0;
        const arr = byChunk.get(cid) ?? [];
        arr.push(p);
        byChunk.set(cid, arr);
      }

      const all = [];
      for (const [chunkId, arr] of byChunk.entries()) {
        const mapping = iconMappingsByChunk?.[chunkId];
        if (!mapping) continue;

        const baseConfig = createBaseLayerConfig(chunkId, arr, mapping);
        let addedGray = false;

        // Overlay by channel
        for (const ch of channels) {
          const atlasGray = atlasByChannel?.[chunkId]?.[ch];
          if (!atlasGray) continue;
          addedGray = true;

          const col = colors?.[ch] || [255, 255, 255];
          const alpha01 = Math.min(1, Math.max(0, alphas?.[ch] ?? 1));
          const a = Math.round(alpha01 * 255);

          const w = windows?.[ch];
          const wMin = w && Number.isFinite(w.min) ? w.min : 0;
          const wMax = w && Number.isFinite(w.max) ? w.max : 65535;
          const winMin01 = Math.max(0, Math.min(1, wMin / 65535));
          const winMax01 = Math.max(0, Math.min(1, wMax / 65535));

          all.push(
            new WindowedIconLayer({
              ...baseConfig,
              id: `icon-ch${ch}-${chunkId}`,
              iconAtlas: String(atlasGray),
              parameters: { depthTest: false, blend: true, blendFunc: [1, 1], blendEquation: 32774 },
              windowMin: winMin01,
              windowMax: winMax01,
              premultiply: true,
              getColor: (d) => {
                const rIdx = getRegionIndexForId(d.id);
                if (rIdx >= 0) return regionColors[Math.min(rIdx, regionColors.length - 1)];
                const activeFilter = filteredIds && filteredIds.size > 0;
                if (activeFilter && !filteredIds.has(d.id)) {
                  const dimA = Math.min(a, 24);
                  return [col[0] ?? 255, col[1] ?? 255, col[2] ?? 255, dimA];
                }
                return [col[0] ?? 255, col[1] ?? 255, col[2] ?? 255, a];
              },
              updateTriggers: {
                ...baseConfig.updateTriggers,
                getColor: [selectedIds, selectedRegions, filteredIds, colors, alphas, windows],
              }
            })
          );
        }

        // Compatible with old approach
        const atlasMerged = !addedGray ? atlasURL?.[chunkId] : null;
        if (atlasMerged) {
          all.push(
            new WindowedIconLayer({
              ...baseConfig,
              id: `icon-merged-${chunkId}`,
              iconAtlas: String(atlasMerged),
              parameters: { depthTest: true, blend: true, blendFunc: [1, 1], blendEquation: 32774 },
              windowMin: 0.0,
              windowMax: 1.0,
              getColor: (d) => {
                const rIdx = getRegionIndexForId(d.id);
                if (rIdx >= 0) return regionColors[Math.min(rIdx, regionColors.length - 1)];
                const activeFilter = filteredIds && filteredIds.size > 0;
                if (activeFilter && !filteredIds.has(d.id)) return [255,255,255,30];
                return [255,255,255,255];
              },
              updateTriggers: {
                ...baseConfig.updateTriggers,
                getColor: [selectedIds, selectedRegions, filteredIds],
              }
            })
          );
        }

        // Clustering color overlay on top of sprites
        if (clusterColorOn) {
          // Prefer to render with the same atlas to avoid any seam/gap (perfect square coverage)
          const atlasAny =
            (atlasByChannel?.[chunkId] && Object.values(atlasByChannel[chunkId])[0]) ||
            null;
          if (atlasAny) {
            all.push(
              new WindowedIconLayer({
                ...baseConfig,
                id: `cluster-color-atlas-${chunkId}`,
                iconAtlas: String(atlasAny),
                parameters: { depthTest: false, blend: true, blendFunc: [1, 1], blendEquation: 32774 },
                windowMin: 0.0,
                windowMax: 1.0,
                premultiply: true,
                getColor: (d) => {
                  const activeFilter = filteredIds && filteredIds.size > 0;
                  if (activeFilter && !filteredIds.has(d.id)) return [0,0,0,0];
                  const rgb = clusterColor(d.label);
                  const a = Math.round(Math.min(1, Math.max(0, clusterOpacity)) * 255);
                  return [rgb[0], rgb[1], rgb[2], a];
                },
                updateTriggers: {
                  ...baseConfig.updateTriggers,
                  getColor: [filteredIds, clusterOpacity],
                }
              })
            );
          } else {
            // Fallback: circle overlay
            const a = Math.round(Math.min(1, Math.max(0, clusterOpacity)) * 255);
            all.push(
              new ScatterplotLayer({
                id: `cluster-color-${chunkId}`,
                data: arr,
                getPosition: (d) => [d.x, d.y, d.z ?? 0],
                stroked: false,
                getFillColor: (d) => {
                  const activeFilter = filteredIds && filteredIds.size > 0;
                  if (activeFilter && !filteredIds.has(d.id)) return [0,0,0,0];
                  const rgb = clusterColor(d.label);
                  return [rgb[0], rgb[1], rgb[2], a];
                },
                getRadius: computedImageSize * 0.76,
                radiusUnits: "pixels",
                pickable: false,
                parameters: { depthTest: false, blend: true, blendFunc: [1, 1], blendEquation: 32774 },
                updateTriggers: { getFillColor: [filteredIds, clusterOpacity], getRadius: [computedImageSize] }
              })
            );
          }
        }
      }
      // Single PathLayer for all clustering outlines (global, not per-chunk)
      if (!is3D && clusterOutlineOn && clusterLineWidth > 0 && outlineData.length > 0) {
        all.push(
          new PathLayer({
            id: "cluster-outlines",
            data: outlineData,
            getPath: (d) => d.path,
            getColor: (d) => d.color,
            widthUnits: "pixels",
            getWidth: Math.max(0, clusterLineWidth),
            parameters: { depthTest: false },
            pickable: false,
            rounded: true,
            jointRounded: true,
            miterLimit: 2,
            updateTriggers: { getColor: [outlineData.length], getWidth: [clusterLineWidth] }
          })
        );
      }
      return all;
    } else {
      const base = [
        new ScatterplotLayer({
          id: "scatter",
          data: points ?? [],
          getPosition: (d) => [d.x, d.y, d.z ?? 0],
          getFillColor: (d) => {
            const rIdx = getRegionIndexForId(d.id);
            if (rIdx >= 0) return regionColors[Math.min(rIdx, regionColors.length - 1)];
            const activeFilter = filteredIds && filteredIds.size > 0;
            if (activeFilter && !filteredIds.has(d.id)) return [255,255,255,30];
            return [255,255,255,255];
          },
          stroked: false,
          // Sync point radius with zoom the same way
          getRadius: computedImageSize*0.75,
          radiusScale: 1,
          radiusUnits: "pixels",
          pickable: true,
          autoHighlight: true,
          parameters: { depthTest: true },
          transitions: {
            getPosition: { duration: 600, easing: ease },
            getRadius: { duration: 300, easing: ease },
          },
          updateTriggers: {
            getFillColor: [selectedIds, selectedRegions, filteredIds],
            getRadius: [computedImageSize]
          },
        })
      ];
      if (clusterColorOn) {
        const a = Math.round(Math.min(1, Math.max(0, clusterOpacity)) * 255);
        base.push(
          new ScatterplotLayer({
            id: "scatter-cluster-color",
            data: points ?? [],
            getPosition: (d) => [d.x, d.y, d.z ?? 0],
            stroked: false,
            getFillColor: (d) => {
              const activeFilter = filteredIds && filteredIds.size > 0;
              if (activeFilter && !filteredIds.has(d.id)) return [0,0,0,0];
              const rgb = clusterColor(d.label);
              return [rgb[0], rgb[1], rgb[2], a];
            },
            getRadius: computedImageSize*0.72,
            radiusUnits: "pixels",
            pickable: false,
            parameters: { depthTest: false, blend: true, blendFunc: [1, 1], blendEquation: 32774 },
            updateTriggers: { getFillColor: [filteredIds, clusterOpacity], getRadius: [computedImageSize] }
          })
        );
      }
      if (!is3D && clusterOutlineOn && clusterLineWidth > 0 && outlineData.length > 0) {
        base.push(
          new PathLayer({
            id: "scatter-cluster-outlines",
            data: outlineData,
            getPath: (d) => d.path,
            getColor: (d) => d.color,
            widthUnits: "pixels",
            getWidth: Math.max(0, clusterLineWidth),
            parameters: { depthTest: false },
            pickable: false,
            rounded: true,
            jointRounded: true,
            miterLimit: 2,
            updateTriggers: { getColor: [outlineData.length], getWidth: [clusterLineWidth] }
          })
        );
      }
      return base;
    }
  }, [
    points,
    atlasURL,
    atlasByChannel,
    iconMappingsByChunk,
    meta,
    renderMode,
    imageSize,
    viewState.zoom,
    selectedIds,
    channels,
    colors,
    alphas,
    windows,
    is3D,
    filteredIds,
    clusterColorOn,
    clusterOpacity,
    clusterLineWidth,
    clusterOutlineOn,
    outlineData,
  ]);


  const controller =
    selectionMode === SELECTION_NONE
      ? is3D
        ? { 
            type: OrbitController,
            // Improved trackpad support
            scrollZoom: true,
            doubleClickZoom: true,
            inertia: true,
            inertiaFriction: 0.95,
            inertiaDeceleration: 0.95,
            // Trackpad zoom sensitivity
            scrollZoomSpeed: 0.8,
            // Smooth zoom
            smoothZoom: true,
            smoothZoomDuration: 200
          }
        : { 
            type: OrthographicController,
            // Improved trackpad support
            scrollZoom: true,
            doubleClickZoom: true,
            inertia: true,
            inertiaFriction: 0.95,
            inertiaDeceleration: 0.95,
            // Trackpad zoom sensitivity
            scrollZoomSpeed: 0.8,
            // Smooth zoom
            smoothZoom: true,
            smoothZoomDuration: 200
          }
      : false;

  return (
    <div className="viewer-root" ref={containerRef}>
      <SelectionOverlay
        containerRef={containerRef}
        deckRef={deckRef}
        viewerId={viewerId}
        selectionMode={selectionMode}
        points={points}
        filteredIds={filteredIds}
        selectedRegions={selectedRegions}
        setSelectedRegions={setSelectedRegions}
        setSelectedIds={setSelectedIds}
        onBeginSelection={() => {
          if (toolbar.show) setToolbar({ show: false, x: 0, y: 0, object: null });
        }}
      >
        {({ onDragStart, onDrag, onDragEnd, isSelecting }) => (
          <>
            <DeckGL
              ref={deckRef}
              views={
                is3D
                  ? [new OrbitView({ id: "3d", orbitAxis: "Y", flipY: false })]
                  : [new OrthographicView({ id: "2d", flipY: false })]
              }
              controller={controller}
              viewState={{ ...viewState, zoom: typeof sharedZoom === 'number' ? sharedZoom : viewState.zoom }}
              onViewStateChange={handleViewStateChange}
              layers={layers}
              onClick={onClick}
              onDragStart={onDragStart}
              onDrag={onDrag}
              onDragEnd={onDragEnd}
              getTooltip={({ object }) => {
                if (!object) return null;
                const activeFilter = filteredIds && filteredIds.size > 0;
                if (activeFilter && !filteredIds.has(object.id)) return null;

                const previewHtml = buildTooltipHTML({
                  object,
                  iconMappingsByChunk,
                  chunkUV,
                  atlasByChannel,
                  atlasURL,
                  channels,
                  colors,
                  alphas,
                  previewSize: 128,
                });

                const textHtml = `id: ${object.id}<br/>label: ${object.label ?? object.id % 11}`;
                return {
                  html: `${textHtml}${previewHtml ? "<br/>" + previewHtml : ""}`,
                  className: "deck-tooltip",
                };
              }}
              getCursor={() => "default"}
              pickingRadius={6}
            />

            {/* 3D mode clustering outlines: screen-space SVG overlay */}
            {is3D && clusterOutlineOn && screenOutlines.length > 0 && (
              <svg className="cluster-outline-svg">
                {screenOutlines.map((s, i) => (
                  <path key={i} d={s.d} fill="none" stroke={s.color} strokeWidth={clusterLineWidth} />
                ))}
              </svg>
            )}

            {/* Group analysis toolbar */}
            <GroupToolbar
              show={
                !isSelecting &&
                selectedIds &&
                selectedIds.size > 1 &&
                (typeof window === "undefined" || window.__selectionOwner === viewerId)
              }
              onAnalyze={() => {
                try {
                  const ids = Array.from(selectedIds || []);
                  if (ids.length > 1) {
                    const deck = deckRef.current?.deck;
                    const viewport = deck?.getViewports()[0];
                    if (viewport) {
                      let cnt = 0, sx = 0, sy = 0;
                      const dpr = (typeof window !== "undefined" && window.devicePixelRatio) ? window.devicePixelRatio : 1;
                      for (const p of points) {
                        if (!selectedIds.has(p.id)) continue;
                        const [px, py] = viewport.project([p.x, p.y, p.z ?? 0]);
                        sx += px / dpr;
                        sy += py / dpr;
                        cnt++;
                      }
                      const container = containerRef.current;
                      const cssW = container ? container.clientWidth : (deck?.width || 0);
                      const cx = cnt ? sx / cnt : cssW / 2;
                      const cy = cnt ? sy / cnt : 24;
                      setPopoverPos({ x: cx, y: cy });
                    } else {
                      setPopoverPos({ x: toolbar.x || 20, y: toolbar.y || 20 });
                    }
                    setPopoverCmd({ type: ANALYSIS_GROUP, ids });
                    setPopoverOpen(true);
                  }
                } catch {}
              }}
              onClear={() => clearSelection()}
            />
          </>
        )}
      </SelectionOverlay>

      {/* Click toolbar */}
      <ClickToolbar
        show={toolbar.show}
        x={toolbar.x}
        y={toolbar.y}
        onClose={() => setToolbar({ show: false, x: 0, y: 0, object: null })}
        onViewRaw={() => {
          setToolbar((t) => ({ ...t, show: false }));
        }}
        onFindTopK={() => {
          try {
            const id = toolbar.object?.id;
            if (id != null) {
              setPopoverCmd({ type: ANALYSIS_SINGLE, q: id });
              setPopoverPos({ x: toolbar.x, y: toolbar.y });
              setPopoverOpen(true);
            }
          } finally {
            setToolbar((t) => ({ ...t, show: false }));
          }
        }}
      />
      {/* Analysis popover (floating window near selection) */}
      <AnalysisPopover
        open={popoverOpen}
        command={popoverCmd}
        x={popoverPos.x}
        y={popoverPos.y}
        onClose={() => setPopoverOpen(false)}
        meta={meta}
        chunkUV={chunkUV}
        atlasURL={atlasURL}
        atlasByChannel={atlasByChannel}
        channels={channels}
        colors={colors}
        alphas={alphas}
        pointsRaw={points}
        pointsUMAP={points}
        useUMAP={false}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
      />
    </div>
  );
};

export default Viewer;
