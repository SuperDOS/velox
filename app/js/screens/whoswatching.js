// "Who's watching?" (Settings → Account → Choose user at start): the Plex Home
// users as avatars when the app starts, the last one active focused. A user
// with a PIN is always asked for it, the last one included, so picking the
// admin's avatar can't skip their PIN.
import { h, setText, toggleClass } from '../util/dom.js';
import { session } from '../session.js';
import { switchToUser } from '../homeUsers.js';
import { showMenu, showPrompt } from '../ui/menu.js';
import * as router from '../router.js';
import * as icons from '../ui/icons.js';
import { error } from '../util/log.js';

export function WhosWatchingScreen(users, { onDone }) {
  const el = h('div', 'screen whos');
  h('h1', 'whos-title', el).textContent = 'Who\'s watching?';
  const list = h('div', 'whos-list', el);
  const status = h('div', 'whos-status', el);
  const me = session.user && session.user.uuid;
  let index = Math.max(0, users.findIndex(u => u.uuid === me));
  let busy = false;

  const tiles = users.map(u => {
    const tile = h('div', 'whos-user', list);
    const pic = h('div', 'whos-pic', tile);
    if (u.thumb) {
      const img = h('img', '', pic);
      img.alt = '';
      img.src = u.thumb;
    } else {
      setText(h('div', 'whos-initial', pic), (u.title || '?').charAt(0).toUpperCase());
    }
    if (u.protected) h('div', 'whos-lock', pic).innerHTML = icons.lock;
    setText(h('div', 'whos-name', tile), u.title);
    return tile;
  });

  function render() {
    tiles.forEach((t, i) => toggleClass(t, 'focus', i === index));
  }
  render();

  async function pick(u) {
    if (busy) return;
    let pin;
    if (u.protected) {
      pin = await showPrompt({ title: 'PIN for ' + u.title, placeholder: 'PIN', secret: true });
      if (pin === null) return;
    } else if (u.uuid === me) {
      onDone(); // the last user, no PIN: nothing to switch
      return;
    }
    busy = true;
    setText(status, 'Switching to ' + u.title + '…');
    try {
      await switchToUser(u, pin);
      onDone();
    } catch (e) {
      busy = false;
      setText(status, '');
      error('switch user failed', e);
      const wrongPin = e.status === 401 || e.status === 403;
      showMenu({ title: wrongPin ? 'Wrong PIN' : 'Couldn\'t switch user', subtitle: wrongPin ? '' : e.message, items: [{ label: 'OK', run: () => {} }] });
    }
  }

  return {
    el,
    name: 'whos',
    onKey(action) {
      if (busy) return true;
      if (action === 'left') { index = Math.max(0, index - 1); render(); }
      else if (action === 'right') { index = Math.min(tiles.length - 1, index + 1); render(); }
      else if (action === 'enter') pick(users[index]);
      return true; // Back stays here: someone has to be picked
    },
  };
}
