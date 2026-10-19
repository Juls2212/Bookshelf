// Why the book could not be identified, and the two ways forward. Offline puts manual entry
// first, since trying again cannot work until the connection returns.
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { sizes, spacing } from '@/design/tokens';
import { t } from '@/i18n';

import type { ScanFailure } from './identifyBook';

const f = t.scan.failure;

type Props = { error: ScanFailure; onRetry: () => void; onManual: () => void };

export function ScanFailureCard({ error, onRetry, onManual }: Props) {
  const { colors } = useTheme();
  const copy = f.errors[error];
  const offline = error === 'offline';
  return (
    <View style={styles.card} testID={`scan-failure-${error}`} accessibilityLiveRegion="polite">
      <View style={styles.titleRow}>
        <Icon
          name={offline ? 'cloud-off' : 'alert-circle'}
          size={sizes.iconLg}
          color={colors.danger}
        />
        <AppText variant="heading" accessibilityRole="header" style={styles.title}>
          {copy.title}
        </AppText>
      </View>
      <AppText variant="body" color="textSecondary">
        {copy.message}
      </AppText>
      <View style={styles.actions}>
        {offline ? (
          <>
            <Button icon="pencil" label={f.manual} onPress={onManual} />
            <Button variant="secondary" icon="refresh" label={f.retry} onPress={onRetry} />
          </>
        ) : (
          <>
            <Button icon="refresh" label={f.retry} onPress={onRetry} />
            <Button variant="secondary" icon="pencil" label={f.manual} onPress={onManual} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1 },
  actions: { gap: spacing.sm },
});
