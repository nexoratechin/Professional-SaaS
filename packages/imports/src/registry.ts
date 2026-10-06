/**
 * Canonical import entity registry — the single source of truth for templates, column mapping,
 * validation, and (for generic entities) the field→Prisma mapping used by the worker.
 *
 * Adding a new importable entity is a change to this file plus, where the write needs more than
 * one table (attendance/marks), a small strategy branch in the worker's processor.
 */
import type { ImportEntityDefinition, ImportEntityKey, ImportFieldDef } from './types';
import { IMPORT_ENTITY_KEYS } from './types';

function field(def: ImportFieldDef): ImportFieldDef {
  return def;
}

const STUDENT_STATUSES = [
  'APPLICANT',
  'ADMITTED',
  'PROVISIONAL',
  'ENROLLED',
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'WITHDRAWN',
  'GRADUATED',
  'ALUMNI',
] as const;

const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'NOT_SPECIFIED'] as const;

const BLOOD_GROUPS = [
  'A_POSITIVE',
  'A_NEGATIVE',
  'B_POSITIVE',
  'B_NEGATIVE',
  'AB_POSITIVE',
  'AB_NEGATIVE',
  'O_POSITIVE',
  'O_NEGATIVE',
  'UNKNOWN',
] as const;

const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE'] as const;

