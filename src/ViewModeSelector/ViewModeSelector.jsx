import React from "react";
import "./ViewModeSelector.css";

export default function ViewModeSelector({ viewMode, setViewMode, useUMAP, setUseUMAP }) {
  const isDual = viewMode === "dual";
  return (
    <div className="viewmode-section">
      <div className="viewmode-title">Viewer</div>
      <div className="viewmode-options">
        <div className="viewmode-group">
          <button
            className={`viewmode-btn ${viewMode === 'single' ? 'active' : ''}`}
            onClick={() => setViewMode('single')}
          >
            Single
          </button>
          <button
            className={`viewmode-btn ${viewMode === 'dual' ? 'active' : ''}`}
            onClick={() => setViewMode('dual')}
          >
            Side by side
          </button>
        </div>
        {viewMode === "single" && (
          <div className="viewmode-group">
            <button
              className={`viewmode-btn ${!useUMAP ? 'active' : ''}`}
              onClick={() => setUseUMAP(false)}
            >
              Raw
            </button>
            <button
              className={`viewmode-btn ${useUMAP ? 'active' : ''}`}
              onClick={() => setUseUMAP(true)}
            >
              Umap
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


