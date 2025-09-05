// =============================
// Viewer.jsx  (screen-space lasso overlay + accurate selection in 2D/3D)
// =============================
import React, { useMemo, useState, useEffect, useRef } from "react";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer, IconLayer } from "@deck.gl/layers";
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
  loading = false,
  chunkUV,
  atlasURL,
  atlasByChannel,
  channels = [],
  colors = {},
  alphas = {},
  // 窗口（每个通道的 min/max，单位：原始值，比如 0..65535）
  windows = {},
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
      // 使用utils函数计算选择框边界
      const bounds = computeSelectionBounds(dragStart, dragEnd);
      // 使用utils函数执行框选
      const picked = performBoxSelection(deck, bounds);
      
      for (const p of picked) {
        const id = p?.object?.id;
        if (id != null) ids.add(id);
      }
    }

    if (selectionMode === "lasso" && lassoPts.length >= 3 && viewport) {
      // 使用utils函数执行套索选择
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
        const mapping = iconMappingsByChunk?.[chunkId];
        if (!mapping) continue;

        // 新：按通道叠加（每个通道一个 IconLayer，使用灰度 atlas 并用颜色着色）
        let addedGray = false;
        for (let i = 0; i < channels.length; i++) {
          const ch = channels[i];
          const atlasGray = atlasByChannel?.[chunkId]?.[ch];
          if (!atlasGray) continue;
          addedGray = true;

          // 颜色与透明度（默认白色 + 100%）
          const col = colors?.[ch] || [255, 255, 255];
          const alpha01 = Math.min(1, Math.max(0, alphas?.[ch] ?? 1));
          const a = Math.round(alpha01 * 255);

          // 归一化窗口到 [0,1]
          const w = windows?.[ch];
          const wMin = w && Number.isFinite(w.min) ? w.min : 0;
          const wMax = w && Number.isFinite(w.max) ? w.max : 65535;
          const winMin01 = Math.max(0, Math.min(1, wMin / 65535));
          const winMax01 = Math.max(0, Math.min(1, wMax / 65535));

          all.push(
            new WindowedIconLayer({
              id: `icon-ch${ch}-${chunkId}`,
              data: arr.map((d) => ({ ...d, icon: `t_${d.local_index}` })),
              iconAtlas: String(atlasGray),
              // 尝试使用 ImageBitmap 提升解码与纹理上传性能
              loadOptions: { image: { type: 'imagebitmap' } },
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
              // 允许所有通道参与拾取；仅最上层显示 hover 高亮，避免重复叠加太亮
              pickable: true,
              autoHighlight: true,
              // Pure additive color mixing across all layers
              parameters: { depthTest: false, blend: true, blendFunc: [1, 1], blendEquation: 32774 },
              transitions: {
                getPosition: { duration: 600, easing: ease },
                getSize: { duration: 300, easing: ease },
              },
              // 窗口参数（归一化后传给 shader）
              windowMin: winMin01,
              windowMax: winMax01,
              premultiply: true,
              // 将灰度图按通道颜色着色；选中时高亮
              getColor: (d) =>
                selectedIds.has(d.id)
                  ? [255, 140, 0, 255]
                  : [col[0] ?? 255, col[1] ?? 255, col[2] ?? 255, a],
            })
          );
        }

        // 兼容旧：若当前 chunk 还没有灰度图层，则退回到服务端合成的 atlas（单层）
        const atlasMerged = !addedGray ? atlasURL?.[chunkId] : null;
        if (!atlasMerged) continue;
        all.push(
          new WindowedIconLayer({
            id: `icon-merged-${chunkId}`,
            data: arr.map((d) => ({ ...d, icon: `t_${d.local_index}` })),
            iconAtlas: String(atlasMerged),
            loadOptions: { image: { type: 'imagebitmap' } },
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
            // Pure additive color mixing
            parameters: { depthTest: false, blend: true, blendFunc: [1, 1], blendEquation: 32774 },
            transitions: {
              getPosition: { duration: 600, easing: ease },
              getSize: { duration: 300, easing: ease },
            },
            windowMin: 0.0,
            windowMax: 1.0,
            getColor: (d) => selectedIds.has(d.id)? [255, 140, 0, 255]: [255, 255, 255, 255],
          })
        );
      }
    } else {
      all.push(
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
      );
    }

    return all;
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
