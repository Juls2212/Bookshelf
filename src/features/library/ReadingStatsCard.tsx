// "Tu lectura" on Inicio: a few numbers about the user's own library (no charts, streaks,
// goals or badges). Hoy | Esta semana | Este año | Total switch the finished books and pages
// read; the other figures are the library as it is now. Static: nothing animates.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { SegmentedControl } from '@/components/SegmentedControl';
import { useTheme } from '@/design/ThemeProvider';
import { radii, sizes, spacing } from '@/design/tokens';
import { format, t } from '@/i18n';
import type { Book } from '@/types/book';

import { formatCount, formatRating, readingStats, type StatsPeriod } from './readingStats';

const s = t.home.stats;

const periodOptions = [
  { value: 'today', label: s.periods.today },
  { value: 'week', label: s.periods.week },
  { value: 'year', label: s.periods.year },
  { value: 'all', label: s.periods.all },
] as const satisfies readonly { value: StatsPeriod; label: string }[];

const plural = (count: number, forms: { one: string; many: string }) =>
  count === 1 ? forms.one : forms.many;

/** One figure: the value and its label read as one sentence by screen readers. */
function Stat({ value, label, testID }: { value: string; label: string; testID: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.stat, { borderColor: colors.border }]}
      accessible
      accessibilityLabel={`${value} ${label}`}
      testID={testID}
    >
      <AppText variant="title">{value}</AppText>
      <AppText variant="caption">{label}</AppText>
    </View>
  );
}

export function ReadingStatsCard({
  books,
  dailyPages = {},
  now = new Date(),
}: {
  books: readonly Book[];
  /** Signed pages per local date from the reading log. */
  dailyPages?: Readonly<Record<string, number>>;
  now?: Date;
}) {
  const { colors } = useTheme();
  const [period, setPeriod] = useState<StatsPeriod>('today');
  if (books.length === 0) return null;
  const stats = readingStats(books, { period, now, dailyPages });
  const nothingToday = period === 'today' && stats.finished === 0 && stats.pagesRead === 0;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]} testID="reading-stats">
      <View style={styles.header}>
        <AppText variant="label" accessibilityRole="header" style={styles.flex}>
          {s.title}
        </AppText>
      </View>
      <SegmentedControl<StatsPeriod>
        options={periodOptions}
        value={period}
        onChange={setPeriod}
        accessibilityLabel={s.periodLabel}
      />
      {nothingToday ? (
        <AppText variant="body" color="textSecondary" testID="reading-stats-today-empty">
          {s.todayEmpty}
        </AppText>
      ) : null}
      <View style={styles.grid}>
        {nothingToday ? null : (
          <>
            <Stat
              value={formatCount(stats.finished)}
              label={plural(stats.finished, s.finished[period])}
              testID="stat-finished"
            />
            <Stat
              value={formatCount(stats.pagesRead)}
              label={plural(stats.pagesRead, s.pages[period])}
              testID="stat-pages"
            />
          </>
        )}
        <Stat
          value={formatCount(stats.reading)}
          label={plural(stats.reading, s.reading)}
          testID="stat-reading"
        />
        <Stat
          value={formatCount(stats.toRead)}
          label={plural(stats.toRead, s.toRead)}
          testID="stat-to-read"
        />
        {stats.averageRating !== null ? (
          <Stat
            value={format(s.ratingValue, { rating: formatRating(stats.averageRating) })}
            label={s.rating}
            testID="stat-rating"
          />
        ) : null}
        {stats.favoriteGenre ? (
          <Stat value={stats.favoriteGenre} label={s.genre} testID="stat-genre" />
        ) : null}
      </View>
      <AppText variant="caption" color="textSecondary" testID="reading-stats-note">
        {s.logNote}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.surface, padding: spacing.lg + spacing.xs, gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: sizes.minTouchTarget,
    borderWidth: sizes.borderWidth,
    borderRadius: radii.field,
    padding: spacing.md,
    gap: spacing.xxs,
  },
});
