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
      <ChannelManager selected={channels} setSelected={setChannels} />
     
    </div>
  );
}
