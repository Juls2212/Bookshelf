import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { fonts, radii, sizes, spacing } from '@/design/tokens';
import { t } from '@/i18n';

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  onSubmitEditing?: () => void;
};

export function SearchField({
  value,
  onChangeText,
  placeholder = t.search.placeholder,
  onSubmitEditing,
}: Props) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View
      style={[
        styles.field,
        {
          backgroundColor: colors.field,
          borderColor: focused || value ? colors.focusBorder : colors.border,
        },
      ]}
    >
      <Icon name="search" color={colors.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={t.search.label}
        returnKeyType="search"
        autoCorrect={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.input, { color: colors.textPrimary }]}
      />
      {value ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel={t.search.clear}
          style={styles.clear}
        >
          <Icon name="x" color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: 52,
    borderRadius: radii.surface,
    borderWidth: sizes.borderWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.lg,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    fontFamily: fonts.sansRegular,
    fontSize: 16,
    paddingVertical: spacing.md,
    paddingRight: spacing.lg,
  },
  clear: {
    width: sizes.minTouchTarget,
    height: sizes.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
});
