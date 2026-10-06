import type { Response } from 'express';
import {
  applyPaginationMetadata,
  buildPaginationLink,
  normalizePagination,
  pageFromSkip,
  searchContains,
  toOrderBy,
  totalPages,
} from './pagination.util';

function mockRes() {
  const headers = new Map<string, string>();
  return {
    setHeader: (name: string, value: string) => {
      headers.set(name, value);
    },
    get: (name: string) => headers.get(name),
  } as unknown as Response;
}

describe('normalizePagination', () => {
  it('applies defaults when omitted', () => {
    expect(normalizePagination()).toEqual({ skip: 0, take: 20 });
    expect(normalizePagination({})).toEqual({ skip: 0, take: 20 });
  });

  it('clamps negatives and the page-size cap', () => {
    expect(normalizePagination({ skip: -5, take: 9999 })).toEqual({ skip: 0, take: 200 });
    expect(normalizePagination({ skip: 3.9, take: 4.2 })).toEqual({ skip: 3, take: 4 });
  });
});

describe('totalPages / pageFromSkip', () => {
  it('computes page counts', () => {
    expect(totalPages(0, 20)).toBe(0);
    expect(totalPages(40, 20)).toBe(2);
    expect(totalPages(41, 20)).toBe(3);
  });

  it('computes 1-based pages from offsets', () => {
    expect(pageFromSkip(0, 20)).toBe(1);
    expect(pageFromSkip(20, 20)).toBe(2);
  });
});

describe('applyPaginationMetadata', () => {
  it('sets count/page headers and skips Link when no url given', () => {
    const res = mockRes();
    const meta = applyPaginationMetadata(res, 45, { skip: 20, take: 20 });
    expect(meta).toEqual({ total: 45, skip: 20, take: 20, page: 2, totalPages: 3 });
    expect(res.get('X-Total-Count')).toBe('45');
    expect(res.get('X-Page')).toBe('2');
    expect(res.get('X-Page-Size')).toBe('20');
    expect(res.get('Link')).toBeUndefined();
  });

  it('emits prev/next Link headers for a middle page', () => {
    const res = mockRes();
    applyPaginationMetadata(res, 45, { skip: 20, take: 20 }, '/students?status=ACTIVE');
    expect(res.get('Link')).toBe(
      '</students?status=ACTIVE&skip=0&take=20>; rel="prev", </students?status=ACTIVE&skip=40&take=20>; rel="next"',
    );
  });
});

describe('searchContains / toOrderBy', () => {
  it('maps a validated sort key to a prisma orderBy', () => {
    expect(toOrderBy('fullName', 'desc')).toEqual({ fullName: 'desc' });
    expect(toOrderBy('createdAt', undefined)).toEqual({ createdAt: 'asc' });
    expect(toOrderBy(undefined, 'asc')).toBeUndefined();
  });

  it('builds OR contains clauses for searchable fields', () => {
    expect(searchContains('ravi', ['firstName', 'lastName'])).toEqual([
      { firstName: { contains: 'ravi', mode: 'insensitive' } },
      { lastName: { contains: 'ravi', mode: 'insensitive' } },
    ]);
    expect(searchContains(undefined, ['firstName'])).toBeUndefined();
    expect(searchContains('', ['firstName'])).toBeUndefined();
  });
});

describe('buildPaginationLink', () => {
  it('formats an RFC 8288 link header value', () => {
    expect(buildPaginationLink({ path: '/audit-logs', skip: 40, take: 20 }, 'next')).toBe(
      '</audit-logs?skip=40&take=20>; rel="next"',
    );
  });
});