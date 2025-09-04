// =============================
// useDataLoader.js  (with selection states)
// =============================
import { useEffect, useState, useRef } from "react";

// 开发环境（3000端口）默认转到后端 8000；生产同源可留空
const API = (typeof window !== 'undefined' && window.location && window.location.port === '3000')
  ? 'http://localhost:8000'
  : '';

export default function useDataLoader() {
  const [meta, setMeta] = useState(null);
  const [points, setPoints] = useState([]); // [{id,x,y,z,chunk_id,local_index,label}]
  const [loading, setLoading] = useState(true);

  // 渲染参数（可绑定到 UI）
  const [channels, setChannels] = useState([]);
  const [weights, setWeights] = useState({});
  const [alphas, setAlphas] = useState({});
  const [colors, setColors] = useState({});
  // 新增：每通道窗口（min/max，单位与后端一致：0..65535）
  const [windows, setWindows] = useState({});
  const [imageSize, setImageSize] = useState(4);

  // 渲染模式设置
  const [renderMode, setRenderMode] = useState('sprites'); // 'sprites' | 'points'
  const [is3D, setIs3D] = useState(false); // 2D/3D 切换
  
  // UMAP模式设置
  const [useUMAP, setUseUMAP] = useState(false); // false: raw, true: umap

  // 每个 chunk 的 UV 映射与 atlas URL
  const [chunkUV, setChunkUV] = useState({});
  const [atlasURL, setAtlasURL] = useState({}); // 旧：服务端合成后的单张 atlas（保留兼容）
  const [atlasByChannel, setAtlasByChannel] = useState({}); // 新：每通道灰度 atlas
  const [fetchingChunks, setFetchingChunks] = useState(new Set());

  // 简单并发限流器（默认最多 6 个并发请求）
  const limiterRef = useRef({ max: 6, inFlight: 0, queue: [] });
  const runWithLimit = (task) => new Promise((resolve) => {
    const run = async () => {
      limiterRef.current.inFlight++;
      try {
        const result = await task();
        resolve(result);
      } finally {
        limiterRef.current.inFlight--;
        const next = limiterRef.current.queue.shift();
        if (next) next();
      }
    };
    if (limiterRef.current.inFlight < limiterRef.current.max) run();
    else limiterRef.current.queue.push(run);
  });

  // 存储所有坐标数据（原始/UMAP2D/UMAP3D）
  const [allCoords, setAllCoords] = useState([]);

  // —— 选择相关（新增）——
  const [selectionMode, setSelectionMode] = useState('none'); // 'none' | 'box' | 'lasso'
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const clearSelection = () => setSelectedIds(new Set());

  // —— 工具：安全归一化，避免除以 0 ——
  function safeScale(v, minV, maxV) {
    const span = maxV - minV;
    if (!isFinite(span) || span === 0) return 0;
    return 2 * (v - minV) / span - 1;
  }

  // 应用坐标投影（不重新加载数据）
  const applyCoordinateProjection = () => {
    if (!allCoords || allCoords.length === 0) return;
    let projectedCoords;
    if (useUMAP) {
      if (is3D) {
        projectedCoords = allCoords.map(p => {
          if (!p.umap3d || p.umap3d.x === undefined || p.umap3d.y === undefined) {
            console.warn('Missing umap3d data for point:', p);
            return { ...p, x: p.raw?.x || 0, y: p.raw?.y || 0, z: 0 };
          }
          return { ...p, x: p.umap3d.x, y: p.umap3d.y, z: p.umap3d.z ?? 0 };
        });
      } else {
        projectedCoords = allCoords.map(p => {
          if (!p.umap2d || p.umap2d.x === undefined || p.umap2d.y === undefined) {
            console.warn('Missing umap2d data for point:', p);
            return { ...p, x: p.raw?.x || 0, y: p.raw?.y || 0, z: 0 };
          }
          return { ...p, x: p.umap2d.x, y: p.umap2d.y, z: 0 };
        });
      }
    } else {
      projectedCoords = allCoords.map(p => {
        if (!p.raw || p.raw.x === undefined || p.raw.y === undefined) {
          console.warn('Missing raw data for point:', p);
          return { ...p, x: 0, y: 0, z: 0 };
        }
        return { ...p, x: p.raw.x, y: p.raw.y, z: 0 };
      });
    }
    
    // 标准化坐标到 [-1, 1] 范围
    const xs = projectedCoords.map(p => p.x);
    const ys = projectedCoords.map(p => p.y);
    const zs = projectedCoords.map(p => p.z || 0);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    
    const scaled = projectedCoords.map(p => ({
      ...p,
      // 确保每个点都有稳定的 label（后端没给时用 id%11 兜底）
      label: p.label ?? (p.id % 11),
      x: safeScale(p.x, minX, maxX),
      y: -safeScale(p.y, minY, maxY),
      z: safeScale(p.z || 0, minZ, maxZ),
    }));
    
    // 重要：保持数组顺序不变，以便 deck.gl 按索引做 attribute transition
    setPoints(scaled);
  };

  // 初始拉 meta + coords
  useEffect(() => {
    (async () => {
      const m = await fetch(`${API}/meta`).then((r) => r.json());
      setMeta(m);
      
      // 直接从JSON文件读取坐标数据
      const coords = await fetch(`${API}/public/coords.json`).then((r) => r.json());
      setAllCoords(coords);

      // 首次也应用一次投影
      if (coords.length > 0) {
        let projectedCoords;
        if (useUMAP) {
          if (is3D) {
            projectedCoords = coords.map(p => {
              if (!p.umap3d || p.umap3d.x === undefined || p.umap3d.y === undefined) {
                console.warn('Missing umap3d data for point:', p);
                return { ...p, x: p.raw?.x || 0, y: p.raw?.y || 0, z: 0 };
              }
              return { ...p, x: p.umap3d.x, y: p.umap3d.y, z: p.umap3d.z ?? 0 };
            });
          } else {
            projectedCoords = coords.map(p => {
              if (!p.umap2d || p.umap2d.x === undefined || p.umap2d.y === undefined) {
                console.warn('Missing umap2d data for point:', p);
                return { ...p, x: p.raw?.x || 0, y: p.raw?.y || 0, z: 0 };
              }
              return { ...p, x: p.umap2d.x, y: p.umap2d.y, z: 0 };
            });
          }
        } else {
          projectedCoords = coords.map(p => {
            if (!p.raw || p.raw.x === undefined || p.raw.y === undefined) {
              console.warn('Missing raw data for point:', p);
              return { ...p, x: 0, y: 0, z: 0 };
            }
            return { ...p, x: p.raw.x, y: p.raw.y, z: 0 };
          });
        }
        
        const xs = projectedCoords.map(p => p.x);
        const ys = projectedCoords.map(p => p.y);
        const zs = projectedCoords.map(p => p.z || 0);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const minZ = Math.min(...zs), maxZ = Math.max(...zs);
        
        const scaled = projectedCoords.map(p => ({
          ...p,
          label: p.label ?? (p.id % 11),
          x: safeScale(p.x, minX, maxX),
          y: -safeScale(p.y, minY, maxY),
          z: safeScale(p.z || 0, minZ, maxZ),
        }));
        
        setPoints(scaled);
      }
      
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 当allCoords数据加载完成后，确保应用坐标投影
  useEffect(() => {
    if (allCoords.length > 0) applyCoordinateProjection();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCoords]);

  // 当UMAP模式或2D/3D模式改变时，重新应用坐标投影（保持数组顺序，便于过渡）
  useEffect(() => {
    if (allCoords.length > 0) applyCoordinateProjection();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useUMAP, is3D]);

  // 拉某个 chunk 的 UV（只拉一次）
  const ensureUV = async (chunkId) => {
    if (!meta) return;
    if (chunkUV[chunkId]) return;
    const uv = await fetch(`${API}/atlas_uv/${chunkId}?tile=${meta.atlas.tile}`).then((r) => r.json());
    setChunkUV((prev) => ({ ...prev, [chunkId]: uv }));
  };

  // 请求某个 chunk 的 atlas（服务器端合成 RGBA）
  const fetchAtlas = async (chunkId) => {
    if (atlasURL[chunkId]) return;
    if (fetchingChunks.has(chunkId)) return;
    setFetchingChunks(new Set([...fetchingChunks, chunkId]));

    const body = {
      channels,
      composite: { weights, alphas, colors },
      tile: meta?.atlas?.tile ?? 16,
      profile: "default_v1",
    };

    const res = await fetch(`${API}/atlas/${chunkId}`, {
      method: 'POST',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.error("atlas request failed", await res.text());
      setFetchingChunks((s) => { const t = new Set(s); t.delete(chunkId); return t; });
      return;
    }

    // 把图片响应转成 blob URL
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    setAtlasURL((prev) => ({ ...prev, [chunkId]: url }));
    setFetchingChunks((s) => { const t = new Set(s); t.delete(chunkId); return t; });
  };

  // 请求某个 chunk 的“单通道灰度”atlas（前端自行叠加着色），统一走 /atlas
  const fetchAtlasGray = async (chunkId, channel) => {
    const existing = atlasByChannel[chunkId]?.[channel];
    if (existing) return;
    if (fetchingChunks.has(`g_${chunkId}_${channel}`)) return;
    setFetchingChunks((s) => new Set([...s, `g_${chunkId}_${channel}`]));

    try {
      await runWithLimit(async () => {
        const t = meta?.atlas?.tile ?? 16;
        const staticURL = `${API}/public/cache/ch${channel}/tile_${t}/chunk_${chunkId}.png`;

        // 1) 先尝试用 HEAD 探测固定路径的静态缓存（避免重复下载图片）
        let head = await fetch(staticURL, { method: 'HEAD' });
        if (head.ok || head.status === 304) {
          setAtlasByChannel((prev) => ({
            ...prev,
            [chunkId]: { ...(prev[chunkId] || {}), [channel]: staticURL },
          }));
          return;
        }

        // 2) 不存在则触发生成（GET 别名 → 失败再 POST 回退）
        let gen = await fetch(`${API}/atlas/${chunkId}?channel=${channel}&tile=${t}`, { method: 'GET' });
        if (!gen.ok && gen.status !== 304) {
          if (gen.status === 405 || gen.status === 404) {
            gen = await fetch(`${API}/atlas/${chunkId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ channels: [channel], tile: t })
            });
            if (!gen.ok) {
              console.error("atlas generate POST failed", gen.status, await gen.text());
              return;
            }
          } else {
            console.error("atlas generate GET failed", gen.status, await gen.text());
            return;
          }
        }

        // 3) 生成后直接使用静态 URL（让 deck.gl 自己加载并走浏览器缓存）
        setAtlasByChannel((prev) => ({
          ...prev,
          [chunkId]: { ...(prev[chunkId] || {}), [channel]: staticURL },
        }));
      });
    } catch (e) {
      console.error("atlas(single) GET error", e);
    } finally {
      setFetchingChunks((s) => { const t = new Set(s); t.delete(`g_${chunkId}_${channel}`); return t; });
    }
  };

  // 计算视野内优先 chunk（这里只做最简单：按 chunk 分组，全部都拉）
  useEffect(() => {
    if (!meta || loading) return;
    const chunks = new Set(points.map((p) => p.chunk_id));
    (async () => {
      for (const c of chunks) {
        await ensureUV(c);
        // 新方案：前端叠加 -> 拉每个通道的灰度 atlas
        for (const ch of (channels || [])) {
          await fetchAtlasGray(c, ch);
        }
        // 兼容旧方案：也可保留后端合成（可逐步移除）
        // fetchAtlas(c);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, loading, channels, renderMode, is3D, useUMAP, points]);

  // 当选择通道变化时，通知后端进行异步预热，减少后续首包延迟
  useEffect(() => {
    if (!meta || !channels || channels.length === 0) return;
    const t = meta?.atlas?.tile ?? 16;
    (async () => {
      for (const ch of channels) {
        try {
          fetch(`${API}/prewarm?channel=${ch}&tile=${t}`, { method: 'POST', keepalive: true }).catch(() => {});
        } catch {}
      }
    })();
  }, [channels, meta]);

  return {
    // 数据状态
    meta,
    points,
    loading,
    chunkUV,
    atlasURL,
    atlasByChannel,
    fetchingChunks,
    
    // 渲染参数
    channels,
    weights,
    alphas,
    colors,
    windows,
    imageSize,
    
    // 渲染模式
    renderMode,
    is3D,
    
    // UMAP模式
    useUMAP,

    // —— 选择（导出给 App/Viewer/Control 使用）——
    selectionMode,
    setSelectionMode,
    selectedIds,
    setSelectedIds,
    clearSelection,
    
    // 设置函数
    setChannels,
    setWeights,
    setAlphas,
    setColors,
    setWindows,
    setRenderMode,
    setIs3D,
    setUseUMAP,
    setImageSize,
    
    // 数据获取函数
    ensureUV,
    fetchAtlas,
    fetchAtlasGray,
  };
}
