import { formatAmount, formatDate, humanizeCode, relevanceScore } from './search-scoring';

describe('global-search search-scoring', () => {
  describe('relevanceScore', () => {
    it('ranks exact > prefix > word-boundary > substring', () => {
      expect(relevanceScore('ravi', ['ravi'])).toBe(1);
      expect(relevanceScore('rav', ['Ravi Kumar'])).toBe(0.85);
      expect(relevanceScore('kumar', ['Ravi Kumar'])).toBe(0.7);
      expect(relevanceScore('av', ['Ravi Kumar'])).toBe(0.5);
      expect(relevanceScore('zzz', ['Ravi Kumar'])).toBe(0);
    });

    it('returns the best score across every label', () => {
      expect(relevanceScore('ece', ['Ravi Kumar', 'ECE2026'])).toBe(0.85);
    });

    it('returns 0 for a blank query', () => {
      expect(relevanceScore('   ', ['anything'])).toBe(0);
    });
  });

  describe('humanizeCode', () => {
    it('turns enum codes into display labels', () => {
      expect(humanizeCode('PARTIALLY_PAID')).toBe('Partially Paid');
      expect(humanizeCode(null)).toBeNull();
    });
  });

  describe('formatAmount / formatDate', () => {
    it('formats paise as rupees with two decimals', () => {
      expect(formatAmount(125000)).toBe('₹1,250.00');
      expect(formatAmount(null)).toBe('₹0.00');
    });

    it('formats a date as "DD Mon YYYY" and rejects garbage', () => {
      expect(formatDate(new Date('2026-03-12T00:00:00Z'))).toMatch(/12 Mar 2026/);
      expect(formatDate('not-a-date')).toBeNull();
      expect(formatDate(null)).toBeNull();
    });
  });
});
