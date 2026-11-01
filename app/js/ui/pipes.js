// 3D Pipes, after the Windows 95 screensaver: shiny pipes grow through an
// invisible 3D grid, turning at random with a ball at every bend, each in its
// own colour, until the space fills up; then it fades and starts over.
//
// Plain WebGL 1. The camera never moves, so the canvas keeps what's been drawn
// (preserveDrawingBuffer, depth included) and each step only draws the newest
// piece: a handful of draw calls a second, however full the screen gets.
import { glCanvas } from './glsaver.js';

const NX = 18, NY = 10, NZ = 10;   // grid cells
const PIPES = 2;                   // growing at once
const STEP_MS = 100;               // one segment per pipe per step
const FILL = 0.4;                  // start over at this share of cells used
const RADIUS = 0.24, BALL = 0.36;
const COLOURS = [[0.85, 0.15, 0.15], [0.15, 0.7, 0.2], [0.2, 0.35, 0.95], [0.95, 0.8, 0.1], [0.1, 0.8, 0.85],
  [0.85, 0.25, 0.85], [0.95, 0.5, 0.1], [0.85, 0.85, 0.85]];
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

const VS = 'attribute vec3 aPos; attribute vec3 aNorm;'
  + 'uniform mat4 uModel; uniform mat4 uViewProj; uniform mat3 uNormal;'
  + 'varying vec3 vNorm; varying vec3 vPos;'
  + 'void main() { vec4 w = uModel * vec4(aPos, 1.0); vPos = w.xyz; vNorm = uNormal * aNorm; gl_Position = uViewProj * w; }';
const FS = 'precision mediump float;'
  + 'uniform vec3 uColor; uniform vec3 uEye; varying vec3 vNorm; varying vec3 vPos;'
  + 'void main() {'
  + '  vec3 n = normalize(vNorm); vec3 l = normalize(vec3(-0.45, 0.6, 0.65));'
  + '  vec3 hv = normalize(l + normalize(uEye - vPos));'
  + '  float d = max(dot(n, l), 0.0); float s = pow(max(dot(n, hv), 0.0), 48.0);'
  + '  gl_FragColor = vec4(uColor * (0.2 + 0.8 * d) + vec3(0.65) * s, 1.0);'
  + '}';

// --- tiny matrix helpers (column-major, like WebGL) ---
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function multiply(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
// Rotation taking +Z onto an axis direction, then a move to p. Returns the
// model matrix and its 3×3 rotation (the normal matrix).
function place(p, dir) {
  const z = dir;
  const up = Math.abs(z[1]) > 0.5 ? [1, 0, 0] : [0, 1, 0];
  const x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return {
    model: [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, p[0], p[1], p[2], 1],
    normal: [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]],
  };
}

