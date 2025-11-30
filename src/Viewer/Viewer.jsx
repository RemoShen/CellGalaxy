// =============================
// Viewer.jsx  (screen-space lasso overlay + accurate selection in 2D/3D)
// =============================
import React, { useMemo, useState, useRef, useEffect } from "react";
import DeckGL from "@deck.gl/react";
import AnalysisPopover from "../AnalysisPopover/AnalysisPopover";
import SelectionOverlay from "../SelectionOverlay/SelectionOverlay";
import { defaultRegionColors, makeRegionIndexGetter } from "../SelectionOverlay/selectionUtils";
import { ANALYSIS_SINGLE } from "../constants/analysis";
import { SELECTION_NONE} from "../constants/selection";
import {
  OrthographicView,
  OrbitView,
  OrthographicController,
  OrbitController,
} from "@deck.gl/core";
import {
  buildIconMappingsByChunk,
  getEventCoordinates,
} from "../utils/utils";
import { buildOutlineData2D, clusterColor } from "../utils/clustering";
import "./Viewer.css";
import buildTooltipHTML from "../TooltipPreview/TooltipPreview";
import ClickToolbar from "../ToolBar/ClickToolbar/ClickToolbar";
import GroupToolbarContainer from "../ToolBar/GroupToolbar/GroupToolbarContainer";
import ClusterHoverMask from "../ClusterHoverMask/ClusterHoverMask";
import DeckViewState from "./DeckViewState";
import ImageLayers from "../layers/ImageLayers";
import ClusterOutlines from "../ClusterHoverMask/ClusterOutlines";
import useClusterSelection from "./useClusterSelection";
import useClusterAnnotations from "./useClusterAnnotations";
import SemanticZoomControl from "./SemanticZoomControl/SemanticZoomControl";
import HoverPreview from "./HoverPreview/HoverPreview";

