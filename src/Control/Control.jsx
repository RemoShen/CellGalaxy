import React, { useState } from "react";
import "./Control.css";
import FileUpload from "../FileUpload/FileUpload";
import RenderModeSelector from "../RenderModeSelector/RenderModeSelector";
import ViewModeSelector from "../ViewModeSelector/ViewModeSelector";
import ImageSizeControl from "../ImageSizeControl/ImageSizeControl";
import ChannelManager from "../ChannelManager/ChannelManager";
import SelectionPanel from "../SelectionPanel/SelectionPanel";
import Filter from "../Filter/Filter";

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

  // —— New: selection state and operations ——
  selectionMode = "none",
  setSelectionMode = () => {},
  selectedIds = new Set(),
  setSelectedIds = () => {},
  filteredIds = new Set(),
  setFilteredIds = () => {},
  viewMode = "dual",
  setViewMode = () => {},
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={`control-panel ${collapsed ? "collapsed" : ""}`}>
      <div className="control-header">
        <div className="brand">
          <div className="brand-logo" aria-hidden="true"></div>
          <div className="brand-name">Cell Galaxy</div>
        </div>
        <button
          className="control-toggle"
          aria-label="Toggle sidebar"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand settings" : "Collapse settings"}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>
      <div className="control-content">
        <FileUpload onRefresh={refreshData} />
      {/* Selection panel */}
      <SelectionPanel
        selectionMode={selectionMode}
        setSelectionMode={setSelectionMode}
        selectedIds={selectedIds}
      />
      
      <ViewModeSelector
        viewMode={viewMode}
        setViewMode={setViewMode}
        useUMAP={useUMAP}
        setUseUMAP={setUseUMAP}
      />

      {/* Rendering mode selection */}
      <RenderModeSelector
        renderMode={renderMode}
        setRenderMode={setRenderMode}
        is3D={is3D}
        setIs3D={setIs3D}
      />

      {/* Image size control */}
      <ImageSizeControl imageSize={imageSize} setImageSize={setImageSize} />

      {/* Filter (by raw data) */}
      <Filter setFilteredIds={(ids) => { setFilteredIds(ids); }} />

      {/* Channel management */}
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
    </div>
  );
}
