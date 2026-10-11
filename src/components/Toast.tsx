import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { radii, sizes, spacing, type ColorToken } from '@/design/tokens';
import { t } from '@/i18n';

import { AppText } from './AppText';

export type ToastKind = 'success' | 'error' | 'info';

type ToastState = { id: number; kind: ToastKind; message: string };

type ToastApi = { show: (message: string, kind?: ToastKind) => void };

export const TOAST_DURATION_MS = 3500;
/** Keeps the toast above the tab bar and its raised Scan button. */
const BOTTOM_OFFSET = sizes.tabBarHeight + spacing.xxl;

const kindIcon: Record<ToastKind, { icon: IconName; color: ColorToken }> = {
  success: { icon: 'check', color: 'highlight' },
  error: { icon: 'alert-circle', color: 'highlight' },
  info: { icon: 'sparkles', color: 'highlight' },
};

const ToastContext = createContext<ToastApi | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const [api] = useState<ToastApi>(() => ({
    show: (message, kind = 'info') => {
      setToast({ id: nextId++, kind, message });
      AccessibilityInfo.announceForAccessibility(message);
    },
  }));

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <View
          pointerEvents="box-none"
          style={[styles.layer, { bottom: insets.bottom + BOTTOM_OFFSET }]}
        >
          <View
            key={toast.id}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[
              styles.toast,
              { backgroundColor: colors.tagStrong, shadowColor: colors.shadow },
            ]}
          >
            <Icon
              name={kindIcon[toast.kind].icon}
              color={colors[kindIcon[toast.kind].color]}
              size={sizes.iconMd}
            />
            <AppText variant="body" color="tagStrongText" style={styles.message}>
              {toast.message}
            </AppText>
            <Pressable
              onPress={() => setToast(null)}
              accessibilityRole="button"
              accessibilityLabel={t.toast.dismiss}
              style={styles.dismiss}
            >
              <Icon name="x" size={sizes.iconSm} color={colors.tagStrongText} />
            </Pressable>
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside ToastProvider');
  return api;
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: spacing.lg, right: spacing.lg },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.button,
    paddingLeft: spacing.lg,
    minHeight: sizes.minTouchTarget + spacing.sm,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 6,
  },
  message: { flex: 1, paddingVertical: spacing.sm },
  dismiss: {
    width: sizes.minTouchTarget,
    height: sizes.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
