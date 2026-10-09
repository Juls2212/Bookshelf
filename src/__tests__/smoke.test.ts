import { t } from '@/i18n';

describe('smoke', () => {
  it('resolves modules through the @/ alias', () => {
    expect(typeof t.tabs.home).toBe('string');
  });
});
