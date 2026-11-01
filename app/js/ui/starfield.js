// Starfield, after the Windows "Starfield Simulation": stars rush towards
// you out of the dark. Each star's depth comes from the clock in the vertex
// shader, so a frame is one draw call and no work in JavaScript.
import { glCanvas } from './glsaver.js';

const STARS = 2400;
const SPEED = 0.16; // of the depth per second

const VS = 'attribute vec3 aStar; uniform float uTime; varying float vLight;'
  + 'void main() {'
  + '  float z = fract(aStar.z - uTime * ' + SPEED.toFixed(3) + ');'        // 1 far → 0 at the screen
  + '  float d = 0.04 + z * 0.96;'
  + '  vec2 p = aStar.xy / d;'
  + '  gl_Position = vec4(p.x * 0.5625, p.y, 0.0, 1.0);'                     // 16:9
  + '  vLight = clamp((1.0 - z) * 1.6, 0.0, 1.0) * clamp(z * 25.0, 0.0, 1.0);' // fade in far away, out at the very end
  + '  gl_PointSize = 1.5 + (1.0 - z) * (1.0 - z) * 9.0;'
  + '}';
const FS = 'precision mediump float; varying float vLight;'
  + 'void main() {'
  + '  vec2 c = gl_PointCoord - 0.5; float r = dot(c, c);'
  + '  if (r > 0.25) discard;'
  + '  gl_FragColor = vec4(vec3(vLight * (1.0 - r * 2.0)), 1.0);'
  + '}';

export function startStarfield(container) {
  const g = glCanvas(container, VS, FS, { antialias: false });
  if (!g) return null;
  const { gl, prog } = g;
  const data = new Float32Array(STARS * 3);
  for (let i = 0; i < STARS; i++) {
    data[i * 3] = (Math.random() * 2 - 1) * 1.8;
    data[i * 3 + 1] = (Math.random() * 2 - 1) * 1.0;
    data[i * 3 + 2] = Math.random();
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const aStar = gl.getAttribLocation(prog, 'aStar');
  gl.enableVertexAttribArray(aStar);
  gl.vertexAttribPointer(aStar, 3, gl.FLOAT, false, 0, 0);
  const uTime = gl.getUniformLocation(prog, 'uTime');
  gl.clearColor(0, 0, 0, 1);
  let running = true;
  const t0 = performance.now();
  (function frame(now) {
    if (!running) return;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(uTime, (now - t0) / 1000);
    gl.drawArrays(gl.POINTS, 0, STARS);
    requestAnimationFrame(frame);
  })(t0);
  return () => { running = false; g.dispose(); };
}
