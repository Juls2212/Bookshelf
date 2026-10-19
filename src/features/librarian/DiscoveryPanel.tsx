// The dark panel of "Nuevas aventuras": invitation, loading (with a real Cancelar), errors and
// the suggestion card with its actions. Every action goes through the stores and the router.
import { useRouter } from 'expo-router';

import { useToast } from '@/components/Toast';
import { suggestionToParams } from '@/features/recommendations/addFromSuggestion';
import { t } from '@/i18n';
import { useRecommendationsStore, type DiscoverInput } from '@/stores/recommendationsStore';

import { DiscoveryCard } from './DiscoveryCard';
import { LoadingPanel, MessagePanel } from './LibrarianPanels';
import { DISCOVERY_RETRYABLE, type DiscoveryView } from './librarianView';

const d = t.librarian.discovery;

export function DiscoveryPanel({ view, input }: { view: DiscoveryView; input: DiscoverInput }) {
  const router = useRouter();
  const toast = useToast();
  const store = useRecommendationsStore;
  const request = () => void store.getState().requestDiscovery(input);

  switch (view.kind) {
    case 'loading':
      return (
        <LoadingPanel message={d.loading} onCancel={() => store.getState().cancelDiscovery()} />
      );
    case 'error':
      return (
        <MessagePanel
          icon={view.error === 'no_new_suggestions' ? 'search' : 'alert-circle'}
          title={view.error === 'no_new_suggestions' ? d.noNewTitle : d.errorTitle}
          text={t.discoveryErrors[view.error]}
          action={
            DISCOVERY_RETRYABLE.includes(view.error)
              ? { label: t.librarian.retry, icon: 'refresh', onPress: request }
              : undefined
          }
          testID={`discovery-error-${view.error}`}
        />
      );
    case 'invite':
      return (
        <MessagePanel
          icon="sparkles"
          title={d.inviteTitle}
          text={view.offline ? d.offlineHint : d.inviteText}
          testID="discovery-invite"
        />
      );
    case 'result': {
      const { recommendation } = view;
      return (
        <DiscoveryCard
          recommendation={recommendation}
          offline={view.offline}
          onAdd={() => {
            const params = suggestionToParams(recommendation);
            if (params) router.push({ pathname: '/book/new', params });
          }}
          onSaveIdea={async () => {
            if (await store.getState().saveIdea(recommendation.id)) {
              toast.show(d.ideaSavedToast, 'success');
            }
          }}
          // The current one is marked skipped only once the next one arrived.
          onAnother={() => void store.getState().requestAnotherDiscovery(input)}
        />
      );
    }
  }
}
