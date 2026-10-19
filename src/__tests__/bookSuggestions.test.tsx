// "Sugerir datos" in the book form: optional proposals that never overwrite typed values.
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ToastProvider } from '@/components/Toast';
import { ThemeProvider } from '@/design/ThemeProvider';
import { BookForm } from '@/features/library/BookForm';
import { emptyBookForm, type BookFormValues } from '@/features/library/bookFormLogic';
import type { FakeSuggestOutcome } from '@/features/suggestions/fakeBookSuggester';
import { bookSuggester, useFakeSuggesterStore } from '@/features/suggestions/suggesterFactory';
import { format, t } from '@/i18n';
import { deviceNetwork } from '@/lib/network';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('@/features/library/coverService', () => ({
  coverService: { pickFromGallery: jest.fn(), renderPreview: jest.fn(), measure: jest.fn() },
}));

const s = t.suggestions;
const required = (label: string) => format(t.common.requiredA11y, { label });
const titleField = () => screen.getByLabelText(required(t.bookForm.titleLabel));
const pagesField = () => screen.getByLabelText(required(t.bookForm.pagesLabel));
const useLabel = (field: keyof typeof s.fields, value: string) =>
  format(s.useA11y, { field: s.fields[field], value });

let suggest: jest.SpyInstance;
let onSubmit: jest.Mock;

async function renderForm(
  initialValues: Partial<BookFormValues> = {},
  { allowSuggestions = true, outcome = 'success' as FakeSuggestOutcome } = {},
) {
  useFakeSuggesterStore.setState({ fakeEnabled: true, outcome, delayMs: 0 });
  await render(
    <ThemeProvider>
      <ToastProvider>
        <BookForm
          allowSuggestions={allowSuggestions}
          initialValues={{ ...emptyBookForm, ...initialValues }}
          onSubmit={onSubmit}
          onCancel={jest.fn()}
        />
      </ToastProvider>
    </ThemeProvider>,
  );
}

async function askFor(initialValues: Partial<BookFormValues> = {}, outcome?: FakeSuggestOutcome) {
  await renderForm({ title: 'Cartas a nadie', ...initialValues }, { outcome });
  await fireEvent.press(screen.getByRole('button', { name: s.ask }));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(deviceNetwork, 'isOnline').mockResolvedValue(true);
  suggest = jest.spyOn(bookSuggester, 'suggest');
  onSubmit = jest.fn(async () => ({ ok: true as const }));
});

afterEach(() => suggest.mockRestore());

describe('asking for suggestions', () => {
  it('shows the button only from 3 characters and never calls while typing', async () => {
    await renderForm();
    expect(screen.queryByRole('button', { name: s.ask })).toBeNull();
    await fireEvent.changeText(titleField(), 'Ca');
    expect(screen.queryByRole('button', { name: s.ask })).toBeNull();
    await fireEvent.changeText(titleField(), 'Car');
    await fireEvent.changeText(titleField(), 'Cartas a nadie');
    expect(screen.getByRole('button', { name: s.ask })).toBeOnTheScreen();
    expect(suggest).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: s.ask }));
    expect(await screen.findByTestId('suggestion-panel')).toBeOnTheScreen();
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest).toHaveBeenCalledWith(
      { title: 'Cartas a nadie', author: null },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('is not offered when editing a book', async () => {
    await renderForm({ title: 'Cartas a nadie' }, { allowSuggestions: false });
    expect(screen.queryByRole('button', { name: s.ask })).toBeNull();
  });

  it('offline: the button is disabled with a hint and nothing is requested', async () => {
    jest.spyOn(deviceNetwork, 'isOnline').mockResolvedValue(false);
    await renderForm({ title: 'Cartas a nadie' });
    expect(await screen.findByText(s.offline)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: s.ask })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: s.ask }));
    expect(suggest).not.toHaveBeenCalled();
  });

  it('shows the loading state while waiting', async () => {
    await askFor({}, 'hang');
    expect(screen.getByText(s.loading)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: s.ask })).toBeDisabled();
  });
});

