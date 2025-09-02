import React from "react";
import "./Control.css";
import FileUpload from "../FileUpload/FileUpload";
import RenderModeSelector from "../RenderModeSelector/RenderModeSelector";
import UMAPSelector from "../UMAPSelector/UMAPSelector";
import ImageSizeControl from "../ImageSizeControl/ImageSizeControl";

// 通道选择器组件
function ChannelPicker({ allChannels, selected, setSelected }) {
  const toggle = (c) => {
    setSelected((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  };
  
  return (
    <div className="channel-picker">
      {Array.from({ length: allChannels }, (_, i) => i).map((c) => (
        <label key={c} className="channel-label">
          <input
            type="checkbox"
            className="channel-checkbox"
            checked={selected.includes(c)}
            onChange={() => toggle(c)}
          />
          ch{c}
        </label>
      ))}
    </div>
  );
}

export default function Control({
  meta,
  minVal,
  setMinVal,
  maxVal,
  setMaxVal,
  channels,
  setChannels,
  renderMode,
  setRenderMode,
  is3D,
  setIs3D,
  useUMAP,
  setUseUMAP,
  imageSize,
  setImageSize
}) {
  return (
    <div className="control-panel">
      <FileUpload />
      
      {/* UMAP模式选择 */}
      <UMAPSelector
        useUMAP={useUMAP}
        setUseUMAP={setUseUMAP}
      />
      
      {/* 渲染模式选择 */}
      <RenderModeSelector
        renderMode={renderMode}
        setRenderMode={setRenderMode}
        is3D={is3D}
        setIs3D={setIs3D}
      />
      
      {/* 图像大小控制 */}
      <ImageSizeControl
        imageSize={imageSize}
        setImageSize={setImageSize}
      />
      
      <div className="control-row">
        <div className="control-label">min</div>
        <input
          className="control-input"
          type="number"
          value={minVal}
          onChange={(e) => setMinVal(e.target.value)}
        />
      </div>
      <div className="control-row-with-margin">
        <div className="control-label">max</div>
        <input
          className="control-input"
          type="number"
          value={maxVal}
          onChange={(e) => setMaxVal(e.target.value)}
        />
      </div>
      <div className="control-section">
        <div className="control-section-title">选择通道：</div>
        <ChannelPicker
          allChannels={meta?.C}
          selected={channels}
          setSelected={setChannels}
        />
      </div>
    </div>
  );
}
