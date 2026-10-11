import { useRouter } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { fonts, sizes, spacing } from '@/design/tokens';
import { t } from '@/i18n';

const tabIcons: Record<string, IconName> = {
  index: 'home',
  library: 'library',
  librarian: 'sparkles',
  profile: 'user',
};

/** The raised Scan button sits after this many tabs. */
const SCAN_SLOT = 2;
const DOT = 4;

function ScanButton() {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={styles.item}>
      <Pressable
        onPress={() => router.push('/scan')}
        accessibilityRole="button"
        accessibilityLabel={t.nav.scanA11y}
        style={({ pressed }) => [
          styles.scan,
          {
            backgroundColor: colors.actionPrimary,
            borderColor: colors.tabBar,
            shadowColor: colors.shadow,
          },
          pressed && styles.pressed,
        ]}
      >
        <Icon name="scan" size={sizes.iconLg} color={colors.actionPrimaryText} strokeWidth={2} />
        <View style={styles.scanPlus}>
          <Icon name="plus" size={12} color={colors.actionPrimaryText} strokeWidth={2.5} />
        </View>
      </Pressable>
      <Text
        style={[styles.label, styles.scanLabel, { color: colors.textPrimary }]}
        importantForAccessibility="no"
        accessibilityElementsHidden
      >
        {t.tabs.scan}
      </Text>
    </View>
  );
}

// Custom bottom bar: Inicio, Biblioteca, raised Escanear, Librero, Perfil.
export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { colors } = useTheme();

  const tabs = state.routes.map((route, index) => {
    const focused = state.index === index;
    const options = descriptors[route.key].options;
    const label = typeof options.title === 'string' ? options.title : route.name;
    const color = focused ? colors.textPrimary : colors.textSecondary;

    const onPress = () => {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
    };

    return (
      <Pressable
        key={route.key}
        onPress={onPress}
        onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected: focused }}
        style={styles.item}
      >
        <Icon
          name={tabIcons[route.name] ?? 'book'}
          size={sizes.iconLg}
          color={color}
          strokeWidth={focused ? 2 : 1.75}
        />
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            { color, fontFamily: focused ? fonts.sansSemiBold : fonts.sansRegular },
          ]}
        >
          {label}
        </Text>
        <View style={[styles.dot, { backgroundColor: focused ? colors.accent : 'transparent' }]} />
      </Pressable>
    );
  });

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={t.nav.tabsLabel}
      style={[
        styles.bar,
        {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, spacing.sm),
        },
      ]}
    >
      {tabs.slice(0, SCAN_SLOT)}
      <ScanButton />
      {tabs.slice(SCAN_SLOT)}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderTopWidth: sizes.borderWidth,
    paddingTop: spacing.sm,
    minHeight: sizes.tabBarHeight,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    minHeight: sizes.minTouchTarget + spacing.md,
    gap: 3,
  },
  label: { fontSize: 12, lineHeight: 15 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  scan: {
    width: sizes.scanButton,
    height: sizes.scanButton,
    borderRadius: sizes.scanButton / 2,
    borderWidth: 4,
    marginTop: -sizes.scanButton / 2 - spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  scanPlus: { position: 'absolute' },
  scanLabel: { fontFamily: fonts.sansSemiBold },
  pressed: { opacity: 0.9 },
});
