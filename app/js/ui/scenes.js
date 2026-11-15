// Ambient scenes: northern lights, a nebula, plasma and fireflies. The first
// three are one fragment shader over the whole screen, drawn at half
// resolution (the TV's GPU manages about 16 fps at 1080p, 45+ at 540p) and
// stretched, which suits their soft shapes. Fireflies are points, like the
// starfield, so they draw at full resolution.
import { glCanvas } from './glsaver.js';

const QUAD_VS = 'attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }';

// Value noise and its fractal sum. highp: the hash falls apart at mediump on Mali.
const NOISE = 'precision highp float; uniform float uTime; uniform vec2 uRes;'
  + 'float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }'
  + 'float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);'
  + '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }'
  + 'float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }'
  // A sparse field of twinkling stars; cell is their spacing in pixels.
  + 'float stars(vec2 px, float cell) { vec2 g = floor(px / cell); float r = hash(g);'
  + '  vec2 c = (g + 0.2 + 0.6 * vec2(hash(g + 3.1), hash(g + 7.7))) * cell;'
  + '  float tw = 0.6 + 0.4 * sin(uTime * (0.5 + r * 2.0) + r * 60.0);'
  + '  return step(0.93, r) * tw * smoothstep(1.6, 0.0, length(px - c)); }';

// Curtains of light over a dark ridge: each has a slowly wandering lower
// edge, glows upward from it, and is combed into fine vertical rays.
const AURORA = NOISE
  + 'float wave(vec2 p) { return 0.67 * noise(p) + 0.33 * noise(p * 2.03 + 17.0); }' // the edges are smooth: two octaves do
  + 'void main() {'
  + '  vec2 u = gl_FragCoord.xy / uRes; float x = u.x * 1.7778; float t = uTime;'
  + '  vec3 col = mix(vec3(0.0, 0.012, 0.035), vec3(0.01, 0.03, 0.07), u.y);'
  + '  col += vec3(0.8, 0.85, 1.0) * stars(gl_FragCoord.xy, 14.0) * 0.8;'
  + '  for (int i = 0; i < 3; i++) {'
  + '    float k = float(i);'
  + '    float edge = 0.40 + 0.10 * k + 0.28 * (wave(vec2(x * 0.9 + k * 3.7 + t * 0.02, t * 0.03 + k * 9.0)) - 0.5);'
  + '    float rays = noise(vec2(x * 26.0 + edge * 30.0 + k * 11.0, t * 0.25 + k * 5.0)); rays *= rays;'
  + '    float d = u.y - edge;'
  + '    float glow = smoothstep(-0.035, 0.03, d) * exp(-max(d, 0.0) * (5.5 - 3.5 * rays)) * (0.22 + 1.1 * rays);'
  + '    float drift = 0.55 + 0.45 * sin(t * 0.11 + k * 2.1 + x * 0.8);'
  + '    vec3 hue = mix(vec3(0.10, 1.00, 0.45), vec3(0.45, 0.20, 0.85), clamp(d * 2.6 + 0.15 * k, 0.0, 1.0));'
  + '    col += hue * glow * drift * (0.95 - 0.15 * k);'
  + '  }'
  + '  float ridge = 0.085 + 0.03 * sin(x * 2.9 + 1.0) + 0.012 * sin(x * 9.7);'
  + '  col *= smoothstep(ridge - 0.004, ridge + 0.004, u.y);'
  + '  gl_FragColor = vec4(col, 1.0);'
  + '}';

// Clouds of gas: noise warped by more noise, coloured by how the two differ,
// drifting slowly, with stars showing through the thin parts.
const NEBULA = NOISE + 'void main() {'
  + '  vec2 p = gl_FragCoord.xy / uRes.y; float t = uTime * 0.012;'
  + '  float q = fbm(p * 1.6 + vec2(t, -t * 0.6));'
  + '  float w = fbm(p * 2.2 + q * 2.4 + vec2(-t * 0.7, t));'
  + '  float gas = smoothstep(0.24, 0.78, w);'
  + '  vec3 col = mix(vec3(0.05, 0.08, 0.32), vec3(0.62, 0.14, 0.50), smoothstep(0.35, 0.75, q));'
  + '  col = mix(col, vec3(1.0, 0.62, 0.36), smoothstep(0.62, 0.95, w) * 0.7);'
  + '  col *= gas * 1.25;'
  + '  col += vec3(0.01, 0.012, 0.03);'
  + '  float s = stars(gl_FragCoord.xy, 11.0) + 0.7 * stars(gl_FragCoord.xy + 37.0, 23.0);'
  + '  col += vec3(0.9, 0.92, 1.0) * s * (1.0 - gas * 0.75);'
  + '  gl_FragColor = vec4(col, 1.0);'
  + '}';

