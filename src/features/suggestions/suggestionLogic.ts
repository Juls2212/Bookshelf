// Pure rules of the form suggestions: which fields get a proposal, and how accepting one changes
// the form. A suggestion never overwrites something the user typed.
import type { BookFormValues } from '@/features/library/bookFormLogic';
import { PAGE_COUNT_MAX, PAGE_COUNT_MIN } from '@/features/library/bookValidation';

import type { SuggestedBook } from './bookSuggester';

export type SuggestField = 'title' | 'author' | 'genre' | 'pages';

/** `official`: the title proposal is the model's official title (not just accents or case). */
export type PendingSuggestion = { field: SuggestField; value: string; official?: true };

/** Order in which proposals are shown. */
const FIELD_ORDER: SuggestField[] = ['title', 'author', 'genre', 'pages'];

/** Characters needed in the title before suggestions can be asked for. */
const SUGGEST_TITLE_MIN_LENGTH = 3;

export function canAskForSuggestions(title: string): boolean {
  return Array.from(title.trim()).length >= SUGGEST_TITLE_MIN_LENGTH;
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

/** Same words, different only in accents or capitalization (e.g. "el tunel" -> "El túnel"). */
export function differsOnlyInAccentsOrCase(typed: string, suggested: string): boolean {
  const a = typed.trim().replace(/\s+/g, ' ');
  const b = suggested.trim().replace(/\s+/g, ' ');
  return a !== b && fold(a) === fold(b) && fold(a) !== '';
}

/** Same title once case, accents, punctuation and articles are ignored. */
function comparable(title: string): string {
  return fold(title)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((word) => word && !ARTICLES.has(word))
    .join(' ');
}

const ARTICLES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'the', 'a', 'an']);

/**
 * The title to propose: the official title when it differs meaningfully from the typed one,
 * else the candidate's title when it only fixes accents or capitalization. Never for an empty
 * title field.
 */
function proposedTitle(
  candidate: SuggestedBook,
  typed: string,
): { value: string; official?: true } | null {
  if (typed.trim() === '') return null;
  const canonical = candidate.canonicalTitle;
  if (canonical && comparable(canonical) !== comparable(typed)) {
    return { value: canonical, official: true };
  }
  return differsOnlyInAccentsOrCase(typed, candidate.title) ? { value: candidate.title } : null;
}

/** What a candidate proposes for a field, or null when it has nothing. */
function proposal(
  candidate: SuggestedBook,
  field: SuggestField,
  values: BookFormValues,
): PendingSuggestion | null {
  if (field === 'title') {
    const title = proposedTitle(candidate, values.title);
    return title ? { field, ...title } : null;
  }
  let value: string | null;
  if (field === 'author') value = candidate.author;
  else if (field === 'genre') value = candidate.genre;
  else {
    const pages = candidate.pageCount;
    value =
      pages != null && Number.isInteger(pages) && pages >= PAGE_COUNT_MIN && pages <= PAGE_COUNT_MAX
        ? String(pages)
        : null;
  }
  return value ? { field, value } : null;
}

/** Whether a proposal may still be applied to the current values. */
function applies(values: BookFormValues, suggestion: PendingSuggestion): boolean {
  const { field, value } = suggestion;
  if (field === 'title') {
    // The official title replaces a typed one only through its own tap; otherwise only an
    // accents or capitalization fix applies.
    return suggestion.official
      ? values.title.trim() !== '' && comparable(values.title) !== comparable(value)
      : differsOnlyInAccentsOrCase(values.title, value);
  }
  return values[field].trim() === '';
}

/**
 * Proposals of `candidate` for the current form: only for empty fields (author, genre, pages),
 * plus the title when it differs only in accents or capitalization, or when the model is
 * confident of the official title (a separate, optional proposal). `hidden` holds fields the
 * user dismissed or typed in after asking.
 */
export function pendingSuggestions(
  candidate: SuggestedBook | null,
  values: BookFormValues,
  hidden: ReadonlySet<SuggestField>,
): PendingSuggestion[] {
  if (!candidate) return [];
  const pending: PendingSuggestion[] = [];
  for (const field of FIELD_ORDER) {
    if (hidden.has(field)) continue;
    const suggestion = proposal(candidate, field, values);
    if (suggestion && applies(values, suggestion)) pending.push(suggestion);
  }
  return pending;
}

/** Applies one proposal, re-checked against the latest values (never overwrites typed text). */
export function applySuggestion(
  values: BookFormValues,
  suggestion: PendingSuggestion,
): BookFormValues {
  if (!applies(values, suggestion)) return values;
  return { ...values, [suggestion.field]: suggestion.value };
}

/**
 * "Usar todo": the empty fields, plus the title only when it just fixes accents or capitalization.
 * Replacing the typed title by the official one is always an explicit tap on the title row.
 */
export function applySuggestions(
  values: BookFormValues,
  suggestions: readonly PendingSuggestion[],
): BookFormValues {
  return suggestions.filter((s) => !s.official).reduce(applySuggestion, values);
}
