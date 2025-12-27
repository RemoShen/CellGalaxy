import React, { useEffect, useMemo, useRef, useState } from "react";
import "../../FeatureDock/FeatureDock.css";
import "./CompareFeaturePanel.css";
import { drawCellPreviewToCanvas } from "../../Viewer/HoverPreview/HoverPreview";
import { API_BASE } from "../../api/api";

// Violin 形状本身仍然用中性白/灰两色区分 Region 1 / Region 2，
// 颜色提示通过文字（Region 1 橙色 / Region 2 青色）来表达。
const COLOR_REGION1 = "rgba(230,230,230,0.95)"; // Region 1 → 较亮的白
const COLOR_REGION2 = "rgba(130,130,130,0.95)"; // Region 2 → 较深的灰

function RegionThumb({
  repId,
  mapById,
  iconMappingsByChunk,
  chunkUV,
  atlasByChannel,
  atlasURL,
  channels,
  colors,
  alphas,
  windows,
}) {
  const obj = mapById.get(repId);
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !obj) return;
    let cancelled = false;
    (async () => {
      await drawCellPreviewToCanvas({
        canvas,
        object: obj,
        iconMappingsByChunk,
        chunkUV,
        atlasByChannel,
        channels,
        colors,
        alphas,
        windows,
        previewSize: 110,
      });
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [
    obj,
    iconMappingsByChunk,
    chunkUV,
    atlasByChannel,
    channels,
    colors,
    alphas,
    windows,
  ]);

  return (
    <div className="compare-thumb">
      {obj ? (
        <canvas
          ref={canvasRef}
          style={{
            width: 72,
            height: 72,
            borderRadius: 8,
            display: "block",
          }}
        />
      ) : null}
    </div>
  );
}

function useChannelNames() {
  const [channelNames, setChannelNames] = useState(new Map()); // id -> name
  useEffect(() => {
    let abort = false;
    const run = async () => {
      try {
        const url = `${API_BASE}/public/channel_info.json?ts=${Date.now()}`;
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const m = new Map();
        if (json && Array.isArray(json.channels)) {
          for (const ch of json.channels) {
            if (typeof ch?.id === "number" && typeof ch?.name === "string") {
              m.set(ch.id, ch.name);
            }
          }
        }
        if (!abort) setChannelNames(m);
      } catch {}
    };
    run();
    return () => {
      abort = true;
    };
  }, []);
  return channelNames;
}

