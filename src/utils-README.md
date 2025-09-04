# Utils 工具函数库

这个文件包含了项目中常用的工具函数，按功能分类组织。

## 几何计算函数

### `computeCenter(points)`
计算点集的几何中心
```javascript
import { computeCenter } from './utils';

const center = computeCenter([
  { x: 0, y: 0, z: 0 },
  { x: 10, y: 10, z: 0 }
]);
// 返回: [5, 5, 0]
```

### `pointInPolygon(point, polygon)`
判断屏幕空间点是否在多边形内（使用射线法）
```javascript
import { pointInPolygon } from './utils';

const inside = pointInPolygon([5, 5], [[0, 0], [10, 0], [10, 10], [0, 10]]);
// 返回: true
```

### `distance(p1, p2)`
计算两点之间的距离
```javascript
import { distance } from './utils';

const dist = distance([0, 0, 0], [3, 4, 0]);
// 返回: 5
```

## 选择相关函数

### `getEventCoordinates(info, containerRef)`
统一获取鼠标事件的屏幕坐标
```javascript
import { getEventCoordinates } from './utils';

const coords = getEventCoordinates(eventInfo, containerRef);
// 返回: { x: 100, y: 200 }
```

### `computeSelectionBounds(dragStart, dragEnd)`
计算选择框的边界
```javascript
import { computeSelectionBounds } from './utils';

const bounds = computeSelectionBounds(
  { x: 0, y: 0 },
  { x: 100, y: 100 }
);
// 返回: { x0: 0, y0: 0, width: 100, height: 100 }
```

### `performBoxSelection(deck, bounds)`
执行框选操作
```javascript
import { performBoxSelection } from './utils';

const picked = performBoxSelection(deck, bounds);
// 返回: 选中的对象数组
```

### `performLassoSelection(points, viewport, lassoPoints)`
执行套索选择操作
```javascript
import { performLassoSelection } from './utils';

const selectedIds = performLassoSelection(points, viewport, lassoPoints);
// 返回: 选中的ID集合
```

## 图标和图层函数

### `buildIconMappingsByChunk(meta, chunkUV)`
构建每个chunk的图标映射，用于IconLayer
```javascript
import { buildIconMappingsByChunk } from './utils';

const mappings = buildIconMappingsByChunk(meta, chunkUV);
// 返回: 图标映射对象
```

## 颜色和样式函数

### `getPointColor(point, selectedIds, selectedColor, defaultColor)`
根据选中状态获取点的颜色
```javascript
import { getPointColor } from './utils';

const color = getPointColor(point, selectedIds);
// 返回: [r, g, b, a] 颜色数组
```

## 数学工具函数

### `ease(t)`
平滑插值函数 (smoothstep)
```javascript
import { ease } from './utils';

const smoothValue = ease(0.5); // 返回: 0.5
```

### `clamp(value, min, max)`
限制数值在指定范围内
```javascript
import { clamp } from './utils';

const limited = clamp(15, 0, 10); // 返回: 10
```

### `lerp(a, b, t)`
线性插值
```javascript
import { lerp } from './utils';

const interpolated = lerp(0, 100, 0.5); // 返回: 50
```

### `toRadians(degrees)` / `toDegrees(radians)`
角度弧度转换
```javascript
import { toRadians, toDegrees } from './utils';

const radians = toRadians(180); // 返回: Math.PI
const degrees = toDegrees(Math.PI); // 返回: 180
```

## 实用工具函数

### `formatNumber(num, decimals)`
格式化数字，添加千位分隔符
```javascript
import { formatNumber } from './utils';

const formatted = formatNumber(1234567.89, 2);
// 返回: "1,234,567.89"
```

### `debounce(func, wait)`
防抖函数
```javascript
import { debounce } from './utils';

const debouncedSearch = debounce(searchFunction, 300);
```

### `throttle(func, limit)`
节流函数
```javascript
import { throttle } from './utils';

const throttledScroll = throttle(scrollHandler, 100);
```

## 使用建议

1. **按需导入**: 只导入需要的函数，避免打包不必要的代码
2. **类型安全**: 所有函数都有详细的JSDoc注释，包含参数和返回值类型
3. **性能优化**: 选择相关函数已经过优化，适合实时交互
4. **可扩展性**: 函数设计为纯函数，易于测试和扩展

## 注意事项

- 所有坐标函数都假设坐标系为左上角原点
- 选择函数需要正确的viewport和deck.gl实例
- 颜色函数返回RGBA数组，值范围0-255
- 几何函数支持2D和3D坐标
