/**
 * Demo module 09 — library: configuration, categories/publishers/authors, a small catalogue with
 * copies, members (students + faculty), an active/returned/overdue/lost loan mix with fines,
 * reservations and the full transaction ledger.
 */
import type { PrismaClient } from '@prisma/client';
import { demoDate, demoId, logDemo, spread, type DemoContext, type IdMap } from './core';
import { LIBRARY_AUTHORS, LIBRARY_PUBLISHERS } from './names';
import type { SeededPeople } from './people';

export interface LibraryInput {
  prisma: PrismaClient;
  ctx: DemoContext;
  org: IdMap;
  people: SeededPeople;
}

export async function seedLibrary(input: LibraryInput): Promise<{ books: number; loans: number; members: number }> {
  const { prisma, ctx, org, people } = input;
  const { tenantId, creator } = ctx;
  const id = (segment: string) => demoId(`library/${segment}`);
  const librarianUserId = people.staff['librarian']?.userId;

  await prisma.libraryConfig.upsert({
    where: { tenantId },
    update: {},
    create: {
      id: id('config'),
      tenantId,
      defaultLoanDays: 14,
      maxLoansPerMember: 5,
      renewalLimit: 2,
      overdueFinePerDayCents: 200,
      reservationHoldDays: 2,
      createdBy: creator,
    },
  });

  const sequences = [
    { kind: 'MEMBER' as const, prefix: 'LM', nextValue: 100 },
    { kind: 'COPY' as const, prefix: 'LB', nextValue: 100 },
    { kind: 'COPY' as const, prefix: 'AC', nextValue: 100 },
  ];
  for (const sequence of sequences) {
    await prisma.librarySequence.upsert({
      where: { tenantId_kind_prefix: { tenantId, kind: sequence.kind, prefix: sequence.prefix } },
      update: { nextValue: sequence.nextValue },
      create: {
        id: id(`sequence/${sequence.kind}/${sequence.prefix}`),
        tenantId,
        kind: sequence.kind,
        prefix: sequence.prefix,
        nextValue: sequence.nextValue,
      },
    });
  }

  // ------------------------------------------------------------------ catalogue
  const categories = [
    { code: 'CS', name: 'Computer Science', description: 'Programming, algorithms, systems and databases' },
    { code: 'EC', name: 'Electronics', description: 'Digital design, signals and communication' },
    { code: 'MGMT', name: 'Management', description: 'Marketing, finance and accounting' },
    { code: 'REF', name: 'Reference', description: 'Handbooks, encyclopaedias and exam guides' },
  ];
  const categoryIds: Record<string, string> = {};
  for (const category of categories) {
    const row = await prisma.libraryCategory.upsert({
      where: { tenantId_code: { tenantId, code: category.code } },
      update: { name: category.name, description: category.description },
      create: {
        id: id(`category/${category.code}`),
        tenantId,
        code: category.code,
        name: category.name,
        description: category.description,
        createdBy: creator,
      },
    });
    categoryIds[category.code] = row.id;
  }

  const publisherIds: Record<string, string> = {};
  for (const [index, publisher] of LIBRARY_PUBLISHERS.entries()) {
    const row = await prisma.libraryPublisher.upsert({
      where: { tenantId_code: { tenantId, code: publisher.code } },
      update: { name: publisher.name, city: publisher.city },
      create: {
        id: id(`publisher/${publisher.code}`),
        tenantId,
        code: publisher.code,
        name: publisher.name,
        city: publisher.city,
        country: 'India',
        createdBy: creator,
        updatedBy: undefined,
        email: `orders${index + 1}@publisher.example.com`,
      },
    });
    publisherIds[publisher.code] = row.id;
  }

  const authorIds: Record<string, string> = {};
  for (const [index, author] of LIBRARY_AUTHORS.entries()) {
    const [firstName, lastName] = author;
    const code = `AUTH-${String(index + 1).padStart(3, '0')}`;
    const row = await prisma.libraryAuthor.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: { fullName: `${firstName} ${lastName}` },
      create: {
        id: id(`author/${code}`),
        tenantId,
        code,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`,
        createdBy: creator,
      },
    });
    authorIds[`${firstName} ${lastName}`] = row.id;
  }

  const bookSpecs = [
    { key: 'book-clrs', title: 'Introduction to Algorithms', author: 'Thomas H. Cormen', category: 'CS', publisher: 'PUB-PHI', year: 2013, pages: 1312, replacement: 450_000, copies: 2 },
    { key: 'book-sedgewick', title: 'Algorithms, 4th Edition', author: 'Robert Sedgewick', category: 'CS', publisher: 'PUB-PEA', year: 2018, pages: 976, replacement: 420_000, copies: 1 },
    { key: 'book-dbconcepts', title: 'Database System Concepts', author: 'Abraham Silberschatz', category: 'CS', publisher: 'PUB-MCG', year: 2019, pages: 1376, replacement: 460_000, copies: 2 },
    { key: 'book-osconcepts', title: 'Operating System Concepts', author: 'Abraham Silberschatz', category: 'CS', publisher: 'PUB-WIL', year: 2018, pages: 1120, replacement: 440_000, copies: 2 },
    { key: 'book-networks', title: 'Computer Networks', author: 'Andrew S. Tanenbaum', category: 'CS', publisher: 'PUB-PEA', year: 2021, pages: 944, replacement: 430_000, copies: 2 },
    { key: 'book-csapp', title: 'Computer Systems: A Programmer\u2019s Perspective', author: 'Randal E. Bryant', category: 'CS', publisher: 'PUB-PEA', year: 2015, pages: 1120, replacement: 410_000, copies: 1 },
    { key: 'book-clean', title: 'Clean Code', author: 'Robert C. Martin', category: 'CS', publisher: 'PUB-PEA', year: 2008, pages: 464, replacement: 320_000, copies: 1 },
    { key: 'book-dd', title: 'Digital Design', author: 'M. Morris Mano', category: 'EC', publisher: 'PUB-PEA', year: 2018, pages: 720, replacement: 380_000, copies: 1 },
    { key: 'book-marketing', title: 'Marketing Management', author: 'Philip Kotler', category: 'MGMT', publisher: 'PUB-PEA', year: 2021, pages: 880, replacement: 520_000, copies: 1 },
    { key: 'book-finance', title: 'Corporate Finance', author: 'Stephen A. Ross', category: 'MGMT', publisher: 'PUB-MCG', year: 2020, pages: 1040, replacement: 540_000, copies: 1 },
    { key: 'book-cost', title: 'Cost Accounting: A Managerial Emphasis', author: 'Charles T. Horngren', category: 'MGMT', publisher: 'PUB-PEA', year: 2019, pages: 992, replacement: 510_000, copies: 1 },
  ] as const;

  const bookIds: Record<string, string> = {};
  const copyIds: Record<string, string> = {};
  let copySequence = 0;
  for (const [index, book] of bookSpecs.entries()) {
    const row = await prisma.libraryBook.upsert({
      where: { id: id(`book/${book.key}`) },
      update: { title: book.title, isActive: true },
      create: {
        id: id(`book/${book.key}`),
        tenantId,
        isbn: `978-93-${String(10000 + index * 137)}-${String(10 + index)}-${String(index + 1)}`,
        title: book.title,
        language: 'English',
        edition: index % 2 === 0 ? 'Latest' : undefined,
        pageCount: book.pages,
        publicationYear: book.year,
        categoryId: categoryIds[book.category] as string,
        publisherId: publisherIds[book.publisher] as string,
        replacementCostCents: book.replacement,
        maxLoanDays: 14,
        createdBy: creator,
      },
    });
    bookIds[book.key] = row.id;

    await prisma.libraryBookAuthor.upsert({
      where: { tenantId_bookId_authorId: { tenantId, bookId: row.id, authorId: authorIds[book.author] as string } },
      update: {},
      create: {
        id: id(`book-author/${book.key}`),
        tenantId,
        bookId: row.id,
        authorId: authorIds[book.author] as string,
      },
    });

    for (let copyIndex = 0; copyIndex < book.copies; copyIndex += 1) {
      copySequence += 1;
      const barcode = `LB-${String(copySequence).padStart(6, '0')}`;
      const accessionNumber = `AC-${String(copySequence).padStart(6, '0')}`;
      const copy = await prisma.libraryCopy.upsert({
        where: { tenantId_barcode: { tenantId, barcode } },
        update: { accessionNumber },
        create: {
          id: id(`copy/${barcode}`),
          tenantId,
          bookId: row.id,
          accessionNumber,
          barcode,
          shelfLocation: `Rack ${book.category}-${(index % 6) + 1}`,
          acquisitionType: 'PURCHASE',
          acquisitionDate: demoDate('2026-06-25'),
          purchasePriceCents: book.replacement,
          condition: 'NEW',
          status: 'AVAILABLE',
          createdBy: creator,
        },
      });
      copyIds[`${book.key}#${copyIndex + 1}`] = copy.id;
    }
  }

  // ------------------------------------------------------------------ members
  const memberIds: Record<string, string> = {};
  let memberSequence = 0;
  for (const student of people.students) {
    memberSequence += 1;
    const memberNumber = `LM-${String(memberSequence).padStart(6, '0')}`;
    const row = await prisma.libraryMember.upsert({
      where: { tenantId_studentId: { tenantId, studentId: student.id } },
      update: { status: 'ACTIVE', fullName: student.fullName },
      create: {
        id: id(`member/${student.admissionNumber}`),
        tenantId,
        memberNumber,
        studentId: student.id,
        userId: student.userId,
        fullName: student.fullName,
        email: student.email,
        phone: student.phone,
        memberType: 'STUDENT',
        status: 'ACTIVE',
        maxLoans: 5,
        membershipStart: demoDate('2026-07-20'),
        createdBy: creator,
      },
    });
    memberIds[student.key] = row.id;
  }
  for (const faculty of Object.values(people.staff).filter((member) => member.isFaculty)) {
    memberSequence += 1;
    const memberNumber = `LM-${String(memberSequence).padStart(6, '0')}`;
    const row = await prisma.libraryMember.upsert({
      where: { id: id(`member/${faculty.key}`) },
      update: { status: 'ACTIVE', fullName: faculty.fullName },
      create: {
        id: id(`member/${faculty.key}`),
        tenantId,
        memberNumber,
        userId: faculty.userId,
        fullName: faculty.fullName,
        email: faculty.email,
        memberType: 'FACULTY',
        status: 'ACTIVE',
        maxLoans: 8,
        membershipStart: demoDate('2026-07-01'),
        createdBy: creator,
      },
    });
    memberIds[faculty.key] = row.id;
  }

  // ------------------------------------------------------------------ loans + fines + transactions
  const studentList = people.students;
  interface LoanSpec {
    key: string;
    memberKey: string;
    studentIndex: number | null;
    copyKey: string;
    borrowedAt: string;
    dueDate: string;
    returnedAt: string | null;
    status: 'ISSUED' | 'RETURNED' | 'OVERDUE' | 'LOST';
    transaction: 'ISSUED' | 'RETURNED' | 'LOST';
  }
  const loanSpecs: LoanSpec[] = [
    { key: 'loan-1', memberKey: studentList[0]?.key ?? '', studentIndex: 0, copyKey: 'book-clrs#1', borrowedAt: '2026-10-01', dueDate: '2026-10-15', returnedAt: null, status: 'ISSUED', transaction: 'ISSUED' },
    { key: 'loan-2', memberKey: studentList[1]?.key ?? '', studentIndex: 1, copyKey: 'book-dbconcepts#1', borrowedAt: '2026-10-06', dueDate: '2026-10-20', returnedAt: null, status: 'ISSUED', transaction: 'ISSUED' },
    { key: 'loan-3', memberKey: studentList[2]?.key ?? '', studentIndex: 2, copyKey: 'book-networks#1', borrowedAt: '2026-10-08', dueDate: '2026-10-22', returnedAt: null, status: 'ISSUED', transaction: 'ISSUED' },
    { key: 'loan-4', memberKey: 'fac-cse1', studentIndex: null, copyKey: 'book-sedgewick#1', borrowedAt: '2026-10-05', dueDate: '2026-10-26', returnedAt: null, status: 'ISSUED', transaction: 'ISSUED' },
    { key: 'loan-5', memberKey: studentList[3]?.key ?? '', studentIndex: 3, copyKey: 'book-osconcepts#1', borrowedAt: '2026-09-01', dueDate: '2026-09-15', returnedAt: '2026-09-12', status: 'RETURNED', transaction: 'RETURNED' },
    { key: 'loan-6', memberKey: studentList[4]?.key ?? '', studentIndex: 4, copyKey: 'book-clean#1', borrowedAt: '2026-09-05', dueDate: '2026-09-19', returnedAt: '2026-09-18', status: 'RETURNED', transaction: 'RETURNED' },
    { key: 'loan-7', memberKey: studentList[5]?.key ?? '', studentIndex: 5, copyKey: 'book-csapp#1', borrowedAt: '2026-09-05', dueDate: '2026-09-19', returnedAt: null, status: 'OVERDUE', transaction: 'ISSUED' },
    { key: 'loan-8', memberKey: studentList[6]?.key ?? '', studentIndex: 6, copyKey: 'book-marketing#1', borrowedAt: '2026-08-01', dueDate: '2026-08-15', returnedAt: null, status: 'LOST', transaction: 'LOST' },
  ];

  for (const [index, spec] of loanSpecs.entries()) {
    const memberId = memberIds[spec.memberKey] as string;
    if (!memberId) continue;
    const student = spec.studentIndex !== null ? studentList[spec.studentIndex] : undefined;
    const bookKey = spec.copyKey.split('#')[0] ?? '';
    const book = bookSpecs.find((candidate) => candidate.key === bookKey);

    const loan = await prisma.studentLibraryLoan.upsert({
      where: { id: id(`loan/${spec.key}`) },
      update: { status: spec.status, returnedAt: spec.returnedAt ? demoDate(spec.returnedAt) : null },
      create: {
        id: id(`loan/${spec.key}`),
        tenantId,
        studentId: student?.id ?? null,
        copyId: copyIds[spec.copyKey] as string,
        memberId,
        itemTitle: book?.title ?? 'Library item',
        itemAuthor: book?.author,
        itemCode: spec.copyKey.split('#')[1],
        itemType: 'BOOK',
        borrowedAt: demoDate(spec.borrowedAt),
        dueDate: demoDate(spec.dueDate),
        returnedAt: spec.returnedAt ? demoDate(spec.returnedAt) : null,
        status: spec.status,
        renewalCount: 0,
        fineCents: spec.status === 'OVERDUE' ? 6000 : 0,
        createdBy: creator,
      },
    });

    // Copy status follows the loan.
    await prisma.libraryCopy.update({
      where: { id: copyIds[spec.copyKey] as string },
      data: {
        status: spec.status === 'RETURNED' ? 'AVAILABLE' : spec.status === 'LOST' ? 'LOST' : 'ISSUED',
      },
    });

    await prisma.libraryTransaction.upsert({
      where: { id: id(`transaction/${spec.key}/issued`) },
      update: {},
      create: {
        id: id(`transaction/${spec.key}/issued`),
        tenantId,
        copyId: copyIds[spec.copyKey] as string,
        loanId: loan.id,
        memberId,
        type: 'ISSUED',
        occurredAt: demoDate(spec.borrowedAt),
        actorUserId: librarianUserId,
        notes: 'Issued at the circulation desk',
      },
    });
    if (spec.returnedAt) {
      await prisma.libraryTransaction.upsert({
        where: { id: id(`transaction/${spec.key}/returned`) },
        update: {},
        create: {
          id: id(`transaction/${spec.key}/returned`),
          tenantId,
          copyId: copyIds[spec.copyKey] as string,
          loanId: loan.id,
          memberId,
          type: 'RETURNED',
          occurredAt: demoDate(spec.returnedAt),
          actorUserId: librarianUserId,
          notes: 'Returned in good condition',
        },
      });
    }
    if (spec.status === 'OVERDUE') {
      await prisma.libraryFine.upsert({
        where: { id: id(`fine/${spec.key}`) },
        update: { status: 'PENDING' },
        create: {
          id: id(`fine/${spec.key}`),
          tenantId,
          loanId: loan.id,
          memberId,
          type: 'OVERDUE',
          amountCents: 6000,
          paidCents: 0,
          status: 'PENDING',
          reason: 'Overdue by 21 days at \u20b92/day',
          createdBy: creator,
        },
      });
    }
    if (spec.status === 'LOST') {
      await prisma.libraryFine.upsert({
        where: { id: id(`fine/${spec.key}`) },
        update: { status: 'PENDING' },
        create: {
          id: id(`fine/${spec.key}`),
          tenantId,
          loanId: loan.id,
          memberId,
          type: 'LOST',
          amountCents: book?.replacement ?? 400_000,
          paidCents: 0,
          status: 'PENDING',
          reason: 'Item reported lost — replacement cost',
          createdBy: creator,
        },
      });
    }
    void index;
  }

  // Reservations waiting for popular titles.
  for (const [index, studentKey] of [studentList[7]?.key, studentList[8]?.key].entries()) {
    if (!studentKey) continue;
    await prisma.libraryReservation.upsert({
      where: { id: id(`reservation/${index + 1}`) },
      update: { status: 'WAITING' },
      create: {
        id: id(`reservation/${index + 1}`),
        tenantId,
        bookId: bookIds['book-clrs'] as string,
        memberId: memberIds[studentKey] as string,
        status: 'WAITING',
        reservedAt: demoDate(`2026-10-0${index + 2}`),
        holdUntil: demoDate('2026-10-25'),
        notes: 'Requested for the algorithms assignment',
        createdBy: creator,
      },
    });
  }

  logDemo('library', {
    books: bookSpecs.length,
    copies: copySequence,
    members: memberSequence,
    loans: loanSpecs.length,
  });

  void spread;
  void org;
  return { books: bookSpecs.length, loans: loanSpecs.length, members: memberSequence };
}
