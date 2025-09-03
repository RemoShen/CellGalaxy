import React, { useState, useEffect } from "react";
import "./ChannelManager.css";

export default function ChannelManager({ selected, setSelected }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [channelInfo, setChannelInfo] = useState({});
  const [sliderValues, setSliderValues] = useState({});
  const [tooltip, setTooltip] = useState({ show: false, value: '', x: 0, y: 0 });

  // 获取通道信息
  useEffect(() => {
    const fetchChannelInfo = async () => {
      const response = await fetch("/public/channel_info.json");
      if (response.ok) {
        const data = await response.json();
        setChannelInfo(data);
      }
    };

    fetchChannelInfo();
  }, []);

  // 计算可用的通道（未选择的）
  const availableChannels = channelInfo.channels?.filter(
    (ch) => !selected.includes(ch.id)
  ) || [];

  // 添加通道
  const addChannel = (channel) => {
    setSelected(prev => [...prev, channel.id]);
    setShowDropdown(false);
  };

  // 删除通道
  const removeChannel = (channelId) => {
    setSelected(prev => prev.filter(id => id !== channelId));
  };

  // 处理滑块值变化
  const handleSliderChange = (channelId, type, value) => {
    setSliderValues(prev => ({
      ...prev,
      [`${channelId}-${type}`]: value
    }));
  };

  // 显示tooltip
  const showTooltip = (value, event) => {
    setTooltip({
      show: true,
      value: Math.round(value),
      x: event.clientX,
      y: event.clientY - 30
    });
  };

  // 隐藏tooltip
  const hideTooltip = () => {
    setTooltip({ show: false, value: '', x: 0, y: 0 });
  };

  // 渲染滑块
  const renderSlider = (channelId, type, defaultValue, min, max) => {
    const currentValue = sliderValues[`${channelId}-${type}`] ?? defaultValue;
    
    return (
      <input
        type="range"
        className={`range-slider range-slider-${type}`}
        min={min}
        max={max}
        defaultValue={defaultValue}
        onChange={(e) => handleSliderChange(channelId, type, e.target.value)}
        onInput={(e) => handleSliderChange(channelId, type, e.target.value)}
        onMouseEnter={(e) => showTooltip(currentValue, e)}
        onMouseMove={(e) => showTooltip(currentValue, e)}
        onMouseLeave={hideTooltip}
      />
    );
  };

  return (
    <div className="channel-manager">
      <div className="channel-section-title">
        <span>Channels</span>
        
        {/* 添加通道区域 */}
        <div className="add-channel-section">
          <div
            className="add-channel-button"
            onClick={() => setShowDropdown(!showDropdown)}
          >
            <span>+</span>
          </div>

          {/* 下拉列表 */}
          {showDropdown && (
            <div className="channel-dropdown">
              {availableChannels.length > 0 ? (
                availableChannels.map((channel) => (
                  <div
                    key={channel.id}
                    className="dropdown-item"
                    onClick={() => addChannel(channel)}
                  >
                    {channel.name}
                  </div>
                ))
              ) : (
                <div className="dropdown-item disabled">
                  All channels have been added
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 已选择的通道列表 */}
      <div className="selected-channels">
        {selected.map((channelId) => {
          const channel = channelInfo.channels?.find(ch => ch.id === channelId);
          if (!channel) return null;

          const { min = 0, max = 100 } = channel.pixel_value_range || {};

          return (
            <div key={channelId} className="channel-item">
              {/* 颜色选择器 */}
              <input
                type="color"
                className="color-picker"
                defaultValue="#ffffff"
              />

              {/* 通道名称 */}
              <span className="channel-name">{channel.name}</span>

              {/* 双端滑块 */}
              <div className="range-slider-container">
                <div className="dual-range-slider">
                  {renderSlider(channelId, 'min', min, min, max)}
                  {renderSlider(channelId, 'max', max, min, max)}
                </div>
              </div>

              {/* 删除按钮 */}
              <button
                className="delete-button"
                onClick={() => removeChannel(channelId)}
              >
                <span className="delete-channel material-icons">delete</span>
              </button>
            </div>
          );
        })}
      </div>
      
      {/* 自定义Tooltip */}
      {tooltip.show && (
        <div 
          className="custom-tooltip"
          style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y,
            zIndex: 10000
          }}
        >
          {tooltip.value}
        </div>
      )}
    </div>
  );
}
