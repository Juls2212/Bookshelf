import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import ScanScreen from '@/app/scan';
import { ToastProvider } from '@/components/Toast';
import { COVER_ASPECT } from '@/components/BookCover';
import { ThemeProvider } from '@/design/ThemeProvider';
import { fakeIdentifiedBook } from '@/dev/fakeFixtures';
import type { LocalImage } from '@/features/library/coverService';
import type { FakeOutcome } from '@/features/scan/fakeBookIdentifier';
import { bookIdentifier, useFakeIdentifierStore } from '@/features/scan/identifierFactory';
import { t } from '@/i18n';
import { deviceNetwork } from '@/lib/network';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);

const mockRouter = { back: jest.fn(), replace: jest.fn(), navigate: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

// Camera: permission state and the captured picture are controlled by each test.
type MockPermission = { granted: boolean; status: string; canAskAgain: boolean } | null;
const mockCamera: {
  permission: MockPermission;
  request: jest.Mock;
  takePicture: jest.Mock;
  props: { onMountError?: () => void };
} = {
  permission: null,
  request: jest.fn(),
  takePicture: jest.fn(),
  props: {},
};
jest.mock('expo-camera', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const CameraView = React.forwardRef<unknown, { onMountError?: () => void }>((props, ref) => {
    React.useImperativeHandle(ref, () => ({ takePictureAsync: mockCamera.takePicture }));
    mockCamera.props = props;
    return React.createElement(View, { testID: 'camera-preview' });
  });
  CameraView.displayName = 'CameraView';
  return {
    CameraView,
    PermissionStatus: { UNDETERMINED: 'undetermined', GRANTED: 'granted', DENIED: 'denied' },
    useCameraPermissions: () => [mockCamera.permission, mockCamera.request, jest.fn()],
  };
});

// Photo files: the identification copy and its cleanup.
jest.mock('@/features/scan/scanPhoto', () => ({
  prepareForIdentification: jest.fn(async () => ({
    uri: 'file:///cache/small.jpg',
    width: 768,
    height: 1024,
  })),
  discardImage: jest.fn(),
}));

const mockCovers = {
  pickFromGallery: jest.fn(),
  prepare: jest.fn(async (image: { uri: string }) => ({ ok: true, data: image })),
  saveLocal: jest.fn(async () => ({
    ok: true,
    data: { localUri: 'file:///doc/covers/user-1/b.jpg', path: 'user-1/b.jpg' },
  })),
  removeLocal: jest.fn(),
  renderPreview: jest.fn(async () => ({
    ok: true,
    data: { uri: 'file:///cache/preview.jpg', width: 340, height: 480 },
  })),
  // Size of the photo as decoded (orientation applied).
  measure: jest.fn(async () => ({ ok: true, data: { width: 3000, height: 4000 } })),
};
// Getter: the mock object is created after the hoisted jest.mock call.
jest.mock('@/features/library/coverService', () => ({
  get coverService() {
    return mockCovers;
  },
}));

const mockCreate = jest.fn();
jest.mock('@/stores/libraryStore', () => ({
  useLibraryStore: { getState: () => ({ create: mockCreate }) },
}));
jest.mock('@/stores/authStore', () => {
  const state = { user: { id: 'user-1' } };
  return { useAuthStore: <T,>(selector: (s: typeof state) => T) => selector(state) };
});

const granted = { granted: true, status: 'granted', canAskAgain: true };
const photo = { uri: 'file:///cache/camera.jpg', width: 3000, height: 4000 };

async function renderScan() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <ScanScreen />
      </ToastProvider>
    </ThemeProvider>,
  );
}

async function shoot(outcome: FakeOutcome) {
  useFakeIdentifierStore.setState({ fakeEnabled: true, outcome, delayMs: 0 });
  await renderScan();
  await fireEvent.press(screen.getByLabelText(t.scan.shutter));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCamera.permission = granted;
  mockCamera.takePicture.mockResolvedValue(photo);
  mockCreate.mockImplementation(async (input) => ({ ok: true, data: input }));
  jest.spyOn(deviceNetwork, 'isOnline').mockResolvedValue(true);
  useFakeIdentifierStore.setState({ fakeEnabled: true, outcome: 'success', delayMs: 0 });
});

