import React from "react";
import "./Control.css";
import FileUpload from "../FileUpload/FileUpload";
import RenderModeSelector from "../RenderModeSelector/RenderModeSelector";
import UMAPSelector from "../UMAPSelector/UMAPSelector";
import ImageSizeControl from "../ImageSizeControl/ImageSizeControl";
import ChannelManager from "../ChannelManager/ChannelManager";

export default function Control({
  meta,
  channels,
  setChannels,
  renderMode,
  setRenderMode,
  is3D,
  setIs3D,
  useUMAP,
  setUseUMAP,
  imageSize,
  setImageSize,

  // —— 新增：选择状态与操作 —— 
  selectionMode = "none",
  setSelectionMode = () => {},
  selectedIds = new Set(),
  clearSelection = () => {},
}) {
  const selectedCount = selectedIds.size ?? 0;

  return (
    <div className="control-panel">
      <FileUpload />
      
      {/* UMAP模式选择 */}
      <UMAPSelector useUMAP={useUMAP} setUseUMAP={setUseUMAP} />
      
      {/* 渲染模式选择 */}
      <RenderModeSelector
        renderMode={renderMode}
        setRenderMode={setRenderMode}
        is3D={is3D}
        setIs3D={setIs3D}
      />
      
      {/* 图像大小控制 */}
      <ImageSizeControl imageSize={imageSize} setImageSize={setImageSize} />

      {/* 通道管理 */}
      <ChannelManager selected={channels} setSelected={setChannels} />

      {/* —— 选择面板 —— */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #eee" }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>选择模式</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <button
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", background: selectionMode === "none" ? "#fff4e0" : "#fafafa", cursor: "default" }}
            onClick={() => setSelectionMode("none")}
          >无</button>
          <button
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", background: selectionMode === "box" ? "#fff4e0" : "#fafafa", cursor: "default" }}
            onClick={() => setSelectionMode("box")}
            title="拖拽画矩形框选"
          >框选</button>
          <button
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", background: selectionMode === "lasso" ? "#fff4e0" : "#fafafa", cursor: "default" }}
            onClick={() => setSelectionMode("lasso")}
            title="拖拽绘制套索"
          >套索</button>
        </div>

        <div style={{ fontSize: 13, margin: "8px 0 10px" }}>
          已选中：<b>{selectedCount}</b> 个点
        </div>

        <button
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "default", opacity: selectedCount ? 1 : 0.55 }}
          onClick={clearSelection}
          disabled={!selectedCount}
        >
          清空选择
        </button>
      </div>
    </div>
  );
}
