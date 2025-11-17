import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildTooltipHTML } from "../TooltipPreview/TooltipPreview";
import "../FeatureDock/FeatureDock.css";

function Thumb({ object, iconMappingsByChunk, chunkUV, atlasByChannel, atlasURL, channels, colors, alphas, size = 96, label }) {
  const html = useMemo(
    () =>
      buildTooltipHTML({
        object,
        iconMappingsByChunk,
        chunkUV,
        atlasByChannel,
        atlasURL,
        channels,
        colors,
        alphas,
        previewSize: size,
      }),
    [object, iconMappingsByChunk, chunkUV, atlasByChannel, atlasURL, channels, colors, alphas, size]
  );
  return (
    <div className="thumb">
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {label ? <div className="label">{label}</div> : null}
    </div>
  );
}

export default function LocalFeaturePanel({
  data,
  iconMappingsByChunk,
  chunkUV,
  atlasByChannel,
  atlasURL,
  channels,
  colors,
  alphas,
  points = [],
}) {
  const [view, setView] = useState("all"); // 'all' | 'gallery' | 'compact' | 'hist' | 'diff'
  // X axis range interaction: right end always fixed at 1.0, left end can be adjusted by wheel (default 0.6)
  const [axisMin, setAxisMin] = useState(0.6);
  const mapById = useMemo(() => {
    const m = new Map();
    for (const p of points) m.set(p.id, p);
    return m;
  }, [points]);

  const queryObj = mapById.get(data?.query);
  const neighborObjs = useMemo(() => {
    const arr = (data?.neighbors || []).map((n) => ({
      ...n,
      object: mapById.get(n.id),
    }));
    return arr.filter((x) => x.object);
  }, [data, mapById]);

  // Histogram render
  const canvasRef = useRef(null);
  const layoutRef = useRef({});
  useEffect(() => {
    const sims = (data?.similarities || []).slice();
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (view !== "all" && view !== "hist") return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 120;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    if (!sims.length) return;

    const X_MIN = Math.max(0.0, Math.min(1.0 - 1e-6, axisMin));
    const X_MAX = 1.0;
    const X_SPAN = Math.max(1e-6, X_MAX - X_MIN);


    const simsIn = sims.filter((s) => s >= X_MIN && s <= X_MAX);
    const base = simsIn.length > 0 ? simsIn : sims;

    let minS = Infinity, maxS = -Infinity, sum = 0;
    for (const s of base) { if (s < minS) minS = s; if (s > maxS) maxS = s; sum += s; }
    const span = maxS - minS;
    const mean = base.length ? sum / base.length : 0;


    const bins = Math.min(16, Math.max(8, Math.round(Math.sqrt(base.length || sims.length) * 2)));
    const hist = new Array(bins).fill(0);
    for (const s of base) {
      let t;
      const norm = (s - X_MIN) / X_SPAN;
      t = Math.floor(Math.max(0, Math.min(0.9999, norm)) * (bins - 1));
      if (t < 0) t = 0; if (t >= bins) t = bins - 1;
      hist[t]++;
    }
    const maxCount = Math.max(...hist);

    // —— layout ——
    const margin = { left: 40, right: 10, top: 8, bottom: 28 };
    const plotW = Math.max(10, w - margin.left - margin.right);
    const plotH = Math.max(10, h - margin.top - margin.bottom);
    const x0 = margin.left;
    const y0 = h - margin.bottom;

    ctx.fillStyle = "rgba(255,255,255,0.03)";
    ctx.fillRect(x0, y0 - plotH, plotW, plotH);

    // axis lines
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + plotW, y0);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0, y0 - plotH);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "11px system-ui, -apple-system, sans-serif";
    const yTicks = 4;
    for (let i = 0; i <= yTicks; i++) {
      const t = i / yTicks;
      const yy = y0 - t * plotH;
      const v = Math.round(t * maxCount);
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.moveTo(x0, yy);
      ctx.lineTo(x0 + plotW, yy);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(String(v), x0 - 6, yy);
    }

    const decimals = X_SPAN < 0.05 ? 3 : 2;
    const tickVals = [X_MIN, X_MIN + X_SPAN * 0.5, X_MAX];
    for (let i = 0; i < tickVals.length; i++) {
      const val = tickVals[i];
      const t = (val - X_MIN) / X_SPAN;
      const xx = x0 + t * plotW;
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(val.toFixed(decimals), xx, y0 + 4);
    }
    // x/y axis titles (larger font size)
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "14px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("cosine similarity", x0 + plotW / 2, h - 2);
    ctx.save();
    ctx.translate(12, y0 - plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("count", 0, 0);
    ctx.restore();

    // —— bars: grayscale, no gradient —— 
    const barSlot = plotW / bins;
    const barW = Math.max(1, barSlot * 0.42);
    ctx.shadowColor = "rgba(0,0,0,0.15)";
    ctx.shadowBlur = 6;
    for (let i = 0; i < bins; i++) {
      const v = hist[i];
      const bh = maxCount ? (v / maxCount) * plotH : 0;
      const bx = x0 + i * barSlot + (barSlot - barW) / 2;
      const by = y0 - bh;
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.globalAlpha = 0.8;
      const r = 3;
      const w2 = barW, h2 = bh;
      ctx.beginPath();
      ctx.moveTo(bx, by + r);
      ctx.arcTo(bx, by, bx + r, by, r);
      ctx.arcTo(bx + w2, by, bx + w2, by + r, r);
      ctx.lineTo(bx + w2, by + h2);
      ctx.lineTo(bx, by + h2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // —— KDE smooth curve (distribution shape of embedding-only) ——
    if (isFinite(span) && span > 0) {
      const gaussian = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
      const bandwidth = Math.max(1e-6, span / bins * 1.2);
      const steps = 160;
      const xs = new Array(steps);
      const ys = new Array(steps);
      let maxY = 0;
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const xVal = X_MIN + t * X_SPAN;
        let yVal = 0;
        for (const s of base) {
          yVal += gaussian((xVal - s) / bandwidth);
        }
        yVal /= ((base.length || 1) * bandwidth);
        xs[i] = xVal; ys[i] = yVal;
        if (yVal > maxY) maxY = yVal;
      }
      // outline only (grayscale)
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < steps; i++) {
        const t = (xs[i] - X_MIN) / X_SPAN;
        const xx = x0 + t * plotW;
        const yy = y0 - (ys[i] / maxY) * plotH * 0.9;
        if (i === 0) ctx.moveTo(xx, yy);
        else ctx.lineTo(xx, yy);
      }
      ctx.stroke();
    }

    // ——  median and std band —— 
    const sorted = base.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? mean;
    const variance = base.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / (base.length || 1);
    const std = Math.sqrt(Math.max(0, variance));
    const bandL = Math.max(X_MIN, mean - std);
    const bandR = Math.min(X_MAX, mean + std);
    const bl = x0 + ((bandL - X_MIN) / X_SPAN) * plotW;
    const br = x0 + ((bandR - X_MIN) / X_SPAN) * plotW;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(bl, y0 - plotH, Math.max(0, br - bl), plotH);
    const medX = x0 + ((median - X_MIN) / X_SPAN) * plotW;
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.moveTo(medX, y0);
    ctx.lineTo(medX, y0 - plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    // remove colored Δ band, keep text only

    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    if (isFinite(span) && span > 0) {
      const decimals2 = Math.max(2, Math.min(6, Math.ceil(-Math.log10(span)) + 1));
      ctx.fillText(`Δ=${span.toFixed(decimals2)}`, x0 + plotW - 4, y0 - plotH + 4);
    }
    // save geometry for hover
    const barRects = [];
    {
      const barSlot2 = plotW / bins;
      const barW2 = Math.max(1, barSlot2 * 0.42);
      for (let i = 0; i < bins; i++) {
        const cxVal = X_MIN + (i + 0.5) * (X_SPAN / bins);
        const v = hist[i];
        const bh = maxCount ? (v / maxCount) * plotH : 0;
        const bx = x0 + i * barSlot2 + (barSlot2 - barW2) / 2;
        barRects.push({ x: bx, y: y0 - bh, w: barW2, h: bh, count: v, center: cxVal });
      }
    }
    layoutRef.current = {
      x0, y0, plotW, plotH, X_MIN, X_SPAN,
      barRects,
      medX,
      medianVal: median,
      band: { bl, br, top: y0 - plotH, bottom: y0 },
    };
  }, [data, view, axisMin]);

  // —— interaction: wheel zoom X axis range; double click reset; hold Shift + wheel pan ——
  const handleWheel = (e) => {
    if (view !== "all" && view !== "hist") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    // fix right end at 1.0, zoom around right end (change left end)
    const span = Math.max(1e-6, 1.0 - axisMin);
    const zoom = Math.exp(-e.deltaY * 0.0012); // zoom in when scroll up
    let newSpan = span / zoom; // zoom in → span smaller
    const MIN_SPAN = 0.005;
    if (newSpan < MIN_SPAN) newSpan = MIN_SPAN;
    if (newSpan > 1.0) newSpan = 1.0;
    let nMin = 1.0 - newSpan;
    if (nMin < 0) nMin = 0;
    setAxisMin(nMin);
  };

  const resetAxis = () => {
    setAxisMin(0.6);
  };

  // Hover tooltip: bar / median / std band
  const wrapperRef = useRef(null);
  const onMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const l = layoutRef.current || {};
    if (!l || !l.plotW) return;
    // bar hover
    for (const r of l.barRects || []) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        // clamp tooltip within wrapper bounds
        const wrap = wrapperRef.current;
        const ww = wrap?.clientWidth || rect.width;
        const wh = wrap?.clientHeight || rect.height;
        const tipW = 180, tipH = 50;
        const lx = Math.max(8, Math.min(mx + 12, ww - tipW - 8));
        const ly = Math.max(8, Math.min(my + 12, wh - tipH - 8));
        setGlobalTooltip({ x: lx, y: ly, lines: [`sim ≈ ${r.center.toFixed(4)}`, `count = ${r.count}`] });
        return;
      }
    }
    // median
    if (Math.abs(mx - l.medX) < 6 && my >= l.band.top && my <= l.band.bottom) {
      const wrap = wrapperRef.current;
      const ww = wrap?.clientWidth || rect.width;
      const wh = wrap?.clientHeight || rect.height;
      const tipW = 180, tipH = 50;
      const lx = Math.max(8, Math.min(mx + 12, ww - tipW - 8));
      const ly = Math.max(8, Math.min(my + 12, wh - tipH - 8));
      const mv = typeof l.medianVal === "number" && isFinite(l.medianVal) ? l.medianVal.toFixed(4) : "";
      setGlobalTooltip({ x: lx, y: ly, lines: [`Median ≈ ${mv}`, "median: half on left, half on right"] });
      return;
    }
    // std band
    if (mx >= l.band.bl && mx <= l.band.br && my >= l.band.top && my <= l.band.bottom) {
      const wrap = wrapperRef.current;
      const ww = wrap?.clientWidth || rect.width;
      const wh = wrap?.clientHeight || rect.height;
      const tipW = 180, tipH = 50;
      const lx = Math.max(8, Math.min(mx + 12, ww - tipW - 8));
      const ly = Math.max(8, Math.min(my + 12, wh - tipH - 8));
      setGlobalTooltip({ x: lx, y: ly, lines: ["Std band", "≈ mean ± std"] });
      return;
    }
    setGlobalTooltip(null);
  };
  const onMouseLeave = () => setGlobalTooltip(null);

  // shared simple tooltip (fixed position)
  const [globalTooltip, setGlobalTooltip] = useState(null);

  if (!data) return null;

  return (
    <div>
      

      {/* remove query label, directly enter content block */}

      {(view === "all" || view === "gallery") && (
      <div className="feature-section">
        <div className="feature-title">Similarity gallery</div>
        <div className="gallery-t1">
          <div className="gallery-query">
            {queryObj && (
              <Thumb
                object={queryObj}
                iconMappingsByChunk={iconMappingsByChunk}
                chunkUV={chunkUV}
                atlasByChannel={atlasByChannel}
                atlasURL={atlasURL}
                channels={channels}
                colors={colors}
                alphas={alphas}
                size={96}
                label="query"
              />
            )}
          </div>
          <div className="neighbors-grid">
            {neighborObjs.slice(0, 8).map((n) => (
              <Thumb
                key={n.id}
                object={n.object}
                iconMappingsByChunk={iconMappingsByChunk}
                chunkUV={chunkUV}
                atlasByChannel={atlasByChannel}
                atlasURL={atlasURL}
                channels={channels}
                colors={colors}
                alphas={alphas}
                size={64}
                label={`sim ${n.similarity.toFixed(2)}`}
              />
            ))}
          </div>
        </div>
      </div>
      )}

      {(view === "all" || view === "compact") && (
      <div className="feature-section">
        <div className="feature-title">Local metrics</div>
        <div className="metrics-wrap">
        <div className="metric-card">
          {/* Compactness gauge (smaller is better → use percentile directly) */}
          <div className="metric-row">
            <div className="metric-name">Compactness</div>
            <div style={{paddingRight: 8}}>
              <div
                className="metric-line"
                aria-label="compactness line"
                title={typeof data?.compactness === "number" ? `raw=${data.compactness.toFixed(4)}` : ""}
              >
                <div className="metric-tick" />
                {(() => {
                  const p = Math.max(0, Math.min(1, data?.percentiles?.compactness ?? 0));
                  const left = `${(p * 100).toFixed(1)}%`;
                  return <div className="metric-dot" style={{ left, background: '#d9d9d9' }} />;
                })()}
              </div>
              <div className="metric-legend">
                <div>low</div>
                <div className="center">median</div>
                <div className="right">high</div>
              </div>
            </div>
            <div className="metric-value">
              {typeof data?.percentiles?.compactness === "number" ? (
                <>
                  <div className="pctl-num">{Math.round((data.percentiles.compactness) * 100)}th</div>
                  <div className="pctl-suffix">percentile</div>
                </>
              ) : (
                "--"
              )}
            </div>
          </div>
          {/* Difference gauge (larger is more unique → percentile higher is more right) */}
          <div className="metric-row">
            <div className="metric-name">Difference</div>
            <div style={{paddingRight: 8}}>
              <div
                className="metric-line"
                aria-label="difference line"
                title={typeof data?.difference === "number" ? `raw=${data.difference.toFixed(4)}` : ""}
              >
                <div className="metric-tick" />
                {(() => {
                  const p = Math.max(0, Math.min(1, data?.percentiles?.difference ?? 0));
                  const left = `${(p * 100).toFixed(1)}%`;
                  return <div className="metric-dot" style={{ left, background: '#bfbfbf' }} />;
                })()}
              </div>
              <div className="metric-legend">
                <div>typical</div>
                <div className="center">median</div>
                <div className="right">unique</div>
              </div>
            </div>
            <div className="metric-value">
              {typeof data?.percentiles?.difference === "number" ? (
                <>
                  <div className="pctl-num">{Math.round((data.percentiles.difference) * 100)}th</div>
                  <div className="pctl-suffix">percentile</div>
                </>
              ) : (
                "--"
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
      )}

      {(view === "all" || view === "hist") && (
      <div className="feature-section">
        <div className="feature-title">Similarity histogram</div>
        <div ref={wrapperRef} style={{ position: "relative", overflow: "visible" }}>
          <canvas
            className="hist-canvas"
            ref={canvasRef}
            onWheel={handleWheel}
            onDoubleClick={resetAxis}
            onMouseMove={onMouseMove}
            onMouseLeave={onMouseLeave}
          />
          {globalTooltip && (
            <div
              style={{
                position: "absolute",
                left: Math.round(globalTooltip.x),
                top: Math.round(globalTooltip.y),
                pointerEvents: "none",
                background: "rgba(0,0,0,0.85)",
                color: "#fff",
                padding: "6px 8px",
                borderRadius: 8,
                fontSize: 12,
                boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
                zIndex: 9999,
                whiteSpace: "nowrap",
              }}
            >
              {globalTooltip.lines.map((t, i) => (
                <div key={i} style={{ opacity: i === 0 ? 1 : 0.8 }}>{t}</div>
              ))}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Difference module merged into Local metrics card */}

      {/* remove "UMAP + Spatial highlight" explanation block */}
    </div>
  );
}


