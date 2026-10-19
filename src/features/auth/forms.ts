// Form-level validation for the auth screens. Pure: returns English codes per field.
import {
  validateDisplayName,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
  type ValidationErrorCode,
} from './validation';

type FormErrors<K extends string> = Partial<Record<K, ValidationErrorCode>>;

type LoginValues = { email: string; password: string };
export type RegisterValues = {
  displayName: string;
  email: string;
  password: string;
  confirmation: string;
};

function collect<K extends string>(checks: [K, ValidationErrorCode | null][]): FormErrors<K> {
  const errors: FormErrors<K> = {};
  for (const [field, code] of checks) if (code) errors[field] = code;
  return errors;
}

export function hasErrors(errors: FormErrors<string>): boolean {
  return Object.keys(errors).length > 0;
}

/** Login only requires a password; its length is the server's decision. */
export function validateLoginForm(values: LoginValues): FormErrors<keyof LoginValues> {
  return collect<keyof LoginValues>([
    ['email', validateEmail(values.email)],
    ['password', values.password.length === 0 ? 'password_required' : null],
  ]);
}

export function validateRegisterForm(values: RegisterValues): FormErrors<keyof RegisterValues> {
  return collect<keyof RegisterValues>([
    ['displayName', validateDisplayName(values.displayName)],
    ['email', validateEmail(values.email)],
    ['password', validatePassword(values.password)],
    ['confirmation', validatePasswordConfirmation(values.password, values.confirmation)],
  ]);
}

export function validateResetForm(email: string): FormErrors<'email'> {
  return collect<'email'>([['email', validateEmail(email)]]);
}
