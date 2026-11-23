// Plex Home users: listing them and switching between them, shared by
// Settings → Account → User and the "Who's watching?" screen at start.
import { session, signIn, useServer } from './session.js';
import { getServers, connect, homeUsers, switchHomeUser } from './plex/auth.js';
import * as store from './util/store.js';

// The Home is listed with the token the account signed in with (a managed
// user's own token can't see the Home).
export function homeToken() {
  return store.get('homeToken') || session.token;
}

// The last list seen, so the start screen can show at once.
export function cachedHomeUsers() {
  return store.get('homeUsers') || [];
}

export async function loadHomeUsers() {
  const users = await homeUsers(homeToken());
  store.set('homeUsers', users.map(u => ({ uuid: u.uuid, title: u.title, thumb: u.thumb, protected: !!u.protected, admin: !!u.admin, restricted: !!u.restricted })));
  return users;
}

// Becomes that user (pin when they have one) on the same server if they can
// reach it, else their first. Throws with .status 401/403 on a wrong PIN.
export async function switchToUser(u, pin) {
  const token = homeToken();
  const user = await switchHomeUser(token, u.uuid, pin);
  // The new user's servers first: nothing changes if this fails.
  const servers = await getServers(user.authToken);
  const resource = servers.find(r => session.server && r.clientIdentifier === session.server.id) || servers[0];
  if (!resource) throw new Error('No servers for ' + u.title);
  const uri = await connect(resource);
  store.set('homeToken', token);
  signIn(user.authToken, user);
  useServer(resource, uri);
  store.set('homeCache', undefined);
}
