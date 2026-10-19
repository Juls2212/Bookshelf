// "Original | Mejorada" in the book form: state machine, fallbacks and what gets saved.
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ToastProvider } from '@/components/Toast';
import { ThemeProvider } from '@/design/ThemeProvider';
import { BookForm } from '@/features/library/BookForm';
import { emptyBookForm } from '@/features/library/bookFormLogic';
import type { LocalImage } from '@/features/library/coverService';
import {
  coverToSave,
  enhancementReducer,
  initialEnhancement,
} from '@/features/scan/coverEnhancement';
import { insetCorners, type Quad } from '@/features/scan/coverGeometry';
import { t } from '@/i18n';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@/lib/supabase', () => ({ getSupabaseClient: jest.fn() }));
const mockCovers = {
  pickFromGallery: jest.fn(),
  renderPreview: jest.fn(async () => ({
    ok: true,
    data: { uri: 'file:///cache/preview.jpg', width: 340, height: 480 },
  })),
  measure: jest.fn(async () => ({ ok: true, data: { width: 3000, height: 4000 } })),
  removeLocal: jest.fn(),
};
jest.mock('@/features/library/coverService', () => ({
  get coverService() {
    return mockCovers;
  },
}));
const mockEnhance = jest.fn();
jest.mock('@/features/scan/coverEnhancer', () => ({
  coverEnhancer: { enhance: (...args: unknown[]) => mockEnhance(...args) },
}));
jest.mock('@/features/scan/scanPhoto', () => ({ discardImage: jest.fn() }));

const e = t.bookForm.enhance;
const photo: LocalImage = {
  uri: 'file:///cache/camera.jpg',
  width: 3000,
  height: 4000,
  source: 'camera',
  crop: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
};
const improved: LocalImage = {
  uri: 'file:///cache/cover-enhanced.jpg',
  width: 845,
  height: 1200,
  source: 'camera',
};
const corners: Quad = [
  { x: 0.25, y: 0.12 },
  { x: 0.77, y: 0.15 },
  { x: 0.78, y: 0.87 },
  { x: 0.22, y: 0.88 },
];