describe('camera permission states', () => {
  it('explains first and asks only when the user agrees', async () => {
    mockCamera.permission = { granted: false, status: 'undetermined', canAskAgain: true };
    await renderScan();
    expect(screen.getByText(t.scan.permission.requestTitle)).toBeTruthy();
    expect(screen.queryByTestId('camera-preview')).toBeNull();
    expect(mockCamera.request).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText(t.scan.permission.allow));
    expect(mockCamera.request).toHaveBeenCalledTimes(1);
  });

  it('denied offers the settings and manual entry', async () => {
    mockCamera.permission = { granted: false, status: 'denied', canAskAgain: false };
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await renderScan();
    expect(screen.getByText(t.scan.permission.deniedTitle)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(t.scan.permission.openSettings));
    expect(openSettings).toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText(t.scan.permission.manual));
    expect(mockRouter.replace).toHaveBeenCalledWith('/book/new');
  });

  it('shows the unavailable state when the camera cannot start', async () => {
    await renderScan();
    expect(screen.getByTestId('camera-preview')).toBeTruthy();
    expect(screen.getByText(t.scan.guidance)).toBeTruthy();
    await act(async () => mockCamera.props.onMountError?.());
    expect(screen.getByText(t.scan.permission.unavailableTitle)).toBeTruthy();
    expect(screen.queryByTestId('camera-preview')).toBeNull();
  });
});

describe('identification', () => {
  const failures = [
    'not_a_book',
    'low_confidence',
    'network',
    'timeout',
    'rate_limited',
    'unauthorized',
    'unknown',
  ] as const;

  it.each(failures)('a %s failure shows its card with both actions', async (code) => {
    await shoot(code);
    expect(await screen.findByTestId(`scan-failure-${code}`)).toBeTruthy();
    expect(screen.getByText(t.scan.failure.errors[code].title)).toBeTruthy();
    expect(screen.getByLabelText(t.scan.failure.retry)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(t.scan.failure.manual));
    expect(mockRouter.replace).toHaveBeenCalledWith('/book/new');
  });

  it('retry sends the same photo again after a network failure', async () => {
    await shoot('network');
    await screen.findByTestId('scan-failure-network');
    const identify = jest.spyOn(bookIdentifier, 'identify');
    useFakeIdentifierStore.setState({ outcome: 'success' });
    await fireEvent.press(screen.getByLabelText(t.scan.failure.retry));
    expect(await screen.findByText(t.scan.review.heading)).toBeTruthy();
    expect(identify).toHaveBeenCalledTimes(1);
  });

  it('retry goes back to the camera when the photo was not a book', async () => {
    await shoot('not_a_book');
    await screen.findByTestId('scan-failure-not_a_book');
    await fireEvent.press(screen.getByLabelText(t.scan.failure.retry));
    expect(screen.getByLabelText(t.scan.shutter)).toBeTruthy();
  });

  it('offline skips the identifier and offers manual entry first', async () => {
    jest.spyOn(deviceNetwork, 'isOnline').mockResolvedValue(false);
    const identify = jest.spyOn(bookIdentifier, 'identify');
    await shoot('success');
    expect(await screen.findByTestId('scan-failure-offline')).toBeTruthy();
    expect(identify).not.toHaveBeenCalled();
  });

  it('cancel really aborts the request and returns to the camera', async () => {
    const identify = jest.spyOn(bookIdentifier, 'identify');
    await shoot('hang');
    expect(await screen.findByTestId('scan-processing')).toBeTruthy();
    expect(identify).toHaveBeenCalledTimes(1);
    const signal = identify.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    await fireEvent.press(screen.getAllByLabelText(t.scan.processing.cancel).at(-1)!);
    expect(signal?.aborted).toBe(true);
    expect(screen.getByLabelText(t.scan.shutter)).toBeTruthy();
    expect(screen.queryByTestId('scan-processing')).toBeNull();
  });
});

