// "Portada sugerida": client rules, the download checks, the card and the form integration.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { ToastProvider } from '@/components/Toast';
import { ThemeProvider } from '@/design/ThemeProvider';
import { BookForm } from '@/features/library/BookForm';
import { emptyBookForm } from '@/features/library/bookFormLogic';
import { createCoverFinder, type CoverFinder } from '@/features/library/coverFinder';
import type { LocalImage } from '@/features/library/coverService';
import {
  coverExtensionFor,
  isAllowedCoverUrl,
  isUsableCoverSize,
  shouldSuggestCover,
  toCoverCandidates,
  type CoverCandidate,
} from '@/features/library/coverSuggestion';
import { CoverSuggestionCard, CoverSuggestionStatus } from '@/features/library/CoverSuggestionCard';
import { useCoverSuggestion } from '@/features/library/useCoverSuggestion';
import { format, t } from '@/i18n';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));

const c = t.bookForm.coverSuggestion;
const required = (label: string) => format(t.common.requiredA11y, { label });

const candidate = (n: number, source: CoverCandidate['source'] = 'open_library') => ({
  imageUrl: `https://covers.openlibrary.org/b/id/${n}-L.jpg?default=false`,
  source,
  title: `Libro ${n}`,
  author: null,
});
const image = (n: number): LocalImage => ({
  uri: `file:///cache/suggested-covers/cover_${n}.jpg`,
  width: 300,
  height: 450,
  source: 'gallery',
});

describe('client rules', () => {
  it('re-validates the allowlist and the content type', () => {
    expect(isAllowedCoverUrl('https://books.googleusercontent.com/x.jpg')).toBe(true);
    expect(isAllowedCoverUrl('http://books.google.com/x')).toBe(false);
    expect(isAllowedCoverUrl('https://evil.example/x.jpg')).toBe(false);
    expect(coverExtensionFor('image/jpeg; charset=binary')).toBe('jpg');
    expect(coverExtensionFor('image/webp')).toBe('webp');
    expect(coverExtensionFor('text/html')).toBeNull();
    expect(coverExtensionFor(null)).toBeNull();
  });

  it('rejects tiny placeholder images (below 100 px)', () => {
    expect(isUsableCoverSize({ width: 1, height: 1 })).toBe(false);
    expect(isUsableCoverSize({ width: 128, height: 99 })).toBe(false);
    expect(isUsableCoverSize({ width: 100, height: 150 })).toBe(true);
  });

  it('only suggests without a cover, before "No, gracias", with a real title', () => {
    const base = { enabled: true, hasCover: false, dismissed: false, title: 'Rayuela' };
    expect(shouldSuggestCover(base)).toBe(true);
    expect(shouldSuggestCover({ ...base, hasCover: true })).toBe(false);
    expect(shouldSuggestCover({ ...base, dismissed: true })).toBe(false);
    expect(shouldSuggestCover({ ...base, enabled: false })).toBe(false);
    expect(shouldSuggestCover({ ...base, title: ' ab ' })).toBe(false);
  });

  it('keeps only valid, allowlisted candidates from the function (max 10)', () => {
    const body = {
      data: {
        candidates: [
          { image_url: 'https://covers.openlibrary.org/b/id/1-L.jpg', source: 'open_library' },
          { image_url: 'https://evil.example/x.jpg', source: 'open_library' },
          { image_url: 'https://books.google.com/a', source: 'other' },
          { image_url: 'https://books.google.com/b', source: 'google_books', title: ' T ' },
          { image_url: 'https://books.google.com/c', source: 'google_books' },
          { image_url: 'https://books.google.com/d', source: 'google_books' },
        ],
      },
    };
    expect(toCoverCandidates(body).map((x) => x.imageUrl)).toEqual([
      'https://covers.openlibrary.org/b/id/1-L.jpg',
      'https://books.google.com/b',
      'https://books.google.com/c',
      'https://books.google.com/d',
    ]);
    const many = {
      data: {
        candidates: Array.from({ length: 14 }, (_, i) => ({
          image_url: `https://covers.openlibrary.org/b/id/${i + 1}-L.jpg`,
          source: 'open_library',
        })),
      },
    };
    expect(toCoverCandidates(many)).toHaveLength(10);
    expect(toCoverCandidates(body)[1].title).toBe('T');
    expect(toCoverCandidates(null)).toEqual([]);
  });
});

