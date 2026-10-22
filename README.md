# @giszhc/three-model-viewer

> 🚀 现代化、高内聚的 Web 3D 模型检视与工程测量 SDK。基于 **Three.js** 与 **TypeScript** 构建，专为 Web 端三维轻量化展示、尺寸标注、空间测量与截面剖切量身定制。

[![npm version](https://img.shields.io/badge/npm-v1.0.0-blue.svg)](https://www.npmjs.com/package/@giszhc/three-model-viewer)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-3178c6.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🌟 核心特性

- 📦 **多源格式无缝加载**：支持 `OBJ`、`MTL`，以及包含模型和图片贴图的 `ZIP` 压缩包在浏览器**纯内存解压加载**，无需后端转码服务。
- 📏 **动态长宽高范围框**：实时绘制模型包围盒与三向尺寸引导线。**随着模型旋转，长宽高标签与指示线自动在当前的三个轴向空间自适应展示**。
- 🎯 **严格模型表面约束与磁吸**：所有测量与自定义剖切交互**严格限制在模型表面**，模型外部点击自动拦截；内置 BVH 空间索引，鼠标靠近网格顶点时自动实现**毫秒级磁吸（Snapping）**。
- 📐 **全功能工程级测量 (单次测量即退，严防误触)**：
  - **距离测量**：空间任意两点直线测距，中点三维浮动尺寸标签。
  - **高度测量**：计算两点高程差 $\Delta H$ 与水平投影跨度，CAD 风格标高引出线。
  - **角度测量**：模型表面点选射线端点、顶点与第二射线端点，实时绘制角度圆弧扇形与精确度数。
  - **面积测量**：模型表面空间多边形点选，双击闭合，自动三角剖分与半透明面积面填充。
- 🔄 **自动旋转与轴向锁定**：
  - 支持 **X 轴 / Y 轴** 自转，默认沿 X 轴自转。
  - 支持 **顺时针 / 逆时针** 旋转方向自由切换。
  - 支持 **锁定 X / Y / Z 某个轴** 检视模型（例如锁 Z 轴可防止倾斜与滚转，维持正立地平线检视）。
- ✨ **模型显示样式三态切换**：
  - 🧊 **实体表面 (Solid)**：支持真实漫反射/PBR 纹理或洁净纯色白模材质。
  - 🕸️ **网格线框 (Wireframe)**：直观展示三维多边形拓扑结构。
  - ✨ **离散点云 (Points)**：将三维模型无损展示为点云形态，支持 1px ~ 10px 点大小动态平滑调节，依然支持表面吸附与全轴剖切。
- ✂️ **灵活剖切系统**：
  - **XYZ 正交轴剖切**：X、Y、Z 三个面独立滑动拖动剖切，支持反向截取。
  - **2点划线自定义剖切**：在模型表面点击起点和终点2个点，如手术刀般沿视线利落切开（纯净截面，不显示遮挡视线的黄色杂乱辅助面），支持一键切换左右/保留另一侧。
- 🎥 **8 个标准视角平滑过渡**：正视、后视、左视、右视、俯视、仰视、前等轴测、后等轴测，基于 Tween 平滑运镜过渡，符合人体工学。
- 🎨 **材质与外观控制**：一键切换模型原始纹理贴图与纯色白模材质；支持自定义背景色、纯黑、浅灰及透明背景输出。
- 📸 **高清图片无损导出**：支持 1x 标清、2x 高清 (2K)、4x 超清 (4K) 截图渲染并一键触发浏览器下载。

---

## 📦 安装

```bash
# npm
npm install @giszhc/three-model-viewer three

# pnpm
pnpm add @giszhc/three-model-viewer three

# yarn
yarn add @giszhc/three-model-viewer three
```

---

## 🚀 3分钟快速上手

### 1. 基础使用

```html
<div id="model-container" style="width: 100vw; height: 100vh;"></div>
```

```typescript
import { Viewer } from '@giszhc/three-model-viewer';
import '@giszhc/three-model-viewer/style.css'; // 导入 3D 尺寸与测量标签样式

// 1. 初始化查看器
const viewer = new Viewer({
  container: document.getElementById('model-container')!,
  background: '#181c24', // 背景色，支持 hex 或 null（透明）
  unit: 'm',             // 测量与尺寸单位 (m, mm, cm)
  antialias: true,       // 开启抗锯齿
});

// 2. 加载本地 ZIP 压缩包 (内含 obj + mtl + 贴图)
const fileInput = document.querySelector('input[type="file"]');
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) {
    const result = await viewer.loadZip(file);
    console.log('模型加载成功:', result);
  }
});

// 或者直接通过网络 URL 加载 OBJ/MTL
// await viewer.loadOBJ('https://example.com/model.obj', 'https://example.com/model.mtl');
```

---

## 📖 核心 API 指南

### 1. 模型加载与管理

| 方法名 | 参数 | 描述 |
| :--- | :--- | :--- |
| `loadZip(source)` | `File \| Blob \| ArrayBuffer \| string` | 加载包含 `.obj`、`.mtl` 和贴图图片的 ZIP 压缩包 |
| `loadOBJ(objUrl, mtlUrl?)` | `string, string?` | 通过 URL 直接加载 OBJ 及可选的 MTL 材质文件 |
| `clearModel()` | - | 清除当前加载的模型并释放内存资源 |
| `rotateModel(rx, ry, rz)` | `number, number, number` | 旋转模型，**长宽高包围盒与尺寸标签将自动随之旋转自适应显示** |

### 2. 测量系统 (`Measurement`)

> **提示**：进入测量模式后，鼠标仅在模型表面可激活点选，点击模型外自动拦截，移动至顶点附近会自动触发磁吸。

```typescript
// 开启测量模式 ('distance' | 'height' | 'angle' | 'area' | 'volume' | 'none')
viewer.setMeasurementMode('distance'); // 距离测量：点选2点
viewer.setMeasurementMode('height');   // 高度测量：点选2点
viewer.setMeasurementMode('angle');    // 角度测量：点选3点 (射线端点、顶点、射线端点)
viewer.setMeasurementMode('area');     // 面积测量：点选多点，双击完成
viewer.setMeasurementMode('volume');   // 动态体积盒测量：点击放置3D包围盒

// 动态调节体积盒尺寸并锁定
viewer.setVolumeDimensions(3.0, 2.5, 4.0); // 实时调节长宽高 (实时显示体积)
viewer.lockVolume();                       // 锁定当前体积测量结果

// 撤销上一个绘制点
viewer.undoMeasurement();

// 清除所有测量结果与 3D 标签
viewer.clearMeasurements();

// 获取当前所有测量数据
const results = viewer.getMeasurements();
```

### 3. 剖切系统 (`Clipping`)

```typescript
// 1. 正交轴剖切 (0: 完全剖开, 1: 完整模型, inverted: 是否翻转截取方向)
viewer.setClipping('x', 0.5, false); // 沿 X 轴切到 50% 位置
viewer.setClipping('y', 0.8, false); // 沿 Y 轴切到 80% 位置
viewer.disableClippingAxis('x');     // 关闭 X 轴剖切

// 2. 自定义 2 点划线切面剖切
viewer.startCustomClip(); // 激活后在模型表面点击起点和终点2个点，沿视线切开模型（无遮挡纯净剖面）
viewer.invertCustomClip(); // 切换左右剖切保留方向（保留左侧或右侧）
viewer.clearCustomClip();  // 清除自定义切面

// 3. 重置全部剖切
viewer.resetClipping();
```

### 4. 视角控制 (`Camera & Views`)

支持 6 个标准工业/CAD 正交视图，内置平滑补间动画（平滑过渡时间可配置，默认 600ms）：

```typescript
// 视角切换：'front' (前视图) | 'back' (后视图) | 'left' (左视图) | 'right' (右视图) | 'top' (顶视图) | 'bottom' (底视图)
await viewer.setView('front', 500);       // 前视图 (模型加载后默认即为前视图)
await viewer.setView('top', 500);         // 顶视图
await viewer.setView('left', 500);        // 左视图

// 视角居中复位
await viewer.fitView(500);
```

### 5. 范围框、尺寸与外观控制

```typescript
// 切换模型显示样式: 'solid' (实体) | 'wireframe' (线框) | 'points' (点云)
viewer.setModelDisplayStyle('points');

// 调节点云点大小 (像素)
viewer.setPointSize(3.0);

// 开启/关闭自动旋转 (默认沿着 X 轴顺时针自转)
viewer.startAutoRotate({ axis: 'x', direction: 'clockwise', speed: 1.0 });
viewer.stopAutoRotate();

// 锁定视角检视轴向: 'x' | 'y' | 'z' | null
viewer.setRotationLockAxis('z'); // 锁 Z 轴检视，防止倾斜

// 显示/隐藏范围框及长宽高尺寸线 (true / false)
viewer.showBoundingBox(true);

// 切换模型贴图开关 (true: 原始贴图材质, false: 纯色白模材质)
viewer.toggleTexture(false);

// 更换背景颜色 (支持十六进制颜色、null 或 transparent)
viewer.setBackground('#0f172a'); // 深色背景
viewer.setBackground(null, true); // 透明背景

// 地面网格参考线开关
viewer.setGridVisible(true);
```

### 6. 高清图片导出 (`Screenshot`)

```typescript
// 导出 2 倍 (2K) 高清截图并自动触发浏览器下载
await viewer.exportImage({
  scale: 2,               // 缩放倍率 (1: 原始尺寸, 2: 2K高清, 4: 4K超清)
  type: 'image/png',      // 格式: 'image/png' 或 'image/jpeg'
  quality: 0.95,          // 图像质量 (0-1)
  download: true,         // 是否直接触发下载
  filename: 'model-2k.png'
});
```

### 7. 事件监听 (`Events`)

```typescript
// 测量完成事件
viewer.on('measure:complete', (result) => {
  console.log(`测量完成 [${result.type}]: ${result.formattedValue}`);
});

// 模型加载成功事件
viewer.on('load:success', (res) => {
  console.log(`模型加载完成，顶点: ${res.vertexCount}, 三角面: ${res.faceCount}`);
});

// 模型加载错误事件
viewer.on('load:error', (error) => {
  console.error('模型加载失败:', error);
});
```

---

## 🛠️ 本地运行与演示体验

克隆本仓库到本地后，执行以下命令即可启动交互式全功能演示平台：

```bash
# 1. 安装依赖
pnpm install

# 2. 启动本地开发服务与演示页面
pnpm dev

# 3. 打包构建 SDK (生成 dist/index.js, dist/index.cjs, dist/index.d.ts)
pnpm build
```

启动后在浏览器打开控制台输出的地址（如 `http://localhost:5173`），即可直接体验**机械装配体/建筑模型、拖放本地 ZIP/OBJ、8 视角切换、三向长宽高动态标注、XYZ 及自定义 3 点剖切、距离/高度/面积/体积测量与 4K 高清导出**全套功能。

---

## 📄 开源许可证

本项目基于 [MIT](LICENSE) 开源协议发布，可自由应用于商业和非商业项目。
