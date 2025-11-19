import { useState } from "react";
import { SolidPolygonLayer } from "@deck.gl/layers";
import { clusterColor } from "../utils/clustering";
import { pointInPolygon, getEventCoordinates } from "../utils/utils";

/**
 * ClusterHoverMask
 * - 仅在 2D 下工作
 * - 当鼠标悬停在某聚类凸包区域内、且未命中任何图元时，渲染半透明蒙版填充该区域
 * - 采用 render-prop 方式向父组件暴露 onHover 与附加 layers
 */
export default function ClusterHoverMask({
  outlineData = [],
  is3D = false,
  deckRef,
  containerRef,
  active = true,
  altPressed = false,
  children = () => null,
}) {
  const [hoverMask, setHoverMask] = useState(null);

  const onHover = (info) => {
    if (!active) { setHoverMask(null); return; }
    // 命中点/图标时不显示蒙版；按住 Alt 则优先显示聚类蒙版
    const altFromEvent = !!(info && info.srcEvent && info.srcEvent.altKey);
    const preferCluster = altPressed || altFromEvent;
    if (info && info.object && !preferCluster) { setHoverMask(null); return; }
    if (is3D || !outlineData || outlineData.length === 0) { setHoverMask(null); return; }
    try {
      const deck = deckRef.current?.deck;
      const viewport = deck?.getViewports?.()[0];
      if (!viewport) { setHoverMask(null); return; }
      const { x, y } = getEventCoordinates(info, containerRef);
      for (const o of outlineData) {
        const polyScreen = o.path.map(([wx, wy, wz]) => viewport.project([wx, wy, wz || 0]));
        if (polyScreen.length >= 3 && pointInPolygon([x, y], polyScreen)) {
          const rgb = clusterColor(o.label ?? 0);
          // 更低一些的透明度（约 25%）
          setHoverMask({
            path: o.path,
            color: [rgb[0], rgb[1], rgb[2], 64],
          });
          return;
        }
      }
      setHoverMask(null);
    } catch {
      setHoverMask(null);
    }
  };

  const layers = [];
  if (!is3D && hoverMask) {
    layers.push(
      new SolidPolygonLayer({
        id: "cluster-hover-mask",
        data: [hoverMask],
        getPolygon: (d) => d.path,
        getFillColor: (d) => d.color,
        stroked: false,
        filled: true,
        pickable: false,
        parameters: { depthTest: false, blend: true, blendFunc: [1, 771] }, // SRC_ALPHA, ONE_MINUS_SRC_ALPHA
        updateTriggers: { getFillColor: [hoverMask?.color?.join(',')], getPolygon: [hoverMask?.path?.length] }
      })
    );
  }

  return children({ onHover, layers });
}


