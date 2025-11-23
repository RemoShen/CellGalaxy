import React from "react";
import { VIEW_DUAL } from "./constants/view";
import useDataLoader from "./DataLoader/DataLoader";
import Viewer from "./Viewer/Viewer";
import Control from "./Control/Control";
import "./App.css";
export default function App() {
  const dataLoader = useDataLoader();
  const {
    pointsRaw,
    pointsUMAP,
    clusterColorOn,
    clusterOutlineOn,
    clusterAnnotationOn,
    clusterAnnotationModel,
    clusterPreviewOn,
    // pass-through for other props
    ...rest
  } = dataLoader;
  // viewer mode: 'single' | 'dual'
  const [viewMode, setViewMode] = React.useState(VIEW_DUAL);
  // disable transitions during mode switch
  const [disableTransitions, setDisableTransitions] = React.useState(false);
  React.useEffect(() => {
    setDisableTransitions(true);
    const t = setTimeout(() => setDisableTransitions(false), 200);
    return () => clearTimeout(t);
  }, [viewMode]);

  return (
    <div className="app-container">
      {viewMode === "dual" ? (
        <div className="viewer-split">
          <div className="viewer-pane">
            <div className="viewer-label">Raw</div>
            <Viewer
              key={`viewer-raw-${viewMode}`}
              {...rest}
              viewerId="raw"
              points={pointsRaw}
              hoverMaskEnabled={false}
              clusterColorOn={clusterColorOn}
              clusterOutlineOn={false}
              clusterAnnotationOn={false}
              clusterAnnotationModel={clusterAnnotationModel}
              clusterPreviewOn={false}
              transitionsEnabled={!disableTransitions}
              zoomSpeed={0.8}  // Raw：保持原来的缩放速度
            />
          </div>
          <div className="viewer-pane">
            <div className="viewer-label">UMAP</div>
            <Viewer
              key={`viewer-umap-${viewMode}`}
              {...rest}
              viewerId="umap"
              points={pointsUMAP}
              hoverMaskEnabled={true}
              clusterColorOn={clusterColorOn}
              clusterOutlineOn={clusterOutlineOn}
              clusterAnnotationOn={clusterAnnotationOn}
              clusterAnnotationModel={clusterAnnotationModel}
              clusterPreviewOn={clusterPreviewOn}
              transitionsEnabled={!disableTransitions}
              // 不传 zoomSpeed，使用 Viewer 默认值（现在是 0.1），缩放更慢
            />
          </div>
        </div>
      ) : (
        <div className="viewer-split">
          <div className="viewer-pane">
            <div className="viewer-label">{rest.useUMAP ? "UMAP" : "Raw"}</div>
            <Viewer
              {...rest}
              viewerId="single"
              points={rest.useUMAP ? pointsUMAP : pointsRaw}
              hoverMaskEnabled={!!rest.useUMAP}
              clusterColorOn={rest.useUMAP ? clusterColorOn : clusterColorOn}
              clusterOutlineOn={rest.useUMAP ? clusterOutlineOn : false}
              clusterAnnotationOn={rest.useUMAP ? clusterAnnotationOn : false}
              clusterAnnotationModel={clusterAnnotationModel}
              clusterPreviewOn={rest.useUMAP ? clusterPreviewOn : false}
              transitionsEnabled={!disableTransitions}
              // 单视图：Raw 用 0.8，UMAP 用 Viewer 默认的 0.1（不额外指定）
              zoomSpeed={rest.useUMAP ? undefined : 0.8}
            />
          </div>
        </div>
      )}
      <Control {...dataLoader} viewMode={viewMode} setViewMode={setViewMode} />
    </div>
  );
}
