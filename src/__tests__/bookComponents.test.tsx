import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import type { BookTileData } from '@/components/BookTile';
import { BookTile } from '@/components/BookTile';
import { FilterTabs } from '@/components/FilterTabs';
import { ThemeProvider } from '@/design/ThemeProvider';
import { format, t } from '@/i18n';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function renderThemed(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

// Cover and progress row are hidden from screen readers; the tile label describes them.
const HIDDEN = { includeHiddenElements: true };

const book: BookTileData = {
  id: 'b1',
  title: 'Title under test',
  author: 'Author under test',
  coverUri: null,
  readingStatus: 'reading',
  currentPage: 214,
  pageCount: 312,
  lentTo: null,
};

describe('BookTile', () => {
  it('renders title, author and progress, and reports presses', async () => {
    const onPress = jest.fn();
    await renderThemed(<BookTile book={book} width={80} onPress={onPress} />);

    expect(screen.getAllByText(book.title).length).toBeGreaterThan(0);
    expect(screen.getAllByText(book.author ?? '').length).toBeGreaterThan(0);
    expect(
      screen.getByText(format(t.book.progressShort, { percent: 69 }), HIDDEN),
    ).toBeOnTheScreen();

    const tile = screen.getByRole('button', {
      name: `${format(t.book.tileA11y, { title: book.title, author: book.author ?? '' })}, ${format(
        t.book.progressA11y,
        { percent: 69 },
      )}`,
    });
    await fireEvent.press(tile);
    expect(onPress).toHaveBeenCalledWith(book);
  });

  it('shows the lent tag and hides progress for other statuses', async () => {
    await renderThemed(
      <BookTile book={{ ...book, readingStatus: 'to_read', lentTo: 'Ana' }} width={80} />,
    );
    expect(screen.getByText(t.statusTag.lent, HIDDEN)).toBeOnTheScreen();
    expect(screen.getByRole('button').props.accessibilityLabel).toContain(t.statusTag.lent);
    expect(screen.queryByText(format(t.book.progressShort, { percent: 69 }), HIDDEN)).toBeNull();
  });
});

describe('FilterTabs', () => {
  it('marks the active tab and reports the selected filter', async () => {
    const onChange = jest.fn();
    await renderThemed(<FilterTabs value="all" onChange={onChange} />);

    expect(screen.getByRole('tab', { name: t.filters.all })).toBeSelected();
    expect(screen.getByRole('tab', { name: t.filters.lent })).not.toBeSelected();

    await fireEvent.press(screen.getByRole('tab', { name: t.filters.to_read }));
    expect(onChange).toHaveBeenCalledWith('to_read');
  });
});
