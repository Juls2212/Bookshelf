import { validateBook, validateLentTo, validateNotes } from '@/features/library/bookValidation';
import { INPUT_LIMITS } from '@/lib/inputLimits';

import {
  CONTEXT_MAX_LENGTH as DISCOVER_CONTEXT,
  parseDiscoverRequest,
} from '../../supabase/functions/_shared/discoverBook';
import { parseFindCoverRequest } from '../../supabase/functions/_shared/findCover';
import * as edge from '../../supabase/functions/_shared/inputLimits';
import { parseRecommendRequest } from '../../supabase/functions/_shared/recommendBook';
import { parseSuggestRequest } from '../../supabase/functions/_shared/suggestBookDetails';

// Node built-ins for the source checks below (the app tsconfig has no Node types).
type FsLike = {
  readFileSync(file: string, encoding: 'utf8'): string;
  readdirSync(dir: string): string[];
};
type PathLike = { join(...parts: string[]): string };
const fs = jest.requireActual<FsLike>('fs');
const path = jest.requireActual<PathLike>('path');
declare const __dirname: string;

const root = path.join(__dirname, '..', '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('central limits', () => {
  it('has one constant per field with the documented values', () => {
    expect(INPUT_LIMITS).toMatchObject({
      title: 200,
      author: 120,
      genre: 60,
      notes: 2000,
      lentTo: 80,
      displayName: 50,
      email: 254,
      passwordMin: 8,
      passwordMax: 72,
      search: 100,
      aiContext: 200,
      pageDigits: 5,
      pageCountMin: 1,
      pageCountMax: 10_000,
    });
  });

  it('is the same on the Edge Function side', () => {
    expect(edge.TITLE_MAX_LENGTH).toBe(INPUT_LIMITS.title);
    expect(edge.AUTHOR_MAX_LENGTH).toBe(INPUT_LIMITS.author);
    expect(edge.CONTEXT_MAX_LENGTH).toBe(INPUT_LIMITS.aiContext);
    expect(edge.PAGE_COUNT_MAX).toBe(INPUT_LIMITS.pageCountMax);
    // Model output is capped tighter than the typed genre field (the discovery table allows 40).
    expect(edge.GENRE_MAX_LENGTH).toBeLessThanOrEqual(INPUT_LIMITS.genre);
  });
});

describe('book validators use the limits', () => {
  const ok = { pageCount: 100 };

  it('accepts text at the limit and rejects one more character', () => {
    expect(validateBook({ title: 't'.repeat(200), ...ok })).toEqual([]);
    expect(validateBook({ title: 't'.repeat(201), ...ok })).toEqual(['title_too_long']);
    expect(validateBook({ title: 'T', author: 'a'.repeat(120), ...ok })).toEqual([]);
    expect(validateBook({ title: 'T', author: 'a'.repeat(121), ...ok })).toEqual([
      'author_too_long',
    ]);
    expect(validateBook({ title: 'T', genre: 'g'.repeat(60), ...ok })).toEqual([]);
    expect(validateBook({ title: 'T', genre: 'g'.repeat(61), ...ok })).toEqual(['genre_too_long']);
    expect(validateNotes('n'.repeat(2000))).toBeNull();
    expect(validateNotes('n'.repeat(2001))).toBe('notes_too_long');
    expect(validateLentTo('l'.repeat(80))).toBeNull();
    expect(validateLentTo('l'.repeat(81))).toBe('lent_to_too_long');
  });

  it('counts characters, not UTF-16 units', () => {
    expect(validateBook({ title: '📚'.repeat(200), ...ok })).toEqual([]);
    expect(validateBook({ title: '📚'.repeat(201), ...ok })).toEqual(['title_too_long']);
  });

  it('validates the length of what is saved (cleaned), not of the raw paste', () => {
    expect(validateBook({ title: `  ${'t'.repeat(200)}   `, ...ok })).toEqual([]);
    expect(
      validateBook({ title: `${'t'.repeat(99)}${' '.repeat(500)}${'u'.repeat(100)}`, ...ok }),
    ).toEqual([]);
  });

  it('requires pages from 1 to 10000', () => {
    expect(validateBook({ title: 'T', pageCount: 10_000 })).toEqual([]);
    expect(validateBook({ title: 'T', pageCount: 10_001 })).toEqual(['page_count_invalid']);
    expect(validateBook({ title: 'T', pageCount: 0 })).toEqual(['page_count_invalid']);
    expect(validateBook({ title: 'T', pageCount: null })).toEqual(['page_count_required']);
  });
});

