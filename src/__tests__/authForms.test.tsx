import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ToastProvider } from '@/components/Toast';
import { ThemeProvider } from '@/design/ThemeProvider';
import * as authService from '@/features/auth/authService';
import { validateLoginForm, validateRegisterForm } from '@/features/auth/forms';
import { LoginForm } from '@/features/auth/LoginForm';
import { RegisterForm } from '@/features/auth/RegisterForm';
import { format, t } from '@/i18n';
import { useProfileStore } from '@/stores/profileStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@/features/auth/authService', () => ({
  signIn: jest.fn(),
  signUp: jest.fn(),
  requestPasswordReset: jest.fn(),
}));

const service = authService as jest.Mocked<typeof authService>;
const v = t.auth.validation;

function renderUi(ui: ReactElement) {
  return render(
    <ThemeProvider>
      <ToastProvider>{ui}</ToastProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useProfileStore.getState().clear();
});

describe('form validators', () => {
  it('login needs a valid email and a password (no length rule)', () => {
    expect(validateLoginForm({ email: '', password: '' })).toEqual({
      email: 'email_required',
      password: 'password_required',
    });
    expect(validateLoginForm({ email: 'a@b.co', password: 'x' })).toEqual({});
  });

  it('register checks every field', () => {
    expect(
      validateRegisterForm({ displayName: '', email: 'bad', password: '123', confirmation: '1' }),
    ).toEqual({
      displayName: 'name_required',
      email: 'email_invalid',
      password: 'password_too_short',
      confirmation: 'password_mismatch',
    });
    expect(
      validateRegisterForm({
        displayName: 'Ana',
        email: 'ana@example.com',
        password: 'secret-123',
        confirmation: 'secret-123',
      }),
    ).toEqual({});
  });
});

describe('LoginForm', () => {
  it('shows Spanish field errors and does not call the service when invalid', async () => {
    await renderUi(<LoginForm onCreateAccount={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: t.auth.login.submit }));
    expect(screen.getByText(v.email_required)).toBeOnTheScreen();
    expect(screen.getByText(v.password_required)).toBeOnTheScreen();
    expect(service.signIn).not.toHaveBeenCalled();
  });

  it('signs in with valid values and shows a mapped server error', async () => {
    service.signIn.mockResolvedValue({ ok: false, error: 'invalid_credentials' });
    await renderUi(<LoginForm onCreateAccount={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText(t.auth.login.emailLabel), 'ana@example.com');
    await fireEvent.changeText(screen.getByLabelText(t.auth.login.passwordLabel), 'secret-123');
    await fireEvent.press(screen.getByRole('button', { name: t.auth.login.submit }));

    expect(service.signIn).toHaveBeenCalledWith({
      email: 'ana@example.com',
      password: 'secret-123',
    });
    expect(await screen.findByText(t.auth.errors.invalid_credentials)).toBeOnTheScreen();
    expect(useProfileStore.getState().themeSyncIntent).toBe('none');
  });

  it('asks the profile theme to win after a successful sign-in', async () => {
    service.signIn.mockResolvedValue({ ok: true, data: null });
    await renderUi(<LoginForm onCreateAccount={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText(t.auth.login.emailLabel), 'ana@example.com');
    await fireEvent.changeText(screen.getByLabelText(t.auth.login.passwordLabel), 'secret-123');
    await fireEvent.press(screen.getByRole('button', { name: t.auth.login.submit }));
    expect(useProfileStore.getState().themeSyncIntent).toBe('pull');
  });

  it('opens the password recovery sheet', async () => {
    await renderUi(<LoginForm onCreateAccount={jest.fn()} />);
    await fireEvent.press(screen.getByRole('link', { name: t.auth.login.forgot }));
    expect(screen.getByText(t.auth.reset.title)).toBeOnTheScreen();
  });
});

describe('RegisterForm', () => {
  const fill = async () => {
    await fireEvent.changeText(screen.getByLabelText(t.auth.register.nameLabel), 'Ana');
    await fireEvent.changeText(
      screen.getByLabelText(t.auth.register.emailLabel),
      'ana@example.com',
    );
    await fireEvent.changeText(screen.getByLabelText(t.auth.register.passwordLabel), 'secret-123');
    await fireEvent.changeText(screen.getByLabelText(t.auth.register.confirmLabel), 'secret-123');
  };

  it('shows per-field Spanish messages', async () => {
    await renderUi(<RegisterForm onSignIn={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText(t.auth.register.passwordLabel), '123');
    await fireEvent.changeText(screen.getByLabelText(t.auth.register.confirmLabel), '124');
    await fireEvent.press(screen.getByRole('button', { name: t.auth.register.submit }));

    expect(screen.getByText(v.name_required)).toBeOnTheScreen();
    expect(screen.getByText(v.email_required)).toBeOnTheScreen();
    expect(screen.getByText(v.password_too_short)).toBeOnTheScreen();
    expect(screen.getByText(v.password_mismatch)).toBeOnTheScreen();
    expect(service.signUp).not.toHaveBeenCalled();
  });

  it('shows the check-your-email state when no session is created', async () => {
    service.signUp.mockResolvedValue({ ok: true, data: { sessionCreated: false } });
    await renderUi(<RegisterForm onSignIn={jest.fn()} />);
    await fill();
    await fireEvent.press(screen.getByRole('button', { name: t.auth.register.submit }));

    expect(service.signUp).toHaveBeenCalledWith({
      displayName: 'Ana',
      email: 'ana@example.com',
      password: 'secret-123',
      confirmation: 'secret-123',
    });
    expect(
      await screen.findByText(format(t.auth.register.checkEmailText, { email: 'ana@example.com' })),
    ).toBeOnTheScreen();
  });

  it('pushes the local theme and welcomes the user when a session is created', async () => {
    service.signUp.mockResolvedValue({ ok: true, data: { sessionCreated: true } });
    await renderUi(<RegisterForm onSignIn={jest.fn()} />);
    await fill();
    await fireEvent.press(screen.getByRole('button', { name: t.auth.register.submit }));

    expect(useProfileStore.getState().themeSyncIntent).toBe('push');
    expect(await screen.findByText(t.auth.register.welcome)).toBeOnTheScreen();
  });

  it('shows email_taken in Spanish', async () => {
    service.signUp.mockResolvedValue({ ok: false, error: 'email_taken' });
    await renderUi(<RegisterForm onSignIn={jest.fn()} />);
    await fill();
    await fireEvent.press(screen.getByRole('button', { name: t.auth.register.submit }));
    expect(await screen.findByText(t.auth.errors.email_taken)).toBeOnTheScreen();
  });
});