describe('finder', () => {
  const response = ({
    ok = true,
    type = 'image/jpeg',
    bytes = 2048,
    length,
    url = 'https://covers.openlibrary.org/b/id/1-L.jpg',
  }: { ok?: boolean; type?: string; bytes?: number; length?: number; url?: string } = {}) =>
    ({
      ok,
      url,
      headers: {
        get: (name: string) =>
          name === 'content-type'
            ? type
            : name === 'content-length'
              ? String(length ?? bytes)
              : null,
      },
      arrayBuffer: async () => new ArrayBuffer(bytes),
    }) as unknown as Response;

  const setup = (res: Response, size = { width: 300, height: 450 }) => {
    const files = { write: jest.fn(() => 'file:///cache/c.jpg'), remove: jest.fn() };
    const finder = createCoverFinder({
      getClient: () => ({ functions: { invoke: jest.fn() } }) as never,
      fetchImpl: jest.fn(async () => res),
      files,
      covers: { measure: jest.fn(async () => ({ ok: true as const, data: size })) },
    });
    return { finder, files };
  };

  it('downloads an accepted cover as a picked image for the normal pipeline', async () => {
    const { finder, files } = setup(response());
    await expect(finder.download(candidate(1))).resolves.toEqual({
      uri: 'file:///cache/c.jpg',
      width: 300,
      height: 450,
      source: 'gallery',
    });
    expect(files.write).toHaveBeenCalledWith(expect.any(Uint8Array), 'jpg');
  });

  it('rejects placeholders, wrong types, huge files, failed requests and foreign redirects', async () => {
    const tiny = setup(response(), { width: 1, height: 1 });
    await expect(tiny.finder.download(candidate(1))).resolves.toBeNull();
    expect(tiny.files.remove).toHaveBeenCalledWith('file:///cache/c.jpg');
    for (const res of [
      response({ type: 'text/html' }),
      response({ length: 6 * 1024 * 1024 }),
      response({ bytes: 0 }),
      response({ ok: false }),
      response({ url: 'https://evil.example/x.jpg' }),
    ]) {
      const { finder, files } = setup(res);
      await expect(finder.download(candidate(1))).resolves.toBeNull();
      expect(files.write).not.toHaveBeenCalled();
    }
    const { finder } = setup(response());
    await expect(
      finder.download({ ...candidate(1), imageUrl: 'https://evil.example/x.jpg' }),
    ).resolves.toBeNull();
  });

  it('find: failures are null (silent), "nothing found" is [], candidates are parsed', async () => {
    const invoke = jest
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error('429') })
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      // Wrong shape (no data wrapper): treated as a failure, not as "nothing found".
      .mockResolvedValueOnce({ data: { candidates: [] }, error: null })
      .mockResolvedValueOnce({ data: { data: { candidates: [] } }, error: null })
      .mockResolvedValueOnce({
        data: {
          data: { candidates: [{ image_url: candidate(7).imageUrl, source: 'open_library' }] },
        },
        error: null,
      });
    const finder = createCoverFinder({ getClient: () => ({ functions: { invoke } }) as never });
    const query = { title: 'Rayuela', author: null };
    await expect(finder.find(query)).resolves.toBeNull();
    await expect(finder.find(query)).resolves.toBeNull();
    await expect(finder.find(query)).resolves.toBeNull();
    await expect(finder.find(query)).resolves.toEqual([]);
    await expect(finder.find(query)).resolves.toMatchObject([{ imageUrl: candidate(7).imageUrl }]);
    expect(invoke).toHaveBeenCalledWith('find-cover', {
      body: { title: 'Rayuela' },
      signal: expect.any(Object),
    });
  });
});

function fakeFinder(candidates: CoverCandidate[], images: (LocalImage | null)[] = [image(1)]) {
  const find = jest.fn<ReturnType<CoverFinder['find']>, Parameters<CoverFinder['find']>>(
    async () => candidates as CoverCandidate[] | null,
  );
  const download = jest.fn<
    ReturnType<CoverFinder['download']>,
    Parameters<CoverFinder['download']>
  >(async () => images.shift() ?? null);
  return { find, download };
}

