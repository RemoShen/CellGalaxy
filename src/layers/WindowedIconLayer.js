// WindowedIconLayer: extends IconLayer to apply per-layer windowing (min/max)
// on the sampled texture intensity in the fragment shader, without reloading images.
import { IconLayer } from '@deck.gl/layers';

const DEFAULT_MIN = 0.0; // normalized
const DEFAULT_MAX = 1.0; // normalized

export default class WindowedIconLayer extends IconLayer {
  getUniforms() {
    const uniforms = super.getUniforms();
    uniforms.windowMin = this.props.windowMin || DEFAULT_MIN;
    uniforms.windowMax = this.props.windowMax || DEFAULT_MAX;
    return uniforms;
  }
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
        // 在最终输出前应用颜色和强度
        'fs:DECKGL_FILTER_COLOR': `
// 使用存储的窗口强度
float t = color.a;
// 将颜色乘以窗口强度，实现灰度到彩色的映射
if (t < windowMin) {
  t = 0.0;
} else if (t > windowMax) {
  t = 1.0;
}
color.rgb *= t;
// Alpha 设为 1.0 用于加法混合
color.a = 1.0;
`,
      }
    };
  }
  updateState({props, oldProps, changeFlags}) {
    super.updateState({props, oldProps, changeFlags});
    const {model} = this.state;
    if (model) {
      model.setUniforms({
        windowMin: props.windowMin ?? DEFAULT_MIN,
        windowMax: props.windowMax ?? DEFAULT_MAX,
      });
    }
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
