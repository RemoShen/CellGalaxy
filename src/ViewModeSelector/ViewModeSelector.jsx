import React from "react";
import "./ViewModeSelector.css";

export default function ViewModeSelector({ viewMode, setViewMode, useUMAP, setUseUMAP }) {
  const isDual = viewMode === "dual";
  return (
    <div className="viewmode-section">
      <div className="viewmode-title">Viewer</div>
      <div className="viewmode-options">
        {/* Row 1: Single vs Side by side */}
        <div className="vm-row radios">
          <label className="render-option">
            <input
              type="radio"
              name="viewerMode"
              value="single"
              checked={viewMode === "single"}
              onChange={() => setViewMode("single")}
            />
            <span className="radio-custom"></span>
            Single
          </label>
          <label className="render-option">
            <input
              type="radio"
              name="viewerMode"
              value="dual"
              checked={viewMode === "dual"}
              onChange={() => setViewMode("dual")}
            />
            <span className="radio-custom"></span>
            Side by side
          </label>
        </div>

        {/* Row 2: Raw vs Umap (disabled in dual mode) */}
        <div className={`vm-row radios ${isDual ? "disabled" : ""}`}>
          <label className="render-option">
            <input
              type="radio"
              name="projMode"
              value="raw"
              checked={!useUMAP}
              disabled={isDual}
              onChange={() => setUseUMAP(false)}
            />
            <span className="radio-custom"></span>
            Raw
          </label>
          <label className="render-option">
            <input
              type="radio"
              name="projMode"
              value="umap"
              checked={!!useUMAP}
              disabled={isDual}
              onChange={() => setUseUMAP(true)}
            />
            <span className="radio-custom"></span>
            Umap
          </label>
        </div>
      </div>
    </div>
  );
}