/** The hook and the card as the form uses them, with the inputs under test control. */
function Harness({
  finder,
  online = true,
  hasCover = false,
  onAccept = () => undefined,
}: {
  finder: CoverFinder;
  online?: boolean;
  hasCover?: boolean;
  onAccept?: (image: LocalImage) => void;
}) {
  const [title, setTitle] = useState('');
  const suggestion = useCoverSuggestion({
    enabled: true,
    title,
    author: '',
    hasCover,
    onAccept,
    finder,
    network: { isOnline: async () => online },
  });
  return (
    <ThemeProvider>
      <ToastProvider>
        <TitleInput onChange={setTitle} />
        <CoverSuggestionCard suggestion={suggestion} title={title} />
      </ToastProvider>
    </ThemeProvider>
  );
}

function TitleInput({ onChange }: { onChange: (text: string) => void }) {
  const { TextInput } = jest.requireActual<typeof import('react-native')>('react-native');
  return <TextInput testID="title" onChangeText={onChange} />;
}

const typeTitle = async (text: string) => {
  await fireEvent.changeText(screen.getByTestId('title'), text);
};
const afterPause = () =>
  act(async () => {
    jest.advanceTimersByTime(800);
  });

describe('"Portada sugerida" card', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('appears after a pause in typing, with its source', async () => {
    const finder = fakeFinder([candidate(1), candidate(2, 'google_books')]);
    await render(<Harness finder={finder} />);
    await typeTitle('Rayuela');
    expect(finder.find).not.toHaveBeenCalled();
    await afterPause();
    expect(finder.find).toHaveBeenCalledWith(
      { title: 'Rayuela', author: null },
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    expect(await screen.findByText(c.title)).toBeOnTheScreen();
    expect(
      screen.getByText(format(c.source, { source: c.sources.open_library })),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText(format(c.imageA11y, { title: 'Libro 1' }))).toBeOnTheScreen();
    // The strip selects another candidate.
    await fireEvent.press(
      screen.getByLabelText(format(c.thumbnailA11y, { position: 2, total: 2 })),
    );
    expect(
      screen.getByText(format(c.source, { source: c.sources.google_books })),
    ).toBeOnTheScreen();
  });

  it('"No, gracias" hides it for good in this form', async () => {
    const finder = fakeFinder([candidate(1)]);
    await render(<Harness finder={finder} />);
    await typeTitle('Rayuela');
    await afterPause();
    await fireEvent.press(await screen.findByRole('button', { name: c.decline }));
    expect(screen.queryByTestId('cover-suggestion')).toBeNull();
    await typeTitle('Rayuela 2');
    await afterPause();
    expect(finder.find).toHaveBeenCalledTimes(1);
    expect(finder.download).not.toHaveBeenCalled();
  });

  it('"Usar esta portada" hands the downloaded image to the form', async () => {
    const finder = fakeFinder([candidate(1)]);
    const onAccept = jest.fn();
    await render(<Harness finder={finder} onAccept={onAccept} />);
    await typeTitle('Rayuela');
    await afterPause();
    await fireEvent.press(await screen.findByRole('button', { name: c.accept }));
    expect(finder.download).toHaveBeenCalledWith(candidate(1));
    expect(onAccept).toHaveBeenCalledWith(image(1));
    expect(screen.queryByTestId('cover-suggestion')).toBeNull();
  });

  it('a failed download keeps the same candidate with an error; retry or pick another', async () => {
    const finder = fakeFinder([candidate(1), candidate(2)], [null, image(1)]);
    const onAccept = jest.fn();
    await render(<Harness finder={finder} onAccept={onAccept} />);
    await typeTitle('Rayuela');
    await afterPause();
    await fireEvent.press(await screen.findByRole('button', { name: c.accept }));
    // Same candidate, a clear error and a retry; never skipped to the next one.
    expect(screen.getByLabelText(format(c.imageA11y, { title: 'Libro 1' }))).toBeOnTheScreen();
    expect(screen.getByTestId('cover-suggestion-error')).toHaveTextContent(c.downloadFailed);
    expect(onAccept).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: c.retry }));
    expect(finder.download).toHaveBeenLastCalledWith(candidate(1));
    expect(onAccept).toHaveBeenCalledWith(image(1));
    expect(screen.queryByTestId('cover-suggestion')).toBeNull();
  });

  it('after a failure, picking another thumbnail moves on (and clears the error)', async () => {
    const finder = fakeFinder([candidate(1), candidate(2)], [null]);
    await render(<Harness finder={finder} />);
    await typeTitle('Rayuela');
    await afterPause();
    await fireEvent.press(await screen.findByRole('button', { name: c.accept }));
    expect(screen.getByTestId('cover-suggestion-error')).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByLabelText(format(c.thumbnailA11y, { position: 2, total: 2 })),
    );
    expect(screen.getByLabelText(format(c.imageA11y, { title: 'Libro 2' }))).toBeOnTheScreen();
    expect(screen.queryByTestId('cover-suggestion-error')).toBeNull();
    expect(screen.getByRole('button', { name: c.accept })).toBeOnTheScreen();
  });

  it('a strip of up to ten thumbnails selects the candidate that "Usar esta portada" applies', async () => {
    const list = Array.from({ length: 10 }, (_, i) => candidate(i + 1));
    const finder = fakeFinder(list);
    const onAccept = jest.fn();
    await render(<Harness finder={finder} onAccept={onAccept} />);
    await typeTitle('Rayuela');
    await afterPause();
    expect(await screen.findByTestId('cover-suggestion-strip')).toBeOnTheScreen();
    expect(
      screen.getByLabelText(format(c.thumbnailA11y, { position: 1, total: 10 })),
    ).toBeOnTheScreen();
    await fireEvent.press(
      screen.getByLabelText(format(c.thumbnailA11y, { position: 4, total: 10 })),
    );
    expect(screen.getByLabelText(format(c.imageA11y, { title: 'Libro 4' }))).toBeOnTheScreen();
    expect(
      screen.getByLabelText(format(c.thumbnailA11y, { position: 4, total: 10 })).props
        .accessibilityState,
    ).toMatchObject({ selected: true });
    await fireEvent.press(screen.getByRole('button', { name: c.accept }));
    expect(finder.download).toHaveBeenCalledWith(list[3]);
  });

  it('thumbnails are touch targets of at least 44 and a failing one is hidden', async () => {
    const finder = fakeFinder([candidate(1), candidate(2), candidate(3)]);
    await render(<Harness finder={finder} />);
    await typeTitle('Rayuela');
    await afterPause();
    const thumb = await screen.findByTestId('cover-suggestion-thumb-1');
    const style = StyleSheet.flatten(thumb.props.style);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    await fireEvent(screen.getByTestId('cover-suggestion-thumb-image-1'), 'error', {
      nativeEvent: {},
    });
    expect(screen.queryByTestId('cover-suggestion-thumb-1')).toBeNull();
    // The labels count what is still shown.
    expect(
      screen.getByLabelText(format(c.thumbnailA11y, { position: 2, total: 2 })),
    ).toBeOnTheScreen();
    await fireEvent(screen.getByTestId('cover-suggestion-thumb-image-2'), 'error', {
      nativeEvent: {},
    });
    // A single candidate left: no strip.
    expect(screen.queryByTestId('cover-suggestion-strip')).toBeNull();
  });

  it('a single candidate shows no strip', async () => {
    await render(<Harness finder={fakeFinder([candidate(1)])} />);
    await typeTitle('Rayuela');
    await afterPause();
    await screen.findByTestId('cover-suggestion');
    expect(screen.queryByTestId('cover-suggestion-strip')).toBeNull();
  });

  it('never asks when the book already has a cover', async () => {
    const finder = fakeFinder([candidate(1)]);
    await render(<Harness finder={finder} hasCover />);
    await typeTitle('Rayuela');
    await afterPause();
    expect(finder.find).not.toHaveBeenCalled();
    expect(screen.queryByTestId('cover-suggestion')).toBeNull();
  });

  it('offline: silent (no request, nothing shown)', async () => {
    const finder = fakeFinder([candidate(1)]);
    await render(<Harness finder={finder} online={false} />);
    await typeTitle('Rayuela');
    await afterPause();
    expect(finder.find).not.toHaveBeenCalled();
    expect(screen.queryByTestId('cover-suggestion')).toBeNull();
  });

  it('typing again cancels the request in flight; its late answer is ignored', async () => {
    let resolveFirst: (value: CoverCandidate[]) => void = () => undefined;
    const finder = fakeFinder([candidate(2)]);
    finder.find.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    await render(<Harness finder={finder} />);
    await typeTitle('Rayu');
    await afterPause();
    const firstSignal = finder.find.mock.calls[0][1]?.signal;
    await typeTitle('Rayuela');
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => resolveFirst([candidate(1)]));
    expect(screen.queryByTestId('cover-suggestion')).toBeNull();
    await afterPause();
    expect(
      await screen.findByLabelText(format(c.imageA11y, { title: 'Libro 2' })),
    ).toBeOnTheScreen();
  });
});

