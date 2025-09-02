import { useEffect, useState } from "react";

const API = '';

export default function useDataLoader() {
  const [meta, setMeta] = useState(null);
  const [points, setPoints] = useState([]); // [{id,x,y,chunk_id,local_index}]
  const [loading, setLoading] = useState(true);

  // 渲染参数（可绑定到 UI）
  const [channels, setChannels] = useState([0]); // 默认选一个通道
  const [minVal, setMinVal] = useState(0);
  const [maxVal, setMaxVal] = useState(65535);
  const [weights, setWeights] = useState({}); // {ch: weight}
  const [alphas, setAlphas] = useState({});  // {ch: alpha}
  const [colors, setColors] = useState({});  // {ch: [r,g,b] 0..1}
  const [imageSize, setImageSize] = useState(4); // 图像大小控制

  // 渲染模式设置
  const [renderMode, setRenderMode] = useState('sprites'); // 'sprites' | 'points'
  const [is3D, setIs3D] = useState(false); // 2D/3D 切换
  
  // UMAP模式设置
  const [useUMAP, setUseUMAP] = useState(false); // false: raw, true: umap

  // 每个 chunk 的 UV 映射与 atlas URL
  const [chunkUV, setChunkUV] = useState({});          // {chunkId: {tile,cols,rows,width,height, uv:[{local_index,u0..}]}}
  const [atlasURL, setAtlasURL] = useState({});        // {chunkId: urlString}
  const [fetchingChunks, setFetchingChunks] = useState(new Set()); // 正在请求 atlas 的 chunk 集

  // 存储所有坐标数据
  const [allCoords, setAllCoords] = useState([]);

  // 应用坐标投影（不重新加载数据）
  const applyCoordinateProjection = () => {
    if (!allCoords || allCoords.length === 0) return;
    let projectedCoords;
    if (useUMAP) {
      // UMAP模式：根据2D/3D选择对应坐标
      if (is3D) {
        // 3D模式：使用UMAP 3D坐标
        projectedCoords = allCoords.map(p => {
          if (!p.umap3d || p.umap3d.x === undefined || p.umap3d.y === undefined) {
            console.warn('Missing umap3d data for point:', p);
            return {
              ...p,
              x: p.raw?.x || 0,
              y: p.raw?.y || 0,
              z: 0
            };
          }
          return {
            ...p,
            x: p.umap3d.x,
            y: p.umap3d.y,
            z: p.umap3d.z || 0
          };
        });
      } else {
        // 2D模式：使用UMAP 2D坐标
        projectedCoords = allCoords.map(p => {
          if (!p.umap2d || p.umap2d.x === undefined || p.umap2d.y === undefined) {
            console.warn('Missing umap2d data for point:', p);
            return {
              ...p,
              x: p.raw?.x || 0,
              y: p.raw?.y || 0,
              z: 0
            };
          }
          return {
            ...p,
            x: p.umap2d.x,
            y: p.umap2d.y,
            z: 0
          };
        });
      }
    } else {
      // Raw模式：使用原始坐标
      projectedCoords = allCoords.map(p => {
        if (!p.raw || p.raw.x === undefined || p.raw.y === undefined) {
          console.warn('Missing raw data for point:', p);
          return {
            ...p,
            x: 0,
            y: 0,
            z: 0
          };
        }
        return {
          ...p,
          x: p.raw.x,
          y: p.raw.y,
          z: 0
        };
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
      x: 2 * (p.x - minX) / (maxX - minX) - 1,
      y: -2 * (p.y - minY) / (maxY - minY) - 1,
      z: 2 * (p.z - minZ) / (maxZ - minZ) - 1
    }));
    
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
      
      // 直接使用coords数据应用投影，而不是依赖state中的allCoords
      if (coords.length > 0) {
        let projectedCoords;
        if (useUMAP) {
          // UMAP模式：根据2D/3D选择对应坐标
          if (is3D) {
            // 3D模式：使用UMAP 3D坐标
            projectedCoords = coords.map(p => {
              if (!p.umap3d || p.umap3d.x === undefined || p.umap3d.y === undefined) {
                console.warn('Missing umap3d data for point:', p);
                return {
                  ...p,
                  x: p.raw?.x || 0,
                  y: p.raw?.y || 0,
                  z: 0
                };
              }
              return {
                ...p,
                x: p.umap3d.x,
                y: p.umap3d.y,
                z: p.umap3d.z || 0
              };
            });
          } else {
            // 2D模式：使用UMAP 2D坐标
            projectedCoords = coords.map(p => {
              if (!p.umap2d || p.umap2d.x === undefined || p.umap2d.y === undefined) {
                console.warn('Missing umap2d data for point:', p);
                return {
                  ...p,
                  x: p.raw?.x || 0,
                  y: p.raw?.y || 0,
                  z: 0
                };
              }
              return {
                ...p,
                x: p.umap2d.x,
                y: p.umap2d.y,
                z: 0
              };
            });
          }
        } else {
          // Raw模式：使用原始坐标
          projectedCoords = coords.map(p => {
            if (!p.raw || p.raw.x === undefined || p.raw.y === undefined) {
              console.warn('Missing raw data for point:', p);
              return {
                ...p,
                x: 0,
                y: 0,
                z: 0
              };
            }
            return {
              ...p,
              x: p.raw.x,
              y: p.raw.y,
              z: 0
            };
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
          x: 2 * (p.x - minX) / (maxX - minX) - 1,
          y: -2 * (p.y - minY) / (maxY - minY) - 1,
          z: 2 * (p.z - minZ) / (maxZ - minZ) - 1
        }));
        
        setPoints(scaled);
      }
      
      setLoading(false);
    })();
  }, []);

  // 当allCoords数据加载完成后，确保应用坐标投影
  useEffect(() => {
    if (allCoords.length > 0) {
      applyCoordinateProjection();
    }
  }, [allCoords]);

  // 当UMAP模式或2D/3D模式改变时，重新应用坐标投影
  useEffect(() => {
    if (allCoords.length > 0) {
      applyCoordinateProjection();
    }
  }, [useUMAP, is3D, allCoords]);

  // 拉某个 chunk 的 UV（只拉一次）
  const ensureUV = async (chunkId) => {
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
      window: {
        mode: "global",
        global: { min: Number(minVal), max: Number(maxVal) },
        gamma: 1.0
      },
      composite: {
        weights,
        alphas,
        colors
      },
      tile: meta?.atlas?.tile ?? 16,
      profile: "default_v1"
    };

    const res = await fetch(`${API}/atlas/${chunkId}`, {
      method: 'POST',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.error("atlas request failed", await res.text());
      setFetchingChunks((s) => {
        const t = new Set(s); t.delete(chunkId); return t;
      });
      return;
    }

    // 把图片响应转成 blob URL
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    setAtlasURL((prev) => ({ ...prev, [chunkId]: url }));
    setFetchingChunks((s) => {
      const t = new Set(s); t.delete(chunkId); return t;
    });
  };

  // 计算视野内优先 chunk（这里只做最简单：按 chunk 分组，全部都拉）
  useEffect(() => {
    if (!meta || loading) return;
    const chunks = new Set(points.map((p) => p.chunk_id));
    (async () => {
      for (const c of chunks) {
        await ensureUV(c);
        fetchAtlas(c);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, loading, channels, minVal, maxVal, renderMode, is3D, useUMAP]);

  return {
    // 数据状态
    meta,
    points,
    loading,
    chunkUV,
    atlasURL,
    fetchingChunks,
    
    // 渲染参数
    channels,
    minVal,
    maxVal,
    weights,
    alphas,
    colors,
    imageSize,
    
    // 渲染模式
    renderMode,
    is3D,
    
    // UMAP模式
    useUMAP,
    
    // 设置函数
    setChannels,
    setMinVal,
    setMaxVal,
    setWeights,
    setAlphas,
    setColors,
    setRenderMode,
    setIs3D,
    setUseUMAP,
    setImageSize,
    
    // 数据获取函数
    ensureUV,
    fetchAtlas
  };
}
