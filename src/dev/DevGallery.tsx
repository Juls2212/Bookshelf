import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { BookCover } from '@/components/BookCover';
import { BookShelfGrid } from '@/components/BookShelfGrid';
import { BookTile, type BookTileData } from '@/components/BookTile';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { FilterTabs, type LibraryFilter } from '@/components/FilterTabs';
import { ProgressBar } from '@/components/ProgressBar';
import { Screen } from '@/components/Screen';
import { SearchField } from '@/components/SearchField';
import { SegmentedControl } from '@/components/SegmentedControl';
import { ShelfLine } from '@/components/ShelfLine';
import { Skeleton } from '@/components/Skeleton';
import { StarRating } from '@/components/StarRating';
import { StatusTag, type StatusTagKind } from '@/components/StatusTag';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import { TextField } from '@/components/TextField';
import { useToast } from '@/components/Toast';
import { Icon, iconNames } from '@/design/icons';
import { useTheme } from '@/design/ThemeProvider';
import { radii, sizes, spacing, type ColorToken } from '@/design/tokens';
import { skiaSelfTest } from './skiaSelfTest';
import { FAKE_OUTCOMES } from '@/features/scan/fakeBookIdentifier';
import { useFakeIdentifierStore } from '@/features/scan/identifierFactory';
import { FAKE_SUGGEST_OUTCOMES } from '@/features/suggestions/fakeBookSuggester';
import { useFakeSuggesterStore } from '@/features/suggestions/suggesterFactory';
import { FAKE_RECOMMEND_OUTCOMES } from '@/features/recommendations/fakeRecommendationService';
import { useFakeRecommendStore } from '@/features/recommendations/serviceFactory';
import { useFakeDiscoverStore } from '@/features/recommendations/discoveryFactory';
import { FAKE_DISCOVER_OUTCOMES } from '@/features/recommendations/fakeDiscoveryService';
import {
  syncBadgeA11yLabel,
  syncBadgeLabel,
  type SyncBadgeState,
} from '@/features/sync/syncPresentation';
import { format, t } from '@/i18n';
import type { ThemeMode } from '@/stores/themeStore';
import type { ReadingStatus } from '@/types/book';

const g = t.devGallery;

const themeOptions = [
  { value: 'light', label: t.theme.light },
  { value: 'dark', label: t.theme.dark },
  { value: 'system', label: t.theme.system },
] as const satisfies readonly { value: ThemeMode; label: string }[];

const readingOptions = (['to_read', 'reading', 'finished'] as const).map((value) => ({
  value,
  label: t.readingStatus[value],
}));

const tagKinds = Object.keys(t.statusTag) as StatusTagKind[];

const GALLERY_BADGES: SyncBadgeState[] = [
  { kind: 'synced', count: 0 },
  { kind: 'syncing', count: 0 },
  { kind: 'pending', count: 3 },
  { kind: 'offline', count: 2 },
  { kind: 'error', count: 1 },
];

const sampleStatuses: ReadingStatus[] = ['reading', 'to_read', 'finished', 'to_read'];
const sampleBooks: BookTileData[] = g.sampleBooks.map((book, index) => ({
  id: `sample-${index}`,
  title: book.title,
  author: book.author,
  coverUri: null,
  readingStatus: sampleStatuses[index % sampleStatuses.length],
  currentPage: index === 0 ? 214 : null,
  pageCount: index === 0 ? 312 : null,
  lentTo: index === 7 ? g.sampleLentTo : null,
}));

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { borderTopColor: colors.border }]}>
      <AppText variant="label" accessibilityRole="header">
        {title}
      </AppText>
      {children}
    </View>
  );
}

