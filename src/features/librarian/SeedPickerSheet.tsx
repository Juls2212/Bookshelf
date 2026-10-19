// "Parecido a…": pick one of the user's own books as the reference for "Nuevas aventuras", or
// go back to the default (based on the user's favorites).
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BottomSheet } from '@/components/BottomSheet';
import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { radii, sizes, spacing } from '@/design/tokens';
import { t } from '@/i18n';
import type { Book } from '@/types/book';

const d = t.librarian.discovery;
const LIST_MAX_HEIGHT = 420;

type Props = {
  visible: boolean;
  books: readonly Book[];
  /** Null = based on my favorites. */
  selectedId: string | null;
  onSelect: (bookId: string | null) => void;
  onClose: () => void;
};

function Option({
  label,
  detail,
  checked,
  onPress,
  testID,
}: {
  label: string;
  detail?: string | null;
  checked: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      testID={testID}
      style={({ pressed }) => [
        styles.option,
        {
          borderColor: checked ? colors.textPrimary : colors.border,
          backgroundColor: colors.surface,
        },
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.flex}>
        <AppText variant="body" color="textPrimary" numberOfLines={2}>
          {label}
        </AppText>
        {detail ? (
          <AppText variant="caption" numberOfLines={1}>
            {detail}
          </AppText>
        ) : null}
      </View>
      {/* The check mark (not only the border) tells which one is selected. */}
      {checked ? <Icon name="check" size={sizes.iconMd} /> : null}
    </Pressable>
  );
}

export function SeedPickerSheet({ visible, books, selectedId, onSelect, onClose }: Props) {
  const choose = (id: string | null) => {
    onSelect(id);
    onClose();
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} title={d.seedSheetTitle}>
      <View accessibilityRole="radiogroup" style={styles.list}>
        <Option
          label={d.seedFavorites}
          checked={selectedId === null}
          onPress={() => choose(null)}
          testID="seed-favorites"
        />
        {books.length === 0 ? (
          <AppText variant="caption">{d.seedEmpty}</AppText>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
            {books.map((book) => (
              <Option
                key={book.id}
                label={book.title}
                detail={book.author}
                checked={selectedId === book.id}
                onPress={() => choose(book.id)}
                testID={`seed-${book.id}`}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  scroll: { maxHeight: LIST_MAX_HEIGHT },
  option: {
    minHeight: sizes.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.field,
    borderWidth: sizes.borderWidth,
  },
  flex: { flex: 1 },
  pressed: { opacity: 0.85 },
});
