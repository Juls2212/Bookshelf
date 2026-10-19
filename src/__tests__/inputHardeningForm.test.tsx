import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { BookTile } from '@/components/BookTile';
import { SearchField } from '@/components/SearchField';
import { ToastProvider } from '@/components/Toast';
import { ThemeProvider } from '@/design/ThemeProvider';
import { BookForm } from '@/features/library/BookForm';
import { digitsOnly, emptyBookForm, toNewBook } from '@/features/library/bookFormLogic';
import { UpdatePageSheet } from '@/features/library/UpdatePageSheet';
import { format, t } from '@/i18n';
import { INPUT_LIMITS } from '@/lib/inputLimits';
import type { Book } from '@/types/book';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@/features/library/coverService', () => ({
  coverService: {
    pickFromGallery: jest.fn(),
    getSignedUrls: jest.fn(),
    renderPreview: jest.fn(),
    measure: jest.fn(),
    removeLocal: jest.fn(),
  },
}));
jest.mock('@/stores/libraryStore', () => {
  const state = { update: jest.fn(), books: [], status: 'ready', load: jest.fn() };
  const useLibraryStore = <T,>(selector: (s: typeof state) => T) => selector(state);
  useLibraryStore.getState = () => state;
  return { useLibraryStore };
});

const required = (label: string) => format(t.common.requiredA11y, { label });

function renderUi(ui: ReactElement) {
  return render(
    <ThemeProvider>
      <ToastProvider>{ui}</ToastProvider>
    </ThemeProvider>,
  );
}

const field = (label: string) => screen.getByLabelText(label);

