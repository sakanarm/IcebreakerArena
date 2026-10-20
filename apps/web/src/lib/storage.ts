/**
 * localStorage that never throws: private windows, blocked storage and
 * full quotas just behave like an empty store.
 */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // nothing to do: the app still works, it just won't remember
  }
}

export function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // see save()
  }
}

/** PINs of the rooms this browser opened and still holds the host token for */
export function hostedPins(): string[] {
  try {
    const pins: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const pin = localStorage.key(i)?.match(/^ib\.host\.(\d{6})$/)?.[1];
      if (pin) pins.push(pin);
    }
    return pins;
  } catch {
    return [];
  }
}

export const keys = {
  myGames: 'ib.games',
  hostToken: (pin: string) => `ib.host.${pin}`,
  playerSession: (pin: string) => `ib.player.${pin}`,
  profile: 'ib.profile',
  /** separate from the Stage window, so a laptop + projector pair can mute one of them */
  hostSound: 'ib.sound.host',
  stageSound: 'ib.sound.stage',
  phoneSound: 'ib.sound.phone',
};

export interface PlayerSession {
  token: string;
  playerId: string;
  nickname: string;
}

export interface Profile {
  nickname: string;
  avatar: string;
}
