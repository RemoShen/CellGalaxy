import React from "react";
import "./ClusteringControl.css";

export default function ClusteringControl({
  colorOn = false,
  setColorOn = () => {},
  outlineOn = false,
  setOutlineOn = () => {},
  opacity = 0.25,
  setOpacity = () => {},
  lineWidth = 1.5,
  setLineWidth = () => {},
}) {
  return (
    <div className="clu-block">
      <div className="clu-title">Clustering</div>
      <div className="clu-buttons">
        <button
          className={`clu-btn ${colorOn ? "on" : ""}`}
          onClick={() => setColorOn(!colorOn)}
          title="用颜色叠加显示各个 clustering"
        >
          颜色
        </button>
        <button
          className={`clu-btn ${outlineOn ? "on" : ""}`}
          onClick={() => setOutlineOn(!outlineOn)}
          title="用大轮廓框住每个 clustering"
        >
          轮廓
        </button>
      </div>
      {colorOn && (
        <div className="clu-row">
          <label className="clu-label">Opacity</label>
          <input
            className="clu-range"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={opacity}
            onChange={(e) => setOpacity(parseFloat(e.target.value))}
          />
          <div className="clu-val">{(opacity * 100).toFixed(0)}%</div>
        </div>
      )}
      {outlineOn && (
        <div className="clu-row">
          <label className="clu-label">Width</label>
          <input
            className="clu-range"
            type="range"
            min="0"
            max="6"
            step="0.1"
            value={lineWidth}
            onChange={(e) => setLineWidth(parseFloat(e.target.value))}
          />
          <div className="clu-val">{lineWidth.toFixed(1)} px</div>
        </div>
      )}
    </div>
  );
}


