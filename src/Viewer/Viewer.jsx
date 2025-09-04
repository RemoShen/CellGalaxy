// =============================
// Viewer.jsx  (screen-space lasso overlay + accurate selection in 2D/3D)
// =============================
import React, { useMemo, useState, useEffect, useRef } from "react";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer, IconLayer } from "@deck.gl/layers";
import {
  OrthographicView,
  OrbitView,
  OrthographicController,
  OrbitController,
  LinearInterpolator,
} from "@deck.gl/core";
import "./Viewer.css";

/** Compute the geometric center of a point set. */
function computeCenter(points) {
  if (!points?.length) return [0, 0, 0];
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const p of points) {
    const x = p.x,
      y = p.y,
      z = p.z ?? 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}

/** Construct icon mappings per chunk for IconLayer from normalized UVs. */
function buildIconMappingsByChunk(meta, chunkUV) {
  if (!meta || !chunkUV) return {};
  const map = {};
  for (const [chunkIdStr, uvObj] of Object.entries(chunkUV)) {
    const chunkId = Number(chunkIdStr);
    const { tile, width, height, uv } = uvObj;
    const imap = {};
    for (const u of uv) {
      const x = Math.round(u.u0 * width);
      const y = Math.round(u.v0 * height);
      imap[`t_${u.local_index}`] = {
        x,
        y,
        width: tile,
        height: tile,
        mask: true,
        anchorY: tile / 2,
        anchorX: tile / 2,
      };
    }
    map[chunkId] = imap;
  }
  return map;
}

// smoothstep
const ease = (t) => t * t * (3 - 2 * t);

// 屏幕空间点是否在多边形内
function pointInPolygon([px, py], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

const Viewer = ({
  meta,
  points,
  loading = false,
  chunkUV,
  atlasURL,
  renderMode = "sprites",
  is3D = false,
  imageSize = 4,

  // 选择
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

  const handleViewStateChange = ({ viewState: next }) => setViewState(next);

  const iconMappingsByChunk = useMemo(
    () => buildIconMappingsByChunk(meta, chunkUV),
    [meta, chunkUV]
  );

  // —— 选择（用屏幕坐标）——
  const deckRef = useRef(null);
  const containerRef = useRef(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [dragStart, setDragStart] = useState(null); // {x,y} screen
  const [dragEnd, setDragEnd] = useState(null); // {x,y} screen
  const [lassoPts, setLassoPts] = useState([]); // [[x,y],...] screen

  // 统一取得屏幕（相对 canvas 左上）的坐标
  const getXY = (info) => {
    if (info?.offsetCenter && Number.isFinite(info.offsetCenter.x)) {
      return { x: info.offsetCenter.x, y: info.offsetCenter.y };
    }
    if (Number.isFinite(info?.x) && Number.isFinite(info?.y)) {
      return { x: info.x, y: info.y };
    }
    const evt = info?.srcEvent;
    if (evt && typeof evt.clientX === "number") {
      const rect = containerRef.current?.getBoundingClientRect();
      return {
        x: evt.clientX - (rect?.left ?? 0),
        y: evt.clientY - (rect?.top ?? 0),
      };
    }
    return { x: 0, y: 0 };
  };

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
      const x0 = Math.min(dragStart.x, dragEnd.x);
      const y0 = Math.min(dragStart.y, dragEnd.y);
      const w = Math.max(1, Math.abs(dragStart.x - dragEnd.x));
      const h = Math.max(1, Math.abs(dragStart.y - dragEnd.y));

      const picked =
        deck?.pickObjects({
          x: x0,
          y: y0,
          width: w,
          height: h,
        }) || [];

      for (const p of picked) {
        const id = p?.object?.id;
        if (id != null) ids.add(id);
      }
    }

    if (selectionMode === "lasso" && lassoPts.length >= 3 && viewport) {
      // lasso 点乘 dpr -> 设备像素
      const lassoDev = lassoPts.map(([x, y]) => [x, y]);
      for (const p of points) {
        const [sx, sy] = viewport.project([p.x, p.y, p.z ?? 0]); // 设备像素
        if (pointInPolygon([sx, sy], lassoDev)) ids.add(p.id);
      }
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

  // 图层
  const layers = useMemo(() => {
    if (!meta) return [];
    const all = [];

    if (renderMode === "sprites") {
      const byChunk = new Map();
      for (const p of points ?? []) {
        const cid = p.chunk_id ?? 0;
        const arr = byChunk.get(cid) ?? [];
        arr.push(p);
        byChunk.set(cid, arr);
      }

      for (const [chunkId, arr] of byChunk.entries()) {
        const atlas = atlasURL?.[chunkId];
        const mapping = iconMappingsByChunk?.[chunkId];
        if (!atlas || !mapping) continue;

        all.push(
          new IconLayer({
            id: `icon-${chunkId}`,
            data: arr.map((d) => ({ ...d, icon: `t_${d.local_index}` })),
            iconAtlas: String(atlas),
            iconMapping: mapping,
            getIcon: (d) => d.icon,
            getPosition: (d) => [d.x, d.y, d.z ?? 0],
            getSize: imageSize,
            sizeScale: 1,
            fovy: 45,
            near: 0.1,
            far: 1000,
            sizeUnits: "pixels",
            billboard: true,
            pickable: true,
            autoHighlight: true,
            parameters: { depthTest: true },
            transitions: {
              getPosition: { duration: 600, easing: ease },
              getSize: { duration: 300, easing: ease },
            },
            getColor: (d) => {
              return selectedIds.has(d.id)
                ? [255, 140, 0, 255]
                : [255, 255, 255, 255];
            },
          })
        );
      }
    } else {
      all.push(
        new ScatterplotLayer({
          id: "scatter",
          data: points ?? [],
          getPosition: (d) => [d.x, d.y, d.z ?? 0],
          getFillColor: (d) => {
            return selectedIds.has(d.id)
              ? [255, 140, 0, 255]
              : [255, 255, 255, 255];
          },
          getRadius: imageSize / 2,
          radiusScale: 1,
          radiusUnits: "pixels",
          pickable: true,
          autoHighlight: true,
          parameters: { depthTest: true },
          transitions: {
            getPosition: { duration: 600, easing: ease },
            getRadius: { duration: 300, easing: ease },
          },
        })
      );
    }

    // 选中叠加描边（置顶）
    const selected = points.filter((p) => selectedIds.has(p.id));

    return all;
  }, [
    points,
    atlasURL,
    iconMappingsByChunk,
    meta,
    renderMode,
    imageSize,
    selectedIds,
  ]);

  if (loading) {
    return (
      <div className="viewer-loading">
        <div>加载中...</div>
      </div>
    );
  }

  const controller =
    selectionMode === "none"
      ? is3D
        ? { type: OrbitController }
        : { type: OrthographicController }
      : false;

  // 把 lasso 的可视化放在屏幕空间的 SVG 里，确保所见即所得
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

      {/* 框选矩形（屏幕空间） */}
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

      {/* 套索可视化（屏幕空间 SVG） */}
      {isSelecting && selectionMode === "lasso" && lassoPts.length > 1 && (
        <svg className="lasso-svg">
          <polyline className="lasso-polyline" points={lassoPath} />
          {/* 可选：闭合区域淡填充 */}
          <polygon className="lasso-fill" points={lassoPath} />
        </svg>
      )}
    </div>
  );
};

export default Viewer;
