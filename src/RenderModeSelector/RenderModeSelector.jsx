import React from "react";
import "./RenderModeSelector.css";

export default function RenderModeSelector({ renderMode, setRenderMode, is3D, setIs3D }) {
  return (
    <div className="render-mode-section">
      <div className="render-title">Render</div>
      <div className="render-options">
        <label className="render-option">
          <input
            type="radio"
            name="renderMode"
            value="sprites"
            checked={renderMode === 'sprites'}
            onChange={(e) => setRenderMode(e.target.value)}
          />
          <span className="radio-custom"></span>
          Sprites
        </label>
        <label className="render-option">
          <input
            type="radio"
            name="renderMode"
            value="points"
            checked={renderMode === 'points'}
            onChange={(e) => setRenderMode(e.target.value)}
          />
          <span className="radio-custom"></span>
          Points
        </label>
        <label className="render-option toggle-option">
          <span className="toggle-label">3D</span>
          <div className="toggle-switch">
            <input
              type="checkbox"
              checked={is3D}
              onChange={(e) => setIs3D(e.target.checked)}
            />
            <span className="toggle-slider"></span>
          </div>
        </label>
      </div>
    </div>
  );
}
