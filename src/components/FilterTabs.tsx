import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/design/ThemeProvider';
import { fonts, sizes, spacing } from '@/design/tokens';
import { t } from '@/i18n';

export const LIBRARY_FILTERS = ['all', 'reading', 'to_read', 'finished', 'lent'] as const;
export type LibraryFilter = (typeof LIBRARY_FILTERS)[number];

type Props = {
  value: LibraryFilter;
  onChange: (value: LibraryFilter) => void;
  /**
   * Horizontal padding of the parent. The row bleeds to the screen edges by this amount so
   * the last tab is never clipped by the padding when the row has to scroll.
   */
  inset?: number;
};

export function FilterTabs({ value, onChange, inset = 0 }: Props) {
  const { colors } = useTheme();
  return (
    <View style={{ marginHorizontal: -inset }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        accessibilityLabel={t.filters.label}
        // Fits: tabs spread across the width (mockup look). Too wide (narrow screen or large
        // font): the row scrolls and both ends keep the inset, so every tab is reachable.
        contentContainerStyle={[styles.content, { paddingHorizontal: inset }]}
      >
        {LIBRARY_FILTERS.map((filter) => {
          const selected = filter === value;
          return (
            <Pressable
              key={filter}
              onPress={() => onChange(filter)}
              accessibilityRole="tab"
              accessibilityLabel={t.filters[filter]}
              accessibilityState={{ selected }}
              style={styles.tab}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.text,
                  selected
                    ? { color: colors.textPrimary, fontFamily: fonts.sansSemiBold }
                    : { color: colors.textSecondary },
                ]}
              >
                {t.filters[filter]}
              </Text>
              <View
                style={[
                  styles.underline,
                  { backgroundColor: selected ? colors.accent : 'transparent' },
                ]}
              />
            </Pressable>
          );
        })}
      </ScrollView>
      {/* Hairline under the tabs, aligned with the content (not the bleed). */}
      <View
        style={[styles.hairline, { left: inset, right: inset, backgroundColor: colors.border }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'space-between', gap: spacing.md },
  tab: { minHeight: sizes.minTouchTarget + 4, justifyContent: 'flex-end' },
  text: { fontFamily: fonts.sansRegular, fontSize: 16, lineHeight: 22, paddingBottom: spacing.md },
  underline: { height: 2, borderRadius: 1 },
  hairline: { position: 'absolute', bottom: 0, height: sizes.borderWidth },
});
