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
        channels={dataLoader.channels}
        weights={dataLoader.weights}
        alphas={dataLoader.alphas}
        colors={dataLoader.colors}
        renderMode={dataLoader.renderMode}
        is3D={dataLoader.is3D}
        useUMAP={dataLoader.useUMAP}
        imageSize={dataLoader.imageSize}
      />
      <Control
        meta={dataLoader.meta}
        channels={dataLoader.channels}
        setChannels={dataLoader.setChannels}
        renderMode={dataLoader.renderMode}
        setRenderMode={dataLoader.setRenderMode}
        is3D={dataLoader.is3D}
        setIs3D={dataLoader.setIs3D}
        useUMAP={dataLoader.useUMAP}
        setUseUMAP={dataLoader.setUseUMAP}
        imageSize={dataLoader.imageSize}
        setImageSize={dataLoader.setImageSize}
      />
    </div>
  );
}
