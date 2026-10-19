// Pure form validators. They return English error codes (or null when valid);
// the UI maps codes to Spanish with `validationMessage`.
import { INPUT_LIMITS } from '@/lib/inputLimits';
import { charCount, cleanLine } from '@/lib/inputSanitizers';

export type ValidationErrorCode =
  | 'name_required'
  | 'name_too_long'
  | 'email_required'
  | 'email_invalid'
  | 'email_too_long'
  | 'password_required'
  | 'password_too_short'
  | 'password_too_long'
  | 'confirmation_required'
  | 'password_mismatch';

export const NAME_MAX_LENGTH = INPUT_LIMITS.displayName;
export const EMAIL_MAX_LENGTH = INPUT_LIMITS.email;
export const PASSWORD_MIN_LENGTH = INPUT_LIMITS.passwordMin;
export const PASSWORD_MAX_LENGTH = INPUT_LIMITS.passwordMax;

// Pragmatic check: something@domain.tld without spaces. The server is the final authority.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Display name as saved: control characters out, whitespace collapsed, trimmed. */
export function cleanDisplayName(name: string): string {
  return cleanLine(name);
}

/** Email as sent: trimmed and lowercased (inner spaces are rejected by `validateEmail`). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateDisplayName(name: string): ValidationErrorCode | null {
  const cleaned = cleanDisplayName(name);
  if (cleaned.length === 0) return 'name_required';
  if (charCount(cleaned) > NAME_MAX_LENGTH) return 'name_too_long';
  return null;
}

export function validateEmail(email: string): ValidationErrorCode | null {
  const trimmed = email.trim();
  if (trimmed.length === 0) return 'email_required';
  if (charCount(trimmed) > EMAIL_MAX_LENGTH) return 'email_too_long';
  if (!EMAIL_PATTERN.test(trimmed)) return 'email_invalid';
  return null;
}

/** Passwords are never trimmed or altered: every character counts. */
export function validatePassword(password: string): ValidationErrorCode | null {
  if (password.length === 0) return 'password_required';
  const length = charCount(password);
  if (length < PASSWORD_MIN_LENGTH) return 'password_too_short';
  if (length > PASSWORD_MAX_LENGTH) return 'password_too_long';
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
