import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { pageAtPosition, ProgressSlider } from '@/components/ProgressSlider';
import { ThemeProvider } from '@/design/ThemeProvider';
import { format, t } from '@/i18n';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const WIDTH = 300;

async function renderSlider(page: number, pageCount = 300) {
  const onCommit = jest.fn();
  const onPreview = jest.fn();
  await render(
    <ThemeProvider>
      <ProgressSlider page={page} pageCount={pageCount} onCommit={onCommit} onPreview={onPreview} />
    </ThemeProvider>,
  );
  // Give the track its width (layout does not run in Jest).
  await fireEvent(screen.getByTestId('progress-slider'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: WIDTH, height: 44 } },
  });
  return { onCommit, onPreview };
}

describe('pageAtPosition', () => {
  it('snaps to integer pages between 0 and the total', () => {
    expect(pageAtPosition(0, 300, 312)).toBe(0);
    expect(pageAtPosition(150, 300, 312)).toBe(156);
    expect(pageAtPosition(149.4, 300, 312)).toBe(155);
    expect(pageAtPosition(-40, 300, 312)).toBe(0);
    expect(pageAtPosition(999, 300, 312)).toBe(312);
    expect(pageAtPosition(100, 0, 312)).toBe(0);
  });
});

describe('ProgressSlider', () => {
  it('previews while dragging and commits once on release', async () => {
    const { onCommit, onPreview } = await renderSlider(50);
    await act(async () => {
      fireGestureHandler(getByGestureTestId('progress-slider-pan'), [
        { state: State.BEGAN, x: 50 },
        { state: State.ACTIVE, x: 60 },
        { x: 120 },
        { x: 180 },
        { state: State.END, x: 200 },
      ]);
    });
    expect(onPreview).toHaveBeenCalledWith(60);
    expect(onPreview).toHaveBeenCalledWith(180);
    expect(onPreview).toHaveBeenLastCalledWith(null);
    // No request per move: a single commit with the snapped page.
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(200);
  });

  it('dragging to the end commits the last page', async () => {
    const { onCommit } = await renderSlider(50);
    await act(async () => {
      fireGestureHandler(getByGestureTestId('progress-slider-pan'), [
        { state: State.BEGAN, x: 50 },
        { state: State.ACTIVE, x: 200 },
        { state: State.END, x: 450 },
      ]);
    });
    expect(onCommit).toHaveBeenCalledWith(300);
  });

  it('tapping the line moves the bookmark there', async () => {
    const { onCommit } = await renderSlider(50);
    await act(async () => {
      fireGestureHandler(getByGestureTestId('progress-slider-tap'), [
        { state: State.BEGAN, x: 75 },
        { state: State.END, x: 75 },
      ]);
    });
    expect(onCommit).toHaveBeenCalledWith(75);
  });

  it('does not commit when released on the same page', async () => {
    const { onCommit } = await renderSlider(100);
    await act(async () => {
      fireGestureHandler(getByGestureTestId('progress-slider-pan'), [
        { state: State.BEGAN, x: 100 },
        { state: State.ACTIVE, x: 140 },
        { state: State.END, x: 100 },
      ]);
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('is an adjustable control with Spanish next/previous page actions', async () => {
    const { onCommit } = await renderSlider(100);
    const slider = screen.getByRole('adjustable', { name: t.reading.sliderLabel });
    expect(slider.props.accessibilityValue).toMatchObject({
      min: 0,
      max: 300,
      now: 100,
      text: format(t.reading.sliderValue, { page: 100, total: 300 }),
    });
    expect(slider.props.accessibilityActions).toEqual([
      { name: 'increment', label: t.reading.sliderIncrement },
      { name: 'decrement', label: t.reading.sliderDecrement },
    ]);

    await fireEvent(slider, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onCommit).toHaveBeenLastCalledWith(101);
    await fireEvent(slider, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onCommit).toHaveBeenLastCalledWith(99);
  });

  it('keeps accessibility actions inside 0..total', async () => {
    const { onCommit } = await renderSlider(300);
    const slider = screen.getByRole('adjustable', { name: t.reading.sliderLabel });
    await fireEvent(slider, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onCommit).toHaveBeenLastCalledWith(300);
  });
});
