// =============================
// Viewer.jsx  (modified for smooth transitions)
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

/**
 * Compute the geometric center of a point set.
 */
function computeCenter(points) {
  if (!points?.length) return [0, 0, 0];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    const x = p.x, y = p.y, z = p.z ?? 0;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}

/**
 * Construct icon mappings per chunk for IconLayer from normalized UVs.
 */
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
        x, y, width: tile, height: tile,
        mask: false,
        anchorY: tile / 2,
        anchorX: tile / 2,
      };
    }
    map[chunkId] = imap;
  }
  return map;
}

// 轻量的缓动函数（smoothstep）
const ease = (t) => t * t * (3 - 2 * t);

const Viewer = ({
  meta,
  points,
  loading = false,
  chunkUV,
  atlasURL,
  renderMode = "sprites",
  is3D = false,
  imageSize = 4,
}) => {
  // center of data for view target
  const center = useMemo(() => computeCenter(points), [points]);

  // 统一的视图状态
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
  // 首次根据数据中心居中（之后不再强制改 target）
  useEffect(() => {
    if (!initialized.current && points.length) {
      setViewState((prev) => ({ ...prev, target: center }));
      initialized.current = true;
    }
  }, [center, points.length]);

  // 在 2D <-> 3D 切换时，平滑地调整相机姿态（如 rotationX）
  useEffect(() => {
    setViewState((prev) => ({
      ...prev,
      rotationX: is3D ? 45 : 0,
      // 可选：也可以轻微调整 zoom 获得更好的空间感
      transitionDuration: 600,
      transitionEasing: ease,
      transitionInterpolator: new LinearInterpolator([
        'rotationX', 'rotationOrbit', 'zoom', 'target',
      ]),
    }));
  }, [is3D]);

  // 处理视图状态变化（拖拽/缩放）
  const handleViewStateChange = ({ viewState: newViewState }) => {
    setViewState(newViewState);
  };

  const iconMappingsByChunk = useMemo(
    () => buildIconMappingsByChunk(meta, chunkUV),
    [meta, chunkUV]
  );

  const layers = useMemo(() => {
    if (!meta) return [];
    const all = [];

    if (renderMode === "sprites") {
      // bucket points by chunk
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
            pickable: false,
            parameters: { depthTest: true },
            // —— 让点位与尺寸都能平滑过渡 ——
            transitions: {
              getPosition: { duration: 600, easing: ease },
              getSize: { duration: 300, easing: ease },
            },
            // 如果 accessor 依赖外部 props，可在此声明触发器；
            // 目前我们依靠 data 变化来触发即可
          })
        );
      }
    } else {
      all.push(
        new ScatterplotLayer({
          id: "scatter",
          data: points ?? [],
          getPosition: (d) => [d.x, d.y, d.z ?? 0],
          getFillColor: [180, 180, 200, 120],
          getRadius: imageSize / 2,
          radiusScale: 1,
          radiusUnits: "pixels",
          pickable: false,
          parameters: { depthTest: true },
          transitions: {
            getPosition: { duration: 600, easing: ease },
            getRadius: { duration: 300, easing: ease },
          },
        })
      );
    }

    return all;
  }, [points, atlasURL, iconMappingsByChunk, meta, renderMode, imageSize]);

  if (loading) {
    return (
      <div className="viewer-loading">
        <div>加载中...</div>
      </div>
    );
  }

  // 2D模式：使用OrthographicController，只允许缩放和平移
  // 3D模式：使用OrbitController，允许所有操作，包括旋转
  const controller = is3D ? { type: OrbitController } : { type: OrthographicController };

  return (
    <DeckGL
      views={
        is3D
          ? [new OrbitView({ id: "3d", orbitAxis: "Y", flipY: false })]
          : [new OrthographicView({ id: "2d", flipY: false })]
      }
      controller={controller}
      viewState={viewState}
      onViewStateChange={handleViewStateChange}
      layers={layers}
    />
  );
};

export default Viewer;
