import React, { useState, useEffect } from "react";
import "./ChannelManager.css";

export default function ChannelManager({ selected, setSelected, colors = {}, setColors = () => {}, windows = {}, setWindows = () => {} }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [channelInfo, setChannelInfo] = useState({});
  // 滑块读写直接使用全局 windows（每个通道的 min/max）
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

  // 监听点击事件，点击外部时关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event) => {
      // 如果点击的是下拉菜单项，不关闭菜单
      if (event.target.closest('.dropdown-item')) {
        return;
      }
      
      if (showDropdown && !event.target.closest('.add-channel-section')) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showDropdown]);

  // 计算可用的通道（未选择的）
  const availableChannels = channelInfo.channels?.filter(
    (ch) => !selected.includes(ch.id)
  ) || [];

  const palette = [
    [255, 0, 0], [0, 255, 0], [0, 128, 255], [255, 255, 0], [255, 0, 255],
    [0, 255, 255], [255, 128, 0], [128, 0, 255], [0, 255, 128], [255, 0, 128]
  ];
  const toHex = (rgb) => {
    const [r, g, b] = rgb || [255, 255, 255];
    const h = (v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  };
  const fromHex = (hex) => {
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '#ffffff');
    if (!m) return [255, 255, 255];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  };
  const defaultColorFor = (id) => palette[id % palette.length];

  // 添加通道
  const addChannel = (channel) => {
    setSelected(prev => [...prev, channel.id]);
    if (!colors[channel.id]) {
      const c = defaultColorFor(channel.id);
      setColors((prev) => ({ ...prev, [channel.id]: c }));
    }
    // 若窗口未初始化，用通道默认范围初始化
    const pv = channel.pixel_value_range || { min: 0, max: 65535 };
    setWindows((prev) => (
      prev[channel.id]
        ? prev
        : { ...prev, [channel.id]: { min: pv.min ?? 0, max: pv.max ?? 65535 } }
    ));
  };

  // 删除通道
  const removeChannel = (channelId) => {
    setSelected(prev => prev.filter(id => id !== channelId));
  };

  // 处理滑块值变化
  const handleSliderChange = (channelId, type, value) => {
    const v = Number(value);
    setWindows((prev) => {
      const cur = prev[channelId] || { min: 0, max: 65535 };
      const next = { ...cur, [type]: v };
      // 保证 min <= max
      if (next.min > next.max) {
        if (type === 'min') next.max = next.min;
        else next.min = next.max;
      }
      return { ...prev, [channelId]: next };
    });
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

  // 渲染滑块（目前仅 UI；可扩展为归一化 lo/hi 控制）
  const renderSlider = (channelId, type, defaultValue, min, max) => {
    const current = windows?.[channelId] || { min: defaultValue, max: defaultValue };
    const currentValue = (type === 'min' ? current.min : current.max) ?? defaultValue;
    
    return (
      <input
        type="range"
        className={`range-slider range-slider-${type}`}
        min={min}
        max={max}
        value={currentValue}
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
                value={toHex(colors[channelId] || defaultColorFor(channelId))}
                onChange={(e) => setColors((prev) => ({ ...prev, [channelId]: fromHex(e.target.value) }))}
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
