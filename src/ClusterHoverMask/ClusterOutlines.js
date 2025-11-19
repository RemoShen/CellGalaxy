import { useEffect, useState } from "react";
import { projectOutlines3D } from "../utils/clustering";

/**
 * 计算 3D 模式下的屏幕空间聚类外轮廓（用于 SVG 覆盖层）
 */
export default function ClusterOutlines({
  is3D = false,
  clusterOutlineOn = false,
  points = [],
  filteredIds = new Set(),
  deckRef,
  viewDeps = [],
}) {
  const [screenOutlines, setScreenOutlines] = useState([]);

  useEffect(() => {
    if (!is3D || !clusterOutlineOn) {
      setScreenOutlines([]);
      return;
    }
    try {
      const deck = deckRef.current?.deck;
      const viewport = deck?.getViewports?.()[0];
      if (!viewport || !points || points.length < 3) {
        setScreenOutlines([]);
        return;
      }
      const paths = projectOutlines3D(viewport, points, filteredIds);
      setScreenOutlines(paths);
    } catch {
      setScreenOutlines([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is3D, clusterOutlineOn, points, filteredIds, deckRef, ...viewDeps]);

  return screenOutlines;
}


