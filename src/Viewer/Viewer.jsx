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
import { buildOutlineData2D } from "../utils/clustering";
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
  // Shared zoom (optional): when provided, viewers sync zoom level
  sharedZoom,
  setSharedZoom,
}) => {
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
  });

  const iconMappingsByChunk = useMemo(
    () => buildIconMappingsByChunk(meta, chunkUV),
    [meta, chunkUV]
  );

  const { selectClusterByLabel, selectSingleById } = useClusterSelection({
    points,
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
      const lbl = info?.object?.label;
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
    if (is3D || !points || points.length < 3) return [];
    return buildOutlineData2D(points);
  }, [is3D, points]);

  const screenOutlines = ClusterOutlines({
    is3D,
    clusterOutlineOn,
    forceCompute: clusterAnnotationOn,
    points,
    filteredIds,
    deckRef,
    viewDeps: [viewState.zoom, viewState.rotationX, viewState.rotationOrbit, viewState.target],
  });

  // Cluster annotation (text layer + tooltip data), derived from outlineData (2D) or projected screen outlines (3D)
  const { annotationLayer, clusterAnnotationByLabel } = useClusterAnnotations({
    clusterAnnotationOn,
    clusterAnnotationModel,
    outlineData,
    viewState,
    is3D,
    screenOutlines3D: screenOutlines,
  });

  const layers = ImageLayers({
    meta,
    renderMode,
    points,
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
                    .concat(annotationLayer ? [annotationLayer] : [])
                    .concat(hoverLayers)}
                  onClick={onClick}
                  onHover={onHover}
                  onDragStart={onDragStart}
                  onDrag={onDrag}
                  onDragEnd={onDragEnd}
                  getTooltip={(info) => {
                    const { object } = info || {};
                    if (altPressed) return null;
                    if (!object) return null;

                    // Cluster-level annotation (used for text layer and point hover)
                    let annotation = null;
                    if (object.kind === "cluster-annotation") {
                      annotation = object;
                    } else if (clusterAnnotationOn && clusterAnnotationByLabel.size > 0) {
                      const lbl = object.label;
                      if (Number.isFinite(lbl)) {
                        annotation = clusterAnnotationByLabel.get(lbl);
                      }
                    }

                    if (annotation && (annotation.title || annotation.description)) {
                      const titleHtml = annotation.title
                        ? `<div><b>${annotation.title}</b></div>`
                        : "";
                      const descHtml = annotation.description
                        ? `<div style="max-width:260px;white-space:normal;text-align:left;">${annotation.description}</div>`
                        : "";
                      return {
                        html: `${titleHtml}${descHtml}`,
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

                    const textHtml = `id: ${object.id}<br/>label: ${object.label ?? object.id % 11}`;
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
              points={points}
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