/** A promise the test resolves or rejects when it wants. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let onSubmit: jest.Mock;

async function renderForm(props: Partial<Parameters<typeof BookForm>[0]> = {}) {
  onSubmit = jest.fn(async () => ({ ok: true as const }));
  await render(
    <ThemeProvider>
      <ToastProvider>
        <BookForm
          initialValues={{ ...emptyBookForm, title: 'Cartas a nadie', pages: '248' }}
          onSubmit={onSubmit}
          onCancel={jest.fn()}
          {...props}
        />
      </ToastProvider>
    </ThemeProvider>,
  );
}

const coverImage = () => screen.getByTestId('book-cover-image').props.source;

beforeEach(() => jest.clearAllMocks());

describe('state machine', () => {
  it('start -> succeeded selects "Mejorada"; failed falls back to "Original"', () => {
    const started = enhancementReducer(initialEnhancement, { type: 'start', corners });
    expect(started).toMatchObject({ status: 'processing', corners, selected: 'original' });
    const done = enhancementReducer(started, { type: 'succeeded', image: improved });
    expect(done).toMatchObject({ status: 'ready', enhanced: improved, selected: 'enhanced' });
    const original = enhancementReducer(done, { type: 'select', version: 'original' });
    expect(original.selected).toBe('original');
    const again = enhancementReducer(original, { type: 'start', corners });
    expect(enhancementReducer(again, { type: 'failed' })).toMatchObject({
      status: 'failed',
      enhanced: null,
      selected: 'original',
    });
  });

  it('cancel goes back; "Mejorada" cannot be chosen without an image; reset forgets', () => {
    const started = enhancementReducer(initialEnhancement, { type: 'start', corners });
    expect(enhancementReducer(started, { type: 'cancelled' }).status).toBe('idle');
    expect(enhancementReducer(initialEnhancement, { type: 'select', version: 'enhanced' })).toBe(
      initialEnhancement,
    );
    const done = enhancementReducer(started, { type: 'succeeded', image: improved });
    expect(
      enhancementReducer({ ...done, status: 'processing' }, { type: 'cancelled' }).status,
    ).toBe('ready');
    expect(enhancementReducer(done, { type: 'reset' })).toEqual(initialEnhancement);
  });

  it('saves the chosen version, and the original (with its crop) otherwise', () => {
    const done = enhancementReducer(
      enhancementReducer(initialEnhancement, { type: 'start', corners }),
      { type: 'succeeded', image: improved },
    );
    expect(coverToSave(done, photo)).toBe(improved);
    expect(coverToSave({ ...done, selected: 'original' }, photo)).toBe(photo);
    expect(coverToSave(initialEnhancement, photo)).toBe(photo);
  });
});

describe('Revisa tu libro (review mode)', () => {
  it('improves the scanned photo right away and defaults to "Mejorada" when it works', async () => {
    const run = deferred<LocalImage>();
    mockEnhance.mockReturnValue(run.promise);
    await renderForm({ mode: 'review', initialCover: photo, initialCorners: corners });
    expect(mockEnhance).toHaveBeenCalledWith(photo, corners, { signal: expect.any(AbortSignal) });
    expect(screen.getByText(e.processing)).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: e.enhanced })).toBeNull();

    await act(async () => run.resolve(improved));
    expect(screen.queryByText(e.processing)).toBeNull();
    expect(screen.getByRole('radio', { name: e.enhanced })).toBeChecked();
    expect(coverImage()).toEqual([expect.objectContaining({ uri: improved.uri })]);

    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));
    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), improved);
  });

  it('"Original" saves the plain crop through the same pipeline', async () => {
    mockEnhance.mockResolvedValue(improved);
    await renderForm({ mode: 'review', initialCover: photo, initialCorners: corners });
    await screen.findByRole('radio', { name: e.enhanced });
    await fireEvent.press(screen.getByRole('radio', { name: e.original }));
    expect(coverImage()).toEqual([expect.objectContaining({ uri: 'file:///cache/preview.jpg' })]);
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));
    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), photo);
  });

  it('a failure (Skia error or timeout) quietly keeps "Original" and never blocks saving', async () => {
    mockEnhance.mockRejectedValue(new Error('timeout'));
    await renderForm({ mode: 'review', initialCover: photo, initialCorners: corners });
    await act(async () => undefined);
    expect(screen.queryByText(e.processing)).toBeNull();
    expect(screen.queryByRole('radio', { name: e.enhanced })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));
    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), photo);
  });

  it('saving is blocked while the cover is still being processed, then saves the improved one', async () => {
    let finish: (image: LocalImage) => void = () => undefined;
    mockEnhance.mockReturnValue(new Promise<LocalImage>((resolve) => (finish = resolve)));
    await renderForm({ mode: 'review', initialCover: photo, initialCorners: corners });
    const save = screen.getByRole('button', { name: t.bookForm.save });
    expect(save).toBeDisabled();
    expect(screen.getByTestId('save-blocker')).toHaveTextContent(t.bookForm.coverPending);
    await fireEvent.press(save);
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => finish(improved));
    expect(screen.getByRole('button', { name: t.bookForm.save })).toBeEnabled();
    expect(screen.queryByTestId('save-blocker')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));
    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), improved);
  });

  it('"Ajustar esquinas" opens the corner editor and re-runs with the new corners', async () => {
    mockEnhance.mockResolvedValue(improved);
    await renderForm({ mode: 'review', initialCover: photo, initialCorners: corners });
    await screen.findByRole('radio', { name: e.enhanced });
    await fireEvent.press(screen.getByRole('button', { name: e.adjustCorners }));
    expect(await screen.findByText(t.cornerEditor.hint)).toBeOnTheScreen();
    await fireEvent(screen.getByTestId('corner-area'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 344, height: 544 } },
    });
    await screen.findByTestId('corner-stage');
    for (const name of Object.values(t.cornerEditor.corners)) {
      expect(screen.getByLabelText(name)).toBeOnTheScreen();
    }
    await fireEvent.press(screen.getByRole('button', { name: t.cornerEditor.apply }));
    expect(mockEnhance).toHaveBeenCalledTimes(2);
    expect(mockEnhance.mock.calls[1][1]).toEqual(corners);
  });
});

describe('picked images in the book form', () => {
  const picked: LocalImage = { uri: 'file:///picked.jpg', width: 1200, height: 900 };

  it('"Mejorar portada" opens the corner editor with the image inset by 5 % and improves it', async () => {
    mockCovers.pickFromGallery.mockResolvedValue({ ok: true, data: picked });
    mockEnhance.mockResolvedValue({ ...improved, uri: 'file:///cache/picked-enhanced.jpg' });
    await renderForm();
    // No image yet, nothing to improve; saved covers are never reprocessed.
    expect(screen.queryByRole('button', { name: e.improve })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.addCover }));
    // The add form asks where the image comes from.
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.coverFromGallery }));
    expect(mockEnhance).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: e.improve }));
    await fireEvent(screen.getByTestId('corner-area'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 344, height: 544 } },
    });
    await screen.findByTestId('corner-stage');
    await fireEvent.press(screen.getByRole('button', { name: t.cornerEditor.apply }));
    expect(mockEnhance).toHaveBeenCalledWith(picked, insetCorners(0.05), {
      signal: expect.any(AbortSignal),
    });
    expect(await screen.findByRole('radio', { name: e.enhanced })).toBeChecked();
  });

  it('cancelling the corner editor improves nothing', async () => {
    mockCovers.pickFromGallery.mockResolvedValue({ ok: true, data: picked });
    await renderForm();
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.addCover }));
    // The add form asks where the image comes from.
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.coverFromGallery }));
    await fireEvent.press(screen.getByRole('button', { name: e.improve }));
    const cancels = screen.getAllByRole('button', { name: t.cornerEditor.cancel });
    await fireEvent.press(cancels[0]);
    expect(screen.queryByText(t.cornerEditor.hint)).toBeNull();
    expect(mockEnhance).not.toHaveBeenCalled();
  });

  it('an existing saved cover offers no improvement', async () => {
    await renderForm({ existingCover: { uri: 'file:///doc/covers/u/b.jpg' } });
    expect(screen.queryByRole('button', { name: e.improve })).toBeNull();
    expect(screen.queryByRole('button', { name: e.adjustCorners })).toBeNull();
  });

  it('removing the photo forgets the improvement', async () => {
    mockEnhance.mockResolvedValue(improved);
    await renderForm({ mode: 'review', initialCover: photo, initialCorners: corners });
    await screen.findByRole('radio', { name: e.enhanced });
    await fireEvent.press(screen.getByRole('button', { name: t.scan.review.removePhoto }));
    expect(screen.queryByRole('radio', { name: e.enhanced })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: t.bookForm.save }));
    expect(onSubmit).toHaveBeenCalledWith(expect.anything(), null);
  });
});