// The old demo effect: a few sine waves added up and run through a palette.
const PLASMA = 'precision highp float; uniform float uTime; uniform vec2 uRes;'
  + 'void main() {'
  + '  vec2 p = 1.5 * (gl_FragCoord.xy - 0.5 * uRes) / uRes.y; float t = uTime * 0.25;'
  + '  float v = sin(p.x * 3.1 + t) + sin(p.y * 4.3 - t * 1.3) + sin((p.x + p.y) * 2.6 + t * 0.7)'
  + '    + sin(length(p - 0.9 * vec2(sin(t * 0.31), cos(t * 0.43))) * 5.0 - t * 1.7);'
  + '  vec3 col = 0.5 + 0.5 * cos(6.2832 * (v * 0.14 + vec3(0.0, 0.1, 0.2)) + uTime * 0.04);'
  + '  gl_FragColor = vec4(col * (0.35 + 0.65 * col) * 0.9, 1.0);'
  + '}';

function quadScene(fs) {
  return container => {
    const g = glCanvas(container, QUAD_VS, fs, { antialias: false }, [960, 540]);
    if (!g) return null;
    const { gl, prog, canvas } = g;
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), canvas.width, canvas.height);
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const from = Math.random() * 600; // a different sky each time
    let running = true;
    const t0 = performance.now();
    (function frame(now) {
      if (!running) return;
      gl.uniform1f(uTime, from + (now - t0) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      requestAnimationFrame(frame);
    })(t0);
    return () => { running = false; g.dispose(); };
  };
}

export const startAurora = quadScene(AURORA);
export const startNebula = quadScene(NEBULA);
export const startPlasma = quadScene(PLASMA);

// Fireflies: glowing points that wander on slow loops and pulse, each from
// its own seed, so the vertex shader does all the moving.
const FLIES = 90;
const FLY_VS = 'attribute vec4 aFly; uniform float uTime; varying float vLight; varying float vWarm;'
  + 'void main() {'
  + '  float s = aFly.z * 6.2832; float t = uTime * (0.05 + 0.07 * aFly.w);'
  + '  vec2 p = aFly.xy + vec2(sin(t * 1.3 + s) * 0.22 + sin(t * 3.1 + s * 2.0) * 0.05, cos(t * 1.1 + s * 1.7) * 0.16 + sin(t * 2.7 + s) * 0.05);'
  + '  gl_Position = vec4(p, 0.0, 1.0);'
  + '  float blink = sin(uTime * (0.5 + aFly.w * 0.9) + s * 5.0);'
  + '  vLight = smoothstep(-0.2, 0.9, blink);'
  + '  vWarm = aFly.z;'
  + '  gl_PointSize = 44.0 + 70.0 * aFly.w;'
  + '}';
const FLY_FS = 'precision mediump float; varying float vLight; varying float vWarm;'
  + 'void main() {'
  + '  float r = length(gl_PointCoord - 0.5) * 2.0;'
  + '  float glow = 0.8 * pow(max(1.0 - r, 0.0), 2.2) + smoothstep(0.13, 0.0, r);'
  + '  vec3 col = mix(vec3(0.75, 1.0, 0.25), vec3(1.0, 0.8, 0.3), vWarm);'
  + '  gl_FragColor = vec4(col * glow * vLight, 1.0);'
  + '}';

export function startFireflies(container) {
  const g = glCanvas(container, FLY_VS, FLY_FS, { antialias: false });
  if (!g) return null;
  const { gl, prog } = g;
  const data = new Float32Array(FLIES * 4);
  for (let i = 0; i < FLIES; i++) {
    data[i * 4] = Math.random() * 2 - 1;
    data[i * 4 + 1] = Math.random() * 1.7 - 0.95; // fewer near the top
    data[i * 4 + 2] = Math.random();
    data[i * 4 + 3] = Math.random();
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const aFly = gl.getAttribLocation(prog, 'aFly');
  gl.enableVertexAttribArray(aFly);
  gl.vertexAttribPointer(aFly, 4, gl.FLOAT, false, 0, 0);
  const uTime = gl.getUniformLocation(prog, 'uTime');
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE); // glows add up where they cross
  gl.clearColor(0.0, 0.012, 0.016, 1);
  const from = Math.random() * 600;
  let running = true;
  const t0 = performance.now();
  (function frame(now) {
    if (!running) return;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uTime, from + (now - t0) / 1000);
    gl.drawArrays(gl.POINTS, 0, FLIES);
    requestAnimationFrame(frame);
  })(t0);
  return () => { running = false; g.dispose(); };
}
