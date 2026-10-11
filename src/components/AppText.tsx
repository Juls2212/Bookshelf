import { Text, type TextProps } from 'react-native';

import { useTheme } from '@/design/ThemeProvider';
import { typeScale, type ColorToken } from '@/design/tokens';

export type TextVariant =
  'display' | 'title' | 'heading' | 'body' | 'label' | 'caption' | 'italicNote';

const defaultColor: Record<TextVariant, ColorToken> = {
  display: 'textPrimary',
  title: 'textPrimary',
  heading: 'textPrimary',
  body: 'textPrimary',
  label: 'accentText',
  caption: 'textSecondary',
  italicNote: 'textSecondary',
};

type Props = TextProps & {
  variant?: TextVariant;
  color?: ColorToken;
};

export function AppText({ variant = 'body', color, style, ...rest }: Props) {
  const { colors } = useTheme();
  return (
    <Text
      {...rest}
      style={[
        typeScale[variant],
        variant === 'label' && { textTransform: 'uppercase' },
        { color: colors[color ?? defaultColor[variant]] },
        style,
      ]}
    />
  );
}
