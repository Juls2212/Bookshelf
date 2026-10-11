import { fireEvent, render, screen } from '@testing-library/react-native';

import { BookCover } from '@/components/BookCover';
import { ThemeProvider } from '@/design/ThemeProvider';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const renderCover = (coverUri: string | null) =>
  render(
    <ThemeProvider>
      <BookCover title="Cover title" author="Cover author" coverUri={coverUri} size="md" />
    </ThemeProvider>,
  );

describe('BookCover fallback', () => {
  it('shows the typographic cover when there is no URL (missing or still resolving)', async () => {
    await renderCover(null);
    expect(screen.getByText('Cover title')).toBeOnTheScreen();
    expect(screen.queryByTestId('book-cover-image')).toBeNull();
  });

  it('keeps the typographic cover underneath while the image loads', async () => {
    await renderCover('https://example.test/cover.jpg');
    expect(screen.getByTestId('book-cover-image')).toBeOnTheScreen();
    expect(screen.getByText('Cover title')).toBeOnTheScreen();
  });

  it('drops a failing image and leaves the typographic cover visible', async () => {
    await renderCover('https://example.test/broken.jpg');
    await fireEvent(screen.getByTestId('book-cover-image'), 'error', {
      nativeEvent: { error: 'decode failed' },
    });
    expect(screen.queryByTestId('book-cover-image')).toBeNull();
    expect(screen.getByText('Cover title')).toBeOnTheScreen();
  });
});
