import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import { t } from '@/i18n';
import { useSyncStore } from '@/stores/syncStore';

import { syncBadgeA11yLabel, syncBadgeFor, syncBadgeLabel } from './syncPresentation';

/** The real sync state. In the error state, tapping it retries the failed changes. */
export function SyncBadge() {
  const status = useSyncStore((state) => state.status);
  const pendingCount = useSyncStore((state) => state.pendingCount);
  const failedCount = useSyncStore((state) => state.failedCount);
  const badge = syncBadgeFor({ status, pendingCount, failedCount });
  const isError = badge.kind === 'error';
  return (
    <SyncStatusBadge
      kind={badge.kind}
      label={syncBadgeLabel(badge)}
      accessibilityLabel={syncBadgeA11yLabel(badge)}
      onPress={isError ? () => void useSyncStore.getState().retryFailed() : undefined}
      accessibilityHint={isError ? t.sync.a11y.retryHint : undefined}
    />
  );
}
