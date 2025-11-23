// =============================
// Viewer.jsx  (screen-space lasso overlay + accurate selection in 2D/3D)
// =============================
import React, { useMemo, useState, useRef } from "react";
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
  // Single-view 模式下：是否当前在显示 UMAP
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
  clusterAnnotationModel = "MedGamma",
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
  // UMAP 视图：使用多层级 cluster 列（cluster_L0...）, raw 视图：使用原始 label
  const clusterLabelKey = isUMAPView
    ? `cluster_L${semanticLevel - 1}`
    : "label";
  // UMAP 视图下，对应每一层的代表性细胞排序字段（rank_L0...rank_L4）
  const clusterRankKey = isUMAPView
    ? `rank_L${semanticLevel - 1}`
    : null;

  // Auto-update semantic level based on zoom（仅在 UMAP 视图启用）
  React.useEffect(() => {
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
  // 每一层的最大点数（控制采样密度），数值越小，显示的点越少。
  // 如果想进一步减少，可以继续把下面几个数字调小。
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
  // but for Rendering (ImageLayers) we will pass ALL points and use GPU filtering.
  // However, since ClusterOutlines and Interaction need to know what's visible to match visual,
  // we keep this visiblePoints subset for them.
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

  // Build clustering outlines (convex hulls) lazily
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

  // —— 为每个 cluster 选出一个代表性细胞（rank 最小），用于固定显示的 preview 卡片 ——
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

  // 将代表性细胞的位置投影到屏幕坐标，用于放置 DOM 预览卡片
  const [clusterPreviewScreens, setClusterPreviewScreens] = useState([]);

  React.useEffect(() => {
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
  const { annotationLayer, clusterAnnotationByLabel, clusterAnnotationData } = useClusterAnnotations({
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

  React.useEffect(() => {
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

  // Canvas-space bounding boxes for each representative preview image,
  // used to suppress DeckGL cell tooltips when hovering over the preview.
  const clusterPreviewBoxes = useMemo(() => {
    if (
      !isUMAPView ||
      !clusterPreviewOn ||
      !clusterPreviewScreens ||
      clusterPreviewScreens.length === 0
    ) {
      return [];
    }
    const z = typeof viewState?.zoom === "number" ? viewState.zoom : 8;
    const baseSize = 60;
    const scale = 1 + (z - 8) * 0.25;
    const size = Math.max(30, Math.min(120, baseSize * scale));
    const half = size / 2;
    return clusterPreviewScreens.map(({ point, canvasX, canvasY }) => {
      const top = canvasY - size * 1.3;
      const bottom = canvasY - size * 0.3;
      const left = canvasX - half;
      const right = canvasX + half;
      return {
        id: point?.id,
        left,
        right,
        top,
        bottom,
      };
    });
  }, [isUMAPView, clusterPreviewOn, clusterPreviewScreens, viewState]);

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
                  getTooltip={(info) => {
                    const { object } = info || {};
                    if (altPressed) return null;
                    // 如果当前鼠标位于任何代表图 preview 的区域内，就不要显示 DeckGL 的 tooltip，
                    // 这样既不会挡住代表图，也不会影响滚轮缩放。
                    if (
                      info &&
                      typeof info.x === "number" &&
                      typeof info.y === "number" &&
                      clusterPreviewBoxes &&
                      clusterPreviewBoxes.length > 0
                    ) {
                      const { x, y } = info;
                      const overPreview = clusterPreviewBoxes.some(
                        (b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom
                      );
                      if (overPreview) return null;
                    }
                    if (!object) return null;

                    // Cluster-level annotation (used for text layer and point hover)
                    let annotation = null;
                    // 只有真正的 cluster-annotation 对象才使用 LLM 文本；
                    // 普通细胞 hover 仍然显示自身 preview。
                    if (object.kind === "cluster-annotation") {
                      annotation = object;
                    }

                    if (annotation && (annotation.title || annotation.description)) {
                      // 在 DeckGL tooltip 中仅展示标题；description 只在标题 DOM hover 时显示
                      const titleHtml = annotation.title
                        ? `<div><b>${annotation.title}</b></div>`
                        : "";
                      return {
                        html: titleHtml,
                        className: "deck-tooltip",
                      };
                    }

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

                    const clusterVal = object?.[clusterLabelKey];
                    const effectiveLabel = Number.isFinite(clusterVal)
                      ? clusterVal
                      : (object.label ?? object.id % 11);
                    const textHtml = `id: ${object.id}<br/>label: ${effectiveLabel}`;
                    return {
                      html: `${textHtml}${previewHtml ? "<br/>" + previewHtml : ""}`,
                      className: "deck-tooltip",
                    };
                  }}
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
              setPopoverOpen={setPopoverOpen}
              clearSelection={clearSelection}
            />
          </>
        )}
      </SelectionOverlay>

      {/* 固定显示的 cluster 代表 preview（level 1–4），样式沿用 hover tooltip */}
      {isUMAPView &&
        clusterPreviewOn &&
        semanticLevel >= 1 &&
        semanticLevel <= 4 &&
        clusterPreviewScreens &&
        clusterPreviewScreens.length > 0 &&
        clusterPreviewScreens.map(({ point, x, y }) => {
          if (!point) return null;
          // 根据当前 zoom 动态调整 preview 尺寸：缩小视图时减小，放大视图时增大（并做上下限裁剪）
          const z = typeof viewState?.zoom === "number" ? viewState.zoom : 8;
          const baseSize = 60; // 你当前觉得合适的基准大小
          const scale = 1 + (z - 8) * 0.25; // 每多 1 级 zoom，尺寸增减约 25%
          const previewSize = Math.max(30, Math.min(120, baseSize * scale));
          // 计算当前 cluster 的颜色，用作外框颜色及标题背景色
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
            // 随 zoom 变化的动态 preview 尺寸
            previewSize,
            // 嵌入式模式：去掉内部 margin / 阴影，让外边框紧贴图片
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
                // 稍微把图片抬高一点，让图片和文字之间有一点间距
                transform: "translate(-50%, -125%)",
                // 不拦截鼠标事件，让滚轮缩放仍然作用在 DeckGL 上
                //（cell tooltip 已在 getTooltip 中根据代表点 ID 屏蔽）
                pointerEvents: "none",
                // 让外框紧贴图片：去掉 padding，仅保留细边框
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

      {/* Cluster titles：在 clustering 中心绘制（DOM），description 仅在 hover 时显示 */}
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
          // 与 useClusterAnnotations 相同的字号逻辑
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
                // 只有在按住 Option 时才需要响应 hover，从而显示 description；
                // 其他情况下把事件透传给 DeckGL，让滚轮缩放始终生效。
                pointerEvents: altPressed ? "auto" : "none",
                zIndex: hoveredAnnotationLabel === label ? 100 : 10,
                // 显示普通鼠标光标，但不出现文字插入光标
                cursor: "default",
                userSelect: "none",
              }}
              onMouseEnter={(e) => {
                // 只有在按住 Option(Alt) 时才显示 description
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
