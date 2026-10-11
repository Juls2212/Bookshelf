import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { BookCover } from '@/components/BookCover';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Screen } from '@/components/Screen';
import { ShelfLine } from '@/components/ShelfLine';
import { Skeleton } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { WarmGlow } from '@/components/WarmGlow';
import { Icon, type IconName } from '@/design/icons';
import { SchemeOverride, useTheme } from '@/design/ThemeProvider';
import { fonts, radii, sceneSpineBand, sceneSpines, spacing } from '@/design/tokens';
import type { MockMood, MockRecommendation, MockTime } from '@/features/_mock/fixtures';
import { useMockData } from '@/features/_mock/mockData';
import { format, t } from '@/i18n';
import type { Book } from '@/types/book';

const PADDING = spacing.lg + spacing.xs;
const TIMES: MockTime[] = ['short', 'hour', 'afternoon'];
const MOODS: MockMood[] = ['calm', 'gripping', 'think'];

// Decorative spines on both sides of the recommended cover (viewBox units).
const SPINES = [
  { x: 0, w: 22, h: 150, band: 30 },
  { x: 24, w: 18, h: 170 },
  { x: 44, w: 30, h: 140, band: 110 },
  { x: 76, w: 22, h: 162 },
  { x: 100, w: 26, h: 146 },
  { x: 250, w: 22, h: 156, band: 120 },
  { x: 274, w: 28, h: 138 },
  { x: 304, w: 20, h: 172, band: 40 },
  { x: 326, w: 22, h: 150 },
  { x: 350, w: 26, h: 160 },
];
const SCENE_HEIGHT = 190;

function ShelfScene({ book }: { book: Book }) {
  return (
    <View style={styles.scene}>
      <Svg
        width="100%"
        height={SCENE_HEIGHT}
        viewBox={`0 0 376 ${SCENE_HEIGHT}`}
        preserveAspectRatio="xMidYMax slice"
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {SPINES.map((s, i) => (
          <Rect
            key={s.x}
            x={s.x}
            y={SCENE_HEIGHT - s.h}
            width={s.w}
            height={s.h}
            fill={sceneSpines[i % sceneSpines.length]}
          />
        ))}
        {SPINES.filter((s) => s.band).map((s) => (
          <Rect
            key={`band-${s.x}`}
            x={s.x + 3}
            y={SCENE_HEIGHT - (s.band ?? 0)}
            width={s.w - 6}
            height={2}
            fill={sceneSpineBand}
          />
        ))}
      </Svg>
      <View style={styles.sceneCover}>
        <BookCover title={book.title} author={book.author} coverUri={book.coverUri} size="xl" />
      </View>
    </View>
  );
}

type PickProps = {
  rec: MockRecommendation;
  book: Book;
  onAnother: () => void;
};

function RecommendationScene({ rec, book, onAnother }: PickProps) {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  return (
    <View style={[styles.panel, { backgroundColor: colors.featureSurface }]}>
      <WarmGlow id="librarian-glow" cx={0.5} cy={0.62} radius={0.5} />
      <ShelfScene book={book} />
      <ShelfLine />
      <View style={styles.pickText}>
        <AppText variant="label" color="highlight" style={styles.center}>
          {t.librarian.pickLabel}
        </AppText>
        <AppText variant="display" style={styles.center} accessibilityRole="header">
          {book.title}
        </AppText>
        <AppText variant="body" color="textSecondary" style={styles.center}>
          {format(t.librarian.authorGenre, { author: book.author ?? '', genre: book.genre ?? '' })}
        </AppText>
        <AppText variant="body" style={[styles.center, styles.reason]}>
          {rec.reason}
        </AppText>
      </View>
      <View style={[styles.row, { paddingHorizontal: PADDING }]}>
        <View style={styles.flex}>
          <Button
            label={t.librarian.viewBook}
            onPress={() => router.push({ pathname: '/book/[id]', params: { id: book.id } })}
          />
        </View>
        <View style={styles.flex}>
          <Button
            variant="secondary"
            label={t.librarian.readLater}
            onPress={() => toast.show(t.toast.savedForLater, 'success')}
          />
        </View>
      </View>
      <View style={styles.another}>
        <Button variant="link" icon="refresh" label={t.librarian.another} onPress={onAnother} />
      </View>
    </View>
  );
}

type MessageProps = {
  icon: IconName;
  title: string;
  text: string;
  action?: { label: string; onPress: () => void; icon?: IconName };
};

