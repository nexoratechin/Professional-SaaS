import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@college-erp/ui';
import { PageShell, Stat, fmtDateTime } from '../portal/portal-shared';
import { useParentData } from './parent-context';

interface ParentDashboard {
  student: { studentId: string; fullName: string; admissionNumber: string; rollNumber: string | null; status: string };
  attendance: { total: number; present: number; absent: number; late: number; leave: number; percentage: number | null } | null;
  timetable: { timetableId: string | null; name: string | null; weeklyClasses: number } | null;
  fees: { totalLines: number; outstandingCents: number; overdueCount: number } | null;
  exams: { registeredSessions: number; upcomingPapers: number; nextExamAt: string | null } | null;
  results: { publishedSubjects: number; publishedSessions: number } | null;
  documents: { uploads: number; pending: number };
  transport: { activePasses: number } | null;
  hostel: { activeBookings: number; openComplaints: number } | null;
  notices: { unread: number; total: number } | null;
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

export function ParentDashboardPage() {
  const { data, error, loading } = useParentData<ParentDashboard>('/parent-portal/dashboard');

  return (
    <PageShell
      title={data ? `${data.student.fullName}` : 'Dashboard'}
      subtitle={
        data
          ? `Admission No. ${data.student.admissionNumber}${data.student.rollNumber ? ` · Roll ${data.student.rollNumber}` : ''}`
          : undefined
      }
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
            {data.exams && <Stat label="Upcoming papers" value={data.exams.upcomingPapers} hint={data.exams.nextExamAt ? `Next: ${fmtDateTime(data.exams.nextExamAt)}` : 'None scheduled'} />}
            {data.results && <Stat label="Published sessions" value={data.results.publishedSessions} hint={`${data.results.publishedSubjects} subjects`} />}
            {data.notices && <Stat label="Unread notices" value={data.notices.unread} hint={`${data.notices.total} total`} />}
            {data.hostel && <Stat label="Hostel bookings" value={data.hostel.activeBookings} hint={`${data.hostel.openComplaints} open complaints`} />}
          </div>

          <div className="sp-cards">
            <QuickLink to="/parent/attendance" label="Attendance" detail="Session-by-session record and percentage." />
            <QuickLink to="/parent/timetable" label="Timetable" detail={data.timetable ? `${data.timetable.weeklyClasses} weekly classes` : 'No published timetable yet.'} />
            <QuickLink to="/parent/fees" label="Fees" detail="Demands, due dates and outstanding balances." />
            <QuickLink to="/parent/payments" label="Payments" detail="Receipts and allocation history." />
            <QuickLink to="/parent/exams" label="Exams" detail="Registered sessions, papers and hall tickets." />
            <QuickLink to="/parent/results" label="Results" detail="Published results and academic standing." />
            <QuickLink to="/parent/notices" label="Notices" detail="Announcements and alerts addressed to you." />
            <QuickLink to="/parent/documents" label="Documents" detail={`${data.documents.uploads} document(s), ${data.documents.pending} pending verification.`} />
            <QuickLink to="/parent/transport" label="Transport" detail={data.transport ? `${data.transport.activePasses} active pass(es)` : 'No transport pass on record.'} />
            <QuickLink to="/parent/hostel" label="Hostel" detail={data.hostel ? `${data.hostel.activeBookings} active booking(s)` : 'No hostel booking on record.'} />
          </div>

          <Card>
            <span className="sp-muted">
              Snapshot generated {fmtDateTime(data.generatedAt)}. Modules disabled on your college&apos;s plan are hidden automatically.
            </span>
          </Card>
        </>
      )}
    </PageShell>
  );
}