describe('search feedback under the title', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** The status line as the form shows it, plus the card. */
  function StatusHarness({
    finder,
    online = true,
    author = '',
  }: {
    finder: CoverFinder;
    online?: boolean;
    author?: string;
  }) {
    const [title, setTitle] = useState('');
    const suggestion = useCoverSuggestion({
      enabled: true,
      title,
      author,
      hasCover: false,
      onAccept: () => undefined,
      finder,
      network: { isOnline: async () => online },
    });
    return (
      <ThemeProvider>
        <TitleInput onChange={setTitle} />
        <CoverSuggestionStatus suggestion={suggestion} />
        <CoverSuggestionCard suggestion={suggestion} title={title} />
      </ThemeProvider>
    );
  }

  it('"Buscando portada…" while searching, then the card', async () => {
    let resolve: (value: CoverCandidate[]) => void = () => undefined;
    const finder = fakeFinder([]);
    finder.find.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    await render(<StatusHarness finder={finder} />);
    await typeTitle('El Quijote de la mancha');
    await afterPause();
    expect(screen.getByText(c.searching)).toBeOnTheScreen();
    await act(async () => resolve([candidate(1)]));
    expect(screen.queryByText(c.searching)).toBeNull();
    expect(screen.getByTestId('cover-suggestion')).toBeOnTheScreen();
  });

  it('nothing found: "No encontramos…", with no buttons', async () => {
    const finder = fakeFinder([]);
    await render(<StatusHarness finder={finder} />);
    await typeTitle('Título que no existe');
    await afterPause();
    expect(await screen.findByText(c.notFound)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: c.accept })).toBeNull();
    expect(screen.queryByRole('button', { name: c.decline })).toBeNull();
    // Typing again hides the old answer.
    await typeTitle('Otro título');
    expect(screen.queryByText(c.notFound)).toBeNull();
  });

  it('errors stay silent (no searching or not-found line left behind)', async () => {
    const failing = fakeFinder([]);
    failing.find.mockResolvedValue(null);
    await render(<StatusHarness finder={failing} />);
    await typeTitle('Rayuela');
    await afterPause();
    expect(screen.queryByText(c.searching)).toBeNull();
    expect(screen.queryByText(c.notFound)).toBeNull();
  });

  it('offline stays silent too', async () => {
    const offline = fakeFinder([candidate(1)]);
    await render(<StatusHarness finder={offline} online={false} />);
    await typeTitle('Rayuela');
    await afterPause();
    expect(offline.find).not.toHaveBeenCalled();
    expect(screen.queryByText(c.searching)).toBeNull();
    expect(screen.queryByText(c.notFound)).toBeNull();
  });

  it('the author arriving later (e.g. from "Sugerir datos") searches again with it', async () => {
    const finder = fakeFinder([]);
    const view = await render(<StatusHarness finder={finder} />);
    await typeTitle('El Quijote de la mancha');
    await afterPause();
    expect(finder.find).toHaveBeenLastCalledWith(
      { title: 'El Quijote de la mancha', author: null },
      expect.anything(),
    );
    finder.find.mockResolvedValueOnce([candidate(3)]);
    await view.rerender(<StatusHarness finder={finder} author="Miguel de Cervantes" />);
    await afterPause();
    expect(finder.find).toHaveBeenLastCalledWith(
      { title: 'El Quijote de la mancha', author: 'Miguel de Cervantes' },
      expect.anything(),
    );
    expect(await screen.findByTestId('cover-suggestion')).toBeOnTheScreen();
  });

  it('re-renders while searching do not cancel the request', async () => {
    let resolve: (value: CoverCandidate[]) => void = () => undefined;
    const finder = fakeFinder([]);
    finder.find.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const view = await render(<StatusHarness finder={finder} />);
    await typeTitle('Rayuela');
    await afterPause();
    // A parent re-render with new (equal) props, e.g. the suggestions card updating.
    await view.rerender(<StatusHarness finder={finder} />);
    await act(async () => resolve([candidate(1)]));
    expect(finder.find).toHaveBeenCalledTimes(1);
    expect(finder.find.mock.calls[0][1]?.signal?.aborted).toBe(false);
    expect(screen.getByTestId('cover-suggestion')).toBeOnTheScreen();
  });
});