function MessagePanel({ icon, title, text, action }: MessageProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.panel, styles.message, { backgroundColor: colors.featureSurface }]}>
      <WarmGlow id="librarian-message-glow" cx={0.5} cy={0.2} radius={0.6} />
      <Icon name={icon} size={28} color={colors.highlight} />
      <AppText variant="title" style={styles.center} accessibilityRole="header">
        {title}
      </AppText>
      <AppText variant="body" color="textSecondary" style={styles.center}>
        {text}
      </AppText>
      {action ? <Button label={action.label} icon={action.icon} onPress={action.onPress} /> : null}
    </View>
  );
}

function LoadingPanel() {
  const { colors } = useTheme();
  return (
    <View style={[styles.panel, styles.message, { backgroundColor: colors.featureSurface }]}>
      <Skeleton width={150} height={210} radius={radii.tag} />
      <AppText variant="body" color="textSecondary" style={styles.center}>
        {t.librarian.loading}
      </AppText>
    </View>
  );
}

function Panel() {
  const router = useRouter();
  const toast = useToast();
  const data = useMockData();
  const [index, setIndex] = useState(0);

  if (data.status === 'loading') return <LoadingPanel />;
  if (data.status === 'offline') {
    return (
      <MessagePanel
        icon="alert-circle"
        title={t.librarian.offlineTitle}
        text={t.librarian.offlineText}
      />
    );
  }
  if (data.status === 'error') {
    return (
      <MessagePanel
        icon="alert-circle"
        title={t.librarian.errorTitle}
        text={t.librarian.errorText}
        action={{
          label: t.librarian.retry,
          icon: 'refresh',
          onPress: () => toast.show(t.librarian.errorTitle, 'error'),
        }}
      />
    );
  }
  if (data.books.length === 0) {
    return (
      <MessagePanel
        icon="book"
        title={t.librarian.emptyTitle}
        text={t.librarian.emptyText}
        action={{
          label: t.librarian.emptyAction,
          icon: 'scan',
          onPress: () => router.push('/scan'),
        }}
      />
    );
  }

  const options = data.recommendations
    .map((rec) => ({ rec, book: data.books.find((b) => b.id === rec.bookId) }))
    .filter(
      (o): o is { rec: MockRecommendation; book: Book } => o.book?.readingStatus === 'to_read',
    );

  if (options.length === 0) {
    return (
      <MessagePanel
        icon="check"
        title={t.librarian.noToReadTitle}
        text={t.librarian.noToReadText}
        action={{
          label: t.librarian.noToReadAction,
          icon: 'scan',
          onPress: () => router.push('/scan'),
        }}
      />
    );
  }

  const current = options[index % options.length];
  return (
    <RecommendationScene
      rec={current.rec}
      book={current.book}
      onAnother={() => setIndex((i) => i + 1)}
    />
  );
}

export default function LibrarianScreen() {
  const [time, setTime] = useState<MockTime>('hour');
  const [mood, setMood] = useState<MockMood>('calm');

  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={[styles.intro, { paddingHorizontal: PADDING }]}>
        <AppText variant="label">{t.librarian.eyebrow}</AppText>
        <AppText variant="display" accessibilityRole="header">
          {t.librarian.titleStart}
          <AppText variant="display" style={{ fontFamily: fonts.serifItalic }}>
            {t.librarian.titleEmphasis}
          </AppText>
          {t.librarian.titleEnd}
        </AppText>
        <AppText variant="label" color="textSecondary">
          {t.librarian.timeLabel}
        </AppText>
        <View style={styles.chips}>
          {TIMES.map((value) => (
            <Chip
              key={value}
              label={t.librarian.time[value]}
              selected={time === value}
              onPress={() => setTime(value)}
            />
          ))}
        </View>
        <AppText variant="label" color="textSecondary">
          {t.librarian.moodLabel}
        </AppText>
        <View style={styles.chips}>
          {MOODS.map((value) => (
            <Chip
              key={value}
              label={t.librarian.mood[value]}
              selected={mood === value}
              onPress={() => setMood(value)}
            />
          ))}
        </View>
      </View>
      {/* The recommendation scene is always dark, as in both mockup themes. */}
      <SchemeOverride scheme="dark">
        <Panel />
      </SchemeOverride>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 0, gap: spacing.xl, paddingTop: spacing.lg, flexGrow: 1 },
  intro: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  panel: {
    flexGrow: 1,
    overflow: 'hidden',
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  scene: { height: SCENE_HEIGHT + spacing.lg, justifyContent: 'flex-end' },
  sceneCover: { alignItems: 'center' },
  pickText: { gap: spacing.xs, paddingHorizontal: PADDING, paddingTop: spacing.sm },
  center: { textAlign: 'center' },
  reason: { marginTop: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  flex: { flex: 1 },
  another: { alignItems: 'center' },
  message: {
    alignItems: 'center',
    paddingHorizontal: PADDING,
    paddingTop: spacing.xxl,
    minHeight: 360,
    gap: spacing.md,
  },
});