function Palette() {
  const { colors } = useTheme();
  const keys = Object.keys(colors) as ColorToken[];
  return (
    <View style={styles.wrap}>
      {keys.map((key) => (
        <View key={key} style={styles.swatchItem}>
          <View
            style={[styles.swatch, { backgroundColor: colors[key], borderColor: colors.border }]}
          />
          <AppText variant="caption" numberOfLines={1}>
            {key}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function FakeIdentifierPicker() {
  const fakeEnabled = useFakeIdentifierStore((state) => state.fakeEnabled);
  const outcome = useFakeIdentifierStore((state) => state.outcome);
  const setOutcome = useFakeIdentifierStore((state) => state.setOutcome);
  const chooseReal = useFakeIdentifierStore((state) => state.chooseReal);
  return (
    <View style={styles.wrap}>
      <Chip label={t.scan.devOutcomes.real} selected={!fakeEnabled} onPress={chooseReal} />
      {FAKE_OUTCOMES.map((value) => (
        <Chip
          key={value}
          label={t.scan.devOutcomes[value]}
          selected={fakeEnabled && outcome === value}
          onPress={() => setOutcome(value)}
        />
      ))}
    </View>
  );
}

function FakeSuggesterPicker() {
  const fakeEnabled = useFakeSuggesterStore((state) => state.fakeEnabled);
  const outcome = useFakeSuggesterStore((state) => state.outcome);
  const setOutcome = useFakeSuggesterStore((state) => state.setOutcome);
  const chooseReal = useFakeSuggesterStore((state) => state.chooseReal);
  return (
    <View style={styles.wrap}>
      <Chip label={t.scan.devOutcomes.real} selected={!fakeEnabled} onPress={chooseReal} />
      {FAKE_SUGGEST_OUTCOMES.map((value) => (
        <Chip
          key={value}
          label={t.scan.devOutcomes[value]}
          selected={fakeEnabled && outcome === value}
          onPress={() => setOutcome(value)}
        />
      ))}
    </View>
  );
}

function FakeRecommendPicker() {
  const fakeEnabled = useFakeRecommendStore((state) => state.fakeEnabled);
  const outcome = useFakeRecommendStore((state) => state.outcome);
  const setOutcome = useFakeRecommendStore((state) => state.setOutcome);
  const chooseReal = useFakeRecommendStore((state) => state.chooseReal);
  return (
    <View style={styles.wrap}>
      <Chip label={t.scan.devOutcomes.real} selected={!fakeEnabled} onPress={chooseReal} />
      {FAKE_RECOMMEND_OUTCOMES.map((value) => (
        <Chip
          key={value}
          label={t.scan.devOutcomes[value]}
          selected={fakeEnabled && outcome === value}
          onPress={() => setOutcome(value)}
        />
      ))}
    </View>
  );
}

function FakeDiscoverPicker() {
  const fakeEnabled = useFakeDiscoverStore((state) => state.fakeEnabled);
  const outcome = useFakeDiscoverStore((state) => state.outcome);
  const setOutcome = useFakeDiscoverStore((state) => state.setOutcome);
  const chooseReal = useFakeDiscoverStore((state) => state.chooseReal);
  return (
    <View style={styles.wrap}>
      <Chip label={t.scan.devOutcomes.real} selected={!fakeEnabled} onPress={chooseReal} />
      {FAKE_DISCOVER_OUTCOMES.map((value) => (
        <Chip
          key={value}
          label={t.scan.devOutcomes[value]}
          selected={fakeEnabled && outcome === value}
          onPress={() => setOutcome(value)}
        />
      ))}
    </View>
  );
}

/** On-device check that Skia (bundled in Expo Go) can render, encode a JPEG and write it. */
function SkiaCheck() {
  const toast = useToast();
  const run = async () => {
    try {
      const bytes = await skiaSelfTest();
      toast.show(format(g.skiaOk, { bytes }), 'success');
    } catch {
      toast.show(g.skiaFailed, 'error');
    }
  };
  return (
    <Button variant="secondary" icon="sparkles" label={g.skiaTest} onPress={() => void run()} />
  );
}

function Overlays() {
  const toast = useToast();
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  return (
    <>
      <View style={styles.wrap}>
        <Button variant="secondary" label={g.openSheet} onPress={() => setSheet(true)} />
        <Button variant="secondary" label={g.openDialog} onPress={() => setDialog(true)} />
      </View>
      <View style={styles.wrap}>
        <Button
          variant="secondary"
          icon="check"
          label={g.toastSuccess}
          onPress={() => toast.show(t.toast.pageUpdated, 'success')}
        />
        <Button
          variant="secondary"
          icon="alert-circle"
          label={g.toastError}
          onPress={() => toast.show(t.librarian.errorTitle, 'error')}
        />
        <Button
          variant="secondary"
          icon="sparkles"
          label={g.toastInfo}
          onPress={() => toast.show(t.reading.notesSaved, 'info')}
        />
      </View>
      <View style={styles.wrap}>
        {GALLERY_BADGES.map((badge) => (
          <SyncStatusBadge
            key={badge.kind}
            kind={badge.kind}
            label={syncBadgeLabel(badge)}
            accessibilityLabel={syncBadgeA11yLabel(badge)}
          />
        ))}
      </View>
      <BottomSheet visible={sheet} onClose={() => setSheet(false)} title={t.bookDetail.sheetTitle}>
        <AppText variant="body" color="textSecondary">
          {g.sampleBody}
        </AppText>
        <Button label={t.overlay.close} onPress={() => setSheet(false)} />
      </BottomSheet>
      <ConfirmDialog
        visible={dialog}
        destructive
        title={t.bookDetail.deleteTitle}
        message={g.sampleBody}
        confirmLabel={t.bookDetail.deleteConfirm}
        cancelLabel={t.bookDetail.cancel}
        onCancel={() => setDialog(false)}
        onConfirm={() => setDialog(false)}
      />
    </>
  );
}

function Gallery() {
  const router = useRouter();
  const { colors, mode, setMode } = useTheme();
  const [reading, setReading] = useState<ReadingStatus>('reading');
  const [chip, setChip] = useState<'novel' | 'essay' | 'poetry'>('novel');
  const [rating, setRating] = useState(3);
  const [query, setQuery] = useState<string>(g.sampleBooks[6].title);
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const openBook = (book: BookTileData) =>
    router.push({ pathname: '/book/[id]', params: { id: book.id } });

  return (
    <Screen scroll contentStyle={styles.content}>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel={t.common.back}
        style={styles.back}
      >
        <Icon name="chevron-left" size={sizes.iconLg} />
      </Pressable>
      <AppText variant="display" accessibilityRole="header">
        {g.title}
      </AppText>

      <Section title={g.themeSection}>
        <SegmentedControl
          options={themeOptions}
          value={mode}
          onChange={setMode}
          accessibilityLabel={g.themeSection}
        />
      </Section>

      <Section title={t.scan.devOutcomes.label}>
        <FakeIdentifierPicker />
      </Section>

      <Section title={t.scan.devOutcomes.suggestLabel}>
        <FakeSuggesterPicker />
      </Section>

      <Section title={t.scan.devOutcomes.recommendLabel}>
        <FakeRecommendPicker />
      </Section>

      <Section title={t.scan.devOutcomes.discoverLabel}>
        <FakeDiscoverPicker />
      </Section>

      <Section title={g.skiaSection}>
        <SkiaCheck />
      </Section>

      <Section title={g.overlaysSection}>
        <Overlays />
      </Section>

      <Section title={g.typographySection}>
        <AppText variant="display">{g.sampleDisplay}</AppText>
        <AppText variant="title">{g.sampleTitle}</AppText>
        <AppText variant="heading">{g.sampleHeading}</AppText>
        <AppText variant="body">{g.sampleBody}</AppText>
        <AppText variant="label">{g.sampleLabel}</AppText>
        <AppText variant="caption">{g.sampleCaption}</AppText>
        <AppText variant="italicNote">{g.sampleNote}</AppText>
      </Section>

      <Section title={g.buttonsSection}>
        <View style={styles.wrap}>
          <Button label={g.continueReading} />
          <Button variant="secondary" label={g.myPage} />
          <Button variant="link" label={g.seeAll} />
        </View>
        <View style={styles.wrap}>
          <Button variant="destructive" icon="trash" label={g.deleteBook} />
          <Button label={g.save} disabled />
          <Button icon="plus" label={g.add} />
        </View>
        <View style={styles.wrap}>
          <Button label={g.saving} loading />
          <Button variant="secondary" label={g.saving} loading />
          <Button variant="link" label={g.seeAll} disabled />
        </View>
      </Section>

      <Section title={g.fieldsSection}>
        <TextField label={g.fieldRest} placeholder={g.titlePlaceholder} />
        <TextField label={g.fieldFocusHint} defaultValue={g.titleValue} />
        <TextField label={g.fieldError} errorText={g.authorError} />
        <TextField
          label={g.fieldReview}
          defaultValue={g.pagesValue}
          review
          helperText={g.pagesReview}
        />
        <TextField label={g.notesLabel} defaultValue={g.sampleNote} multiline />
        <TextField label={g.passwordLabel} helperText={g.passwordHelper} secureTextEntry />
      </Section>

      <Section title={g.chipsSection}>
        <View style={styles.wrap}>
          <Chip label={g.chipNovel} selected={chip === 'novel'} onPress={() => setChip('novel')} />
          <Chip label={g.chipEssay} selected={chip === 'essay'} onPress={() => setChip('essay')} />
          <Chip
            label={g.chipPoetry}
            selected={chip === 'poetry'}
            onPress={() => setChip('poetry')}
          />
        </View>
      </Section>

      <Section title={g.segmentedSection}>
        <SegmentedControl options={readingOptions} value={reading} onChange={setReading} />
      </Section>

      <Section title={g.tagsSection}>
        <View style={styles.wrap}>
          {tagKinds.map((kind) => (
            <StatusTag key={kind} kind={kind} />
          ))}
        </View>
      </Section>

      <Section title={g.shelfSection}>
        <View style={[styles.shelfBox, { backgroundColor: colors.surface }]}>
          <ShelfLine />
        </View>
      </Section>

      <Section title={g.skeletonSection}>
        <Skeleton height={20} width="70%" />
        <Skeleton height={14} />
        <Skeleton height={96} width={64} radius={radii.tag} />
      </Section>

      <Section title={g.iconsSection}>
        <View style={styles.wrap}>
          {iconNames.map((name) => (
            <View key={name} style={styles.iconCell}>
              <Icon name={name} size={sizes.iconLg} />
            </View>
          ))}
        </View>
      </Section>

      <Section title={g.navigationSection}>
        <View style={styles.wrap}>
          <Button variant="secondary" label={g.openBook} onPress={() => openBook(sampleBooks[0])} />
          <Button
            variant="secondary"
            icon="scan"
            label={g.openScan}
            onPress={() => router.push('/scan')}
          />
        </View>
      </Section>

      <Section title={g.coversSection}>
        <View style={[styles.wrap, styles.covers]}>
          <BookCover title={sampleBooks[0].title} author={sampleBooks[0].author} size="xl" ribbon />
          <BookCover title={sampleBooks[1].title} author={sampleBooks[1].author} size="lg" />
          <BookCover title={sampleBooks[3].title} size="md" />
          <BookCover title={sampleBooks[7].title} size="md" lent />
          <BookCover title={sampleBooks[9].title} size="sm" />
        </View>
      </Section>

      <Section title={g.tilesSection}>
        <View style={[styles.wrap, styles.covers]}>
          {sampleBooks.slice(0, 3).map((book) => (
            <BookTile key={book.id} book={book} width={84} onPress={openBook} />
          ))}
        </View>
      </Section>

      <Section title={g.progressSection}>
        <ProgressBar percent={68} />
        <ProgressBar percent={0} />
        <ProgressBar percent={100} />
        <View style={styles.wrap}>
          <ProgressBar percent={68} variant="mini" />
        </View>
      </Section>

      <Section title={g.ratingSection}>
        <StarRating value={4} />
        <StarRating value={rating} onChange={setRating} />
        <StarRating value={null} />
      </Section>

      <Section title={g.searchSection}>
        <SearchField value="" onChangeText={() => {}} />
        <SearchField value={query} onChangeText={setQuery} />
      </Section>

      <Section title={g.filtersSection}>
        <FilterTabs value={filter} onChange={setFilter} inset={spacing.lg} />
      </Section>

      <Section title={g.gridSection}>
        <View style={styles.bleed}>
          <BookShelfGrid books={sampleBooks} onPressBook={openBook} virtualized={false} />
        </View>
      </Section>

      <Section title={g.emptySection}>
        <EmptyState
          eyebrow={t.emptyLibrary.eyebrow}
          title={t.emptyLibrary.title}
          description={t.emptyLibrary.text}
          primaryAction={{ label: t.emptyLibrary.scanFirst, icon: 'scan' }}
          secondaryAction={{ label: t.emptyLibrary.addManually }}
        />
      </Section>

      <Section title={g.paletteSection}>
        <Palette />
      </Section>
    </Screen>
  );
}

/** Component gallery and dev switches (development builds only; see src/app/dev-gallery.tsx). */
export function DevGallery() {
  return <Gallery />;
}

const styles = StyleSheet.create({
  content: { gap: spacing.xl, paddingBottom: spacing.xxxl },
  covers: { alignItems: 'flex-end', gap: spacing.lg, paddingTop: spacing.md },
  bleed: { marginHorizontal: -spacing.lg },
  back: {
    width: sizes.minTouchTarget,
    height: sizes.minTouchTarget,
    justifyContent: 'center',
    marginLeft: -spacing.sm,
  },
  section: { gap: spacing.md, borderTopWidth: sizes.borderWidth, paddingTop: spacing.lg },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'center' },
  shelfBox: {
    height: 80,
    borderRadius: radii.surface,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  iconCell: {
    width: sizes.minTouchTarget,
    height: sizes.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchItem: { width: 96, gap: spacing.xs },
  swatch: { height: 40, borderRadius: radii.field, borderWidth: sizes.borderWidth },
});
