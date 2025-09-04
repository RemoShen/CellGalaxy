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
        // Adjust final color just before output
        'fs:DECKGL_FILTER_COLOR': `
// Treat current alpha as normalized intensity in [0,1]
float a = color.a;
// Window clamp: below min -> 0, above max -> 1, inside keep original
float t = a;
if (a < windowMin) {
  t = 0.0;
} else if (a > windowMax) {
  t = 1.0;
}
// Pure RGB additive contribution scaled by windowed intensity
color.rgb *= t;
// Alpha not used in additive blend, set to 1.0 to avoid side effects
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
