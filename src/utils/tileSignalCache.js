/**
 * Per-tile atlas signal cache for UMAP empty-tile filtering.
 * Atlas gray = raw/65535 (full scale 0..65535). We store tile mean in 0–1,
 * then score in raw units so display window stretch cannot revive empty tiles.
 */
import {
  applyIntensityWindow01,
  INTENSITY_FULL_RANGE,
  readAtlasIntensity01,
  windowFromChannel,
} from "./intensityWindow";

/**
 * Minimum composite tile mean in raw units (0..65535 × alpha sum).
 * Edge-only / haze tiles stay below this; real content usually clears it.
 */
export const TILE_SIGNAL_MIN_RAW = 1900;

/** Also require some post-window response (drops tiles entirely below contrast min). */
export const TILE_SIGNAL_MIN_WINDOWED = 0.02;

const _imageCache = new Map(); // url -> HTMLImageElement | Promise

function loadImage(url) {
  if (!url) return Promise.resolve(null);
  const hit = _imageCache.get(url);
  if (hit instanceof HTMLImageElement && hit.complete && hit.naturalWidth > 0) {
    return Promise.resolve(hit);
  }
  if (hit && typeof hit.then === "function") return hit;
  const pending = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      _imageCache.set(url, img);
      resolve(img);
    };
    img.onerror = () => {
      _imageCache.delete(url);
      resolve(null);
    };
    img.src = url;
  });
  _imageCache.set(url, pending);
  return pending;
}

/**
 * Scan one atlas PNG → Float32Array[local_index] = mean intensity in 0–1
 * (atlas encodes raw/65535).
 */
export async function scanAtlasTileMax01(atlasUrl, { tile, cols, nTiles }) {
  // Name kept for call sites; value is mean01 (better empty detection than max).
  const t = Number(tile) || 16;
  const c = Number(cols);
  const n = Number(nTiles);
  if (!atlasUrl || !Number.isFinite(c) || c <= 0 || !Number.isFinite(n) || n <= 0) {
    return null;
  }
  const img = await loadImage(String(atlasUrl));
  if (!img) return null;

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, w, h);
  const pixPerTile = t * t;

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / c);
    const col = i % c;
    const x0 = col * t;
    const y0 = row * t;
    let sum = 0;
    let count = 0;
    for (let dy = 0; dy < t; dy++) {
      const yy = y0 + dy;
      if (yy >= h) break;
      for (let dx = 0; dx < t; dx++) {
        const xx = x0 + dx;
        if (xx >= w) break;
        const bi = (yy * w + xx) * 4;
        sum += readAtlasIntensity01(data, bi);
        count++;
      }
    }
    out[i] = count > 0 ? sum / count : 0;
    if (count < pixPerTile && count > 0) {
      // partial tile at atlas edge — already averaged over available pixels
    }
  }
  return out;
}

/** Layout from /atlas_uv response (or infer from atlas pixel size). */
export function atlasLayoutFromUv(uvMeta, tileFallback = 16) {
  if (!uvMeta || typeof uvMeta !== "object") return null;
  const tile = Number(uvMeta.tile) || tileFallback;
  const cols = Number(uvMeta.cols);
  const nTiles = Array.isArray(uvMeta.uv) ? uvMeta.uv.length : Number(uvMeta.n);
  if (!Number.isFinite(cols) || cols <= 0 || !Number.isFinite(nTiles) || nTiles <= 0) {
    return null;
  }
  return { tile, cols, nTiles };
}

/**
 * Composite scores for one point across active channels.
 * - meanRaw: Σ mean01 * 65535 * alpha  (absolute content, 0..65535 scale)
 * - windowed: Σ window(mean01) * alpha (respects contrast; 0 if below window)
 * Returns null if any active channel is not scanned yet for this chunk.
 */
export function compositeTileSignalScore(
  point,
  {
    channels,
    tileSignalByChannel,
    windows = {},
    alphas = {},
    omePixelRangeByChannelId = {},
  },
) {
  const list = Array.isArray(channels) ? channels : [];
  if (list.length === 0 || !point) return null;

  const chunkId = point.chunk_id ?? 0;
  const local = point.local_index;
  if (!Number.isFinite(local) || local < 0) return null;

  let meanRaw = 0;
  let windowed = 0;
  let saw = false;
  let missing = false;
  for (const ch of list) {
    const byChunk = tileSignalByChannel?.[ch] ?? tileSignalByChannel?.[String(ch)];
    const arr = byChunk?.[chunkId] ?? byChunk?.[String(chunkId)];
    if (!arr || local >= arr.length) {
      missing = true;
      continue;
    }
    saw = true;
    const mean01 = arr[local] ?? 0;
    const { winMin01, winMax01 } = windowFromChannel(
      ch,
      windows,
      omePixelRangeByChannelId,
    );
    const a = Math.min(1, Math.max(0, alphas?.[ch] ?? 1));
    meanRaw += mean01 * INTENSITY_FULL_RANGE * a;
    windowed += applyIntensityWindow01(mean01, winMin01, winMax01) * a;
  }
  if (missing || !saw) return null;
  return { meanRaw, windowed };
}

/** True if point should stay in the UMAP candidate pool. */
export function passesTileSignalFilter(
  point,
  opts,
  minRaw = TILE_SIGNAL_MIN_RAW,
  minWindowed = TILE_SIGNAL_MIN_WINDOWED,
) {
  const score = compositeTileSignalScore(point, opts);
  if (score == null) return true; // no data yet → do not drop
  return score.meanRaw > minRaw && score.windowed > minWindowed;
}
