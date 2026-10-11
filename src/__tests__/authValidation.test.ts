import { authErrorMessage, mapAuthError, validationMessage } from '@/features/auth/authErrors';
import {
  validateDisplayName,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
  type ValidationErrorCode,
} from '@/features/auth/validation';
import { t } from '@/i18n';

describe('validators', () => {
  it('validates the display name (1-60 characters, trimmed)', () => {
    expect(validateDisplayName('Ana')).toBeNull();
    expect(validateDisplayName('   ')).toBe('name_required');
    expect(validateDisplayName('a'.repeat(60))).toBeNull();
    expect(validateDisplayName('a'.repeat(61))).toBe('name_too_long');
    // Multi-byte characters count once.
    expect(validateDisplayName('ñ'.repeat(60))).toBeNull();
  });

  it('validates the email format', () => {
    expect(validateEmail('reader@example.com')).toBeNull();
    expect(validateEmail('  reader@example.co  ')).toBeNull();
    expect(validateEmail('')).toBe('email_required');
    expect(validateEmail('reader@')).toBe('email_invalid');
    expect(validateEmail('reader@example')).toBe('email_invalid');
    expect(validateEmail('re ader@example.com')).toBe('email_invalid');
  });

  it('requires passwords of at least 8 characters', () => {
    expect(validatePassword('')).toBe('password_required');
    expect(validatePassword('1234567')).toBe('password_too_short');
    expect(validatePassword('12345678')).toBeNull();
  });

  it('checks the confirmation matches', () => {
    expect(validatePasswordConfirmation('secret-123', '')).toBe('confirmation_required');
    expect(validatePasswordConfirmation('secret-123', 'secret-124')).toBe('password_mismatch');
    expect(validatePasswordConfirmation('secret-123', 'secret-123')).toBeNull();
  });

  it('has a Spanish message for every validation code', () => {
    const codes = Object.keys(t.auth.validation) as ValidationErrorCode[];
    for (const code of codes) expect(validationMessage(code).length).toBeGreaterThan(0);
  });
});

describe('mapAuthError', () => {
  it.each([
    [{ name: 'AuthApiError', status: 400, code: 'invalid_credentials' }, 'invalid_credentials'],
    [{ name: 'AuthApiError', status: 422, code: 'user_already_exists' }, 'email_taken'],
    [{ name: 'AuthApiError', status: 422, code: 'email_exists' }, 'email_taken'],
    [{ name: 'AuthWeakPasswordError', status: 422, code: 'weak_password' }, 'weak_password'],
    [{ name: 'AuthWeakPasswordError', status: 422 }, 'weak_password'],
    [{ name: 'AuthApiError', status: 400, code: 'email_not_confirmed' }, 'email_not_confirmed'],
    [{ name: 'AuthApiError', status: 429, code: 'over_email_send_rate_limit' }, 'rate_limited'],
    [{ name: 'AuthApiError', status: 429 }, 'rate_limited'],
    [{ name: 'AuthRetryableFetchError', status: 0 }, 'network_error'],
    [new TypeError('Network request failed'), 'network_error'],
    [
      { name: 'AuthApiError', status: 400, message: 'Invalid login credentials' },
      'invalid_credentials',
    ],
    [{ name: 'AuthApiError', status: 422, message: 'User already registered' }, 'email_taken'],
    [{ name: 'AuthApiError', status: 500, code: 'unexpected_failure' }, 'unknown'],
    [new Error('boom'), 'unknown'],
    [null, 'unknown'],
    ['string error', 'unknown'],
  ] as const)('maps %p to %s', (error, expected) => {
    expect(mapAuthError(error)).toBe(expected);
  });

  it('has a Spanish message for every auth error code', () => {
    const codes = Object.keys(t.auth.errors) as (keyof typeof t.auth.errors)[];
    expect(codes.sort()).toEqual(
      [
        'email_not_confirmed',
        'email_taken',
        'invalid_credentials',
        'network_error',
        'rate_limited',
        'unknown',
        'weak_password',
      ].sort(),
    );
    for (const code of codes) expect(authErrorMessage(code)).toBe(t.auth.errors[code]);
  });
});
