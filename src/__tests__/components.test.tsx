import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { ThemeProvider } from '@/design/ThemeProvider';
import { t } from '@/i18n';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const LABEL = 'label-under-test';

function renderThemed(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe('Button', () => {
  it('renders the primary state and handles presses', async () => {
    const onPress = jest.fn();
    await renderThemed(<Button label={LABEL} onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: LABEL }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it.each(['secondary', 'destructive'] as const)('renders the %s variant', async (variant) => {
    await renderThemed(<Button label={LABEL} variant={variant} icon="trash" />);
    expect(screen.getByRole('button', { name: LABEL })).toBeOnTheScreen();
  });

  it('renders the link variant with the link role', async () => {
    await renderThemed(<Button label={LABEL} variant="link" />);
    expect(screen.getByRole('link', { name: LABEL })).toBeOnTheScreen();
  });

  it('does not fire when disabled', async () => {
    const onPress = jest.fn();
    await renderThemed(<Button label={LABEL} onPress={onPress} disabled />);
    const button = screen.getByRole('button', { name: LABEL });
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows a busy indicator when loading', async () => {
    const onPress = jest.fn();
    await renderThemed(<Button label={LABEL} onPress={onPress} loading />);
    expect(screen.getByRole('button', { name: LABEL })).toBeBusy();
    expect(screen.getByLabelText(t.common.loading)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: LABEL }));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('TextField', () => {
  it('renders the rest state with label and helper', async () => {
    await renderThemed(<TextField label={LABEL} helperText="helper" placeholder="placeholder" />);
    expect(screen.getByText(LABEL)).toBeOnTheScreen();
    expect(screen.getByText('helper')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('placeholder')).toBeOnTheScreen();
  });

  it('handles focus and blur', async () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    await renderThemed(<TextField label={LABEL} onFocus={onFocus} onBlur={onBlur} />);
    const input = screen.getByLabelText(LABEL);
    await fireEvent(input, 'focus');
    await fireEvent(input, 'blur');
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('shows the error text instead of the helper', async () => {
    await renderThemed(<TextField label={LABEL} helperText="helper" errorText="error" />);
    expect(screen.getByText('error')).toBeOnTheScreen();
    expect(screen.queryByText('helper')).toBeNull();
  });

  it('renders the review state', async () => {
    await renderThemed(<TextField label={LABEL} review helperText="review" defaultValue="248" />);
    expect(screen.getByDisplayValue('248')).toBeOnTheScreen();
    expect(screen.getByText('review')).toBeOnTheScreen();
  });

  it('renders multiline', async () => {
    await renderThemed(<TextField label={LABEL} multiline defaultValue="note" />);
    expect(screen.getByDisplayValue('note').props.multiline).toBe(true);
  });

  it('toggles secure text visibility', async () => {
    await renderThemed(<TextField label={LABEL} secureTextEntry defaultValue="secret" />);
    expect(screen.getByDisplayValue('secret').props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: t.common.showPassword }));
    expect(screen.getByDisplayValue('secret').props.secureTextEntry).toBe(false);
    expect(screen.getByRole('button', { name: t.common.hidePassword })).toBeOnTheScreen();
  });
});
