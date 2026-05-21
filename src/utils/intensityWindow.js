/**
 * Shared intensity windowing + tone gain (hover preview is the reference).
 * Zarr atlas tiles store gray = raw / INTENSITY_FULL_RANGE; windows use the same scale.
 */

export const INTENSITY_FULL_RANGE = 65535;
export const TONE_GAIN = 1.35;
/** Pixels below this accumulated alpha are cleared (matches hover/server preview). */
export const ALPHA_VISIBLE_MIN = 5 / 255;

export function resolveRawWindow(window, defaults = { min: 0, max: INTENSITY_FULL_RANGE }) {
  const w = window || {};
  return {
    min: Number.isFinite(w.min) ? w.min : defaults.min,
    max: Number.isFinite(w.max) ? w.max : defaults.max,
  };
}

/** Map Channel Manager raw min/max to 0..1 for atlas gray (raw / 65535). */
export function rawWindowToNormalized01(min, max, fullRange = INTENSITY_FULL_RANGE) {
  const winMin01 = Math.max(0, Math.min(1, min / fullRange));
  const winMax01 = Math.max(0, Math.min(1, max / fullRange));
  return {
    winMin01,
    winMax01,
    span: Math.max(1e-6, winMax01 - winMin01),
  };
}

export function windowFromChannel(ch, windows) {
  const { min, max } = resolveRawWindow(windows?.[ch]);
  return rawWindowToNormalized01(min, max);
}

/** Piecewise linear window on normalized gray (atlas or icon alpha). */
export function applyIntensityWindow01(gray01, winMin01, winMax01) {
  if (gray01 <= winMin01) return 0;
  if (gray01 >= winMax01) return 1;
  const span = Math.max(1e-6, winMax01 - winMin01);
  return (gray01 - winMin01) / span;
}

/** Combined raw window across channels (merged-atlas fallback). */
export function combinedRawWindow(channels, windows) {
  const list = Array.isArray(channels) ? channels : [];
  if (list.length === 0) return resolveRawWindow(null);
  let rawMin = Infinity;
  let rawMax = -Infinity;
  for (const ch of list) {
    const { min, max } = resolveRawWindow(windows?.[ch]);
    rawMin = Math.min(rawMin, min);
    rawMax = Math.max(rawMax, max);
  }
  if (!Number.isFinite(rawMin)) return resolveRawWindow(null);
  return { min: rawMin, max: rawMax };
}

export function applyToneGainRgb(r, g, b, a, toneGain = TONE_GAIN) {
  if (a < ALPHA_VISIBLE_MIN * 255) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  return {
    r: Math.min(255, r * toneGain),
    g: Math.min(255, g * toneGain),
    b: Math.min(255, b * toneGain),
    a: Math.max(0, Math.min(255, a)),
  };
}

/** Scale Viv / UI channel tint to match post-window tone gain. */
export function scaleRgbByToneGain(rgb, toneGain = TONE_GAIN) {
  const [r, g, b] = rgb || [255, 255, 255];
  return [
    Math.min(255, Math.round((r ?? 255) * toneGain)),
    Math.min(255, Math.round((g ?? 255) * toneGain)),
    Math.min(255, Math.round((b ?? 255) * toneGain)),
  ];
}
