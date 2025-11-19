import { CLUSTERING_COLORS } from "../constants/clustering";
import { computeConvexHull2D } from "./utils";

export function clusterColor(label) {
  const palette = CLUSTERING_COLORS;
  const n = palette.length;
  if (!Number.isFinite(label) || n === 0) return [255, 255, 255];
  const idx = ((label % n) + n) % n;
  const c = palette[idx] || palette[0];
  return [c[0], c[1], c[2]];
}

export function buildOutlineData2D(points) {
  if (!Array.isArray(points) || points.length < 3) return [];
  const groups = new Map();
  for (const p of points) {
    const k = Number.isFinite(p?.label) ? p.label : 0;
    const arr = groups.get(k) || [];
    arr.push(p);
    groups.set(k, arr);
  }
  const out = [];
  for (const [label, arr] of groups.entries()) {
    if (arr.length < 3) continue;
    const hull = computeConvexHull2D(arr);
    if (!hull || hull.length < 3) continue;
    const rgb = clusterColor(label);
    out.push({
      path: hull.map(([x, y]) => [x, y, 0]),
      color: [rgb[0], rgb[1], rgb[2], 255],
      label,
    });
  }
  return out;
}

export function projectOutlines3D(viewport, points, filteredIds) {
  if (!viewport || !Array.isArray(points) || points.length < 3) return [];
  const byLabel = new Map();
  const activeFilter = filteredIds && filteredIds.size > 0;
  for (const p of points) {
    if (activeFilter && !filteredIds.has(p.id)) continue;
    const [sx, sy] = viewport.project([p.x, p.y, p.z ?? 0]);
    const arr = byLabel.get(p.label) || [];
    arr.push({ x: sx, y: sy });
    byLabel.set(p.label, arr);
  }
  const paths = [];
  for (const [label, arr] of byLabel.entries()) {
    if (arr.length < 3) continue;
    const hull = computeConvexHull2D(arr);
    if (!hull || hull.length < 3) continue;
    const rgb = clusterColor(label);
    const d = hull.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ") + " Z";
    paths.push({ d, color: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)` });
  }
  return paths;
}