// --- meshes: positions and normals, interleaved ---
function cylinder(sides) {
  const v = [];
  for (let i = 0; i < sides; i++) {
    const a0 = i / sides * Math.PI * 2, a1 = (i + 1) / sides * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const q = (c, s, zz) => v.push(c * RADIUS, s * RADIUS, zz, c, s, 0);
    q(c0, s0, 0); q(c1, s1, 0); q(c1, s1, 1);
    q(c0, s0, 0); q(c1, s1, 1); q(c0, s0, 1);
  }
  return new Float32Array(v);
}
function sphere(rings, sides) {
  const v = [];
  const pt = (r, s) => {
    const th = r / rings * Math.PI, ph = s / sides * Math.PI * 2;
    const x = Math.sin(th) * Math.cos(ph), y = Math.cos(th), z = Math.sin(th) * Math.sin(ph);
    return [x * BALL, y * BALL, z * BALL, x, y, z];
  };
  for (let r = 0; r < rings; r++) for (let s = 0; s < sides; s++) {
    const a = pt(r, s), b = pt(r + 1, s), c = pt(r + 1, s + 1), d = pt(r, s + 1);
    v.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  return new Float32Array(v);
}

export function startPipes(container) {
  const g = glCanvas(container, VS, FS, { antialias: true, preserveDrawingBuffer: true });
  if (!g) return null;
  const { canvas, gl, prog } = g;
  const loc = n => gl.getUniformLocation(prog, n);
  const uModel = loc('uModel'), uNormal = loc('uNormal'), uColor = loc('uColor');
  const aPos = gl.getAttribLocation(prog, 'aPos'), aNorm = gl.getAttribLocation(prog, 'aNorm');

  const mesh = data => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buf, count: data.length / 6 };
  };
  const tube = mesh(cylinder(16));
  const ball = mesh(sphere(10, 16));

  const eye = [0, 0, 16];
  const viewProj = multiply(perspective(50 * Math.PI / 180, 16 / 9, 1, 60),
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -eye[0], -eye[1], -eye[2], 1]);
  gl.uniformMatrix4fv(loc('uViewProj'), false, new Float32Array(viewProj));
  gl.uniform3fv(loc('uEye'), new Float32Array(eye));
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 1);

  function draw(m, p, dir, colour) {
    const t = place(p, dir);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(aNorm);
    gl.vertexAttribPointer(aNorm, 3, gl.FLOAT, false, 24, 12);
    gl.uniformMatrix4fv(uModel, false, new Float32Array(t.model));
    gl.uniformMatrix3fv(uNormal, false, new Float32Array(t.normal));
    gl.uniform3fv(uColor, new Float32Array(colour));
    gl.drawArrays(gl.TRIANGLES, 0, m.count);
  }

  // Cell (i, j, k) → world position, the grid centred on the origin.
  const world = c => [c[0] - NX / 2 + 0.5, c[1] - NY / 2 + 0.5, c[2] - NZ / 2 + 0.5];
  let used, filled, pipes, colourAt;
  const key = c => (c[0] * NY + c[1]) * NZ + c[2];
  const free = c => c[0] >= 0 && c[0] < NX && c[1] >= 0 && c[1] < NY && c[2] >= 0 && c[2] < NZ && !used[key(c)];
  const take = c => { used[key(c)] = 1; filled++; };

  function newPipe() {
    for (let tries = 0; tries < 50; tries++) {
      const c = [Math.floor(Math.random() * NX), Math.floor(Math.random() * NY), Math.floor(Math.random() * NZ)];
      if (!free(c)) continue;
      take(c);
      const colour = COLOURS[colourAt++ % COLOURS.length];
      draw(ball, world(c), [0, 0, 1], colour);
      // Each pipe runs a while then ends, so new colours keep appearing.
      return { cell: c, dir: DIRS[Math.floor(Math.random() * 6)], colour, left: 40 + Math.floor(Math.random() * 80) };
    }
    return null;
  }

  function reset() {
    used = new Uint8Array(NX * NY * NZ);
    filled = 0;
    colourAt = Math.floor(Math.random() * COLOURS.length);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    pipes = [];
    for (let i = 0; i < PIPES; i++) { const p = newPipe(); if (p) pipes.push(p); }
  }

  function grow(p) {
    const next = d => [p.cell[0] + d[0], p.cell[1] + d[1], p.cell[2] + d[2]];
    let dir = p.dir;
    // Mostly straight on; otherwise (or when blocked) a random free turn.
    if (!free(next(dir)) || Math.random() < 0.22) {
      const options = DIRS.filter(d => free(next(d)) && !(d[0] === -dir[0] && d[1] === -dir[1] && d[2] === -dir[2]));
      if (!options.length || p.left <= 0) { draw(ball, world(p.cell), dir, p.colour); return false; }
      const turn = options[Math.floor(Math.random() * options.length)];
      if (turn !== dir) draw(ball, world(p.cell), dir, p.colour); // the bend
      dir = turn;
    }
    const to = next(dir);
    draw(tube, world(p.cell), dir, p.colour);
    take(to);
    p.cell = to;
    p.dir = dir;
    if (--p.left <= 0) { draw(ball, world(to), dir, p.colour); return false; }
    return true;
  }

  let fading = false;
  let fadeTimer = 0;
  function step() {
    if (fading) return;
    if (filled / (NX * NY * NZ) > FILL) {
      // Fade the picture out, clear, fade back in.
      fading = true;
      canvas.style.opacity = '0';
      fadeTimer = setTimeout(() => { reset(); canvas.style.opacity = '1'; fading = false; }, 1200);
      return;
    }
    pipes = pipes.map(p => (grow(p) ? p : newPipe())).filter(Boolean);
    while (pipes.length < PIPES) { const p = newPipe(); if (!p) break; pipes.push(p); }
  }

  reset();
  const timer = setInterval(step, STEP_MS);
  return () => {
    clearInterval(timer);
    clearTimeout(fadeTimer);
    g.dispose();
  };
}
