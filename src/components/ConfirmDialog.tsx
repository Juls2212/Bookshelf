import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/design/ThemeProvider';
import { radii, scrimOpacity, sizes, spacing } from '@/design/tokens';

import { AppText } from './AppText';
import { Button } from './Button';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
};

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  destructive = false,
}: Props) {
  const { colors, scheme } = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onCancel}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
        >
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.scrim, opacity: scrimOpacity[scheme] },
            ]}
          />
        </Pressable>
        <View
          accessibilityViewIsModal
          accessibilityRole="alert"
          style={[
            styles.card,
            { backgroundColor: colors.surfaceElevated, borderColor: colors.border },
          ]}
        >
          <AppText variant="heading" accessibilityRole="header">
            {title}
          </AppText>
          <AppText variant="body" color="textSecondary">
            {message}
          </AppText>
          <View style={styles.actions}>
            <Button
              variant={destructive ? 'destructive' : 'primary'}
              icon={destructive ? 'trash' : undefined}
              label={confirmLabel}
              onPress={onConfirm}
            />
            <Button variant="secondary" label={cancelLabel} onPress={onCancel} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  card: {
    borderRadius: radii.surface,
    borderWidth: sizes.borderWidth,
    padding: spacing.xl,
    gap: spacing.md,
  },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
});