export const IMPORT_ENTITIES: Record<ImportEntityKey, ImportEntityDefinition> = {
  students: {
    key: 'students',
    label: 'Students',
    model: 'student',
    module: 'students',
    importPermission: 'students.create',
    viewPermission: 'students.view',
    strategy: 'generic',
    duplicateKey: ['admissionNumber'],
    fields: [
      field({ field: 'admissionNumber', header: 'Admission No', required: true, type: 'string', maxLength: 64, sample: 'ADM-2026-0001' }),
      field({ field: 'rollNumber', header: 'Roll No', type: 'string', maxLength: 64 }),
      field({ field: 'registrationNumber', header: 'Registration No', type: 'string', maxLength: 64 }),
      field({ field: 'firstName', header: 'First Name', required: true, type: 'string', maxLength: 100, sample: 'Aarav' }),
      field({ field: 'middleName', header: 'Middle Name', type: 'string', maxLength: 100 }),
      field({ field: 'lastName', header: 'Last Name', required: true, type: 'string', maxLength: 100, sample: 'Sharma' }),
      field({ field: 'gender', header: 'Gender', type: 'enum', enumValues: GENDERS, sample: 'MALE' }),
      field({ field: 'bloodGroup', header: 'Blood Group', type: 'enum', enumValues: BLOOD_GROUPS }),
      field({ field: 'dateOfBirth', header: 'Date of Birth', type: 'date', sample: '2005-06-14' }),
      field({ field: 'email', header: 'Email', type: 'string', maxLength: 200 }),
      field({ field: 'primaryPhone', header: 'Phone', type: 'string', maxLength: 32 }),
      field({ field: 'campusId', header: 'Campus Code', required: true, type: 'string', ref: { model: 'campus', codeField: 'code', targetField: 'campusId' }, sample: 'MAIN' }),
      field({ field: 'programId', header: 'Program Code', type: 'string', ref: { model: 'program', codeField: 'code', targetField: 'programId' } }),
      field({ field: 'batchId', header: 'Batch Code', type: 'string', ref: { model: 'batch', codeField: 'code', targetField: 'batchId' } }),
      field({ field: 'sectionId', header: 'Section Code', type: 'string', ref: { model: 'section', codeField: 'code', targetField: 'sectionId' } }),
      field({ field: 'academicYearId', header: 'Academic Year Code', type: 'string', ref: { model: 'academicYear', codeField: 'code', targetField: 'academicYearId' } }),
      field({ field: 'status', header: 'Status', type: 'enum', enumValues: STUDENT_STATUSES, sample: 'ACTIVE' }),
      field({ field: 'yearOfAdmission', header: 'Year of Admission', type: 'int', min: 1900, max: 2200 }),
      field({ field: 'admittedOn', header: 'Admitted On', type: 'date' }),
      field({ field: 'city', header: 'City', type: 'string', maxLength: 100 }),
      field({ field: 'state', header: 'State', type: 'string', maxLength: 100 }),
    ],
    derive: (mapped) => {
      const parts = [mapped.firstName, mapped.middleName, mapped.lastName]
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter((v) => v.length > 0);
      return { ...mapped, fullName: parts.join(' ') };
    },
  },

  faculty: {
    key: 'faculty',
    label: 'Faculty & Staff',
    model: 'employee',
    module: 'hr',
    importPermission: 'hr.create',
    viewPermission: 'hr.view',
    strategy: 'generic',
    duplicateKey: ['employeeCode'],
    fields: [
      field({ field: 'employeeCode', header: 'Employee Code', required: true, type: 'string', maxLength: 64, sample: 'EMP-0001' }),
      field({ field: 'employeeType', header: 'Employee Type', type: 'enum', enumValues: ['FACULTY', 'STAFF', 'ADMIN'], sample: 'FACULTY' }),
      field({ field: 'honorific', header: 'Honorific', type: 'string', maxLength: 20, sample: 'Dr.' }),
      field({ field: 'firstName', header: 'First Name', required: true, type: 'string', maxLength: 100, sample: 'Meera' }),
      field({ field: 'middleName', header: 'Middle Name', type: 'string', maxLength: 100 }),
      field({ field: 'lastName', header: 'Last Name', required: true, type: 'string', maxLength: 100, sample: 'Iyer' }),
      field({ field: 'gender', header: 'Gender', type: 'string', maxLength: 20 }),
      field({ field: 'dateOfBirth', header: 'Date of Birth', type: 'date' }),
      field({ field: 'personalEmail', header: 'Personal Email', type: 'string', maxLength: 200 }),
      field({ field: 'phone', header: 'Phone', type: 'string', maxLength: 32 }),
      field({ field: 'departmentId', header: 'Department Code', required: true, type: 'string', ref: { model: 'department', codeField: 'code', targetField: 'departmentId' }, sample: 'CSE' }),
      field({ field: 'designationId', header: 'Designation Code', type: 'string', ref: { model: 'hrDesignation', codeField: 'code', targetField: 'designationId' } }),
      field({ field: 'campusId', header: 'Campus Code', type: 'string', ref: { model: 'campus', codeField: 'code', targetField: 'campusId' } }),
      field({ field: 'employmentType', header: 'Employment Type', type: 'enum', enumValues: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'VISITING', 'ADJUNCT', 'INTERN'], sample: 'FULL_TIME' }),
      field({ field: 'employmentStatus', header: 'Employment Status', type: 'enum', enumValues: ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'RESIGNED', 'RETIRED', 'TERMINATED'], sample: 'ACTIVE' }),
      field({ field: 'joinDate', header: 'Join Date', type: 'date', sample: '2026-07-01' }),
      field({ field: 'qualification', header: 'Qualification', type: 'string', maxLength: 200 }),
      field({ field: 'specialization', header: 'Specialization', type: 'string', maxLength: 200 }),
      field({ field: 'panNumber', header: 'PAN', type: 'string', maxLength: 20 }),
      field({ field: 'aadhaarNumber', header: 'Aadhaar', type: 'string', maxLength: 20 }),
      field({ field: 'bankName', header: 'Bank Name', type: 'string', maxLength: 200 }),
      field({ field: 'bankAccountNumber', header: 'Bank Account No', type: 'string', maxLength: 40 }),
      field({ field: 'bankIfsc', header: 'Bank IFSC', type: 'string', maxLength: 20 }),
    ],
  },

  courses: {
    key: 'courses',
    label: 'Courses',
    model: 'course',
    module: 'academics',
    importPermission: 'academics.create',
    viewPermission: 'academics.view',
    strategy: 'generic',
    duplicateKey: ['code'],
    fields: [
      field({ field: 'code', header: 'Course Code', required: true, type: 'string', maxLength: 64, sample: 'CS101' }),
      field({ field: 'name', header: 'Course Name', required: true, type: 'string', maxLength: 200, sample: 'Introduction to Programming' }),
      field({ field: 'departmentId', header: 'Department Code', type: 'string', ref: { model: 'department', codeField: 'code', targetField: 'departmentId' }, sample: 'CSE' }),
      field({ field: 'creditHours', header: 'Credit Hours', type: 'int', min: 0, max: 100, sample: '3' }),
      field({ field: 'courseType', header: 'Course Type', type: 'enum', enumValues: ['CORE', 'ELECTIVE', 'OPEN_ELECTIVE', 'LABORATORY', 'PROJECT', 'INTERNSHIP', 'MINOR', 'OTHER'], sample: 'CORE' }),
      field({ field: 'gradingBasis', header: 'Grading Basis', type: 'string', maxLength: 50 }),
      field({ field: 'description', header: 'Description', type: 'string', maxLength: 2000 }),
      field({ field: 'isActive', header: 'Active', type: 'boolean', sample: 'true' }),
    ],
  },

  departments: {
    key: 'departments',
    label: 'Departments',
    model: 'department',
    module: 'departments',
    importPermission: 'departments.manage',
    viewPermission: 'departments.read',
    strategy: 'generic',
    duplicateKey: ['code'],
    fields: [
      field({ field: 'code', header: 'Department Code', required: true, type: 'string', maxLength: 64, sample: 'CSE' }),
      field({ field: 'name', header: 'Department Name', required: true, type: 'string', maxLength: 200, sample: 'Computer Science & Engineering' }),
      field({ field: 'campusId', header: 'Campus Code', type: 'string', ref: { model: 'campus', codeField: 'code', targetField: 'campusId' }, sample: 'MAIN' }),
      field({ field: 'description', header: 'Description', type: 'string', maxLength: 2000 }),
      field({ field: 'isActive', header: 'Active', type: 'boolean', sample: 'true' }),
    ],
  },

  fees: {
    key: 'fees',
    label: 'Fee Heads',
    model: 'feeHead',
    module: 'fees',
    importPermission: 'fees.create',
    viewPermission: 'fees.view',
    strategy: 'generic',
    duplicateKey: ['code'],
    fields: [
      field({ field: 'code', header: 'Fee Head Code', required: true, type: 'string', maxLength: 64, sample: 'TUITION' }),
      field({ field: 'name', header: 'Fee Head Name', required: true, type: 'string', maxLength: 200, sample: 'Tuition Fee' }),
      field({ field: 'frequency', header: 'Frequency', required: true, type: 'enum', enumValues: ['ONE_TIME', 'PER_TERM', 'ANNUAL'], sample: 'PER_TERM' }),
      field({ field: 'defaultAmountCents', header: 'Default Amount', required: true, type: 'number', min: 0, transform: 'rupeesToCents', sample: '25000' }),
      field({ field: 'isOptional', header: 'Optional', type: 'boolean', sample: 'false' }),
      field({ field: 'isRefundable', header: 'Refundable', type: 'boolean', sample: 'true' }),
      field({ field: 'isActive', header: 'Active', type: 'boolean', sample: 'true' }),
      field({ field: 'description', header: 'Description', type: 'string', maxLength: 2000 }),
    ],
  },

  attendance: {
    key: 'attendance',
    label: 'Attendance',
    model: 'studentAttendance',
    module: 'attendance',
    importPermission: 'attendance.create',
    viewPermission: 'attendance.view',
    strategy: 'attendance',
    duplicateKey: ['studentId', 'date', 'attendanceType', 'subjectCode'],
    fields: [
      field({ field: 'admissionNumber', header: 'Admission No', required: true, type: 'string', ref: { model: 'student', codeField: 'admissionNumber', targetField: 'studentId' }, sample: 'ADM-2026-0001' }),
      field({ field: 'date', header: 'Date', required: true, type: 'date', sample: '2026-01-15' }),
      field({ field: 'status', header: 'Status', required: true, type: 'enum', enumValues: ATTENDANCE_STATUSES, sample: 'PRESENT' }),
      field({ field: 'attendanceType', header: 'Attendance Type', type: 'string', maxLength: 30, sample: 'CLASS' }),
      field({ field: 'subjectCode', header: 'Subject Code', type: 'string', maxLength: 64, sample: 'CS101' }),
      field({ field: 'subjectName', header: 'Subject Name', type: 'string', maxLength: 200 }),
      field({ field: 'termCode', header: 'Term Code', type: 'string', ref: { model: 'term', codeField: 'code', targetField: 'termId' } }),
      field({ field: 'remarks', header: 'Remarks', type: 'string', maxLength: 500 }),
    ],
  },

  marks: {
    key: 'marks',
    label: 'Exam Marks',
    model: 'examMarksEntry',
    module: 'exams',
    importPermission: 'exams.create',
    viewPermission: 'exams.view',
    strategy: 'marks',
    duplicateKey: ['examSessionCode', 'admissionNumber', 'courseCode'],
    fields: [
      field({ field: 'examSessionCode', header: 'Exam Session Code', required: true, type: 'string', ref: { model: 'examSession', codeField: 'code', targetField: 'sessionId' }, sample: 'END-SEM-2026' }),
      field({ field: 'admissionNumber', header: 'Admission No', required: true, type: 'string', ref: { model: 'student', codeField: 'admissionNumber', targetField: 'studentId' }, sample: 'ADM-2026-0001' }),
      field({ field: 'courseCode', header: 'Course Code', required: true, type: 'string', ref: { model: 'course', codeField: 'code', targetField: 'courseId' }, sample: 'CS101' }),
      field({ field: 'marksObtained', header: 'Marks Obtained', type: 'int', min: 0, sample: '78' }),
      field({ field: 'graceMarks', header: 'Grace Marks', type: 'int', min: 0, sample: '0' }),
      field({ field: 'attendanceStatus', header: 'Attendance Status', type: 'enum', enumValues: ['PRESENT', 'ABSENT'], sample: 'PRESENT' }),
      field({ field: 'remark', header: 'Remark', type: 'string', maxLength: 500 }),
    ],
  },

  library: {
    key: 'library',
    label: 'Library Books',
    model: 'libraryBook',
    module: 'library',
    importPermission: 'library.create',
    viewPermission: 'library.view',
    strategy: 'generic',
    duplicateKey: ['isbn'],
    duplicateKeyFallback: 'title',
    fields: [
      field({ field: 'title', header: 'Title', required: true, type: 'string', maxLength: 500, sample: 'Introduction to Algorithms' }),
      field({ field: 'isbn', header: 'ISBN', type: 'string', maxLength: 32, sample: '9780262046305' }),
      field({ field: 'subtitle', header: 'Subtitle', type: 'string', maxLength: 500 }),
      field({ field: 'categoryId', header: 'Category Code', required: true, type: 'string', ref: { model: 'libraryCategory', codeField: 'code', targetField: 'categoryId' }, sample: 'CS' }),
      field({ field: 'publisherId', header: 'Publisher Code', type: 'string', ref: { model: 'libraryPublisher', codeField: 'code', targetField: 'publisherId' } }),
      field({ field: 'language', header: 'Language', type: 'string', maxLength: 50, sample: 'English' }),
      field({ field: 'edition', header: 'Edition', type: 'string', maxLength: 50 }),
      field({ field: 'pageCount', header: 'Page Count', type: 'int', min: 0 }),
      field({ field: 'publicationYear', header: 'Publication Year', type: 'int', min: 1000, max: 2200 }),
      field({ field: 'replacementCostCents', header: 'Replacement Cost', type: 'number', min: 0, transform: 'rupeesToCents' }),
      field({ field: 'maxLoanDays', header: 'Max Loan Days', type: 'int', min: 1, max: 365, sample: '14' }),
      field({ field: 'description', header: 'Description', type: 'string', maxLength: 2000 }),
    ],
  },

  inventory: {
    key: 'inventory',
    label: 'Inventory Products',
    model: 'inventoryProduct',
    module: 'inventory',
    importPermission: 'inventory.create',
    viewPermission: 'inventory.view',
    strategy: 'generic',
    duplicateKey: ['code'],
    fields: [
      field({ field: 'code', header: 'Product Code', required: true, type: 'string', maxLength: 64, sample: 'STA-001' }),
      field({ field: 'name', header: 'Product Name', required: true, type: 'string', maxLength: 200, sample: 'A4 Paper Ream' }),
      field({ field: 'categoryId', header: 'Category Code', required: true, type: 'string', ref: { model: 'inventoryCategory', codeField: 'code', targetField: 'categoryId', filter: { kind: 'PRODUCT' } }, sample: 'STATIONERY' }),
      field({ field: 'sku', header: 'SKU', type: 'string', maxLength: 100 }),
      field({ field: 'unit', header: 'Unit', type: 'string', maxLength: 30, sample: 'PCS' }),
      field({ field: 'unitPriceCents', header: 'Unit Price', type: 'number', min: 0, transform: 'rupeesToCents', sample: '250' }),
      field({ field: 'reorderLevel', header: 'Reorder Level', type: 'int', min: 0, sample: '10' }),
      field({ field: 'isActive', header: 'Active', type: 'boolean', sample: 'true' }),
      field({ field: 'description', header: 'Description', type: 'string', maxLength: 2000 }),
    ],
  },
};

export function getImportEntity(key: string): ImportEntityDefinition | undefined {
  return (IMPORT_ENTITIES as Record<string, ImportEntityDefinition>)[key];
}

export function listImportEntities(): ImportEntityDefinition[] {
  return IMPORT_ENTITY_KEYS.map((key) => IMPORT_ENTITIES[key]);
}
