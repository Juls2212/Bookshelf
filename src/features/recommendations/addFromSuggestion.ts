// "Añadir a mi estante" for a "Nuevas aventuras" suggestion: the add-book form opens prefilled
// (everything stays editable) through route params, and the suggestion is marked once saved.
import { emptyBookForm, type BookFormValues } from '@/features/library/bookFormLogic';
import { PAGE_COUNT_MAX, PAGE_COUNT_MIN } from '@/features/library/bookValidation';

import type { Recommendation } from './recommendationRules';

/** Route params of /book/new (strings only, as expo-router passes them). */
export type SuggestionParams = {
  title?: string;
  author?: string;
  genre?: string;
  pages?: string;
  /** The recommendation id to mark after saving. */
  suggestion?: string;
};

export function suggestionToParams(recommendation: Recommendation): SuggestionParams | null {
  const s = recommendation.suggestion;
  if (recommendation.kind !== 'discovery' || !s) return null;
  const params: SuggestionParams = { title: s.title, suggestion: recommendation.id };
  if (s.author) params.author = s.author;
  if (s.genre) params.genre = s.genre;
  if (s.pageCount) params.pages = String(s.pageCount);
  return params;
}

const param = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? '';

/** Form values from the params (a new book "to read"); null when there is no suggestion. */
export function formValuesFromParams(params: {
  [K in keyof SuggestionParams]?: string | string[];
}): { values: BookFormValues; suggestionId: string } | null {
  const suggestionId = param(params.suggestion);
  const title = param(params.title);
  if (!suggestionId || !title) return null;
  const pages = Number.parseInt(param(params.pages), 10);
  return {
    suggestionId,
    values: {
      ...emptyBookForm,
      title,
      author: param(params.author),
      genre: param(params.genre),
      pages:
        Number.isInteger(pages) && pages >= PAGE_COUNT_MIN && pages <= PAGE_COUNT_MAX
          ? String(pages)
          : '',
    },
  };
}
