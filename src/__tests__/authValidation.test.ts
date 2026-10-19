import { authErrorMessage, mapAuthError, validationMessage } from '@/features/auth/authErrors';
import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validateDisplayName,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
  type ValidationErrorCode,
} from '@/features/auth/validation';
import { t } from '@/i18n';
import { INPUT_LIMITS } from '@/lib/inputLimits';

describe('validators', () => {
  it('validates the display name (1-50 characters, trimmed)', () => {
    expect(validateDisplayName('Ana')).toBeNull();
    expect(validateDisplayName('   ')).toBe('name_required');
    expect(validateDisplayName('a'.repeat(50))).toBeNull();
    expect(validateDisplayName('a'.repeat(51))).toBe('name_too_long');
    // Multi-byte characters count once.
    expect(validateDisplayName('ñ'.repeat(50))).toBeNull();
    expect(validateDisplayName('📚'.repeat(50))).toBeNull();
    // Control characters and repeated spaces do not count as content.
    expect(validateDisplayName('\u0000\u0007 \n')).toBe('name_required');
    expect(validateDisplayName(`${'a'.repeat(24)}${' '.repeat(40)}${'b'.repeat(25)}`)).toBeNull();
  });

  it('limits the email to 254 characters and rejects spaces inside', () => {
    const local = 'a'.repeat(64);
    const long = `${local}@${'b'.repeat(180)}.com`;
    expect(long.length).toBeLessThanOrEqual(254);
    expect(validateEmail(long)).toBeNull();
    expect(validateEmail(`${'a'.repeat(250)}@example.com`)).toBe('email_too_long');
    expect(validateEmail('a b@example.com')).toBe('email_invalid');
    expect(validateEmail('a@exa mple.com')).toBe('email_invalid');
  });

  it('limits passwords to 8-72 characters and never trims them', () => {
    expect(validatePassword('a'.repeat(72))).toBeNull();
    expect(validatePassword('a'.repeat(73))).toBe('password_too_long');
    // Spaces count: eight spaces are a valid (if poor) password, not "empty".
    expect(validatePassword('        ')).toBeNull();
    expect(validatePassword(' 1234567 ')).toBeNull();
    expect(validatePasswordConfirmation(' abc ', 'abc')).toBe('password_mismatch');
  });

  it('takes its numbers from the central limits', () => {
    expect(NAME_MAX_LENGTH).toBe(INPUT_LIMITS.displayName);
    expect(EMAIL_MAX_LENGTH).toBe(INPUT_LIMITS.email);
    expect(PASSWORD_MIN_LENGTH).toBe(INPUT_LIMITS.passwordMin);
    expect(PASSWORD_MAX_LENGTH).toBe(INPUT_LIMITS.passwordMax);
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
