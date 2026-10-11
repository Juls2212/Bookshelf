import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/design/ThemeProvider';
import { radii, scrimOpacity, sizes, spacing } from '@/design/tokens';
import { t } from '@/i18n';

import { AppText } from './AppText';

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
};

// Bottom sheet (radius 28). No animation by design; Android back closes it.
export function BottomSheet({ visible, onClose, title, children }: Props) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t.overlay.close}
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
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surfaceElevated,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.sm,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.track }]} />
          {title ? (
            <AppText variant="heading" accessibilityRole="header">
              {title}
            </AppText>
          ) : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    borderWidth: sizes.borderWidth,
    borderBottomWidth: 0,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.lg,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2 },
});
