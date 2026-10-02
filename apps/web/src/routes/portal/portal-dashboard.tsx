import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@college-erp/ui';
import { PageShell, Stat, fmtDateTime, usePortalData } from './portal-shared';

interface PortalDashboard {
  student: { id: string; fullName: string; admissionNumber: string; rollNumber: string | null; status: string };
  attendance: { total: number; present: number; absent: number; late: number; leave: number; percentage: number | null } | null;
  timetable: { timetableId: string | null; name: string | null; weeklyClasses: number } | null;
  courses: { activeRegistrations: number } | null;
  fees: { totalLines: number; outstandingCents: number; overdueCount: number } | null;
  exams: { registeredSessions: number; upcomingPapers: number; nextExamAt: string | null } | null;
  results: { publishedSubjects: number; publishedSessions: number } | null;
  certificates: { total: number; pending: number; issued: number } | null;
  library: { activeLoans: number; pendingFines: number } | null;
  hostel: { activeBookings: number; openComplaints: number } | null;
  transport: { activePasses: number } | null;
  notices: { unread: number; total: number } | null;
  tickets: { open: number; total: number } | null;
  documents: { uploads: number; studentDocs: number };
  generatedAt: string;
}

function QuickLink({ to, label, detail }: { to: string; label: string; detail: string }) {
  return (
    <Link to={to} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="sp-stat" style={{ height: '100%' }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div className="sp-muted" style={{ marginTop: 4 }}>
          {detail}
        </div>
      </div>
    </Link>
  );
}

export function PortalDashboardPage() {
  const { data, error, loading } = usePortalData<PortalDashboard>('/student-portal/dashboard');

  return (
    <PageShell
      title={data ? `Welcome, ${data.student.fullName}` : 'Dashboard'}
      subtitle={data ? `Admission No. ${data.student.admissionNumber}${data.student.rollNumber ? ` · Roll ${data.student.rollNumber}` : ''}` : undefined}
      error={error}
      loading={loading}
    >
      {data && (
        <>
          <div className="sp-grid">
            {data.attendance && (
              <Stat
                label="Attendance"
                value={data.attendance.percentage === null ? '—' : `${data.attendance.percentage}%`}
                hint={`${data.attendance.present + data.attendance.late}/${data.attendance.total} present`}
              />
            )}
            {data.fees && (
              <Stat
                label="Fees outstanding"
                value={new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(data.fees.outstandingCents / 100)}
                hint={data.fees.overdueCount ? `${data.fees.overdueCount} overdue` : 'No overdue items'}
              />
            )}
            {data.courses && <Stat label="Registered courses" value={data.courses.activeRegistrations} />}
            {data.notices && <Stat label="Unread notices" value={data.notices.unread} hint={`${data.notices.total} total`} />}
            {data.tickets && <Stat label="Open tickets" value={data.tickets.open} hint={`${data.tickets.total} total`} />}
            {data.library && <Stat label="Library loans" value={data.library.activeLoans} hint={`${data.library.pendingFines} fines pending`} />}
            {data.exams && <Stat label="Upcoming papers" value={data.exams.upcomingPapers} hint={data.exams.nextExamAt ? `Next: ${fmtDateTime(data.exams.nextExamAt)}` : 'None scheduled'} />}
            {data.certificates && <Stat label="Certificates" value={data.certificates.issued} hint={`${data.certificates.pending} in progress`} />}
          </div>

          <div className="sp-cards">
            <QuickLink to="/portal/attendance" label="Attendance" detail="Session-by-session record and percentage." />
            <QuickLink to="/portal/timetable" label="Timetable" detail={data.timetable ? `${data.timetable.weeklyClasses} weekly classes` : 'No published timetable yet.'} />
            <QuickLink to="/portal/courses" label="Courses" detail="Your current registrations and enrollment history." />
            <QuickLink to="/portal/fees" label="Fees" detail="Demands, due dates and outstanding balances." />
            <QuickLink to="/portal/payments" label="Payments" detail="Receipts and allocation history." />
            <QuickLink to="/portal/exams" label="Exams" detail="Registered sessions, papers and hall tickets." />
            <QuickLink to="/portal/results" label="Results" detail="Published results and academic standing." />
            <QuickLink to="/portal/certificates" label="Certificates" detail="Request and track bonafide/transcripts." />
            <QuickLink to="/portal/library" label="Library" detail="Loans, reservations and fines." />
            <QuickLink to="/portal/hostel" label="Hostel" detail="Allocation, rent charges and complaints." />
            <QuickLink to="/portal/transport" label="Transport" detail="Bus pass, route and pickup details." />
            <QuickLink to="/portal/notices" label="Notices" detail="In-app announcements and alerts." />
            <QuickLink to="/portal/tickets" label="Support Tickets" detail="Raise and follow up on requests." />
            <QuickLink to="/portal/documents" label="Documents" detail={`${data.documents.uploads} uploads · ${data.documents.studentDocs} profile documents.`} />
          </div>

          <Card>
            <span className="sp-muted">Snapshot generated {fmtDateTime(data.generatedAt)}. Modules disabled on your college&apos;s plan are hidden automatically.</span>
          </Card>
        </>
      )}
    </PageShell>
  );
}