describe('proposals', () => {
  it('only for empty fields: typed values are never overwritten', async () => {
    await askFor({ author: 'Mi autor' });
    await screen.findByTestId('suggestion-panel');
    expect(screen.queryByTestId('suggestion-author')).toBeNull();
    expect(screen.getByTestId('suggestion-genre')).toBeOnTheScreen();
    expect(screen.getByTestId('suggestion-pages')).toBeOnTheScreen();
    expect(screen.getByText(s.pagesHint)).toBeOnTheScreen();
    // Nothing is filled until the user accepts.
    expect(pagesField().props.value).toBe('');

    await fireEvent.press(screen.getByRole('button', { name: s.useAll }));
    expect(screen.getByDisplayValue('Mi autor')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Novela')).toBeOnTheScreen();
    expect(pagesField().props.value).toBe('248');
    expect(screen.getByText(s.nothingLeft)).toBeOnTheScreen();
  });

  describe('official title', () => {
    const official = {
      title: 'Cartas a nadie',
      canonicalTitle: 'Cartas a nadie: novela',
      author: 'Julián Rueda',
      genre: 'Novela',
      pageCount: 248,
    };
    beforeEach(() => suggest.mockResolvedValue([official]));

    it('is offered as its own row and never applied by itself or by "Usar todo"', async () => {
      await askFor();
      await screen.findByTestId('suggestion-panel');
      expect(screen.getByTestId('suggestion-title')).toBeOnTheScreen();
      expect(screen.getByText('Cartas a nadie: novela')).toBeOnTheScreen();
      expect(titleField().props.value).toBe('Cartas a nadie');
      await fireEvent.press(screen.getByRole('button', { name: s.useAll }));
      expect(titleField().props.value).toBe('Cartas a nadie');
      expect(pagesField().props.value).toBe('248');
      expect(screen.getByTestId('suggestion-title')).toBeOnTheScreen();
    });

    it('"Usar" replaces the typed title, and the row disappears', async () => {
      await askFor();
      await screen.findByTestId('suggestion-panel');
      await fireEvent.press(
        screen.getByRole('button', { name: useLabel('title', 'Cartas a nadie: novela') }),
      );
      expect(titleField().props.value).toBe('Cartas a nadie: novela');
      expect(screen.queryByTestId('suggestion-title')).toBeNull();
    });

    it('"Descartar" keeps the typed title', async () => {
      await askFor();
      await screen.findByTestId('suggestion-panel');
      await fireEvent.press(
        screen.getByRole('button', { name: format(s.dismissA11y, { field: s.fields.title }) }),
      );
      expect(titleField().props.value).toBe('Cartas a nadie');
      expect(screen.queryByTestId('suggestion-title')).toBeNull();
    });

    it('typing in the title after asking drops the proposal', async () => {
      await askFor();
      await screen.findByTestId('suggestion-panel');
      await fireEvent.changeText(titleField(), 'Cartas a nadie 2');
      expect(screen.queryByTestId('suggestion-title')).toBeNull();
      expect(titleField().props.value).toBe('Cartas a nadie 2');
    });
  });

  it('accepts one proposal; the value stays editable', async () => {
    await askFor();
    await screen.findByTestId('suggestion-panel');
    await fireEvent.press(screen.getByRole('button', { name: useLabel('genre', 'Novela') }));
    expect(screen.getByDisplayValue('Novela')).toBeOnTheScreen();
    expect(screen.queryByTestId('suggestion-genre')).toBeNull();
    // The others are still pending and untouched.
    expect(screen.getByTestId('suggestion-author')).toBeOnTheScreen();
    expect(screen.queryByDisplayValue('Julián Rueda')).toBeNull();

    await fireEvent.changeText(screen.getByDisplayValue('Novela'), 'Novela corta');
    expect(screen.getByDisplayValue('Novela corta')).toBeOnTheScreen();
  });

  it('dismisses one proposal, or all of them', async () => {
    await askFor();
    await screen.findByTestId('suggestion-panel');
    await fireEvent.press(
      screen.getByRole('button', { name: format(s.dismissA11y, { field: s.fields.author }) }),
    );
    expect(screen.queryByTestId('suggestion-author')).toBeNull();
    expect(screen.queryByDisplayValue('Julián Rueda')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: s.dismissAll }));
    expect(screen.queryByTestId('suggestion-panel')).toBeNull();
    expect(pagesField().props.value).toBe('');
  });

  it('typing in a field drops its pending proposal', async () => {
    await askFor();
    await screen.findByTestId('suggestion-panel');
    await fireEvent.changeText(pagesField(), '3');
    expect(screen.queryByTestId('suggestion-pages')).toBeNull();
    // Clearing the field does not bring it back.
    await fireEvent.changeText(pagesField(), '');
    expect(screen.queryByTestId('suggestion-pages')).toBeNull();
    expect(screen.getByTestId('suggestion-genre')).toBeOnTheScreen();
  });

  it('proposes the title only when it differs in accents or capitalization', async () => {
    await askFor({ title: 'cartas a NADIE' });
    await screen.findByTestId('suggestion-panel');
    expect(screen.getByTestId('suggestion-title')).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByRole('button', { name: useLabel('title', 'Cartas a nadie') }),
    );
    expect(titleField().props.value).toBe('Cartas a nadie');
  });

  it('switches to another candidate from "Otras opciones"', async () => {
    await askFor();
    await screen.findByTestId('suggestion-panel');
    expect(screen.getByText(format(s.pagesValue, { pages: 248 }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: s.otherOptions }));
    expect(screen.getByText(s.otherOptionsTitle)).toBeOnTheScreen();
    expect(
      screen.getByRole('radio', {
        name: format(s.optionA11y, { title: 'Cartas a nadie', author: 'Julián Rueda' }),
      }),
    ).toBeChecked();
    await fireEvent.press(
      screen.getByRole('radio', {
        name: format(s.optionA11y, {
          title: 'Cartas sin nadie',
          author: 'Marta Ossa',
        }),
      }),
    );
    expect(
      screen.getByText(
        format(s.candidateWithAuthor, { title: 'Cartas sin nadie', author: 'Marta Ossa' }),
      ),
    ).toBeOnTheScreen();
    // That candidate has no page count: no pages proposal.
    expect(screen.queryByTestId('suggestion-pages')).toBeNull();
    expect(screen.getByRole('button', { name: useLabel('genre', 'Poesía') })).toBeOnTheScreen();
  });

  it('a single candidate has no "Otras opciones"', async () => {
    await askFor({}, 'single');
    await screen.findByTestId('suggestion-panel');
    expect(screen.queryByRole('button', { name: s.otherOptions })).toBeNull();
  });

  it('saving uses only what is in the fields', async () => {
    await askFor({ pages: '100' });
    await screen.findByTestId('suggestion-panel');
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Cartas a nadie', author: '', genre: '', pages: '100' }),
      null,
    );
  });
});

