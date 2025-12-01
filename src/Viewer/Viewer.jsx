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
  LinearInterpolator,
} from "@deck.gl/core";
import {
  buildIconMappingsByChunk,
  getEventCoordinates,
  ease,
} from "../utils/utils";
import { buildOutlineData2D, clusterColor } from "../utils/clustering";
import "./Viewer.css";
import ClickToolbar from "../ToolBar/ClickToolbar/ClickToolbar";
import GroupToolbarContainer from "../ToolBar/GroupToolbar/GroupToolbarContainer";
import ClusterHoverMask from "../ClusterHoverMask/ClusterHoverMask";
import DeckViewState from "./DeckViewState";
import ImageLayers from "../layers/ImageLayers";
import ClusterOutlines from "../ClusterHoverMask/ClusterOutlines";
import useClusterSelection from "./useClusterSelection";
import useClusterAnnotations from "./useClusterAnnotations";
import SemanticZoomControl from "./SemanticZoomControl/SemanticZoomControl";
import HoverPreview, { drawCellPreviewToCanvas } from "./HoverPreview/HoverPreview";

// Canvas‑based fixed cluster preview thumbnail, sharing the same
// windowing logic as HoverPreview / main viewer.
function ClusterPreviewThumb({
  point,
  x,
  y,
  previewSize,
  borderColor,
  iconMappingsByChunk,
  chunkUV,
  atlasByChannel,
  channels,
  colors,
  alphas,
  windows,
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !point) return;
    let cancelled = false;
    (async () => {
      await drawCellPreviewToCanvas({
        canvas,
        object: point,
        iconMappingsByChunk,
        chunkUV,
        atlasByChannel,
        channels,
        colors,
        alphas,
        windows,
        previewSize,
      });
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [
    point,
    iconMappingsByChunk,
    chunkUV,
    atlasByChannel,
    channels,
    colors,
    alphas,
    windows,
    previewSize,
  ]);

  if (!point) return null;

  return (
    <div
      className="deck-tooltip cluster-preview-thumb"
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: "translate(-50%, -125%)",
        // 不拦截鼠标事件，让底层 DeckGL 继续响应缩放/拖拽；
        // HoverPreview 会通过几何位置判断在代表图上方时抑制单细胞 preview。
        pointerEvents: "none",
        padding: 0,
        background: "transparent",
        borderRadius: 8,
        border: `1px solid ${borderColor}`,
        boxShadow: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: previewSize,
          height: previewSize,
          borderRadius: 8,
          display: "block",
        }}
      />
    </div>
  );
}

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
    setViewState,
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

  // 注册全局聚焦函数，用于从 similarity gallery 等地方聚焦到 cell
  useEffect(() => {
    if (typeof window !== "undefined") {
      // 为当前 viewer 注册聚焦函数
      const focusKey = `__focusCell_${viewerId}`;
      window[focusKey] = (cellPos) => {
        if (!cellPos || typeof cellPos.x !== "number" || typeof cellPos.y !== "number") return;
        const cellX = cellPos.x ?? 0;
        const cellY = cellPos.y ?? 0;
        const cellZ = cellPos.z ?? 0;
        const targetZoom = 14; // 聚焦时的目标zoom级别
        
        setViewState((prev) => ({
          ...prev,
          target: [cellX, cellY, cellZ],
          zoom: targetZoom,
          transitionDuration: transitionsEnabled ? 800 : 0,
          transitionEasing: transitionsEnabled ? ease : undefined,
          transitionInterpolator: transitionsEnabled
            ? new LinearInterpolator(["target", "zoom"])
            : undefined,
        }));
      };
      
      // 注册显示相似度排名的函数
      const rankingKey = `__showSimilarityRanking_${viewerId}`;
      window[rankingKey] = (rankings) => {
        if (rankings && typeof rankings === 'object') {
          const map = new Map();
          if (Array.isArray(rankings)) {
            // 如果是数组，假设第一个是 query (rank 0)，后面是 neighbors (rank 1-N)
            rankings.forEach((id, index) => {
              if (id != null) {
                map.set(id, index);
              }
            });
          } else if (rankings instanceof Map) {
            map = rankings;
          } else {
            // 如果是对象，key 是 id，value 是 rank
            Object.entries(rankings).forEach(([id, rank]) => {
              const numId = Number(id);
              const numRank = Number(rank);
              if (!isNaN(numId) && !isNaN(numRank)) {
                map.set(numId, numRank);
              }
            });
          }
          setSimilarityRankings(map);
        } else {
          setSimilarityRankings(new Map());
        }
      };
      
      // 同时注册通用聚焦函数（用于从 similarity gallery 调用）
      // 根据 viewerId 决定使用哪个 viewer 的聚焦函数
      if (viewerId === "raw" || (viewerId === "single" && !useUMAP)) {
        window.__focusCell = window[focusKey];
        window.__showSimilarityRanking = window[rankingKey];
      } else if (viewerId === "umap" || (viewerId === "single" && useUMAP)) {
        window.__focusCellUMAP = window[focusKey];
        window.__showSimilarityRankingUMAP = window[rankingKey];
      }

      return () => {
        // 清理
        if (window[focusKey]) {
          delete window[focusKey];
        }
        if (window[rankingKey]) {
          delete window[rankingKey];
        }
        if (viewerId === "raw" || (viewerId === "single" && !useUMAP)) {
          if (window.__focusCell === window[focusKey]) {
            delete window.__focusCell;
          }
          if (window.__showSimilarityRanking === window[rankingKey]) {
            delete window.__showSimilarityRanking;
          }
        } else if (viewerId === "umap" || (viewerId === "single" && useUMAP)) {
          if (window.__focusCellUMAP === window[focusKey]) {
            delete window.__focusCellUMAP;
          }
          if (window.__showSimilarityRankingUMAP === window[rankingKey]) {
            delete window.__showSimilarityRankingUMAP;
          }
        }
      };
    }
  }, [viewerId, useUMAP, setViewState, transitionsEnabled]);
  
  const [semanticLevel, setSemanticLevel] = useState(6); // Default to finest level (1..6)
  const [isSemanticAuto, setIsSemanticAuto] = useState(true);
  // UMAP view: use multi-level cluster columns (cluster_L0...), raw view: use original label
  const clusterLabelKey = isUMAPView
    ? `cluster_L${semanticLevel - 1}`
    : "label";
  // In UMAP view, representative cell ranking fields per level (rank_L0...rank_L5)
  const clusterRankKey = isUMAPView
    ? `rank_L${semanticLevel - 1}`
    : null;

  // Auto-update semantic level based on zoom (only enabled in UMAP view), mapping zoom→level(1..6)
  useEffect(() => {
    if (!isUMAPView || !isSemanticAuto || !viewState) return;
    const z = typeof viewState.zoom === 'number' ? viewState.zoom : 8;
    let lvl = 6;
    if (z < 6) lvl = 1;
    else if (z < 7) lvl = 2;
    else if (z < 8) lvl = 3;
    else if (z < 9) lvl = 4;
    else if (z < 10) lvl = 5;
    else lvl = 6;
    
    setSemanticLevel(lvl);
  }, [isUMAPView, isSemanticAuto, viewState?.zoom]);

  // Sampling budget for each semantic level (1..6)
  // Maximum number of points per level (controls sampling density); smaller numbers show fewer points.
  // To reduce further, decrease the values below.
  const SAMPLING_BUDGETS = useMemo(
    // level 1..5 使用有限采样预算；level 6（finest）始终展示全部点。
    () => [1000, 2500, 8000, 20000, 50000, Infinity],
    []
  );

  const samplingThreshold = useMemo(() => {
    if (!points || points.length === 0) return 1.0;
    // Raw 视图不做采样/semantic zoom，始终使用全部点
    if (!isUMAPView) return 1.0;
    // 如果是最高语义层级（6），展示全部；否则根据预算做下采样
    if (semanticLevel >= 6) return 1.0;

    const idx = Math.max(0, Math.min(SAMPLING_BUDGETS.length - 2, semanticLevel - 1));
    const budget = SAMPLING_BUDGETS[idx];
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
  // Similarity ranking: Map of cell ID -> rank (0 for query, 1-N for neighbors)
  const [similarityRankings, setSimilarityRankings] = useState(new Map());
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
      setSimilarityRankings(new Map()); // 清除排名标签
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

    // Auto-focus to selected cell if zoom is small (画面很小)
    const currentZoom = typeof viewState?.zoom === "number" ? viewState.zoom : 8;
    const zoomThreshold = 9; // 如果zoom小于9，认为是"很小的画面"
    if (currentZoom < zoomThreshold && info?.object) {
      const cellX = info.object.x ?? 0;
      const cellY = info.object.y ?? 0;
      const cellZ = info.object.z ?? 0;
      const targetZoom = 14; // 聚焦时的目标zoom级别
      
      setViewState((prev) => ({
        ...prev,
        target: [cellX, cellY, cellZ],
        zoom: targetZoom,
        transitionDuration: transitionsEnabled ? 800 : 0,
        transitionEasing: transitionsEnabled ? ease : undefined,
        transitionInterpolator: transitionsEnabled
          ? new LinearInterpolator(["target", "zoom"])
          : undefined,
      }));
    }
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
    // 只在 level 1–5 显示 cluster 预览（倒数第二层也需要 representative image）
    if (!clusterRankKey || semanticLevel < 1 || semanticLevel > 5) return [];

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

  // Screen positions for similarity ranking labels (DOM overlay)
  const [similarityRankingScreens, setSimilarityRankingScreens] = useState([]);

  useEffect(() => {
    if (!similarityRankings || similarityRankings.size === 0) {
      setSimilarityRankingScreens([]);
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

    // 找到所有需要显示排名的 points
    const rankedPoints = points.filter((p) => similarityRankings.has(p.id));
    const result = rankedPoints.map((p) => {
      const world = [p.x, p.y, p.z ?? 0];
      const projected = viewport.project(world);
      const sx = projected?.[0] ?? 0;
      const sy = projected?.[1] ?? 0;
      const rank = similarityRankings.get(p.id);
      return {
        id: p.id,
        x: sx + offsetX,
        y: sy + offsetY,
        rank: rank,
      };
    });
    setSimilarityRankingScreens(result);
  }, [similarityRankings, points, viewState, deckRef, containerRef]);

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
        semanticLevel <= 5 &&
        clusterPreviewScreens &&
        clusterPreviewScreens.length > 0 &&
        clusterPreviewScreens.map(({ point, x, y }) => {
          if (!point) return null;
          // 固定代表图尺寸，避免在缩放过程中频繁重算缩略图，提高交互流畅度。
          const previewSize = 64;
          const val = point?.[clusterLabelKey];
          const lbl = Number.isFinite(val) ? val : (point.label ?? 0);
          const rgb = clusterColor(lbl);
          const borderColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.9)`;

          return (
            <ClusterPreviewThumb
              key={`cluster-preview-${point.id}`}
              point={point}
              x={x}
              y={y}
              previewSize={previewSize}
              borderColor={borderColor}
              iconMappingsByChunk={iconMappingsByChunk}
              chunkUV={chunkUV}
              atlasByChannel={atlasByChannel}
              channels={channels}
              colors={colors}
              alphas={alphas}
              windows={windows}
            />
          );
        })}

      {/* Cluster titles: rendered at cluster centers (DOM); description is only shown on hover */}
      {isUMAPView &&
        clusterAnnotationOn &&
        semanticLevel >= 1 &&
        semanticLevel <= 6 &&
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
              className="cluster-annotation-title"
              style={{
                position: "absolute",
                left: x,
                top: y,
                transform: "translate(-50%, -50%)",
                // 仅在按下 Alt 键查看描述时接收鼠标事件，其余时间让底层 DeckGL 处理缩放/拖拽。
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

      {/* Similarity ranking labels (DOM overlay) */}
      {similarityRankingScreens && similarityRankingScreens.length > 0 &&
        similarityRankingScreens.map((item) => {
          const { id, x, y, rank } = item;
          const isQuery = rank === 0;
          return (
            <div
              key={`similarity-rank-${id}`}
              style={{
                position: "absolute",
                left: x,
                top: y,
                transform: "translate(-50%, -50%)",
                pointerEvents: "none",
                zIndex: 200,
                userSelect: "none",
              }}
            >
              <div
                style={{
                  display: "inline-block",
                  padding: isQuery ? "4px 8px" : "3px 6px",
                  borderRadius: 4,
                  backgroundColor: isQuery 
                    ? "rgba(255, 200, 0, 0.9)" // 查询 cell 用更亮的黄色
                    : "rgba(255, 215, 0, 0.85)", // 相似 cells 用金黄色
                  color: "#000",
                  fontSize: isQuery ? "14px" : "12px",
                  fontFamily: "Monaco, Menlo, 'DejaVu Sans Mono', 'Courier New', monospace",
                  fontWeight: isQuery ? 700 : 600,
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  border: `2px solid ${isQuery ? "rgba(255, 150, 0, 1)" : "rgba(255, 200, 0, 1)"}`,
                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.4)",
                }}
              >
                {isQuery ? "Q" : rank}
              </div>
            </div>
          );
        })}

      {/* Click toolbar */}
      <ClickToolbar
        show={toolbar.show}
        x={toolbar.x}
        y={toolbar.y}
        onClose={() => {
          setToolbar({ show: false, x: 0, y: 0, object: null });
          clearSelection();
          setSimilarityRankings(new Map()); // 清除排名标签
        }}
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
        viewerId={viewerId}
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
          maxLevel={6}
          isAuto={isSemanticAuto}
          setIsAuto={setIsSemanticAuto}
        />
      )}
    </div>
  );
};

export default Viewer;
