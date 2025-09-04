import React from "react";
import useDataLoader from "./DataLoader/DataLoader";
import Viewer from "./Viewer/Viewer";
import Control from "./Control/Control";
import "./App.css";

export default function App() {
  const dataLoader = useDataLoader();

  return (
    <div className="app-container">
      <Viewer
        meta={dataLoader.meta}
        points={dataLoader.points}
        loading={dataLoader.loading}
        chunkUV={dataLoader.chunkUV}
        atlasURL={dataLoader.atlasURL}
        atlasByChannel={dataLoader.atlasByChannel}
        channels={dataLoader.channels}
        weights={dataLoader.weights}
        alphas={dataLoader.alphas}
        colors={dataLoader.colors}
        windows={dataLoader.windows}
        renderMode={dataLoader.renderMode}
        is3D={dataLoader.is3D}
        useUMAP={dataLoader.useUMAP}
        imageSize={dataLoader.imageSize}
        /* 选择（传递给 Viewer，用于绘制与更新） */
        selectionMode={dataLoader.selectionMode}
        selectedIds={dataLoader.selectedIds}
        setSelectedIds={dataLoader.setSelectedIds}
        clearSelection={dataLoader.clearSelection}
      />
      <Control
        meta={dataLoader.meta}
        channels={dataLoader.channels}
        setChannels={dataLoader.setChannels}
        colors={dataLoader.colors}
        setColors={dataLoader.setColors}
        windows={dataLoader.windows}
        setWindows={dataLoader.setWindows}
        renderMode={dataLoader.renderMode}
        setRenderMode={dataLoader.setRenderMode}
        is3D={dataLoader.is3D}
        setIs3D={dataLoader.setIs3D}
        useUMAP={dataLoader.useUMAP}
        setUseUMAP={dataLoader.setUseUMAP}
        imageSize={dataLoader.imageSize}
        setImageSize={dataLoader.setImageSize}
        /* 选择（传递给 Control，用于切换与清空） */
        selectionMode={dataLoader.selectionMode}
        setSelectionMode={dataLoader.setSelectionMode}
        selectedIds={dataLoader.selectedIds}
        clearSelection={dataLoader.clearSelection}
      />
    </div>
  );
}
