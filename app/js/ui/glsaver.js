// Shared setup for the WebGL screensavers (pipes, starfield, bezier, scenes): a
// full-screen canvas and a compiled program, or null without WebGL.
import { DEV } from '../config.js';

// size: the drawing buffer; smaller than the screen is stretched to fit it.
export function glCanvas(container, vs, fs, options, size) {
  const canvas = document.createElement('canvas');
  canvas.className = 'saver-gl';
  canvas.width = size ? size[0] : 1920;
  canvas.height = size ? size[1] : 1080;
  container.appendChild(canvas);
  // window.__glKeep (dev tools): keep each frame so it can be captured.
  const gl = canvas.getContext('webgl', Object.assign({ alpha: false, preserveDrawingBuffer: DEV && !!window.__glKeep }, options));
  if (!gl) { container.removeChild(canvas); return null; }
  const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const dispose = () => {
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  };
  return { canvas, gl, prog, dispose };
}
