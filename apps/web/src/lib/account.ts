'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { api, setPageUser } from './api';

/** off: no accounts, games stay in the browser. mock: name-only login for development. local: username and password. oidc: company login. */
export type AuthMode = 'off' | 'mock' | 'local' | 'oidc';

export interface AccountUser {
  id: string;
  name: string;
  isCurator: boolean;
}

export type Account =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      mode: AuthMode;
      /** who this page acts for: the user it opened as, or logged in as here */
      user: AccountUser | null;
      /**
       * Set when the browser's login no longer matches `user`: it ended, or another tab logged in as
       * someone else. The page keeps acting for `user` (the server refuses its requests until the
       * person logs back in as `user`), so nothing lands in the wrong account and no edit is lost.
       */
      switched: { to: AccountUser | null } | null;
    };

const LOADING: Account = { status: 'loading' };
let current: Account = LOADING;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Account) {
  current = next;
  if (next.status === 'ready') setPageUser(next.user?.id ?? null);
  listeners.forEach((l) => l());
}

/** A login or logout in this tab: the page now acts for `user`, and other tabs check theirs. */
function become(mode: AuthMode, user: AccountUser | null) {
  set({ status: 'ready', mode, user, switched: null });
  try {
    channel()?.postMessage('changed');
  } catch {
    // another tab will notice when it is next shown
  }
}

/** Asks the server who is logged in; every useAccount() on the page updates. */
export function refreshAccount(): Promise<void> {
  inflight ??= api<{ mode: AuthMode; user: AccountUser | null }>('/auth/me')
    .then((r) => {
      const mine = current.status === 'ready' ? current.user : null;
      // a page that had nobody takes whoever logged in; a page with a user stays with them
      if (!mine || r.user?.id === mine.id) set({ status: 'ready', mode: r.mode, user: r.user, switched: null });
      else set({ status: 'ready', mode: r.mode, user: mine, switched: { to: r.user } });
    })
    .catch(() => {
      // a page already showing someone's games keeps them through a network blip
      if (current.status !== 'ready') set({ status: 'error' });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

let bc: BroadcastChannel | null | undefined;
function channel(): BroadcastChannel | null {
  if (bc === undefined) bc = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('ib-account');
  return bc;
}

let watching = false;
/** Logins in other tabs: told at once where the browser can, and checked whenever this tab comes back into view. */
function watchOtherTabs() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const check = () => {
    if (current.status === 'ready' && current.mode !== 'off') void refreshAccount();
  };
  channel()?.addEventListener('message', check);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
}

const subscribe = (l: () => void) => {
  watchOtherTabs();
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The login mode and user, fetched once per page load and shared by every component. */
export function useAccount(): Account {
  const account = useSyncExternalStore(
    subscribe,
    () => current,
    () => LOADING,
  );
  useEffect(() => {
    if (current.status !== 'ready') void refreshAccount();
  }, []);
  return account;
}

/** True when games live in the user's account instead of this browser. */
export const usesAccounts = (a: Account) => a.status === 'ready' && a.mode !== 'off';

/** Development login: any name, no password. The server only allows it when AUTH_MODE=mock. */
export async function mockLogin(name: string) {
  const r = await api<{ user: AccountUser }>('/auth/mock', { method: 'POST', body: { name } });
  become('mock', r.user);
}

/** Username and password, for accounts an admin made. The server only allows it when AUTH_MODE=local. */
export async function localLogin(username: string, password: string) {
  const r = await api<{ user: AccountUser }>('/auth/login', { method: 'POST', body: { username, password } });
  become('local', r.user);
}

export async function logout() {
  await api('/auth/logout', { method: 'POST' });
  become(current.status === 'ready' ? current.mode : 'off', null);
}
