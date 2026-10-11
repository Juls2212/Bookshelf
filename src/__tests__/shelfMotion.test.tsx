import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as Reanimated from 'react-native-reanimated';

import { ShelfMotion } from '@/components/ShelfMotion';
import { motion, shelfArrivalTotalMs } from '@/design/motion';

// Reanimated 4 needs the worklets native module; both ship Jest mocks.
jest.mock('react-native-worklets', () =>
  jest.requireActual('react-native-worklets/lib/module/mock'),
);
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated/mock');
  return { ...actual, useReducedMotion: jest.fn(() => false) };
});

const reduced = Reanimated.useReducedMotion as jest.Mock;

describe('motion tokens', () => {
  it('matches the mockup timings', () => {
    expect(motion.shelfArrival.durationMs).toBe(320);
    expect(motion.shelfArrival.staggerMs).toBe(60);
    expect(motion.newBookDrop.durationMs).toBe(400);
    expect(shelfArrivalTotalMs).toBe(320 + 60 * 11);
  });
});

describe('ShelfMotion', () => {
  it.each(['arrival', 'drop', 'none'] as const)(
    'always renders its children (%s)',
    async (kind) => {
      reduced.mockReturnValue(false);
      await render(
        <ShelfMotion kind={kind} index={0}>
          <Text>cover</Text>
        </ShelfMotion>,
      );
      expect(screen.getByText('cover')).toBeOnTheScreen();
    },
  );

  it('shows children immediately with reduce motion on', async () => {
    reduced.mockReturnValue(true);
    await render(
      <ShelfMotion kind="arrival" index={0}>
        <Text>cover</Text>
      </ShelfMotion>,
    );
    expect(screen.getByText('cover')).toBeOnTheScreen();
  });
});