describe('failures', () => {
  it.each([
    ['no_suggestions', s.errors.no_suggestions],
    ['rate_limited', s.errors.rate_limited],
    ['unauthorized', s.errors.unauthorized],
  ] as const)('%s shows its message without "Reintentar"', async (outcome, message) => {
    await askFor({}, outcome);
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: s.retry })).toBeNull();
  });

  it.each(['network', 'timeout'] as const)(
    '%s offers "Reintentar", which asks again',
    async (code) => {
      await askFor({}, code);
      expect(await screen.findByText(s.errors[code])).toBeOnTheScreen();
      useFakeSuggesterStore.setState({ outcome: 'success' });
      await fireEvent.press(screen.getByRole('button', { name: s.retry }));
      expect(await screen.findByTestId('suggestion-panel')).toBeOnTheScreen();
      expect(suggest).toHaveBeenCalledTimes(2);
    },
  );

  it('losing the connection before the request shows the network message', async () => {
    await renderForm({ title: 'Cartas a nadie' });
    jest.spyOn(deviceNetwork, 'isOnline').mockResolvedValue(false);
    await fireEvent.press(screen.getByRole('button', { name: s.ask }));
    expect(await screen.findByText(s.errors.network)).toBeOnTheScreen();
    expect(suggest).not.toHaveBeenCalled();
  });
});
