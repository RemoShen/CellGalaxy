import React, { useState } from "react";
import "./ClusteringControl.css";

export default function ClusteringControl({
  colorOn = false,
  setColorOn = () => {},
  outlineOn = false,
  setOutlineOn = () => {},
  setLineWidth = () => {},
  onRunLargeModel = () => {},
}) {
  const [showModelPanel, setShowModelPanel] = useState(false);
  const [selectedModel, setSelectedModel] = useState("Biomni");
  const [isRunning, setIsRunning] = useState(false);

  const handleRun = () => {
    if (!selectedModel || isRunning) return;
    setIsRunning(true);
    // placeholder: here we will call the specific large model logic in the future
    // currently only simulate the callback completion
    window.requestAnimationFrame(() => {
      setTimeout(() => {
        // eslint-disable-next-line no-console
        console.log("[Model Run]", selectedModel);
        setIsRunning(false);
      }, 300);
    });
  };

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
        {/* New: Large Model trigger button (runs the whole pipeline) */}
        <button
          className="clu-btn model"
          onClick={() => {
            // 仅创建按钮：后续处理与请求逻辑由上层传入
            onRunLargeModel();
          }}
          title="run large model from scratch"
        >
          {/* model icon (robot head) */}
          <svg
            className="icon icon-model"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="4" y="6.5" width="16" height="11" rx="4" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="9" cy="12" r="1.75" fill="currentColor" />
            <circle cx="15" cy="12" r="1.75" fill="currentColor" />
            <path d="M12 6.5V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        <button
          className={`clu-btn annotate ${showModelPanel ? "on" : ""}`}
          onClick={() => setShowModelPanel((v) => !v)}
          title="open annotation panel"
        >
          {/* annotation icon (chat bubble with dots) */}
          <svg
            className="icon icon-annotate"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="3.5" y="5" width="17" height="12" rx="3.5" stroke="currentColor" strokeWidth="1.5"/>
            <circle cx="9" cy="11" r="1.25" fill="currentColor"/>
            <circle cx="12" cy="11" r="1.25" fill="currentColor" opacity="0.9"/>
            <circle cx="15" cy="11" r="1.25" fill="currentColor" opacity="0.8"/>
            <path d="M8 17.5l-2.5 3v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
      {showModelPanel && (
        <div className="clu-panel">
          <div className="clu-row">
            <div className="clu-label">Model</div>
            <div className="clu-select-wrap">
              <select
                className="clu-select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                <option value="Biomni">Biomni</option>
                <option value="MedGamma">MedGamma</option>
                <option value="Bimistral">Bimistral</option>
              </select>
            </div>
          </div>
          <div className="clu-row">
            <div className="clu-label">Action</div>
            <div className="clu-actions">
              <button
                className="clu-run-btn"
                onClick={handleRun}
                disabled={!selectedModel || isRunning}
              >
                {isRunning ? "Running..." : "Annotate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


