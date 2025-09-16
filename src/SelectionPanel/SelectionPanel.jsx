import React from "react";
import "./SelectionPanel.css";

export default function SelectionPanel({
  selectionMode = "none",
  setSelectionMode = () => {},
  selectedIds = new Set(),
}) {
  const selectedCount = selectedIds.size ?? 0;

  return (
    <div className="selection-panel">
      <div className="selection-panel-title">Selection</div>
      
      <div className="selection-mode-buttons">
        <button
          className={`selection-mode-btn ${selectionMode === "none" ? "active" : ""}`}
          onClick={() => setSelectionMode("none")}
          title="No selection mode"
        >
          <img src="/icons/none.svg" alt="None" />
        </button>
        <button
          className={`selection-mode-btn ${selectionMode === "box" ? "active" : ""}`}
          onClick={() => setSelectionMode("box")}
          title="Drag to draw a rectangle"
        >
          <img src="/icons/box.svg" alt="Box" />
        </button>
        <button
          className={`selection-mode-btn ${selectionMode === "lasso" ? "active" : ""}`}
          onClick={() => setSelectionMode("lasso")}
          title="Drag to draw a lasso"
        >
          <img src="/icons/lasso.svg" alt="Lasso" />
        </button>
      </div>

      <div className="selection-count">
        Selected: <b>{selectedCount}</b> points
      </div>
    </div>
  );
}