const Viewer = ({
  viewerId = "viewer",
  meta,
  points,
  chunkUV,
  hoverMaskEnabled = false,
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
  // In single-view mode: whether UMAP is currently shown
  useUMAP = false,

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
  // Cluster annotation (LLM titles/descriptions)
  clusterAnnotationOn = false,
  clusterAnnotationModel = "MedGemma",
  // Cluster preview (representative image per cluster, on UMAP view)
  clusterPreviewOn = true,
  // Shared zoom (optional): when provided, viewers sync zoom level
  sharedZoom,
  setSharedZoom,
  // Zoom sensitivity (how strong scroll wheel changes camera distance)
  zoomSpeed = 0.01,
  // 控制视图和点位置过渡动画（来自 App）
  transitionsEnabled = true,
}) => {
  const isUMAPView =
    viewerId === "umap" || (viewerId === "single" && !!useUMAP);
  const {
    viewState,
    handleViewStateChange,
    computedImageSize,
    altPressed,
  } = DeckViewState({
    points,
    is3D,
    sharedZoom,
    setSharedZoom,
    initialZoom: 8,
    imageSize,
    transitionsEnabled,
  });
  
  const [semanticLevel, setSemanticLevel] = useState(5); // Default to finest level (adjust as needed)
  const [isSemanticAuto, setIsSemanticAuto] = useState(true);
  // UMAP view: use multi-level cluster columns (cluster_L0...), raw view: use original label
  const clusterLabelKey = isUMAPView
    ? `cluster_L${semanticLevel - 1}`
    : "label";
  // In UMAP view, representative cell ranking fields per level (rank_L0...rank_L4)
  const clusterRankKey = isUMAPView
    ? `rank_L${semanticLevel - 1}`
    : null;

  // Auto-update semantic level based on zoom (only enabled in UMAP view)
  useEffect(() => {
    if (!isUMAPView || !isSemanticAuto || !viewState) return;
    const z = typeof viewState.zoom === 'number' ? viewState.zoom : 8;
    let lvl = 5;
    if (z < 6) lvl = 1;
    else if (z < 7) lvl = 2;
    else if (z < 8) lvl = 3;
    else if (z < 9) lvl = 4;
    else lvl = 5;
    
    setSemanticLevel(lvl);
  }, [isUMAPView, isSemanticAuto, viewState?.zoom]);

  // Sampling budget for each semantic level (1..5)
  // Maximum number of points per level (controls sampling density); smaller numbers show fewer points.
  // To reduce further, decrease the values below.
  const SAMPLING_BUDGETS = useMemo(
    () => [1000, 2500, 8000, 20000, Infinity],
    []
  );

  const samplingThreshold = useMemo(() => {
    if (!points || points.length === 0) return 1.0;
    // Raw 视图不做采样/semantic zoom，始终使用全部点
    if (!isUMAPView) return 1.0;
    // If finest level, show all
    if (semanticLevel === 5) return 1.0;

    const budget = SAMPLING_BUDGETS[semanticLevel - 1];
    const total = points.length;
    return budget / total;
  }, [isUMAPView, semanticLevel, SAMPLING_BUDGETS, points]);

  // For outline/selection/interaction logic, we still want a "visible" subset for CPU calculations,
  // but for rendering (ImageLayers) we pass ALL points and use GPU filtering.
  // ClusterOutlines and interaction still rely on this visiblePoints subset to match visuals.
  const visiblePoints = useMemo(() => {
    if (!points || points.length === 0) return [];
    if (samplingThreshold >= 1.0) return points;

    return points.filter((p) => {
      if (selectedIds.has(p.id)) return true;
      const hash = (p.id * 0.6180339887) % 1;
      return hash < samplingThreshold;
    });
  }, [points, samplingThreshold, selectedIds]);

  const iconMappingsByChunk = useMemo(
    () => buildIconMappingsByChunk(meta, chunkUV),
    [meta, chunkUV]
  );

  const { selectClusterByLabel, selectSingleById } = useClusterSelection({
    points: visiblePoints,
    filteredIds,
    selectedRegions,
    setSelectedRegions,
    setSelectedIds,
    viewerId,
  });

  // —— Selection (using screen coordinates) ——
  const deckRef = useRef(null);
  const containerRef = useRef(null);
  const [toolbar, setToolbar] = useState({ show: false, x: 0, y: 0, object: null });
  // Analysis popover state
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverCmd, setPopoverCmd] = useState(null);
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });
  const [popoverBounds, setPopoverBounds] = useState(null);
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
      setPopoverBounds(null);
      return;
    }
    if (altPressed) {
      // Use dynamic label key for selection
      const val = info?.object?.[clusterLabelKey];
      const lbl = Number.isFinite(val) ? val : info?.object?.label;
      if (selectClusterByLabel(lbl)) {
        return;
      }
    }

    selectSingleById(info?.object?.id);
    // Keep the lightweight toolbar (can be closed)
    const { x, y } = getEventCoordinates(info, containerRef);
    setToolbar({ show: true, x, y, object: info.object });
  };

  // Lazily build clustering outlines (convex hulls)
  const outlineData = useMemo(() => {
    if (is3D || !visiblePoints || visiblePoints.length < 3) return [];
    // Pass dynamic label key
    return buildOutlineData2D(visiblePoints, clusterLabelKey);
  }, [is3D, visiblePoints, clusterLabelKey]);

  const screenOutlines = ClusterOutlines({
    is3D,
    clusterOutlineOn,
    forceCompute: clusterAnnotationOn,
    points: visiblePoints,
    filteredIds,
    deckRef,
    viewDeps: [viewState.zoom, viewState.rotationX, viewState.rotationOrbit, viewState.target],
    labelKey: clusterLabelKey,
  });

  // —— Choose one representative cell per cluster (minimum rank) for fixed preview cards ——
  const clusterPreviewPoints = useMemo(() => {
    if (!isUMAPView) return [];
    if (!clusterPreviewOn) return [];
    if (!points || points.length === 0) return [];
    // 只在 level 1–4 显示 cluster 预览
    if (!clusterRankKey || semanticLevel < 1 || semanticLevel > 4) return [];

    const byLabel = new Map();
    for (const p of points) {
      const val = p?.[clusterLabelKey];
      const label = Number.isFinite(val) ? val : (p?.label ?? null);
      if (!Number.isFinite(label)) continue;
      const r = p?.[clusterRankKey];
      if (!Number.isFinite(r)) continue;
      const prev = byLabel.get(label);
      if (!prev || r < prev.rank) {
        byLabel.set(label, { point: p, rank: r });
      }
    }
    return Array.from(byLabel.values()).map((v) => v.point);
  }, [isUMAPView, clusterPreviewOn, points, clusterLabelKey, clusterRankKey, semanticLevel]);

  // Project representative cell positions into screen coordinates for DOM preview card placement
  const [clusterPreviewScreens, setClusterPreviewScreens] = useState([]);

  useEffect(() => {
    if (!isUMAPView || !clusterPreviewOn) {
      setClusterPreviewScreens([]);
      return;
    }
    if (!clusterPreviewPoints || clusterPreviewPoints.length === 0) {
      setClusterPreviewScreens([]);
      return;
    }
    const deckInstance = deckRef.current && deckRef.current.deck;
    const containerEl = containerRef.current;
    if (!deckInstance || !containerEl) return;

    const viewports = deckInstance.getViewports();
    if (!viewports || viewports.length === 0) return;
    const viewport = viewports[0];
    const canvas = deckInstance.canvas;
    if (!canvas) return;

    const containerRect = containerEl.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const offsetX = canvasRect.left - containerRect.left;
    const offsetY = canvasRect.top - containerRect.top;

    const result = clusterPreviewPoints.map((p) => {
      const world = [p.x, p.y, p.z ?? 0];
      const projected = viewport.project(world);
      const sx = projected?.[0] ?? 0;
      const sy = projected?.[1] ?? 0;
      return {
        point: p,
        x: sx + offsetX,
        y: sy + offsetY,
        canvasX: sx,
        canvasY: sy,
      };
    });
    setClusterPreviewScreens(result);
  }, [isUMAPView, clusterPreviewOn, clusterPreviewPoints, viewState, deckRef, containerRef]);

  // Cluster annotation (text layer + tooltip data), derived from outlineData (2D) or projected screen outlines (3D)
  const { annotationLayer, clusterAnnotationData } = useClusterAnnotations({
    clusterAnnotationOn,
    clusterAnnotationModel,
    outlineData,
    viewState,
    is3D,
    screenOutlines3D: screenOutlines,
    level: semanticLevel,
  });

  // We now always render titles/descriptions via DOM overlays instead of
  // the original DeckGL TextLayer to avoid double‑drawing text.
  const showAnnotationLayer = false;

  // Screen positions for cluster titles (DOM overlay at cluster centroid)
  const [clusterAnnotationScreens, setClusterAnnotationScreens] = useState([]);

  useEffect(() => {
    if (!isUMAPView || !clusterAnnotationOn) {
      setClusterAnnotationScreens([]);
      return;
    }
    if (!clusterAnnotationData || clusterAnnotationData.length === 0) {
      setClusterAnnotationScreens([]);
      return;
    }
    const deckInstance = deckRef.current && deckRef.current.deck;
    const containerEl = containerRef.current;
    if (!deckInstance || !containerEl) return;

    const viewports = deckInstance.getViewports();
    if (!viewports || viewports.length === 0) return;
    const viewport = viewports[0];
    const canvas = deckInstance.canvas;
    if (!canvas) return;

    const containerRect = containerEl.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const offsetX = canvasRect.left - containerRect.left;
    const offsetY = canvasRect.top - containerRect.top;

    const result = clusterAnnotationData.map((d) => {
      const world = d.position || [0, 0, 0];
      const projected = viewport.project(world);
      const sx = projected?.[0] ?? 0;
      const sy = projected?.[1] ?? 0;
      return {
        ...d,
        x: sx + offsetX,
        y: sy + offsetY,
      };
    });
    setClusterAnnotationScreens(result);
  }, [
    isUMAPView,
    clusterAnnotationOn,
    clusterAnnotationData,
    viewState,
    deckRef,
    containerRef,
  ]);

  const [hoveredAnnotationLabel, setHoveredAnnotationLabel] = useState(null);
  const descriptionRefs = useRef({});

  const layers = ImageLayers({
    meta,
    renderMode,
    points,  // Pass ALL points to ImageLayers for GPU filtering
    atlasURL,
    atlasByChannel,
    iconMappingsByChunk,
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
    computedImageSize,
    getRegionIndexForId,
    regionColors,
    labelKey: clusterLabelKey,
    samplingThreshold,  // New prop for GPU filtering
    selectedIds,        // Needed to exclude selected items from filtering
    transitionsEnabled,
  });

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
            scrollZoomSpeed: zoomSpeed,
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
            scrollZoomSpeed: zoomSpeed,
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
        points={visiblePoints}
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
            <ClusterHoverMask
              outlineData={outlineData}
              is3D={is3D}
              deckRef={deckRef}
              containerRef={containerRef}
              active={hoverMaskEnabled && clusterOutlineOn}
              altPressed={altPressed}
              screenOutlines3D={screenOutlines}
            >
              {({ onHover, layers: hoverLayers }) => (
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
                  layers={layers
                    .concat(showAnnotationLayer && annotationLayer ? [annotationLayer] : [])
                    .concat(hoverLayers)}
                  onClick={onClick}
                  onHover={onHover}
                  onDragStart={onDragStart}
                  onDrag={onDrag}
                  onDragEnd={onDragEnd}
                  getTooltip={null}
                  getCursor={() => "default"}
                  pickingRadius={6}
                />
              )}
            </ClusterHoverMask>

            {/* 3D mode clustering outlines: screen-space SVG overlay */}
            {is3D && clusterOutlineOn && screenOutlines.length > 0 && (
              <svg className="cluster-outline-svg">
                {screenOutlines.map((s, i) => (
                  <path key={i} d={s.d} fill="none" stroke={s.color} strokeWidth={clusterLineWidth} />
                ))}
              </svg>
            )}

            {/* Group analysis toolbar */}
            <GroupToolbarContainer
              viewerId={viewerId}
              isSelecting={isSelecting}
              selectedIds={selectedIds}
              selectedRegions={selectedRegions}
              points={visiblePoints}
              deckRef={deckRef}
              containerRef={containerRef}
              toolbar={toolbar}
              setPopoverCmd={setPopoverCmd}
              setPopoverPos={setPopoverPos}
              setPopoverBounds={setPopoverBounds}
              setPopoverOpen={setPopoverOpen}
              clearSelection={clearSelection}
            />
          </>
        )}
      </SelectionOverlay>

      {/* Fixed cluster representative previews (levels 1–4), reusing hover tooltip styles */}
      {isUMAPView &&
        clusterPreviewOn &&
        semanticLevel >= 1 &&
        semanticLevel <= 4 &&
        clusterPreviewScreens &&
        clusterPreviewScreens.length > 0 &&
        clusterPreviewScreens.map(({ point, x, y }) => {
          if (!point) return null;
          // Dynamically adjust preview size based on current zoom: smaller when zoomed out, larger when zoomed in,
          // with lower/upper bounds.
          const z = typeof viewState?.zoom === "number" ? viewState.zoom : 8;
          const baseSize = 60; // baseline size considered visually reasonable
          const scale = 1 + (z - 8) * 0.25; // change size by ~25% per zoom level
          const previewSize = Math.max(30, Math.min(120, baseSize * scale));
          // Compute current cluster color for the border and title background
          const val = point?.[clusterLabelKey];
          const lbl = Number.isFinite(val) ? val : (point.label ?? 0);
          const rgb = clusterColor(lbl);
          const borderColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.9)`;

          const previewHtml = buildTooltipHTML({
            object: point,
            iconMappingsByChunk,
            chunkUV,
            atlasByChannel,
            atlasURL,
            channels,
            colors,
            alphas,
            // Preview size that changes dynamically with zoom
            previewSize,
            // Embedded mode: remove internal margin/shadow so border hugs the image
            compact: true,
          });
          if (!previewHtml) return null;
          return (
            <div
              key={`cluster-preview-${point.id}`}
              className="deck-tooltip"
              style={{
                position: "absolute",
                left: x,
                top: y,
                // Lift the image slightly so there is some spacing between image and text
                transform: "translate(-50%, -125%)",
                // Do not intercept mouse events so that scroll zoom still works on DeckGL.
                // (cell tooltip is already suppressed in getTooltip based on representative IDs)
                pointerEvents: "none",
                padding: 0,
                background: "transparent",
                borderRadius: 8,
                border: `1px solid ${borderColor}`,
                boxShadow: "none",
              }}
              dangerouslySetInnerHTML={{
                __html: previewHtml,
              }}
            />
          );
        })}

      {/* Cluster titles: rendered at cluster centers (DOM); description is only shown on hover */}
      {isUMAPView &&
        clusterAnnotationOn &&
        semanticLevel >= 1 &&
        semanticLevel <= 5 &&
        clusterAnnotationScreens &&
        clusterAnnotationScreens.length > 0 &&
        clusterAnnotationScreens.map((ann) => {
          const { label, title, description, x, y } = ann;
          if (!title) return null;
          const rgb = clusterColor(label);
          // Same font-size logic as in useClusterAnnotations
          const z = typeof viewState?.zoom === "number" ? viewState.zoom : 8;
          const baseSize = 14;
          const scale = 1 + (z - 8) * 0.1;
          const size = Math.max(10, Math.min(32, baseSize * scale));
          return (
            <div
              key={`cluster-annotation-title-${label}`}
              style={{
                position: "absolute",
                left: x,
                top: y,
                transform: "translate(-50%, -50%)",
                // Only respond to hover when Option is pressed to show the description;
                // in other cases, let events pass through to DeckGL so scroll zoom always works.
                pointerEvents: altPressed ? "auto" : "none",
                zIndex: hoveredAnnotationLabel === label ? 100 : 10,
                // Show default cursor, but no text insertion cursor
                cursor: "default",
                userSelect: "none",
              }}
              onMouseEnter={(e) => {
                // Only show description when Option (Alt) is pressed
                if (altPressed || e.altKey) {
                  setHoveredAnnotationLabel(label);
                }
              }}
              onMouseLeave={() =>
                setHoveredAnnotationLabel((cur) => (cur === label ? null : cur))
              }
              onWheel={(e) => {
                const el = descriptionRefs.current[label];
                if (el) {
                  el.scrollTop += e.deltaY;
                  e.preventDefault();
                }
              }}
            >
              <div
                style={{
                  display: "inline-block",
                  padding: "2px 6px",
                  borderRadius: 4,
                  backgroundColor: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.67)`,
                  color: "#fff",
                  fontSize: `${size}px`,
                  fontFamily:
                    "Monaco, Menlo, 'DejaVu Sans Mono', 'Courier New', monospace",
                  fontWeight: 400,
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                }}
              >
                {title}
              </div>
              {hoveredAnnotationLabel === label && description && altPressed && (
                <div
                  className="deck-tooltip"
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: -12,
                    transform: "translate(-50%, -110%)",
                    pointerEvents: "none",
                    width: 320,
                    maxHeight: 180,
                    overflowY: "hidden",
                    textAlign: "left",
                    whiteSpace: "normal",
                  }}
                  ref={(el) => {
                    if (el) {
                      descriptionRefs.current[label] = el;
                    } else {
                      delete descriptionRefs.current[label];
                    }
                  }}
                >
                  {description}
                </div>
              )}
            </div>
          );
        })}

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
              // 将 viewer 内部坐标转换成全局 viewport 坐标，支持跨两个 viewer 覆盖
              const container = containerRef.current;
              const rect = container?.getBoundingClientRect
                ? container.getBoundingClientRect()
                : { left: 0, top: 0 };
              const gx = (rect.left || 0) + toolbar.x;
              const gy = (rect.top || 0) + toolbar.y;
              setPopoverPos({ x: gx, y: gy });
              const r = 60;
              setPopoverBounds({
                x0: gx - r,
                y0: gy - r,
                x1: gx + r,
                y1: gy + r,
              });
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
        selectionBounds={popoverBounds}
        onClose={() => {
          setPopoverOpen(false);
          setPopoverBounds(null);
        }}
        meta={meta}
        chunkUV={chunkUV}
        atlasURL={atlasURL}
        atlasByChannel={atlasByChannel}
        channels={channels}
        colors={colors}
        alphas={alphas}
        windows={windows}
        pointsRaw={points}
        pointsUMAP={points}
        useUMAP={false}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
      />

      <HoverPreview
        deckRef={deckRef}
        containerRef={containerRef}
        iconMappingsByChunk={iconMappingsByChunk}
        chunkUV={chunkUV}
        atlasByChannel={atlasByChannel}
        channels={channels}
        colors={colors}
        alphas={alphas}
        windows={windows}
      />

      {/* Semantic Zoom Slider (Manual Control) */}
      {isUMAPView && (
        <SemanticZoomControl
          level={semanticLevel}
          setLevel={setSemanticLevel}
          maxLevel={5}
          isAuto={isSemanticAuto}
          setIsAuto={setIsSemanticAuto}
        />
      )}
    </div>
  );
};

export default Viewer;
