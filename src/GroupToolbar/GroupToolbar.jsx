import React from "react";
import "./GroupToolbar.css";

export default function GroupToolbar({ show, onAnalyze = () => {}, onClear = () => {} }) {
  if (!show) return null;
  return (
    <div className="group-toolbar">
      <button className="gtb-btn" title="群体分析" onClick={onAnalyze}>
        <span className="material-icons">analytics</span>
      </button>
      <div className="gtb-divider" />
      <button className="gtb-btn gtb-close" title="清空选择" onClick={onClear}>
        <span className="material-icons">close</span>
      </button>
    </div>
  );
}


