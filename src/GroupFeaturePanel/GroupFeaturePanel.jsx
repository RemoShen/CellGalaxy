import React, { useMemo, useRef, useEffect, useState } from "react";
import { buildTooltipHTML } from "../TooltipPreview/TooltipPreview";
import "../FeatureDock/FeatureDock.css";
import "../AnalysisPanels/GroupAnalysisPanel.css";

function Thumb({ object, iconMappingsByChunk, chunkUV, atlasByChannel, atlasURL, channels, colors, alphas, size = 112, label }) {
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

export default function GroupFeaturePanel({
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
  const mapById = useMemo(() => {
    const m = new Map();
    for (const p of points) m.set(p.id, p);
    return m;
  }, [points]);
  const repObj = mapById.get(data?.representative);

  // 已移除：Centroid similarity(heatmap) 与 Group compactness distribution

  // Gallery self-adaptive sizing (single row, no scrollbar)
  const galleryRef = useRef(null);
  const [thumbSize, setThumbSize] = useState(72);
  const [mainSize, setMainSize] = useState(112);
  useEffect(() => {
    const update = () => {
      const el = galleryRef.current;
      if (!el) return;
      const others = Math.min(5, Math.max(0, (data?.exemplars || []).length - 1));
      const hasMain = !!repObj;
      const total = others + (hasMain ? 1 : 0);
      if (total === 0) return;
      const gap = 12;
      const w = el.clientWidth || 600;
      const ratio = hasMain ? 1.35 : 1.0; // main vs others width ratio
      const s = Math.floor((w - Math.max(0, total - 1) * gap) / (others + ratio));
      const sClamped = Math.max(52, Math.min(110, s));
      const main = Math.floor(ratio * sClamped);
      setThumbSize(sClamped);
      setMainSize(main);
    };
    update();
    const onResize = () => update();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [data, repObj]);

  // High-dimensional Similarity Field (seriation-based)
  const fieldRef = useRef(null);
  useEffect(() => {
    const canvas = fieldRef.current;
    if (!canvas) return;
    const sims = Array.isArray(data?.centroid_similarities) ? data.centroid_similarities.slice() : [];
    const seriation = Array.isArray(data?.seriation_order) ? data.seriation_order.slice() : [];
    const gY = data?.global_y_hist || { centers: [], counts: [] };
    const medGroup = typeof data?.group_y_median === "number" ? data.group_y_median : null;
    const medGlobal = typeof data?.global_y_median === "number" ? data.global_y_median : null;
    const memberIds = Array.isArray(data?.coords) ? data.coords.map((o) => o.id) : [];
    const N = Math.min(sims.length, memberIds.length);
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 360;
    const h = canvas.clientHeight || 320;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0,0,w,h);
    if (N === 0) return;
    // margins（扩大留白，避免元素拥挤与遮挡）
    const mx = 36, my = 28;
    // x from seriation
    const orderIdx = [];
    if (seriation.length === memberIds.length) {
      const idToRank = new Map(seriation.map((id, rank) => [id, rank]));
      for (let i = 0; i < memberIds.length; i++) {
        const id = memberIds[i];
        const r = idToRank.has(id) ? idToRank.get(id) : i;
        orderIdx.push(r);
      }
    } else {
      for (let i = 0; i < memberIds.length; i++) orderIdx.push(i);
    }
    const n1 = Math.max(1, memberIds.length - 1);
    const x01 = orderIdx.map(r => r / n1);
    // y from similarity to centroid
    const y01 = sims.map(s => Math.max(0, Math.min(1, (s + 1) / 2)));
    // （已移除 seriation cluster cue）
    // draw global y background bands (1D hist as horizontal bands)
    if (Array.isArray(gY.centers) && Array.isArray(gY.counts) && gY.centers.length === gY.counts.length && gY.centers.length > 0) {
      const maxC = Math.max(1, ...gY.counts);
      ctx.save();
      ctx.filter = "blur(0.8px)";
      for (let i = 0; i < gY.centers.length; i++) {
        const y = my + (1 - gY.centers[i]) * (h - 2 * my);
        const a = 0.04 + 0.16 * (gY.counts[i] / maxC);
        ctx.strokeStyle = `rgba(200,200,205,${a})`;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(mx, y);
        ctx.lineTo(w - mx, y);
        ctx.stroke();
      }
      ctx.restore();
    }
    // 2D KDE grid
    const gw = 160, gh = 100;
    const grid = new Float32Array(gw * gh);
    const sigma = 0.055;
    const sig2 = 2 * sigma * sigma;
    for (let i = 0; i < N; i++) {
      const xi = x01[i];
      const yi = y01[i];
      const gx = Math.round(xi * (gw - 1));
      const gy = Math.round((1 - yi) * (gh - 1));
      const r = Math.max(2, Math.ceil(3 * sigma * gw));
      for (let yy = Math.max(0, gy - r); yy <= Math.min(gh - 1, gy + r); yy++) {
        const vy = (yy / (gh - 1));
        const dy = (vy - (1 - yi));
        for (let xx = Math.max(0, gx - r); xx <= Math.min(gw - 1, gx + r); xx++) {
          const ux = (xx / (gw - 1));
          const dx = (ux - xi);
          const wv = Math.exp(-((dx * dx + dy * dy) / sig2));
          grid[yy * gw + xx] += wv;
        }
      }
    }
    let maxV = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i] > maxV) maxV = grid[i];
    if (maxV > 0) {
      for (let yy = 0; yy < gh; yy++) {
        for (let xx = 0; xx < gw; xx++) {
          const v = grid[yy * gw + xx] / maxV;
          if (v <= 0) continue;
          const alpha = 0.05 + 0.36 * v;
          ctx.fillStyle = `rgba(0,160,255,${alpha})`;
          const x = mx + (xx / (gw - 1)) * (w - 2 * mx);
          const y = my + (yy / (gh - 1)) * (h - 2 * my);
          ctx.fillRect(x, y, (w - 2 * mx) / (gw - 1), (h - 2 * my) / (gh - 1));
        }
      }
    }
    // overlay group points
    for (let i = 0; i < N; i++) {
      const x = mx + x01[i] * (w - 2 * mx);
      const y = my + (1 - y01[i]) * (h - 2 * my);
      const id = memberIds[i];
      const isEx = data?.exemplars?.some(ex => ex.id === id);
      const light = 45 + Math.round(40 * y01[i]);
      const size = isEx ? 3.0 : 2.0;
      if (isEx) {
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(x, y, size + 1.4, 0, Math.PI*2);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.arc(x, y, size + 0.6, 0, Math.PI*2);
      ctx.stroke();
      ctx.fillStyle = `hsl(195, 90%, ${light}%)`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI*2);
      ctx.fill();
    }
    // median reference lines
    if (typeof medGlobal === "number") {
      const yg = my + (1 - medGlobal) * (h - 2 * my);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(200,200,205,0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mx, yg);
      ctx.lineTo(w - mx, yg);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (typeof medGroup === "number") {
      const yg2 = my + (1 - medGroup) * (h - 2 * my);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(0,160,255,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mx, yg2);
      ctx.lineTo(w - mx, yg2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // legend box（右上角）
    if (typeof medGlobal === "number" || typeof medGroup === "number") {
      const pad = 8;
      const lh = 16;
      const boxW = 160, boxH = 2 * lh + pad + 6;
      const x0 = w - mx - boxW;
      const y0 = my + 6;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x0, y0, boxW, boxH, 6);
        ctx.fill();
      } else {
        ctx.fillRect(x0, y0, boxW, boxH);
      }
      ctx.font = "11px sans-serif";
      // global
      ctx.strokeStyle = "rgba(200,200,205,0.75)";
      ctx.setLineDash([6,3]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x0 + pad, y0 + lh - 6);
      ctx.lineTo(x0 + pad + 26, y0 + lh - 6);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(230,230,235,0.9)";
      ctx.textAlign = "left";
      ctx.fillText("global median", x0 + pad + 32, y0 + lh - 2);
      // group
      ctx.strokeStyle = "rgba(0,160,255,0.85)";
      ctx.setLineDash([6,3]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x0 + pad, y0 + 2*lh - 6);
      ctx.lineTo(x0 + pad + 26, y0 + 2*lh - 6);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(0,180,255,0.95)";
      ctx.fillText("group median", x0 + pad + 32, y0 + 2*lh - 2);
    }
    // axis ticks (lightweight, non-intrusive)
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.lineWidth = 1;
    ctx.font = "11px sans-serif";
    // x ticks: 0..1
    ctx.textAlign = "center";
    const xts = [0, 0.25, 0.5, 0.75, 1];
    for (const t of xts) {
      const px = mx + t * (w - 2 * mx);
      const py = h - my;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py - 5);
      ctx.stroke();
      ctx.fillText(t.toFixed(2), px, py + 12);
    }
    // y ticks: 0..1 (top=1)
    ctx.textAlign = "right";
    const yts = [0, 0.25, 0.5, 0.75, 1];
    for (const t of yts) {
      const py = my + (1 - t) * (h - 2 * my);
      const px0 = mx, px1 = mx + 5;
      ctx.beginPath();
      ctx.moveTo(px0, py);
      ctx.lineTo(px1, py);
      ctx.stroke();
      ctx.fillText(t.toFixed(2), mx - 4, py + 4);
    }
    // axis labels
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("x: similarity-based ordering (seriation)", w/2, h - 4);
    ctx.save();
    ctx.translate(14, h/2);
    ctx.rotate(-Math.PI/2);
    ctx.fillText("y: similarity to group centroid (0..1)", 0, 0);
    ctx.restore();
  }, [data]);

  // Unified radial visualization
  const radialRef = useRef(null);
  useEffect(() => {
    const canvas = radialRef.current;
    if (!canvas) return;
    const sims = Array.isArray(data?.centroid_similarities) ? data.centroid_similarities.slice() : [];
    const proj = Array.isArray(data?.proj1) ? data.proj1.slice() : [];
    const ghist = data?.global_sims_hist || { centers: [], counts: [] };
    const memberIds = Array.isArray(data?.coords) ? data.coords.map((o) => o.id) : [];
    const exemplarSet = new Set((data?.exemplars || []).map((ex) => ex.id));
    const N = Math.min(sims.length, proj.length);
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 240;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0,0,w,h);
    // center, radii
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * 0.48;
    const R0 = Math.min(w, h) * 0.075; // 缩小内半径（约等于直径15%）
    // 背景底色
    ctx.fillStyle = "rgba(255,255,255,0.02)";
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI*2);
    ctx.fill();
    // 工具函数：KDE over [0,1]
    const kde1d = (vals01, bandwidth = 0.08, samples = 192) => {
      if (!vals01 || vals01.length === 0) return { xs: [], ys: [] };
      const xs = new Array(samples);
      const ys = new Array(samples).fill(0);
      const twoSigma2 = 2 * bandwidth * bandwidth;
      const norm = 1 / (Math.sqrt(Math.PI * twoSigma2) * vals01.length);
      for (let i = 0; i < samples; i++) {
        const x = i / (samples - 1);
        xs[i] = x;
        let acc = 0;
        for (let j = 0; j < vals01.length; j++) {
          const d = x - vals01[j];
          acc += Math.exp(-(d * d) / twoSigma2);
        }
        ys[i] = acc * norm;
      }
      // 归一化 0..1
      const maxY = Math.max(1e-6, ...ys);
      for (let i = 0; i < samples; i++) ys[i] /= maxY;
      return { xs, ys };
    };
    // 组内半径：r = 1 - s，组内 min-max 归一化 r_norm ∈ [0,1]
    const sClip = sims.map(v => Math.max(-1, Math.min(1, v)));
    const rVals = sClip.map(v => 1 - v);
    let rMin = 0, rMax = 1;
    if (N > 0) {
      rMin = Math.min(...rVals);
      rMax = Math.max(...rVals);
    }
    const r01Group = rVals.map(v => (v - rMin) / (rMax - rMin + 1e-6));
    // 计算 group KDE（基于 r_norm 的平滑径向带）
    const bw = Math.max(0.05, Math.min(0.15, 1 / Math.sqrt(Math.max(8, r01Group.length))));
    const { xs: gx, ys: gy } = kde1d(r01Group, bw, 192);
    // 计算 global 密度（由直方图平滑）
    let hx = [], hy = [];
    if (Array.isArray(ghist.centers) && Array.isArray(ghist.counts) && ghist.centers.length === ghist.counts.length && ghist.centers.length > 0) {
      const maxC = Math.max(1, ...ghist.counts);
      // 平滑 counts（3点均值）并归一化
      const sm = ghist.counts.map((c, i, a) => {
        const c0 = a[Math.max(0, i-1)] ?? c, c1 = c, c2 = a[Math.min(a.length-1, i+1)] ?? c;
        return (c0 + c1 + c2) / 3;
      }).map(v => v / maxC);
      hx = ghist.centers.slice();
      hy = sm;
    }
    // 绘制 global 背景带（柔和、低透明度），避免“CD”
    if (hx.length > 0) {
      ctx.save();
      ctx.filter = "blur(1.2px)";
      for (let i = 0; i < hx.length; i++) {
        const s01 = Math.max(0, Math.min(1, hx[i]));
        const r01 = 1 - s01; // r_global_norm
        const r = R0 + r01 * (R - R0);
        const a = 0.06 + 0.18 * hy[i];
        ctx.strokeStyle = `rgba(180,180,185,${a})`; // 全局：浅灰
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI*2);
        ctx.stroke();
      }
      ctx.restore();
    }
    // 绘制 group 密度带（平滑KDE，无条纹，淡蓝）
    if (N > 0) {
      ctx.save();
      ctx.filter = "blur(1.8px)";
      for (let i = 0; i < gx.length; i++) {
        const r01 = gx[i];
        const r = R0 + r01 * (R - R0);
        const a = 0.10 + 0.35 * gy[i];
        ctx.strokeStyle = `rgba(0,160,255,${a})`; // 组内：淡蓝，亮度随密度
        ctx.lineWidth = 12;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI*2);
        ctx.stroke();
      }
      ctx.restore();
      // angle from proj1（方向轴）
      let minP = Math.min(...proj), maxP = Math.max(...proj);
      if (!isFinite(minP) || !isFinite(maxP) || minP === maxP) {
        minP = -1; maxP = 1;
      }
      // 角度正方向轴线（极淡）+ 箭头（指向 PCA1 positive）
      const thetaPos = Math.PI; // t=1 对应的方向
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + (R-2) * Math.cos(thetaPos), cy + (R-2) * Math.sin(thetaPos));
      ctx.stroke();
      // 小箭头
      const ax = cx + (R-2) * Math.cos(thetaPos);
      const ay = cy + (R-2) * Math.sin(thetaPos);
      const ah = 6;
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - ah * Math.cos(thetaPos - Math.PI/8), ay - ah * Math.sin(thetaPos - Math.PI/8));
      ctx.lineTo(ax - ah * Math.cos(thetaPos + Math.PI/8), ay - ah * Math.sin(thetaPos + Math.PI/8));
      ctx.closePath();
      ctx.fill();

      // 计算局部密度（用于点大小，密集→小，稀疏→大）
      const tvals = proj.map(v => (v - minP) / (maxP - minP)); // [0,1]
      const dens = new Array(N).fill(0);
      if (N <= 1500) {
        const aeps = 0.08, reps = 0.06; // 角度/半径邻域
        for (let i = 0; i < N; i++) {
          let c = 0;
          const ti = tvals[i], ri = r01Group[i];
          for (let j = 0; j < N; j++) {
            if (i === j) continue;
            const tj = tvals[j], rj = r01Group[j];
            let dt = Math.abs(ti - tj);
            dt = Math.min(dt, 1 - dt); // 环绕
            const dr = Math.abs(ri - rj);
            if (dt < aeps && dr < reps) c++;
          }
          dens[i] = c;
        }
        // 归一化到 [0,1]
        const md = Math.max(1, ...dens);
        for (let i = 0; i < N; i++) dens[i] = dens[i] / md;
      } else {
        // 大组时不计算，默认中等密度
        for (let i = 0; i < N; i++) dens[i] = 0.5;
      }

      // 前景点：亮度=similarity，大小=密度(反比)，描边=exemplar
      for (let i = 0; i < N; i++) {
        const r01 = r01Group[i];
        const r = R0 + r01 * (R - R0);
        const t = (proj[i] - minP) / (maxP - minP);
        const theta = (t * Math.PI * 2) - Math.PI;
        const x = cx + r * Math.cos(theta);
        const y = cy + r * Math.sin(theta);
        // 点大小：稀疏更大
        const size = 1.6 + (1 - dens[i]) * 2.2; // 1.6..3.8
        // 亮度：相似度越高越亮（HSL）
        const s01_for_light = Math.max(0, Math.min(1, (sClip[i] + 1) / 2));
        const light = 40 + Math.round(45 * s01_for_light); // 40%..85%
        ctx.strokeStyle = "rgba(0,0,0,0.3)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, size + 0.7, 0, Math.PI*2);
        ctx.stroke();
        ctx.fillStyle = `hsl(195, 90%, ${light}%)`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI*2);
        ctx.fill();
        // exemplar 高亮描边
        const idHere = memberIds[i];
        if (exemplarSet.has(idHere)) {
          ctx.strokeStyle = "rgba(255,255,255,0.95)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, size + 1.6, 0, Math.PI*2);
          ctx.stroke();
          ctx.strokeStyle = "rgba(255,255,255,0.25)";
          ctx.lineWidth = 4.5;
          ctx.beginPath();
          ctx.arc(x, y, size + 2.6, 0, Math.PI*2);
          ctx.stroke();
        }
      }
      // 群心标记
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI*2);
      ctx.fill();
    }
    // 外边界
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI*2);
    ctx.stroke();
    // 图例：径向相似度
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("high sim", cx + 6, cy + 4);
    ctx.textAlign = "right";
    ctx.fillText("low sim", cx + R - 6, cy + 4);
    // 图例：角度方向（投影）
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText("− projection → +", cx, cy - R - 6 + 16);
  }, [data]);

  if (!data) return null;
  return (
    <div>

      <div className="feature-section">
        <div className="feature-title">Representative gallery</div>
        {/* 自适应一行排布：根据容器宽度动态缩放，避免滚动条 */}
        <div ref={galleryRef} className="gallery-row">
          {repObj ? (
            <Thumb
              object={repObj}
              iconMappingsByChunk={iconMappingsByChunk}
              chunkUV={chunkUV}
              atlasByChannel={atlasByChannel}
              atlasURL={atlasURL}
              channels={channels}
              colors={colors}
              alphas={alphas}
              size={mainSize}
              label={"centroid exemplar"}
            />
          ) : null}
          {(data?.exemplars || []).slice(1, 6).map((ex) => {
            const obj = mapById.get(ex.id);
            if (!obj) return null;
            return (
              <Thumb
                key={ex.id}
                object={obj}
                iconMappingsByChunk={iconMappingsByChunk}
                chunkUV={chunkUV}
                atlasByChannel={atlasByChannel}
                atlasURL={atlasURL}
                channels={channels}
                colors={colors}
                alphas={alphas}
                size={thumbSize}
                label={`sim ${ex.similarity.toFixed(2)}`}
              />
            );
          })}
        </div>
      </div>

      <div className="feature-section">
        <div className="feature-title">High-dimensional Similarity Field</div>
        <canvas ref={fieldRef} style={{ width: "100%", height: 320, display: "block" }} />
      </div>

      {/* 已移除 heatmap 与 compactness 分布 */}

      {/* 已移除 Group difference 指标 */}
    </div>
  );
}


