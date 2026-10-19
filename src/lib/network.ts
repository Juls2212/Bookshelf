// Connectivity (NetInfo, included in Expo Go). "Online" means the device has a network
// connection; a connected but unreachable network is NOT treated as offline: those requests
// fail and are retried by the sync engine.
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { AppState } from 'react-native';

export type Network = {
  isOnline(): Promise<boolean>;
  /** Called with the new online state on every change. Returns an unsubscribe function. */
  subscribe(listener: (online: boolean) => void): () => void;
};

/** Unknown (null) counts as online: only a definite "no connection" is offline. */
const isOnlineState = (state: Pick<NetInfoState, 'isConnected'>): boolean =>
  state.isConnected !== false;

export const deviceNetwork: Network = {
  async isOnline() {
    return isOnlineState(await NetInfo.fetch());
  },
  subscribe(listener) {
    return NetInfo.addEventListener((state) => listener(isOnlineState(state)));
  },
};

export type Foreground = {
  /** Called with true when the app returns to the foreground. */
  subscribe(listener: (active: boolean) => void): () => void;
};

export const appForeground: Foreground = {
  subscribe(listener) {
    const subscription = AppState.addEventListener('change', (state) =>
      listener(state === 'active'),
    );
    return () => subscription.remove();
  },
};
