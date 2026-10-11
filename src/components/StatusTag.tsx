import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/design/ThemeProvider';
import { radii, sizes, spacing, typeScale, type ColorToken } from '@/design/tokens';
import { t } from '@/i18n';

export type StatusTagKind = keyof typeof t.statusTag;

type TagStyle = { background?: ColorToken; border: ColorToken; text: ColorToken; dashed?: true };

const tagStyles: Record<StatusTagKind, TagStyle> = {
  reading: { background: 'highlight', border: 'highlight', text: 'onHighlight' },
  to_read: { border: 'accentText', text: 'accentText' },
  finished: { background: 'tagStrong', border: 'tagStrong', text: 'tagStrongText' },
  lent: { border: 'danger', text: 'danger', dashed: true },
  saved: { border: 'success', text: 'success' },
  review: { border: 'warning', text: 'warning' },
};

export function StatusTag({ kind }: { kind: StatusTagKind }) {
  const { colors } = useTheme();
  const s = tagStyles[kind];
  return (
    <View
      accessibilityRole="text"
      style={[
        styles.tag,
        {
          borderColor: colors[s.border],
          borderStyle: s.dashed ? 'dashed' : 'solid',
          backgroundColor: s.background ? colors[s.background] : undefined,
        },
      ]}
    >
      <Text style={[typeScale.tag, styles.text, { color: colors[s.text] }]}>
        {t.statusTag[kind]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    alignSelf: 'flex-start',
    borderWidth: sizes.borderWidth,
    borderRadius: radii.tag,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs + 1,
  },
  text: { textTransform: 'uppercase' },
});
