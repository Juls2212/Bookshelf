import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { Icon } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { fonts, radii, sizes, spacing, type ColorToken } from '@/design/tokens';
import { t } from '@/i18n';

import { AppText } from './AppText';

type Props = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  label: string;
  helperText?: string;
  errorText?: string;
  /** Marks a value that must be double-checked (e.g. filled by AI). */
  review?: boolean;
};

export function TextField({
  label,
  helperText,
  errorText,
  review = false,
  multiline = false,
  secureTextEntry = false,
  onFocus,
  onBlur,
  ...inputProps
}: Props) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);

  const hasError = Boolean(errorText);
  const borderToken: ColorToken | null = hasError
    ? 'danger'
    : focused
      ? 'focusBorder'
      : review
        ? 'warning'
        : null;
  const message = errorText ?? helperText;

  return (
    <View style={styles.container}>
      <AppText variant="label">{label}</AppText>
      <View
        style={[
          styles.field,
          multiline && styles.multiline,
          {
            backgroundColor: colors.field,
            borderColor: borderToken ? colors[borderToken] : colors.border,
          },
        ]}
      >
        <TextInput
          {...inputProps}
          accessibilityLabel={inputProps.accessibilityLabel ?? label}
          accessibilityHint={message}
          multiline={multiline}
          secureTextEntry={secureTextEntry && hidden}
          placeholderTextColor={colors.textMuted}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            styles.input,
            multiline && styles.inputMultiline,
            {
              color: colors.textPrimary,
              fontFamily: multiline ? fonts.serifItalic : fonts.sansRegular,
            },
          ]}
        />
        {secureTextEntry ? (
          <Pressable
            onPress={() => setHidden((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={hidden ? t.common.showPassword : t.common.hidePassword}
            style={styles.toggle}
          >
            <Icon name={hidden ? 'eye' : 'eye-off'} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      {message ? (
        <View style={styles.messageRow}>
          {hasError ? <Icon name="alert-circle" size={14} color={colors.danger} /> : null}
          <AppText
            variant="caption"
            color={hasError ? 'danger' : review ? 'warning' : 'textSecondary'}
            accessibilityLiveRegion={hasError ? 'polite' : 'none'}
          >
            {message}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs + 2 },
  field: {
    minHeight: sizes.minTouchTarget + 4,
    borderRadius: radii.field,
    borderWidth: sizes.borderWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  multiline: { minHeight: 96, alignItems: 'flex-start' },
  input: { flex: 1, fontSize: 16, paddingVertical: spacing.md },
  inputMultiline: { fontSize: 18, textAlignVertical: 'top', minHeight: 72 },
  toggle: {
    minWidth: sizes.minTouchTarget,
    minHeight: sizes.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -spacing.sm,
  },
  messageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
