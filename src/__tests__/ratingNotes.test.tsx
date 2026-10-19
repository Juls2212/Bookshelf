import { render } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';

import { ProgressBar } from '@/components/ProgressBar';
import { ThemeProvider } from '@/design/ThemeProvider';
import { motion } from '@/design/motion';
import { NOTES_MAX_LENGTH, validateNotes } from '@/features/library/bookValidation';
import { normalizeNotes, toggleRating } from '@/features/library/readingRules';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('rating rules', () => {
  it('sets the tapped star and clears when tapping the current rating', () => {
    expect(toggleRating(null, 4)).toBe(4);
    expect(toggleRating(2, 4)).toBe(4);
    expect(toggleRating(4, 4)).toBeNull();
  });
});

describe('notes rules', () => {
  it('trims and stores an empty note as null', () => {
    expect(normalizeNotes('  A note \n')).toBe('A note');
    expect(normalizeNotes('   \n ')).toBeNull();
    expect(normalizeNotes(null)).toBeNull();
  });

  it('limits notes to 2000 characters after trimming (code points)', () => {
    expect(validateNotes('a'.repeat(NOTES_MAX_LENGTH))).toBeNull();
    expect(validateNotes(`  ${'a'.repeat(NOTES_MAX_LENGTH)}  `)).toBeNull();
    expect(validateNotes('a'.repeat(NOTES_MAX_LENGTH + 1))).toBe('notes_too_long');
    // Emoji count as one character each.
    expect(validateNotes('📚'.repeat(NOTES_MAX_LENGTH))).toBeNull();
    expect(validateNotes(null)).toBeNull();
  });
});

describe('bookmark animation', () => {
  const reduced = Reanimated.useReducedMotion as jest.Mock;
  const renderBar = (percent: number) =>
    render(
      <ThemeProvider>
        <ProgressBar percent={percent} animated animateFrom={0} />
      </ThemeProvider>,
    );

  afterEach(() => {
    reduced.mockReturnValue(false);
    jest.restoreAllMocks();
  });

  it('slides with the 280 ms token when motion is allowed', async () => {
    reduced.mockReturnValue(false);
    const withTiming = jest.spyOn(Reanimated, 'withTiming');
    await renderBar(68);
    expect(withTiming).toHaveBeenCalledWith(
      68,
      expect.objectContaining({ duration: motion.bookmarkSlide.durationMs }),
    );
    expect(motion.bookmarkSlide.durationMs).toBe(280);
  });

  it('jumps to the final state with reduce motion on', async () => {
    reduced.mockReturnValue(true);
    const withTiming = jest.spyOn(Reanimated, 'withTiming');
    const screen = await renderBar(68);
    expect(withTiming).not.toHaveBeenCalled();
    expect(screen.getByRole('progressbar')).toHaveAccessibilityValue({ min: 0, max: 100, now: 68 });
  });
});
