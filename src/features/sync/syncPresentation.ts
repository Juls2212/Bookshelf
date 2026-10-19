// What the UI shows for a sync snapshot (pure: tested without rendering). Copy from i18n.
import type { SyncBadgeKind } from '@/components/SyncStatusBadge';
import { format, t } from '@/i18n';
import { formatDayTime } from '@/lib/dates';

import type { SyncSnapshot } from './syncEngine';

export type { SyncBadgeKind };

export type SyncBadgeState = {
  kind: SyncBadgeKind;
  /** Pending changes (pending/offline) or failed changes (error). */
  count: number;
};

type Counts = Pick<SyncSnapshot, 'status' | 'pendingCount' | 'failedCount'>;

/** Offline first, then syncing, then failures, then pending changes. */
export function syncBadgeFor({ status, pendingCount, failedCount }: Counts): SyncBadgeState {
  if (status === 'offline') return { kind: 'offline', count: pendingCount + failedCount };
  if (status === 'syncing') return { kind: 'syncing', count: pendingCount };
  if (failedCount > 0) return { kind: 'error', count: failedCount };
  if (pendingCount > 0) return { kind: 'pending', count: pendingCount };
  if (status === 'error') return { kind: 'error', count: 0 };
  return { kind: 'synced', count: 0 };
}

const plural = (count: number, one: string, many: string) =>
  count === 1 ? one : format(many, { count });

/** Visible badge text. */
export function syncBadgeLabel({ kind, count }: SyncBadgeState): string {
  const c = t.sync.badge;
  switch (kind) {
    case 'pending':
      return plural(count, c.pendingOne, c.pendingMany);
    case 'offline':
      return count > 0 ? plural(count, c.offlinePendingOne, c.offlinePendingMany) : c.offline;
    default:
      return c[kind];
  }
}

/** Full sentence for screen readers. */
export function syncBadgeA11yLabel({ kind, count }: SyncBadgeState): string {
  const c = t.sync.a11y;
  switch (kind) {
    case 'pending':
      return plural(count, c.pendingOne, c.pendingMany);
    case 'offline':
      return count > 0 ? plural(count, c.offlinePendingOne, c.offlinePendingMany) : c.offline;
    case 'error':
      return count > 0 ? plural(count, c.errorOne, c.errorMany) : c.error;
    default:
      return c[kind];
  }
}

/** Perfil: one sentence describing the current state. */
export function syncStatusText({ kind, count }: SyncBadgeState): string {
  const c = t.sync.status;
  switch (kind) {
    case 'pending':
      return plural(count, c.pendingOne, c.pendingMany);
    case 'error':
      return count > 0 ? plural(count, t.sync.failedOne, t.sync.failedMany) : c.error;
    default:
      return c[kind];
  }
}

/** Perfil: the last sync (day and time), or that it never synced on this device. */
export function lastSyncText(lastSyncAt: string | null, now: Date): string {
  if (!lastSyncAt) return t.sync.neverSynced;
  return format(t.sync.lastSync, { when: formatDayTime(new Date(lastSyncAt), now) });
}

export type FirstRunState = 'loading' | 'offline' | 'failed' | null;

/**
 * Before the first download of the library on this device the local list is empty but not
 * meaningful: screens show this state instead of the empty library. null = show the library.
 */
export function firstRunState(
  { status, initialPullDone }: Pick<SyncSnapshot, 'status' | 'initialPullDone'>,
  hasBooks: boolean,
): FirstRunState {
  if (initialPullDone === true || hasBooks) return null;
  if (status === 'offline') return 'offline';
  if (initialPullDone === false && status === 'error') return 'failed';
  return 'loading';
}
