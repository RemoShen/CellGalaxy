// WindowedIconLayer: extends IconLayer to apply per-layer windowing (min/max)
// on the sampled texture intensity in the fragment shader, without reloading images.
import { IconLayer } from '@deck.gl/layers';

const DEFAULT_MIN = 0.0; // normalized
const DEFAULT_MAX = 1.0; // normalized

export default class WindowedIconLayer extends IconLayer {
  getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      inject: {
        // Declare uniforms for windowing range
        'fs:#decl': `
uniform float windowMin;
uniform float windowMax;
`,
        // 在主要片段着色器逻辑中处理纹理采样和窗口
        'fs:#main': `
// 直接采样纹理获取灰度值（在 Deck.gl 处理颜色之前）
vec4 textureColor = texture2D(texture, vTexCoord);
// 从纹理中提取灰度强度（使用亮度公式）
float intensity = dot(textureColor.rgb, vec3(0.299, 0.587, 0.114));

// 应用窗口函数
float windowedIntensity = intensity;
if (intensity < windowMin) {
  windowedIntensity = 0.0;
} else if (intensity > windowMax) {
  windowedIntensity = 1.0;
} else {
  // 线性映射到 [0,1] 范围
  windowedIntensity = (intensity - windowMin) / (windowMax - windowMin);
}

// 将窗口后的强度存储到 alpha 通道，供后续使用
color.a = windowedIntensity;
`,
        // 在最终输出前应用颜色和强度
        'fs:DECKGL_FILTER_COLOR': `
// 使用存储的窗口强度
float t = color.a;
// 将颜色乘以窗口强度，实现灰度到彩色的映射
color.rgb *= t;
// Alpha 设为 1.0 用于加法混合
color.a = 1.0;
`,
      }
    };
  }

  draw(opts) {
    const { uniforms = {} } = opts;
    const { windowMin = DEFAULT_MIN, windowMax = DEFAULT_MAX } = this.props;
    super.draw({
      ...opts,
      uniforms: {
        ...uniforms,
        windowMin,
        windowMax,
      }
    });
  }
}
