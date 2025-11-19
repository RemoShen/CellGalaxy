import React from "react";
import "./ClusteringControl.css";

export default function ClusteringControl({
  colorOn = false,
  setColorOn = () => {},
  outlineOn = false,
  setOutlineOn = () => {},
  setLineWidth = () => {},
}) {
  return (
    <div className="clu-block">
      <div className="clu-title">Clustering</div>
      <div className="clu-buttons">
        <button
          className={`clu-btn ${colorOn ? "on" : ""}`}
          onClick={() => setColorOn(!colorOn)}
          title="color overlay for each clustering"
        >
          {/* color icon */}
          <svg
            className="icon icon-color"
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="2.5" y="2.5" width="15" height="15" rx="3.5" stroke="currentColor" opacity="0.35"/>
            <circle cx="7" cy="7" r="3" fill="#ef4444"/>
            <circle cx="13" cy="7" r="3" fill="#3b82f6"/>
            <circle cx="7" cy="13" r="3" fill="#22c55e"/>
            <circle cx="13" cy="13" r="3" fill="#eab308"/>
          </svg>
        </button>
        <button
          className={`clu-btn ${outlineOn ? "on" : ""}`}
          onClick={() => {
            const next = !outlineOn;
            setOutlineOn(next);
            if (next) setLineWidth(0.8);
          }}
          title="outline for each clustering"
        >
          {/* outline icon */}
          <svg
            className="icon icon-outline"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.5" opacity="0.6"/>
          </svg>
        </button>
      </div>
    </div>
  );
}


