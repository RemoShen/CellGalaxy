import React from "react";
import "./ClickToolbar.css";

export default function ClickToolbar({
  show,
  x,
  y,
  onClose = () => {},
  onViewRaw = () => {},
  onFindTopK = () => {},
}) {
  if (!show) return null;
  const style = {
    left: Math.round(x),
    top: Math.round(y),
  };
  return (
    <div className="click-toolbar" style={style}>
      <button className="tb-btn" title="View meta data" onClick={onViewRaw}>
        <span className="material-icons">visibility</span>
      </button>
      <button className="tb-btn" title="Find similar cells" onClick={onFindTopK}>
        <span className="material-icons">search</span>
      </button>
      <div className="tb-divider" />
      <button className="tb-btn tb-close" title="Close" onClick={onClose}>
        <span className="material-icons">close</span>
      </button>
    </div>
  );
}


