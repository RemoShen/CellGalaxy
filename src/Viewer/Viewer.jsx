// =============================
// Viewer.jsx  (smooth transitions + hover tooltip, normal cursor)
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

// 轻量缓动（smoothstep）
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
  // center for initial target
  const center = useMemo(() => computeCenter(points), [points]);

  // viewState（含过渡配置）
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

  // 2D <-> 3D 相机姿态平滑
  useEffect(() => {
    setViewState((prev) => ({
      ...prev,
      rotationX: is3D ? 45 : 0,
      transitionDuration: 600,
      transitionEasing: ease,
      transitionInterpolator: new LinearInterpolator([
        "rotationX", "rotationOrbit", "zoom", "target",
      ]),
    }));
  }, [is3D]);

  const handleViewStateChange = ({ viewState: next }) => {
    setViewState(next);
  };

  const iconMappingsByChunk = useMemo(
    () => buildIconMappingsByChunk(meta, chunkUV),
    [meta, chunkUV]
  );

  const layers = useMemo(() => {
    if (!meta) return [];
    const all = [];

    if (renderMode === "sprites") {
      // 分 chunk 渲染 IconLayer
      const byChunk = new Map();
      for (const p of points ?? []) {
        const cid = p.chunk_id ?? 0;
        if (!byChunk.has(cid)) byChunk.set(cid, []);
        byChunk.get(cid).push(p);
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
          })
        );
      }
    } else {
      // 散点模式
      all.push(
        new ScatterplotLayer({
          id: "scatter",
          data: points ?? [],
          getPosition: (d) => [d.x, d.y, d.z ?? 0],
          getFillColor: [180, 180, 200, 120],
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

    return all;
  }, [points, atlasURL, iconMappingsByChunk, meta, renderMode, imageSize]);

  if (loading) {
    return (
      <div className="viewer-loading">
        <div>加载中...</div>
      </div>
    );
  }

  // 控制器
  const controller = is3D
    ? { type: OrbitController }
    : { type: OrthographicController };

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
      // 悬停提示文本
      getTooltip={({ object }) =>
        object
          ? `id: ${object.id}\nlabel: ${object.label ?? ((object?.id ?? 0) % 11)}`
          : null
      }
      // 固定为默认箭头；拖拽时可显示 grabbing（可改成始终 'default'）
      getCursor={({ isDragging /* , isHovering */ }) =>
        isDragging ? "grabbing" : "default"
      }
      pickingRadius={6}
      className="deck-tooltip"
    />
  );
};

export default Viewer;