describe('review', () => {
  it('prefills the form with the photo as cover and never saves on its own', async () => {
    await shoot('success');
    expect(await screen.findByText(t.scan.review.heading)).toBeTruthy();
    expect(screen.getByTestId('scan-confidence-high')).toBeTruthy();
    expect(screen.getByText(t.scan.review.confidence.high)).toBeTruthy();
    expect(screen.getByDisplayValue(fakeIdentifiedBook.title)).toBeTruthy();
    expect(screen.getByDisplayValue('248')).toBeTruthy();
    expect(screen.getByLabelText(t.scan.review.removePhoto)).toBeTruthy();

    await fireEvent.changeText(screen.getByDisplayValue(fakeIdentifiedBook.title), 'Otro título');
    await fireEvent.press(screen.getByLabelText(t.readingStatus.reading));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCovers.saveLocal).not.toHaveBeenCalled();
  });

  it('shows a low confidence result with words, not only color', async () => {
    await shoot('low_result');
    expect(await screen.findByTestId('scan-confidence-low')).toBeTruthy();
    expect(screen.getByText(t.scan.review.confidence.low)).toBeTruthy();
    expect(screen.getByText(t.scan.review.confidenceHint.low)).toBeTruthy();
  });

  it('saves the edited values with the photo as a camera cover', async () => {
    await shoot('success');
    await screen.findByText(t.scan.review.heading);
    await fireEvent.changeText(screen.getByDisplayValue(fakeIdentifiedBook.title), 'Otro título');
    await fireEvent.changeText(screen.getByDisplayValue('248'), '300');
    await fireEvent.press(screen.getByLabelText(t.bookForm.save));

    expect(mockCovers.prepare).toHaveBeenCalledWith(expect.objectContaining({ uri: photo.uri }));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Otro título',
        author: fakeIdentifiedBook.author,
        pageCount: 300,
        readingStatus: 'to_read',
        coverSource: 'camera',
        coverPath: 'user-1/b.jpg',
      }),
    );
    const savedId = mockCreate.mock.calls[0][0].id;
    expect(mockRouter.navigate).toHaveBeenCalledWith({
      pathname: '/library',
      params: { added: savedId },
    });
  });

  it('proposes the photo cropped to the book (with a margin) and saves that crop', async () => {
    await shoot('success');
    await screen.findByText(t.scan.review.heading);
    // The preview is the rendered crop of the original photo.
    expect(mockCovers.renderPreview).toHaveBeenCalledWith(
      expect.objectContaining({ uri: photo.uri, crop: expect.any(Object) }),
    );
    // The preview resolves asynchronously (slow under a loaded test run).
    await waitFor(() =>
      expect(screen.getByTestId('book-cover-image').props.source).toEqual([
        expect.objectContaining({ uri: 'file:///cache/preview.jpg' }),
      ]),
    );
    await fireEvent.press(screen.getByLabelText(t.bookForm.save));
    await waitFor(() => expect(mockCovers.prepare).toHaveBeenCalled());
    // fakeIdentifiedBook.coverBox = { x: 0.22, y: 0.12, width: 0.56, height: 0.76 } + 2 %.
    const saved = mockCovers.prepare.mock.calls[0][0] as unknown as LocalImage;
    expect(saved.uri).toBe(photo.uri);
    expect(saved.crop!.x).toBeCloseTo(0.2);
    expect(saved.crop!.y).toBeCloseTo(0.1);
    expect(saved.crop!.width).toBeCloseTo(0.6);
    expect(saved.crop!.height).toBeCloseTo(0.8);
  });

  it('without a cover box it proposes a centered crop of 80 %', async () => {
    await shoot('low_result');
    await screen.findByTestId('scan-confidence-low');
    expect(mockCovers.renderPreview).toHaveBeenCalledWith(
      expect.objectContaining({ crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } }),
    );
  });

  it('"Ajustar recorte" opens the editor and applies a crop with the cover proportions', async () => {
    await shoot('success');
    await screen.findByText(t.scan.review.heading);
    await fireEvent.press(screen.getByLabelText(t.bookForm.adjustCrop));
    expect(await screen.findByText(t.cropEditor.hint)).toBeTruthy();
    expect(mockCovers.measure).toHaveBeenCalledWith(photo.uri);
    await fireEvent(screen.getByTestId('crop-area'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 344, height: 544 } },
    });
    expect(await screen.findByTestId('crop-frame')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(t.cropEditor.apply));
    expect(screen.queryByText(t.cropEditor.hint)).toBeNull();

    await fireEvent.press(screen.getByLabelText(t.bookForm.save));
    const { crop } = mockCovers.prepare.mock.calls[0][0] as unknown as LocalImage;
    // Same proportions as a BookCover once applied to the 3000 x 4000 photo.
    expect((crop!.width * 3000) / (crop!.height * 4000)).toBeCloseTo(1 / COVER_ASPECT, 3);
    expect(crop!.height).toBeCloseTo(0.8);
  });

  it('a book without a page count cannot be saved', async () => {
    await shoot('low_result');
    await screen.findByTestId('scan-confidence-low');
    await fireEvent.press(screen.getByLabelText(t.bookForm.save));
    expect(screen.getByText(t.bookValidation.page_count_required)).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
    await fireEvent.changeText(
      screen.getByLabelText(`${t.bookForm.pagesLabel}, obligatorio`),
      '180',
    );
    await fireEvent.press(screen.getByLabelText(t.bookForm.save));
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ pageCount: 180 }));
  });

  it('saves without a cover when the photo is removed', async () => {
    await shoot('success');
    await screen.findByText(t.scan.review.heading);
    await fireEvent.press(screen.getByLabelText(t.scan.review.removePhoto));
    await fireEvent.press(screen.getByLabelText(t.bookForm.save));
    expect(mockCovers.saveLocal).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ coverPath: null, coverSource: null }),
    );
  });

  it('validation works as in the normal form', async () => {
    await shoot('success');
    await screen.findByText(t.scan.review.heading);
    await fireEvent.changeText(screen.getByDisplayValue(fakeIdentifiedBook.title), '  ');
    await fireEvent.press(screen.getByLabelText(t.bookForm.save));
    expect(screen.getByTestId('save-blocker')).toHaveTextContent(t.bookValidation.title_required);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('"Volver a fotografiar" returns to the camera without saving', async () => {
    await shoot('success');
    await screen.findByText(t.scan.review.heading);
    await fireEvent.press(screen.getAllByLabelText(t.scan.review.retake)[0]);
    expect(screen.getByLabelText(t.scan.shutter)).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
