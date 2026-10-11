import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { coverColorFor } from '@/design/coverColor';
import { useTheme } from '@/design/ThemeProvider';
import { coverSpine, fonts, spacing } from '@/design/tokens';
import { format, t } from '@/i18n';

import { StatusTag } from './StatusTag';

export type BookCoverSize = 'sm' | 'md' | 'lg' | 'xl';

const coverWidths: Record<BookCoverSize, number> = { sm: 56, md: 80, lg: 120, xl: 160 };
export const COVER_ASPECT = 1.42;

type Props = {
  title: string;
  author?: string | null;
  coverUri?: string | null;
  /**
   * Stable image cache key (e.g. cover path + updated_at) so a refreshed signed URL
   * still hits the cached image.
   */
  coverCacheKey?: string | null;
  size?: BookCoverSize;
  /** Overrides `size`, e.g. for grid columns. */
  width?: number;
  /** Multiplies the height so covers on a shelf vary like real books. */
  heightFactor?: number;
  ribbon?: boolean;
  lent?: boolean;
  /** Hide from screen readers when a parent already describes the book. */
  decorative?: boolean;
};

function Ribbon({ coverWidth, color }: { coverWidth: number; color: string }) {
  const w = Math.max(8, Math.round(coverWidth * 0.1));
  const h = Math.round(w * 2.2);
  const notch = Math.round(w * 0.45);
  return (
    <Svg width={w} height={h} style={[styles.ribbon, { right: Math.round(coverWidth * 0.1) }]}>
      <Path d={`M0 0 H${w} V${h} L${w / 2} ${h - notch} L0 ${h} Z`} fill={color} />
    </Svg>
  );
}

export function BookCover({
  title,
  author,
  coverUri,
  coverCacheKey,
  size = 'md',
  width,
  heightFactor = 1,
  ribbon = false,
  lent = false,
  decorative = false,
}: Props) {
  const { colors } = useTheme();
  const coverWidth = width ?? coverWidths[size];
  const coverHeight = Math.round(coverWidth * COVER_ASPECT * heightFactor);
  const palette = coverColorFor(title);
  const label = author
    ? format(t.book.coverWithAuthorA11y, { title, author })
    : format(t.book.coverA11y, { title });
  const titleSize = Math.max(10, Math.round(coverWidth * 0.16));
  const showAuthor = Boolean(author) && coverWidth >= 72;
  // Remembers which URI failed, so a new URI (e.g. a refreshed signed URL) is tried again.
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const imageUri = coverUri && coverUri !== failedUri ? coverUri : null;

  return (
    <View
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={decorative ? undefined : label}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={decorative}
      style={[
        styles.shadow,
        { width: coverWidth, height: coverHeight, shadowColor: colors.shadow },
      ]}
    >
      <View style={[styles.cover, { backgroundColor: palette.background }]}>
        {/* Typographic cover always underneath: visible while the URL resolves, while the
            image loads, and whenever the image is missing or fails. Never a blank block. */}
        <View style={[styles.fallback, { padding: Math.max(6, coverWidth * 0.1) }]}>
          <Text
            numberOfLines={4}
            style={{
              color: palette.text,
              fontFamily: fonts.serif,
              fontSize: titleSize,
              lineHeight: Math.round(titleSize * 1.08),
            }}
          >
            {title}
          </Text>
          {showAuthor ? (
            <Text
              numberOfLines={1}
              style={[
                styles.author,
                { color: palette.text, fontSize: Math.max(7, Math.round(coverWidth * 0.065)) },
              ]}
            >
              {author}
            </Text>
          ) : null}
        </View>
        {imageUri ? (
          <Image
            testID="book-cover-image"
            source={coverCacheKey ? { uri: imageUri, cacheKey: coverCacheKey } : { uri: imageUri }}
            cachePolicy="memory-disk"
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={0}
            onError={() => setFailedUri(imageUri)}
          />
        ) : null}
        <View
          style={[
            styles.spine,
            {
              width: Math.max(3, Math.round(coverWidth * 0.05)),
              backgroundColor: coverSpine.color,
            },
          ]}
        />
        {ribbon ? <Ribbon coverWidth={coverWidth} color={colors.accent} /> : null}
      </View>
      {lent ? (
        <View style={[styles.lentTag, { backgroundColor: colors.background }]}>
          <StatusTag kind="lent" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowOffset: { width: 2, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
    borderRadius: 4,
  },
  cover: {
    flex: 1,
    overflow: 'hidden',
    borderTopLeftRadius: 2,
    borderBottomLeftRadius: 2,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  fallback: { flex: 1, justifyContent: 'space-between', paddingLeft: spacing.md },
  author: {
    fontFamily: fonts.sansSemiBold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  spine: { position: 'absolute', left: 0, top: 0, bottom: 0, opacity: coverSpine.opacity },
  ribbon: { position: 'absolute', top: 0 },
  lentTag: { position: 'absolute', top: -12, alignSelf: 'center', borderRadius: 4 },
});
