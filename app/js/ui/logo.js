// A title's logo image, or its name in text when it has none, or when the
// server can't deliver it (Plex sometimes lists a clearLogo whose file is
// missing: a 404, which the TV draws as a broken picture). The logo stays
// invisible until it has loaded; logos that failed once go straight to text.
import { setText } from '../util/dom.js';

const failed = new Set();

// fit(): sizes the title text once it's shown (fitText needs it on screen).
export function showLogo(img, title, src, text, fit) {
  const asText = () => {
    img.style.display = 'none';
    title.style.display = '';
    setText(title, text);
    fit();
  };
  if (!src || failed.has(src)) { asText(); return; }
  img.style.display = '';
  title.style.display = 'none';
  if (img._src === src) return; // already showing (or loading) this one
  img._src = src;
  img.style.visibility = 'hidden';
  img.onload = () => { if (img._src === src) img.style.visibility = ''; };
  img.onerror = () => {
    failed.add(src);
    if (img._src === src) { img._src = ''; asText(); }
  };
  img.src = src;
}
