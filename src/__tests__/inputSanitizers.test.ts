import {
  charCount,
  cleanLine,
  cleanMultiline,
  digitsInput,
  emailInput,
  lineInput,
  multilineInput,
  truncateChars,
} from '@/lib/inputSanitizers';

describe('digitsInput', () => {
  it('strips everything that is not a digit (pasted letters, signs, spaces, emoji)', () => {
    expect(digitsInput('abc')).toBe('');
    expect(digitsInput('2a6-4 ')).toBe('264');
    expect(digitsInput('-5')).toBe('5');
    expect(digitsInput('1.5e3')).toBe('153');
    expect(digitsInput('1📚2')).toBe('12');
    expect(digitsInput('٣٤')).toBe('');
  });

  it('keeps at most the given number of digits', () => {
    expect(digitsInput('1234567')).toBe('12345');
    expect(digitsInput('1234567', 3)).toBe('123');
  });
});

describe('lineInput', () => {
  it('removes control characters and turns line breaks and tabs into spaces', () => {
    expect(lineInput('a\u0000b\u0007c', 50)).toBe('abc');
    expect(lineInput('line1\nline2\r\nline3\ttab', 50)).toBe('line1 line2 line3 tab');
    expect(lineInput('x​y‮z', 50)).toBe('xyz');
  });

  it('does not touch spaces while typing', () => {
    expect(lineInput('El nombre ', 50)).toBe('El nombre ');
  });

  it('cuts to the limit by characters, never splitting an emoji', () => {
    expect(lineInput('a'.repeat(300), 200)).toHaveLength(200);
    const cut = lineInput('📚'.repeat(300), 200);
    expect(charCount(cut)).toBe(200);
    expect(cut).toBe('📚'.repeat(200));
  });
});

describe('multilineInput', () => {
  it('keeps line breaks but drops control characters', () => {
    expect(multilineInput('a\r\nb\rc\u0000d', 100)).toBe('a\nb\ncd');
  });
});

describe('cleanLine (on save)', () => {
  it('collapses repeated whitespace and trims', () => {
    expect(cleanLine('  El   nombre \n de la\t rosa  ')).toBe('El nombre de la rosa');
    expect(cleanLine('\u0000\u0001  ')).toBe('');
    expect(cleanLine('a\u0007b')).toBe('a b');
  });
});

describe('cleanMultiline (on save)', () => {
  it('collapses spaces per line, keeps single blank lines and trims', () => {
    expect(cleanMultiline('  uno   dos \n\n\n\n tres  \n')).toBe('uno dos\n\ntres');
    expect(cleanMultiline('\n\n  ')).toBe('');
  });
});

describe('emailInput', () => {
  it('lowercases and trims, so a paste with surrounding spaces is fine', () => {
    expect(emailInput('  Ana@Example.COM  ', 254)).toBe('ana@example.com');
  });

  it('leaves inner spaces for the validator to reject', () => {
    expect(emailInput('a b@c.com', 254)).toBe('a b@c.com');
  });

  it('cuts to the limit', () => {
    expect(emailInput('a'.repeat(400), 254)).toHaveLength(254);
  });
});

describe('truncateChars', () => {
  it('returns short text unchanged', () => {
    expect(truncateChars('hola', 10)).toBe('hola');
    expect(truncateChars('📚📚', 2)).toBe('📚📚');
  });

  it('survives very long unbroken strings', () => {
    const huge = 'x'.repeat(2_000_000);
    expect(truncateChars(huge, 200)).toHaveLength(200);
    expect(charCount(truncateChars('📚'.repeat(1_000_000), 200))).toBe(200);
  });

  it('cuts exactly at the limit when the text is all surrogate pairs and longer', () => {
    expect(charCount(truncateChars('📚'.repeat(201), 200))).toBe(200);
  });
});