function drawViolinRow(canvas, kdeA, kdeB, channelNames, colors, message) {
  if (!canvas) return;
  const chs = Array.isArray(kdeA?.channels)
    ? kdeA.channels
    : Array.isArray(kdeB?.channels)
    ? kdeB.channels
    : null;
  const hasData =
    chs &&
    Array.isArray(kdeA?.xs) &&
    Array.isArray(kdeA?.ys) &&
    Array.isArray(kdeB?.xs) &&
    Array.isArray(kdeB?.ys);
  const ctx0 = canvas.getContext("2d");
  if (!ctx0) return;
  const dpr0 = window.devicePixelRatio || 1;
  const w0 = canvas.clientWidth || 640;
  const h0 = canvas.clientHeight || 180;
  canvas.width = Math.round(w0 * dpr0);
  canvas.height = Math.round(h0 * dpr0);
  ctx0.setTransform(1, 0, 0, 1, 0, 0);
  ctx0.scale(dpr0, dpr0);
  ctx0.clearRect(0, 0, w0, h0);

  const renderEmpty = (msg) => {
    ctx0.fillStyle = "rgba(255,255,255,0.03)";
    ctx0.fillRect(0, 0, w0, h0);
    if (msg) {
      ctx0.fillStyle = "rgba(255,255,255,0.75)";
      ctx0.font = "14px sans-serif";
      ctx0.fillText(msg, 12, 22);
      ctx0.fillStyle = "rgba(255,255,255,0.15)";
      ctx0.fillRect(10, 28, w0 - 20, 1);
    }
  };

  if (!hasData) {
    renderEmpty(message || "No violin data");
    return;
  }

  const ctx = ctx0;
  const w = w0;
  const h = h0;
  const marginL = 56,
    marginR = 16,
    marginT = 16,
    marginB = 32;
  const plotW = w - marginL - marginR;
  const plotH = h - marginT - marginB;
  const C = chs.length;
  if (C === 0) {
    renderEmpty("No active channels");
    return;
  }

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "rgba(255,255,255,0.02)");
  bg.addColorStop(1, "rgba(255,255,255,0.02)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const colW = plotW / C;
  const gammaY = 4.0;
  const toY = (t01) => {
    const u = Math.max(0, Math.min(1, t01));
    const nonlin = Math.pow(u, gammaY);
    return marginT + (1 - nonlin) * plotH;
  };

  // 固定使用 16-bit 强度范围，方便不同视野之间对齐。
  let uLo = 0;
  let uHi = 65535;
  const mapToUnion01 = (v) => (v - uLo) / (uHi - uLo + 1e-6);

  // y 轴显示改为 0–1（归一化强度），只是显示，不改变内部使用的 0–65535 映射。
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  const numTicks = 4;
  for (let i = 0; i < numTicks; i++) {
    const p = i / (numTicks - 1);
    const y = marginT + p * plotH;
    const v01 = 1 - p; // 顶部 1，底部 0
    const label = v01.toFixed(2).replace(/\.00$/, "");
    ctx.fillText(label, marginL - 6, y + 4);
  }

  ctx.textAlign = "center";
  ctx.font = "14px sans-serif";
  for (let i = 0; i < C; i++) {
    const cx = marginL + i * colW + colW * 0.5;
    const chIdx = chs[i];
    const label = channelNames.get(chIdx) || `ch${chIdx}`;
    const col = colors?.[chIdx] || [230, 230, 235];
    ctx.fillStyle = `rgba(${col[0] ?? 230},${col[1] ?? 230},${col[2] ?? 235},0.95)`;
    ctx.fillText(label, cx, h - 10);
  }

  ctx.lineWidth = 1;
  for (let i = 0; i < C; i++) {
    const xsA = Array.isArray(kdeA?.xs?.[i]) ? kdeA.xs[i] : [];
    const ysA = Array.isArray(kdeA?.ys?.[i]) ? kdeA.ys[i] : [];
    const maxYA = Math.max(1e-6, ...(ysA || []));
    const d1 = {
      lo: Array.isArray(xsA) && xsA.length ? xsA[0] : 0,
      hi: Array.isArray(xsA) && xsA.length ? xsA[xsA.length - 1] : 1,
      xs: xsA,
      ys: (ysA || []).map((v) => v / maxYA),
    };

    const xsB = Array.isArray(kdeB?.xs?.[i]) ? kdeB.xs[i] : [];
    const ysB = Array.isArray(kdeB?.ys?.[i]) ? kdeB.ys[i] : [];
    const maxYB = Math.max(1e-6, ...(ysB || []));
    const d2 = {
      lo: Array.isArray(xsB) && xsB.length ? xsB[0] : 0,
      hi: Array.isArray(xsB) && xsB.length ? xsB[xsB.length - 1] : 1,
      xs: xsB,
      ys: (ysB || []).map((v) => v / maxYB),
    };
    const cx = marginL + i * colW + colW * 0.5;
    const halfW = Math.max(8, Math.min(22, colW * 0.35));

    // Region 1：左侧
    ctx.fillStyle = COLOR_REGION1;
    ctx.beginPath();
    for (let b = 0; b < (d1.xs?.length || 0); b++) {
      const v = d1.xs[b];
      const tUnion = mapToUnion01(v);
      const y = toY(tUnion);
      const wLeft = (d1.ys[b] || 0) * halfW;
      if (b === 0) ctx.moveTo(cx, y);
      ctx.lineTo(cx - wLeft, y);
    }
    for (let b = (d1.xs?.length || 0) - 1; b >= 0; b--) {
      const v = d1.xs[b];
      const tUnion = mapToUnion01(v);
      const y = toY(tUnion);
      ctx.lineTo(cx, y);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Region 2：右侧
    ctx.fillStyle = COLOR_REGION2;
    ctx.beginPath();
    for (let b = 0; b < (d2.xs?.length || 0); b++) {
      const v = d2.xs[b];
      const tUnion = mapToUnion01(v);
      const y = toY(tUnion);
      const wRight = (d2.ys[b] || 0) * halfW;
      if (b === 0) ctx.moveTo(cx, y);
      ctx.lineTo(cx + wRight, y);
    }
    for (let b = (d2.xs?.length || 0) - 1; b >= 0; b--) {
      const v = d2.xs[b];
      const tUnion = mapToUnion01(v);
      const y = toY(tUnion);
      ctx.lineTo(cx, y);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, marginT);
    ctx.lineTo(cx, marginT + plotH);
    ctx.stroke();
  }
}

export default function CompareFeaturePanel({
  data,
  iconMappingsByChunk,
  chunkUV,
  atlasByChannel,
  atlasURL,
  channels,
  colors,
  alphas,
  windows,
  points = [],
}) {
  const channelNames = useChannelNames();
  const mapById = useMemo(() => {
    const m = new Map();
    for (const p of points) m.set(p.id, p);
    return m;
  }, [points]);

  const violinRef = useRef(null);

  const regionA = data?.regions?.[0] || {};
  const regionB = data?.regions?.[1] || {};

  useEffect(() => {
    drawViolinRow(
      violinRef.current,
      regionA?.sel_kde,
      regionB?.sel_kde,
      channelNames,
      colors,
      "No intensity data for the two regions"
    );
  }, [regionA, regionB, channelNames, colors]);

  if (!data) {
    return <div className="loading">No comparison data</div>;
  }

  return (
    <div className="feature-section">
      <div className="gfp-header gfp-header--center">
        <div className="feature-title">Comparative Analysis of the Two Selected Regions</div>
      </div>

      {/* 第二行：左侧小标题 + 右侧两个代表性细胞缩略图 */}
      <div className="compare-reps-row">
        <div className="compare-reps-title">
          <span>Representative</span>
          <br />
          <span>images</span>
        </div>
        <div className="compare-reps compare-reps-inline">
          <div className="compare-rep-item">
            <RegionThumb
              repId={regionA?.representative}
              mapById={mapById}
              iconMappingsByChunk={iconMappingsByChunk}
              chunkUV={chunkUV}
              atlasByChannel={atlasByChannel}
              atlasURL={atlasURL}
              channels={channels}
              colors={colors}
              alphas={alphas}
              windows={windows}
            />
            <div className="compare-rep-label region1-label">Region 1</div>
          </div>
          <div className="compare-rep-item">
            <RegionThumb
              repId={regionB?.representative}
              mapById={mapById}
              iconMappingsByChunk={iconMappingsByChunk}
              chunkUV={chunkUV}
              atlasByChannel={atlasByChannel}
              atlasURL={atlasURL}
              channels={channels}
              colors={colors}
              alphas={alphas}
              windows={windows}
            />
            <div className="compare-rep-label region2-label">Region 2</div>
          </div>
        </div>
      </div>

      <div className="compare-violin-stack">
        <div className="compare-violin-caption-row">
          <div className="compare-violin-caption">
          Distribution of Intensity Values 
          in Two Regions
          </div>
          <div className="gfp-legend">
            <div className="gfp-legend-item">
              <span className="gfp-swatch gfp-swatch--global" />
              <span className="gfp-legend-label region1-label">Region 1</span>
            </div>
            <div className="gfp-legend-item">
              <span className="gfp-swatch gfp-swatch--selection" />
              <span className="gfp-legend-label region2-label">Region 2</span>
            </div>
          </div>
        </div>
        <canvas ref={violinRef} className="compare-violin-canvas" />
      </div>
    </div>
  );
}
