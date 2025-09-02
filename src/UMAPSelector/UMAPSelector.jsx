import React from "react";
import "./UMAPSelector.css";

export default function UMAPSelector({ useUMAP, setUseUMAP }) {
  return (
    <div className="umap-section">
      <div className="umap-title">UMAP</div>
      <div className="umap-options">
        <button
          className={`umap-btn ${!useUMAP ? 'active' : ''}`}
          onClick={() => setUseUMAP(false)}
        >
          Raw
        </button>
        <button
          className={`umap-btn ${useUMAP ? 'active' : ''}`}
          onClick={() => setUseUMAP(true)}
        >
          Umap
        </button>
      </div>
    </div>
  );
}
