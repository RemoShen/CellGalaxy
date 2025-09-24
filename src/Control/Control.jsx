import React from "react";
import "./Control.css";
import FileUpload from "../FileUpload/FileUpload";
import RenderModeSelector from "../RenderModeSelector/RenderModeSelector";
import UMAPSelector from "../UMAPSelector/UMAPSelector";
import ImageSizeControl from "../ImageSizeControl/ImageSizeControl";
import ChannelManager from "../ChannelManager/ChannelManager";
import SelectionPanel from "../SelectionPanel/SelectionPanel";

export default function Control({
  meta,
  channels,
  setChannels,
  colors,
  setColors,
  windows,
  setWindows,
  renderMode,
  setRenderMode,
  is3D,
  setIs3D,
  useUMAP,
  setUseUMAP,
  imageSize,
  setImageSize,
  refreshData,
  dataVersion,

  // —— 新增：选择状态与操作 ——
  selectionMode = "none",
  setSelectionMode = () => {},
  selectedIds = new Set(),
}) {
  return (
    <div className="control-panel">
      <FileUpload onRefresh={refreshData} />
      {/* 选择面板 */}
      <SelectionPanel
        selectionMode={selectionMode}
        setSelectionMode={setSelectionMode}
        selectedIds={selectedIds}
      />

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
      <ChannelManager
        selected={channels}
        setSelected={setChannels}
        colors={colors}
        setColors={setColors}
        windows={windows}
        setWindows={setWindows}
        dataVersion={dataVersion}
      />
    </div>
  );
}
