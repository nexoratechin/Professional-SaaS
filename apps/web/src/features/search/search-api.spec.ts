import { buildSearchQuery } from './search-params';

describe('search-params buildSearchQuery', () => {
  it('always carries the query', () => {
    expect(buildSearchQuery({ q: 'ravi' })).toBe('q=ravi');
  });

  it('joins the type filter with commas', () => {
    expect(buildSearchQuery({ q: 'ravi', types: ['student', 'payment'] })).toBe('q=ravi&types=student%2Cpayment');
  });

  it('omits an empty type filter and includes take when set', () => {
    expect(buildSearchQuery({ q: 'x', types: [], take: 8 })).toBe('q=x&take=8');
  });

  it('encodes characters that would otherwise break the URL', () => {
    expect(buildSearchQuery({ q: 'a b&c' })).toBe('q=a+b%26c');
  });
});
