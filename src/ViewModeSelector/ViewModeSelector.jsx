import React from "react";
import "./ViewModeSelector.css";

export default function ViewModeSelector({ viewMode, setViewMode }) {
  return (
    <div className="viewmode-section">
      <div className="viewmode-title">Viewer</div>
      <div className="viewmode-options">
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
    </div>
  );
}