describe('Edge Function validators use the limits', () => {
  it('suggest-book-details: title 200, author 120', () => {
    expect(parseSuggestRequest({ title: 'a'.repeat(200) }).ok).toBe(true);
    expect(parseSuggestRequest({ title: 'a'.repeat(201) })).toEqual({
      ok: false,
      error: 'invalid_request',
    });
    expect(parseSuggestRequest({ title: 'Rayuela', author: 'a'.repeat(121) })).toEqual({
      ok: false,
      error: 'invalid_request',
    });
  });

  it('find-cover: title 200, author 120', () => {
    expect(parseFindCoverRequest({ title: 'a'.repeat(200) }).ok).toBe(true);
    expect(parseFindCoverRequest({ title: 'a'.repeat(201) })).toEqual({
      ok: false,
      error: 'invalid_request',
    });
    expect(parseFindCoverRequest({ title: 'Rayuela', author: 'a'.repeat(121) })).toEqual({
      ok: false,
      error: 'invalid_request',
    });
  });

  it('recommend-book and discover-book: context 200', () => {
    expect(DISCOVER_CONTEXT).toBe(200);
    const base = { local_weekday: 1, local_hour: 9 };
    expect(parseRecommendRequest({ ...base, context: 'c'.repeat(200) }).ok).toBe(true);
    expect(parseRecommendRequest({ ...base, context: 'c'.repeat(201) })).toEqual({
      ok: false,
      error: 'invalid_request',
    });
    expect(parseDiscoverRequest({ ...base, context: 'c'.repeat(200) }).ok).toBe(true);
    expect(parseDiscoverRequest({ ...base, context: 'c'.repeat(201) })).toEqual({
      ok: false,
      error: 'invalid_request',
    });
  });

  it('discover-book: an excluded suggestion with an overlong title or author is rejected', () => {
    const base = { local_weekday: 1, local_hour: 9 };
    expect(
      parseDiscoverRequest({ ...base, exclude_suggestions: [{ title: 't'.repeat(201) }] }),
    ).toEqual({ ok: false, error: 'invalid_request' });
    expect(
      parseDiscoverRequest({
        ...base,
        exclude_suggestions: [{ title: 'T', author: 'a'.repeat(121) }],
      }),
    ).toEqual({ ok: false, error: 'invalid_request' });
  });
});

describe('input constraints migration', () => {
  const sql = read('supabase/migrations/20261015000000_input_constraints.sql');
  const lengthChecks: [string, number][] = [
    ['user_books_title_length', INPUT_LIMITS.title],
    ['user_books_author_length', INPUT_LIMITS.author],
    ['user_books_genre_length', INPUT_LIMITS.genre],
    ['user_books_notes_length', INPUT_LIMITS.notes],
    ['user_books_lent_to_length', INPUT_LIMITS.lentTo],
    ['profiles_display_name_length', INPUT_LIMITS.displayName],
  ];

  it.each(lengthChecks)('%s mirrors the app limit (%i)', (name, limit) => {
    const match = new RegExp(`add constraint ${name}[^;]*?<= (\\d+)`, 'i').exec(sql);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(limit);
  });

  it('mirrors the page ranges', () => {
    expect(sql).toMatch(
      new RegExp(
        `user_books_page_count_range[\\s\\S]*?between ${INPUT_LIMITS.pageCountMin} and ${INPUT_LIMITS.pageCountMax}`,
      ),
    );
    expect(sql).toMatch(
      new RegExp(`user_books_current_page_cap[\\s\\S]*?between 0 and ${INPUT_LIMITS.pageCountMax}`),
    );
  });

  it('is idempotent: every constraint is dropped if it exists before being added', () => {
    const added = [...sql.matchAll(/add constraint (\w+)/gi)].map((m) => m[1]);
    expect(added.length).toBeGreaterThanOrEqual(8);
    for (const name of added) {
      const drop = sql.search(new RegExp(`drop constraint if exists ${name}\\b`, 'i'));
      const add = sql.search(new RegExp(`add constraint ${name}\\b`, 'i'));
      expect(drop).toBeGreaterThanOrEqual(0);
      expect(drop).toBeLessThan(add);
    }
    // No bare "add column" / "create table" / "drop table" that would fail on a second run.
    expect(sql).not.toMatch(/create table (?!if not exists)/i);
    expect(sql).not.toMatch(/drop table/i);
  });

  it('cleans existing values before adding the constraints', () => {
    const firstConstraint = sql.search(/add constraint/i);
    for (const column of ['title', 'author', 'genre', 'notes', 'lent_to', 'display_name']) {
      const update = sql.search(new RegExp(`set ${column} = left\\(`, 'i'));
      expect(update).toBeGreaterThanOrEqual(0);
      expect(update).toBeLessThan(firstConstraint);
    }
    expect(sql.search(/set page_count = 10000/i)).toBeLessThan(firstConstraint);
    expect(sql.search(/set current_page = least/i)).toBeLessThan(firstConstraint);
  });

  it('keeps the sign-up trigger from failing on a long name', () => {
    expect(sql).toMatch(
      /left\(nullif\(btrim\(new\.raw_user_meta_data ->> 'display_name'\), ''\), 50\)/,
    );
  });

  it('does not edit earlier migrations: it only adds a new file', () => {
    const names = fs.readdirSync(path.join(root, 'supabase/migrations')).sort();
    expect(names[names.length - 1]).toBe('20261015000000_input_constraints.sql');
  });

  it('has a test file with a rejection case for every constraint', () => {
    const tests = read('supabase/tests/constraints.sql');
    for (const label of [
      'title 201',
      'author 121',
      'genre 61',
      'notes 2001',
      'lent_to 81',
      'page_count 0',
      'page_count 10001',
      'current_page -1',
      'current_page above page_count',
      'display_name 51',
    ]) {
      expect(tests).toContain(`'${label}'`);
    }
    expect(tests).toMatch(/rollback;\s*$/);
  });
});