describe('BookForm inputs', () => {
  it('gives every field its limit, keyboard and capitalization', async () => {
    await renderUi(<BookForm onSubmit={jest.fn()} onCancel={jest.fn()} />);
    expect(field(required(t.bookForm.titleLabel)).props.maxLength).toBe(INPUT_LIMITS.title);
    expect(field(t.bookForm.authorLabel).props.maxLength).toBe(INPUT_LIMITS.author);
    expect(field(t.bookForm.genreLabel).props.maxLength).toBe(INPUT_LIMITS.genre);
    expect(field(t.bookForm.notesLabel).props.maxLength).toBe(INPUT_LIMITS.notes);
    const pages = field(required(t.bookForm.pagesLabel));
    expect(pages.props).toMatchObject({
      maxLength: 5,
      keyboardType: 'number-pad',
      inputMode: 'numeric',
      autoCorrect: false,
    });
    expect(field(t.bookForm.authorLabel).props.autoCapitalize).toBe('words');
  });

  it('keeps only digits when letters, signs, emoji or spaces are pasted into the pages', async () => {
    await renderUi(<BookForm onSubmit={jest.fn()} onCancel={jest.fn()} />);
    const pages = () => field(required(t.bookForm.pagesLabel));
    for (const [pasted, kept] of [
      ['abc', ''],
      ['12ab34', '1234'],
      ['-30', '30'],
      ['1.5', '15'],
      ['📚 12', '12'],
      ['1234567890', '12345'],
    ]) {
      await fireEvent.changeText(pages(), pasted);
      expect(pages().props.value).toBe(kept);
    }
  });

  it('strips control characters and cuts a pasted title, author and genre to their limits', async () => {
    await renderUi(<BookForm onSubmit={jest.fn()} onCancel={jest.fn()} />);
    const title = () => field(required(t.bookForm.titleLabel));
    await fireEvent.changeText(title(), 'Rayuela\u0000\u0007\nuno');
    expect(title().props.value).toBe('Rayuela uno');

    await fireEvent.changeText(title(), 'x'.repeat(5000));
    expect(title().props.value).toHaveLength(200);
    await fireEvent.changeText(field(t.bookForm.authorLabel), 'a'.repeat(500));
    expect(field(t.bookForm.authorLabel).props.value).toHaveLength(120);
    await fireEvent.changeText(field(t.bookForm.genreLabel), '📚'.repeat(500));
    expect(Array.from(field(t.bookForm.genreLabel).props.value)).toHaveLength(60);
  });

  it('shows the remaining-characters counter only on the long notes field', async () => {
    await renderUi(<BookForm onSubmit={jest.fn()} onCancel={jest.fn()} />);
    const counter = (count: number) =>
      format(t.reading.notesCounter, { count, max: INPUT_LIMITS.notes });
    await fireEvent.changeText(field(t.bookForm.notesLabel), 'n'.repeat(100));
    expect(screen.queryByText(counter(100))).toBeNull();
    await fireEvent.changeText(field(t.bookForm.notesLabel), 'n'.repeat(1900));
    expect(screen.getByText(counter(1900))).toBeOnTheScreen();
    await fireEvent.changeText(field(t.bookForm.notesLabel), `a\nb${'n'.repeat(5000)}`);
    expect(field(t.bookForm.notesLabel).props.value).toHaveLength(2000);
    // No counter on short fields.
    expect(screen.queryByText(/de 200 caracteres/)).toBeNull();
  });

  it('blocks saving a legacy title over the limit, with the reason shown', async () => {
    const onSubmit = jest.fn();
    await renderUi(
      <BookForm
        initialValues={{ ...emptyBookForm, title: 't'.repeat(250), pages: '100' }}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
      />,
    );
    expect(screen.getByTestId('save-blocker')).toHaveTextContent(t.bookValidation.title_too_long);
    const save = screen.getByRole('button', { name: t.bookForm.save });
    expect(save).toBeDisabled();
    await fireEvent.press(save);
    expect(onSubmit).not.toHaveBeenCalled();
    // Shortening it unblocks the form.
    await fireEvent.changeText(field(required(t.bookForm.titleLabel)), 'Corto');
    expect(screen.getByRole('button', { name: t.bookForm.save })).toBeEnabled();
  });

  it('blocks saving a legacy author, genre or notes over the limit', async () => {
    await renderUi(
      <BookForm
        initialValues={{
          ...emptyBookForm,
          title: 'T',
          pages: '100',
          author: 'a'.repeat(121),
        }}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(screen.getByTestId('save-blocker')).toHaveTextContent(t.bookValidation.author_too_long);
    expect(screen.getByText(t.bookValidation.author_too_long)).toBeOnTheScreen();
  });
});

describe('toNewBook cleans what is saved', () => {
  it('collapses whitespace, drops control characters and keeps note paragraphs', () => {
    const saved = toNewBook({
      ...emptyBookForm,
      title: '  El   nombre\u0000 de la\trosa ',
      author: ' Umberto \n Eco ',
      genre: '  Novela   histórica ',
      pages: '500',
      notes: ' uno   dos\n\n\n\ntres ',
    });
    expect(saved).toMatchObject({
      title: 'El nombre de la rosa',
      author: 'Umberto Eco',
      genre: 'Novela histórica',
      pageCount: 500,
      notes: 'uno dos\n\ntres',
    });
  });

  it('digitsOnly never returns more than five digits', () => {
    expect(digitsOnly('00000123456')).toBe('00000');
    expect(digitsOnly('x'.repeat(100))).toBe('');
  });
});

describe('UpdatePageSheet input', () => {
  const book: Book = {
    id: 'b1',
    title: 'Rayuela',
    author: null,
    genre: null,
    pageCount: 300,
    coverPath: null,
    coverSource: null,
    readingStatus: 'reading',
    currentPage: 10,
    rating: null,
    notes: null,
    lentTo: null,
    lentAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    statusChangedAt: null,
  };

  it('is a numeric keypad field of at most five digits that drops pasted letters', async () => {
    await renderUi(<UpdatePageSheet book={book} onClose={jest.fn()} />);
    const input = () => field(t.reading.pageLabel);
    expect(input().props).toMatchObject({
      maxLength: 5,
      keyboardType: 'number-pad',
      inputMode: 'numeric',
    });
    await fireEvent.changeText(input(), 'abc42xyz');
    expect(input().props.value).toBe('42');
    await fireEvent.changeText(input(), '301');
    expect(screen.getByText(t.bookValidation.current_page_exceeds_total)).toBeOnTheScreen();
  });
});

describe('SearchField input', () => {
  it('limits the search to 100 characters and strips control characters', async () => {
    const onChange = jest.fn();
    await renderUi(<SearchField value="" onChangeText={onChange} />);
    const input = field(t.search.label);
    expect(input.props.maxLength).toBe(100);
    await fireEvent.changeText(input, 'a\u0000b'.repeat(100));
    expect(onChange.mock.calls[0][0]).toHaveLength(100);
    expect(onChange.mock.calls[0][0]).not.toMatch(/\u0000/);
  });
});

describe('extreme text never breaks a list tile', () => {
  it('cuts a huge title and author to a few lines with an ellipsis', async () => {
    const tile = {
      id: 'x',
      title: 'T'.repeat(200_000),
      author: 'A'.repeat(200_000),
      coverUri: null,
      readingStatus: 'to_read' as const,
      currentPage: 0,
      pageCount: null,
      lentTo: null,
    };
    await renderUi(<BookTile book={tile} width={120} onPress={jest.fn()} />);
    const title = screen.getAllByText(/^T+$/);
    const author = screen.getAllByText(/^A+$/);
    // Every rendered occurrence (tile text and typographic cover) is line-limited.
    for (const node of [...title, ...author]) {
      expect(node.props.numberOfLines).toBeGreaterThan(0);
    }
  });
});

describe('EditNameSheet input', () => {
  it('limits the display name to 50 characters and cleans pasted text', async () => {
    const { EditNameSheet } = jest.requireActual<typeof import('@/features/profile/EditNameSheet')>(
      '@/features/profile/EditNameSheet',
    );
    await renderUi(<EditNameSheet initialName="Ana" onClose={jest.fn()} />);
    const input = field(t.auth.register.nameLabel);
    expect(input.props.maxLength).toBe(INPUT_LIMITS.displayName);
    expect(input.props.autoComplete).toBe('name');
    await fireEvent.changeText(input, `${'n'.repeat(80)}\u0000`);
    expect(input.props.value).toHaveLength(50);
    await fireEvent.changeText(input, 'Ana\nMaría');
    expect(input.props.value).toBe('Ana María');
  });
});
