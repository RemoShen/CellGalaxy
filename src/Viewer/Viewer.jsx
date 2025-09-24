// =============================
// Viewer.jsx  (screen-space lasso overlay + accurate selection in 2D/3D)
// =============================
import React, { useMemo, useState, useEffect, useRef } from "react";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer } from "@deck.gl/layers";
import WindowedIconLayer from "../layers/WindowedIconLayer";
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
import "./Viewer.css";

const Viewer = ({
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
  clearSelection = () => {},
}) => {
  const center = useMemo(() => computeCenter(points), [points]);

  const [viewState, setViewState] = useState(() => ({
    target: [0, 0, 0],
    zoom: 8,
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
      transitionInterpolator: new LinearInterpolator([
        "rotationX",
        "rotationOrbit",
        "zoom",
        "target",
      ]),
    }));
  }, [is3D]);

  // Zoom sensitivity control - improved trackpad support
  const zoomSensitivity = 0.8; // Reduce zoom sensitivity for smoother trackpad
  const minImageSize = 1;
  const maxImageSize = 40;
  
  // Use debouncing to avoid frequent updates
  const zoomTimeoutRef = useRef(null);
  
  const handleViewStateChange = ({ viewState: next }) => {
    setViewState(next);
    
    // When zoom changes, synchronously update imageSize
    if (next.zoom !== viewState.zoom) {
      const zoomDelta = next.zoom - viewState.zoom;
      const newImageSize = Math.max(
        minImageSize,
        Math.min(maxImageSize, imageSize + zoomDelta * zoomSensitivity)
      );
      
      // Clear previous timer
      if (zoomTimeoutRef.current) {
        clearTimeout(zoomTimeoutRef.current);
      }
      
      // Use debouncing for smooth updates
      zoomTimeoutRef.current = setTimeout(() => {
        setImageSize(newImageSize);
      }, 16); // ~60fps update frequency
    }
  };

  const iconMappingsByChunk = useMemo(
    () => buildIconMappingsByChunk(meta, chunkUV),
    [meta, chunkUV]
  );

  // —— Selection (using screen coordinates) ——
  const deckRef = useRef(null);
  const containerRef = useRef(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [dragStart, setDragStart] = useState(null); // {x,y} screen
  const [dragEnd, setDragEnd] = useState(null); // {x,y} screen
  const [lassoPts, setLassoPts] = useState([]); // [[x,y],...] screen

  // Get unified screen coordinates (relative to canvas top-left)
  const getXY = (info) => getEventCoordinates(info, containerRef);

  const onDragStart = (info) => {
    if (selectionMode === "none") return;
    const { x, y } = getXY(info);
    setIsSelecting(true);
    setDragStart({ x, y });
    setDragEnd({ x, y });
    if (selectionMode === "lasso") setLassoPts([[x, y]]);
  };

  const onDrag = (info) => {
    if (!isSelecting) return;
    const { x, y } = getXY(info);
    setDragEnd({ x, y });
    if (selectionMode === "lasso") {
      setLassoPts((prev) =>
        prev.length &&
        prev[prev.length - 1][0] === x &&
        prev[prev.length - 1][1] === y
          ? prev
          : [...prev, [x, y]]
      );
    }
  };

  const onDragEnd = () => {
    if (!isSelecting) return;

    const deck = deckRef.current?.deck;
    const viewport = deck?.getViewports()[0];
    const ids = new Set();

    if (selectionMode === "box" && dragStart && dragEnd) {
      // Use utils function to calculate selection bounds
      const bounds = computeSelectionBounds(dragStart, dragEnd);
      // Use utils function to perform box selection
      const picked = performBoxSelection(deck, bounds);
      
      for (const p of picked) {
        const id = p?.object?.id;
        if (id != null) ids.add(id);
      }
    }

    if (selectionMode === "lasso" && lassoPts.length >= 3 && viewport) {
      // Use utils function to perform lasso selection
      const lassoIds = performLassoSelection(points, viewport, lassoPts);
      lassoIds.forEach(id => ids.add(id));
    }

    setSelectedIds(ids);
    setIsSelecting(false);
    setDragStart(null);
    setDragEnd(null);
    setLassoPts([]);
  };

  const onClick = (info) => {
    if (!info?.object) clearSelection();
  };

  // Create base layer configuration
  const createBaseLayerConfig = (chunkId, arr, mapping) => ({
    data: arr.map((d) => ({ ...d, icon: `t_${d.local_index}` })),
    iconMapping: mapping,
    getIcon: (d) => d.icon,
    getPosition: (d) => [d.x, d.y, d.z ?? 0],
    getSize: imageSize,
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
  });

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
              getColor: (d) =>
                selectedIds.has(d.id)
                  ? [255, 140, 0, 255]
                  : [col[0] ?? 255, col[1] ?? 255, col[2] ?? 255, a],
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
              getColor: (d) => selectedIds.has(d.id)? [255, 140, 0, 255]: [255, 255, 255, 255],
            })
          );
        }
      }
      return all;
    } else {
      return [
        new ScatterplotLayer({
          id: "scatter",
          data: points ?? [],
          getPosition: (d) => [d.x, d.y, d.z ?? 0],
          getFillColor: (d) => selectedIds.has(d.id)? [255, 140, 0, 255]: [255, 255, 255, 255],
          stroked: false,
          getRadius: imageSize*0.75,
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
            getFillColor: [selectedIds],
          },
        })
      ];
    }
  }, [
    points,
    atlasURL,
    atlasByChannel,
    iconMappingsByChunk,
    meta,
    renderMode,
    imageSize,
    selectedIds,
    channels,
    colors,
    alphas,
    windows,
    is3D,
  ]);


  const controller =
    selectionMode === "none"
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

  // Place lasso visualization in screen-space SVG for WYSIWYG
  const lassoPath = lassoPts.length
    ? lassoPts.map(([x, y]) => `${x},${y}`).join(" ")
    : "";

  return (
    <div className="viewer-root" ref={containerRef}>
      <DeckGL
        ref={deckRef}
        views={
          is3D
            ? [new OrbitView({ id: "3d", orbitAxis: "Y", flipY: false })]
            : [new OrthographicView({ id: "2d", flipY: false })]
        }
        controller={controller}
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        layers={layers}
        onClick={onClick}
        onDragStart={onDragStart}
        onDrag={onDrag}
        onDragEnd={onDragEnd}
        getTooltip={({ object }) =>
          object
            ? `id: ${object.id}\nlabel: ${object.label ?? object.id % 11}`
            : null
        }
        getCursor={() => "default"}
        pickingRadius={6}
      />

      {/* Box selection rectangle (screen space) */}
      {isSelecting && selectionMode === "box" && dragStart && dragEnd && (
        <div
          className="selection-rect"
          style={{
            left: Math.min(dragStart.x, dragEnd.x),
            top: Math.min(dragStart.y, dragEnd.y),
            width: Math.abs(dragStart.x - dragEnd.x),
            height: Math.abs(dragStart.y - dragEnd.y),
          }}
        />
      )}

      {/* Lasso visualization (screen space SVG) */}
      {isSelecting && selectionMode === "lasso" && lassoPts.length > 1 && (
        <svg className="lasso-svg">
          <polyline className="lasso-polyline" points={lassoPath} />
          {/* Optional: light fill for closed area */}
          <polygon className="lasso-fill" points={lassoPath} />
        </svg>
      )}
    </div>
  );
};

export default Viewer;
