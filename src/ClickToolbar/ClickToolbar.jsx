import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./ClickToolbar.css";

export default function ClickToolbar({
  show,
  x,
  y,
  onClose = () => {},
  onViewRaw = () => {},
  onFindTopK = () => {},
}) {
  const rootRef = useRef(null);
  const [pos, setPos] = useState({ left: Math.round(x), top: Math.round(y) });

  // Clamp inside offset parent to prevent overflow
  const clamp = () => {
    const node = rootRef.current;
    if (!node) return;
    const parent = node.offsetParent || document.body;
    const prect = parent.getBoundingClientRect();
    const w = node.offsetWidth || 140;
    const h = node.offsetHeight || 40;
    const margin = 8;
    let nx = Math.round(x + 6); // small offset
    let ny = Math.round(y - 6);
    const maxX = Math.max(margin, prect.width - w - margin);
    const maxY = Math.max(margin, prect.height - h - margin);
    if (nx > maxX) nx = maxX;
    if (ny > maxY) ny = maxY;
    if (nx < margin) nx = margin;
    if (ny < margin) ny = margin;
    setPos({ left: nx, top: ny });
  };
  useLayoutEffect(() => { clamp(); }, [x, y, show]);
  useEffect(() => {
    const onResize = () => clamp();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  if (!show) return null;
  const style = pos;
  return (
    <div ref={rootRef} className="click-toolbar" style={style}>
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


