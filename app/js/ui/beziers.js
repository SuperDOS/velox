// Bezier, after the Windows NT screensaver: curves whose control points
// bounce around the screen, each trailed by fading copies of where it was,
// slowly changing colour. Drawn as thin triangle strips (WebGL lines are
// one pixel wide on most devices).
import { glCanvas } from './glsaver.js';

const CURVES = 3;
const TRAIL = 16;        // copies per curve
const EVERY = 3;         // frames between copies
const SAMPLES = 48;      // points along a curve
const WIDTH = 3;         // px
const SPEED = 260;       // px per second, roughly

const VS = 'attribute vec2 aPos; uniform vec2 uRes;'
  + 'void main() { gl_Position = vec4(aPos / uRes * 2.0 - 1.0, 0.0, 1.0); gl_Position.y = -gl_Position.y; }';
const FS = 'precision mediump float; uniform vec4 uColor; void main() { gl_FragColor = uColor; }';

function hsv(h, s, v) {
  const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}

export function startBeziers(container) {
  const g = glCanvas(container, VS, FS, { antialias: true });
  if (!g) return null;
  const { gl, prog } = g;
  const W = 1920, H = 1080;
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), W, H);
  const uColor = gl.getUniformLocation(prog, 'uColor');
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 1);

  const rnd = (a, b) => a + Math.random() * (b - a);
  const curves = [];
  for (let c = 0; c < CURVES; c++) {
    const pts = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2, sp = rnd(0.6, 1.2) * SPEED;
      pts.push({ x: rnd(100, W - 100), y: rnd(100, H - 100), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp });
    }
    curves.push({ pts, trail: [], hue: Math.random() });
  }

  const strip = new Float32Array(SAMPLES * 4);
  function drawCurve(p, colour, alpha) {
    // Sample the cubic, then offset each point both ways along its normal.
    let px = 0, py = 0;
    const xs = [], ys = [];
    for (let i = 0; i < SAMPLES; i++) {
      const t = i / (SAMPLES - 1), u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      xs.push(a * p[0] + b * p[2] + c * p[4] + d * p[6]);
      ys.push(a * p[1] + b * p[3] + c * p[5] + d * p[7]);
    }
    for (let i = 0; i < SAMPLES; i++) {
      const j0 = Math.max(0, i - 1), j1 = Math.min(SAMPLES - 1, i + 1);
      let dx = xs[j1] - xs[j0], dy = ys[j1] - ys[j0];
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      px = -dy / len * WIDTH / 2; py = dx / len * WIDTH / 2;
      strip[i * 4] = xs[i] + px; strip[i * 4 + 1] = ys[i] + py;
      strip[i * 4 + 2] = xs[i] - px; strip[i * 4 + 3] = ys[i] - py;
    }
    gl.bufferData(gl.ARRAY_BUFFER, strip, gl.STREAM_DRAW);
    gl.uniform4f(uColor, colour[0], colour[1], colour[2], alpha);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, SAMPLES * 2);
  }

  let running = true;
  let last = performance.now();
  let frameNo = 0;
  (function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frameNo++;
    gl.clear(gl.COLOR_BUFFER_BIT);
    curves.forEach(cv => {
      cv.pts.forEach(p => {
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < 0 || p.x > W) { p.vx = -p.vx; p.x = Math.max(0, Math.min(W, p.x)); }
        if (p.y < 0 || p.y > H) { p.vy = -p.vy; p.y = Math.max(0, Math.min(H, p.y)); }
      });
      cv.hue = (cv.hue + dt * 0.03) % 1;
      if (frameNo % EVERY === 0) {
        cv.trail.unshift(cv.pts.reduce((a, p) => a.concat([p.x, p.y]), []));
        if (cv.trail.length > TRAIL) cv.trail.pop();
      }
      const colour = hsv(cv.hue, 0.85, 1);
      for (let i = cv.trail.length - 1; i >= 0; i--) drawCurve(cv.trail[i], colour, 0.85 * (1 - i / TRAIL));
    });
    requestAnimationFrame(frame);
  })(last);
  return () => { running = false; g.dispose(); };
}
