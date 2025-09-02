# MultiScaleImageProjection

一个基于React和DeckGL的多尺度图像投影可视化工具，支持2D/3D视图切换和UMAP投影。

## 功能特性

- 🖼️ **多尺度图像渲染**：支持sprite和point两种渲染模式
- 🌍 **2D/3D视图切换**：支持正交投影和轨道视图
- 🧬 **UMAP投影支持**：可切换原始坐标和UMAP投影坐标
- 🎛️ **实时参数控制**：图像大小、通道选择、亮度范围等
- 📁 **文件上传支持**：支持多种数据格式
- 🎨 **现代化UI**：响应式设计，直观的控制面板

## 技术栈

- **前端框架**：React 18
- **3D渲染**：DeckGL + WebGL
- **样式**：CSS3
- **构建工具**：Create React App
- **Python后端**：支持数据处理和分析

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm start
```

### 构建生产版本

```bash
npm run build
```

## 项目结构

```
src/
├── App.jsx                 # 主应用组件
├── Control/                # 控制面板组件
│   ├── Control.jsx        # 主控制面板
│   └── Control.css        # 控制面板样式
├── DataLoader/            # 数据加载器
│   └── DataLoader.jsx     # 数据加载逻辑
├── FileUpload/            # 文件上传组件
│   ├── FileUpload.jsx     # 文件上传逻辑
│   └── FileUpload.css     # 上传组件样式
├── ImageSizeControl/      # 图像大小控制组件
│   ├── ImageSizeControl.jsx
│   └── ImageSizeControl.css
├── RenderModeSelector/    # 渲染模式选择器
│   ├── RenderModeSelector.jsx
│   └── RenderModeSelector.css
├── UMAPSelector/          # UMAP模式选择器
│   ├── UMAPSelector.jsx
│   └── UMAPSelector.css
├── Viewer/                # 3D/2D视图组件
│   ├── Viewer.jsx         # 主视图逻辑
│   └── Viewer.css         # 视图样式
└── index.jsx              # 应用入口
```

## 使用说明

### 基本操作

1. **视图控制**：
   - 2D模式：支持缩放和平移
   - 3D模式：支持缩放、平移和旋转

2. **渲染模式**：
   - **Sprites模式**：显示实际的图像内容
   - **Points模式**：显示简单的点云

3. **参数调节**：
   - **图像大小**：控制单个点/图像的大小
   - **亮度范围**：调整min/max值来改变图像对比度
   - **通道选择**：选择要显示的图像通道

### UMAP投影

- 启用UMAP模式后，数据会使用UMAP算法进行降维投影
- 支持2D和3D UMAP投影
- 可以实时切换投影模式

## 开发说明

### 添加新功能

1. 在`DataLoader`中添加新的状态变量
2. 在`Control`组件中添加对应的UI控件
3. 在`Viewer`组件中实现渲染逻辑
4. 更新`App.jsx`中的props传递

### 样式定制

- 每个组件都有独立的CSS文件
- 使用CSS变量来保持主题一致性
- 支持响应式设计

## 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 联系方式

如有问题或建议，请提交 Issue 或 Pull Request。
