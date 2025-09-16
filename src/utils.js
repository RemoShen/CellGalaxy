// =============================
// utils.js - 工具函数集合
// =============================

/**
 * 判断屏幕空间点是否在多边形内（射线法）
 * @param {Array} point - [px, py] 待判断的点坐标
 * @param {Array} polygon - [[x1,y1], [x2,y2], ...] 多边形顶点数组
 * @returns {boolean} 点是否在多边形内
 */
export function pointInPolygon([px, py], polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      const intersect =
        (yi > py) !== (yj > py) &&
        px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }
/**
 * 计算点集的几何中心
 * @param {Array} points - 点数组，每个点包含 x, y, z 属性
 * @returns {Array} [centerX, centerY, centerZ]
 */
export function computeCenter(points) {
  if (!points?.length) return [0, 0, 0];
  
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const zs = points.map(p => p.z ?? 0);
  
  return [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
    (Math.min(...zs) + Math.max(...zs)) / 2
  ];
}



/**
 * 平滑插值函数 (smoothstep)
 * @param {number} t - 插值参数 [0, 1]
 * @returns {number} 平滑后的值
 */
export function ease(t) {
  return t * t * (3 - 2 * t);
}

/**
 * 构建每个chunk的图标映射，用于IconLayer
 * @param {Object} meta - 元数据
 * @param {Object} chunkUV - chunk的UV坐标信息
 * @returns {Object} 图标映射对象
 */
export function buildIconMappingsByChunk(meta, chunkUV) {
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
        // Use atlas RGB directly (grayscale), not alpha-mask mode
        mask:true,
        anchorY: tile / 2,
        anchorX: tile / 2,
      };
    }
    map[chunkId] = imap;
  }
  
  return map;
}

/**
 * 获取canvas的设备像素比
 * @param {Object} deckRef - deck.gl的ref引用
 * @returns {number} 设备像素比
 */
export function getCanvasDPR(deckRef) {
  const deck = deckRef?.current?.deck;
  const canvas = deck?.canvas || deck?.getCanvas?.();
  if (!canvas) return window.devicePixelRatio || 1;
  
  const cssW = canvas.clientWidth || canvas.width;
  const dpr = cssW ? canvas.width / cssW : window.devicePixelRatio || 1;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/**
 * 统一获取鼠标事件的屏幕坐标（相对于canvas左上角）
 * @param {Object} info - 事件信息对象
 * @param {HTMLElement} containerRef - 容器元素的ref
 * @returns {Object} {x, y} 坐标对象
 */
export function getEventCoordinates(info, containerRef) {
  if (info?.offsetCenter && Number.isFinite(info.offsetCenter.x)) {
    return { x: info.offsetCenter.x, y: info.offsetCenter.y };
  }
  
  if (Number.isFinite(info?.x) && Number.isFinite(info?.y)) {
    return { x: info.x, y: info.y };
  }
  
  const evt = info?.srcEvent;
  if (evt && typeof evt.clientX === "number") {
    const rect = containerRef?.current?.getBoundingClientRect();
    return {
      x: evt.clientX - (rect?.left ?? 0),
      y: evt.clientY - (rect?.top ?? 0),
    };
  }
  
  return { x: 0, y: 0 };
}

/**
 * 计算选择框的边界
 * @param {Object} dragStart - 拖拽开始点 {x, y}
 * @param {Object} dragEnd - 拖拽结束点 {x, y}
 * @returns {Object} {x0, y0, width, height} 选择框边界
 */
export function computeSelectionBounds(dragStart, dragEnd) {
  const x0 = Math.min(dragStart.x, dragEnd.x);
  const y0 = Math.min(dragStart.y, dragEnd.y);
  const width = Math.max(1, Math.abs(dragStart.x - dragEnd.x));
  const height = Math.max(1, Math.abs(dragStart.y - dragEnd.y));
  
  return { x0, y0, width, height };
}

/**
 * 执行框选操作
 * @param {Object} deck - deck.gl实例
 * @param {Object} bounds - 选择框边界 {x0, y0, width, height}
 * @returns {Array} 选中的对象数组
 */
export function performBoxSelection(deck, bounds) {
  const { x0, y0, width, height } = bounds;
  
  const picked = deck?.pickObjects({
    x: x0,
    y: y0,
    width,
    height,
  }) || [];
  
  return picked;
}

/**
 * 执行套索选择操作
 * @param {Array} points - 所有数据点
 * @param {Object} viewport - 视口对象
 * @param {Array} lassoPoints - 套索路径点 [[x,y], ...]
 * @returns {Set} 选中的ID集合
 */
export function performLassoSelection(points, viewport, lassoPoints) {
  if (lassoPoints.length < 3) return new Set();
  
  const ids = new Set();
  for (const p of points) {
    const [sx, sy] = viewport.project([p.x, p.y, p.z ?? 0]);
    if (pointInPolygon([sx, sy], lassoPoints)) {
      ids.add(p.id);
    }
  }
  
  return ids;
}


