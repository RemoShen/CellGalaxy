import React from "react";
import useDataLoader from "./DataLoader/DataLoader";
import Viewer from "./Viewer/Viewer";
import Control from "./Control/Control";
import "./App.css";
export default function App() {
  const dataLoader = useDataLoader();
  const {
    pointsRaw,
    pointsUMAP,
    // pass-through for other props
    ...rest
  } = dataLoader;
  // viewer mode: 'single' | 'dual'
  const [viewMode, setViewMode] = React.useState("dual");
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
              transitionsEnabled={!disableTransitions}
            />
          </div>
          <div className="viewer-pane">
            <div className="viewer-label">UMAP</div>
            <Viewer
              key={`viewer-umap-${viewMode}`}
              {...rest}
              viewerId="umap"
              points={pointsUMAP}
              transitionsEnabled={!disableTransitions}
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
              transitionsEnabled={!disableTransitions}
            />
          </div>
        </div>
      )}
      <Control {...dataLoader} viewMode={viewMode} setViewMode={setViewMode} />
    </div>
  );
}
