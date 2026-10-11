// Pure form validators. They return English error codes (or null when valid);
// the UI maps codes to Spanish with `validationMessage`.
export type ValidationErrorCode =
  | 'name_required'
  | 'name_too_long'
  | 'email_required'
  | 'email_invalid'
  | 'password_required'
  | 'password_too_short'
  | 'confirmation_required'
  | 'password_mismatch';

export const NAME_MAX_LENGTH = 60;
export const PASSWORD_MIN_LENGTH = 8;

// Pragmatic check: something@domain.tld without spaces. The server is the final authority.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Counts user-perceived characters by code point (so "ñ" or emoji count as one). */
function characterCount(value: string): number {
  return Array.from(value).length;
}

export function validateDisplayName(name: string): ValidationErrorCode | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'name_required';
  if (characterCount(trimmed) > NAME_MAX_LENGTH) return 'name_too_long';
  return null;
}

export function validateEmail(email: string): ValidationErrorCode | null {
  const trimmed = email.trim();
  if (trimmed.length === 0) return 'email_required';
  if (!EMAIL_PATTERN.test(trimmed)) return 'email_invalid';
  return null;
}

export function validatePassword(password: string): ValidationErrorCode | null {
  if (password.length === 0) return 'password_required';
  if (characterCount(password) < PASSWORD_MIN_LENGTH) return 'password_too_short';
  return null;
}

export function validatePasswordConfirmation(
  password: string,
  confirmation: string,
): ValidationErrorCode | null {
  if (confirmation.length === 0) return 'confirmation_required';
  if (password !== confirmation) return 'password_mismatch';
  return null;
}