describe('in the book form', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const renderForm = (props: Partial<Parameters<typeof BookForm>[0]> = {}) =>
    render(
      <ThemeProvider>
        <ToastProvider>
          <BookForm
            initialValues={emptyBookForm}
            onSubmit={jest.fn(async () => ({ ok: true as const }))}
            onCancel={jest.fn()}
            {...props}
          />
        </ToastProvider>
      </ThemeProvider>,
    );

  it('accepting makes it the cover; saving sends it through the cover pipeline', async () => {
    const finder = fakeFinder([candidate(1)]);
    const onSubmit = jest.fn(async () => ({ ok: true as const }));
    await renderForm({ coverFinder: finder, onSubmit });
    await fireEvent.changeText(screen.getByLabelText(required(t.bookForm.titleLabel)), 'Rayuela');
    await fireEvent.changeText(screen.getByLabelText(required(t.bookForm.pagesLabel)), '600');
    await afterPause();
    await fireEvent.press(await screen.findByRole('button', { name: c.accept }));
    expect(screen.queryByTestId('cover-suggestion')).toBeNull();
    // The user can still replace it with their own photo.
    expect(screen.getByRole('button', { name: t.bookForm.changeCover })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Rayuela' }),
      expect.objectContaining({ uri: image(1).uri }),
    );
  });

  it('saving is blocked while an accepted cover is still downloading', async () => {
    const finder = fakeFinder([candidate(1)]);
    let finish: (value: LocalImage | null) => void = () => undefined;
    finder.download.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const onSubmit = jest.fn(async () => ({ ok: true as const }));
    await renderForm({ coverFinder: finder, onSubmit });
    await fireEvent.changeText(screen.getByLabelText(required(t.bookForm.titleLabel)), 'Rayuela');
    await fireEvent.changeText(screen.getByLabelText(required(t.bookForm.pagesLabel)), '600');
    await afterPause();
    await fireEvent.press(await screen.findByRole('button', { name: c.accept }));
    const save = () => screen.getByTestId('save-button');
    expect(screen.getByTestId('save-blocker')).toHaveTextContent(t.bookForm.coverPending);
    expect(save()).toBeDisabled();
    await fireEvent.press(save());
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => finish(image(1)));
    expect(save()).toBeEnabled();
    await fireEvent.press(save());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ uri: image(1).uri }),
    );
  });

  it('declining changes nothing: the book is saved without a cover', async () => {
    const finder = fakeFinder([candidate(1)]);
    const onSubmit = jest.fn(async () => ({ ok: true as const }));
    await renderForm({ coverFinder: finder, onSubmit });
    await fireEvent.changeText(screen.getByLabelText(required(t.bookForm.titleLabel)), 'Rayuela');
    await fireEvent.changeText(screen.getByLabelText(required(t.bookForm.pagesLabel)), '600');
    await afterPause();
    await fireEvent.press(await screen.findByRole('button', { name: c.decline }));
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Rayuela' }), null);
  });

  it('a book that already has a saved cover gets no suggestion', async () => {
    const finder = fakeFinder([candidate(1)]);
    await renderForm({
      coverFinder: finder,
      existingCover: { uri: 'https://signed/cover.jpg' },
      initialValues: { ...emptyBookForm, title: 'Rayuela' },
    });
    await afterPause();
    expect(finder.find).not.toHaveBeenCalled();
  });

  it('the scan review never asks (it already has the photo)', async () => {
    const finder = fakeFinder([candidate(1)]);
    await renderForm({
      coverFinder: finder,
      mode: 'review',
      initialValues: { ...emptyBookForm, title: 'Rayuela' },
    });
    await afterPause();
    expect(finder.find).not.toHaveBeenCalled();
  });
});
