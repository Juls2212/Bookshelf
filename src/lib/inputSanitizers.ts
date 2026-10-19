// Pure sanitizers for typed or pasted text. `*Input` functions run on every change and keep the
// text editable (they never trim the middle of what the user is typing); `clean*` functions run
// on save. Validators still re-check on submit: these are a convenience, never the guard.

// Control characters (except tab and line feed, which the callers handle), DEL, C1 controls and
// the zero-width/bidi characters used to hide text.
const CONTROL = new RegExp(
  '[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]',
  'g',
);

/** Number of code points ("ñ" and an emoji count as one). */
export function charCount(value: string): number {
  return Array.from(value).length;
}

/** Cuts to `max` code points (never in the middle of a surrogate pair). */
export function truncateChars(value: string, max: number): string {
  if (value.length <= max) return value;
  // A code point takes at most two UTF-16 units, so this prefix holds at least `max` of them;
  // it keeps the work bounded for absurdly long input.
  const chars = Array.from(value.slice(0, max * 2));
  if (value.length <= max * 2 && chars.length <= max) return value;
  return chars.slice(0, max).join('');
}

/** Digits only, at most `max` of them (numeric fields). */
export function digitsInput(value: string, max: number = 5): string {
  return value.replace(/[^0-9]/g, '').slice(0, max);
}

/** Single-line text while typing: control characters out, line breaks become spaces. */
export function lineInput(value: string, max: number): string {
  return truncateChars(value.replace(/[\r\n\t]+/g, ' ').replace(CONTROL, ''), max);
}

/** Multiline text while typing: control characters out (line breaks stay). */
export function multilineInput(value: string, max: number): string {
  return truncateChars(value.replace(/\r\n?/g, '\n').replace(CONTROL, ''), max);
}

/** Single-line text on save: no control characters, repeated whitespace collapsed, trimmed. */
export function cleanLine(value: string): string {
  return value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
}

/** Multiline text on save: spaces collapsed per line, at most one blank line in a row, trimmed. */
export function cleanMultiline(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, ' ')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Email while typing: lowercase, surrounding whitespace out, control characters out. */
export function emailInput(value: string, max: number): string {
  return truncateChars(value.replace(CONTROL, '').trim().toLowerCase(), max);
}
