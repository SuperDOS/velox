// The way back to Home from deep in the app: ▲ from the top of a page shows
// this button. OK goes Home; ▼ or Back returns to the page.
import { h } from '../util/dom.js';
import * as router from '../router.js';
import { home } from './icons.js';

export function showHomeButton() {
  const el = h('div', 'home-jump', document.body);
  const btn = h('div', 'btn btn-sm focus', el);
  btn.innerHTML = home;
  h('span', '', btn).textContent = 'Home';
  const close = () => {
    router.setModal(null);
    if (el.parentNode) el.parentNode.removeChild(el);
  };
  router.setModal({
    onKey(action) {
      if (action === 'enter') { close(); router.home(); }
      else if (action === 'down' || action === 'back') close();
    },
  });
}
