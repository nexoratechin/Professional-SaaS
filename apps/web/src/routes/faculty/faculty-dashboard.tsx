import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@college-erp/ui';
import { PageShell, Stat, fmtDateTime, usePortalData } from './faculty-shared';

interface FacultyDashboard {
  faculty: { id: string; employeeCode: string; fullName: string; employeeType: string; employmentStatus: string };
  courses: Array<{ assignmentId: string; role: string; offering: { id: string; code: string; course: { code: string; name: string } } }> | null;
  timetable: { weeklyClasses: number; todayClasses: number; teachingHoursPerWeek: number } | null;
  attendance: { offerings: number; sessions: number; openSessions: number; todaySessions: number; marked: number; percentage: number | null } | null;
  marks: { papers: number; entries: number; drafts: number; submitted: number; approved: number } | null;
  leave: { pending: number; approved: number; year: number } | null;
  workload: { summary: { weeklyClasses: number; teachingHoursPerWeek: number; totalHoursPerWeek: number; invigilationDuties: number } } | null;
  notices: { summary: { unread: number; total: number } } | null;
  reports: { offerings: Array<{ id: string; code: string; studentCount: number }> } | null;
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

export function FacultyDashboardPage() {
  const { data, error, loading } = usePortalData<FacultyDashboard>('/faculty-portal/dashboard');

  return (
    <PageShell
      title={data ? `Welcome, ${data.faculty.fullName}` : 'Dashboard'}
      subtitle={data ? `Employee No. ${data.faculty.employeeCode} · ${data.faculty.employmentStatus}` : undefined}
      error={error}
      loading={loading}
    >
      {data && (
        <>
          <div className="sp-grid">
            {data.courses && <Stat label="Assigned courses" value={data.courses.length} />}
            {data.timetable && (
              <Stat label="Classes this week" value={data.timetable.weeklyClasses} hint={`${data.timetable.todayClasses} today`} />
            )}
            {data.attendance && (
              <Stat
                label="Attendance marked"
                value={data.attendance.marked}
                hint={data.attendance.percentage === null ? 'No records yet' : `${data.attendance.percentage}% present`}
              />
            )}
            {data.marks && <Stat label="Marks drafts" value={data.marks.drafts} hint={`${data.marks.papers} papers`} />}
            {data.leave && <Stat label="Pending leave" value={data.leave.pending} hint={`${data.leave.approved} approved`} />}
            {data.workload && (
              <Stat
                label="Weekly load"
                value={`${data.workload.summary.totalHoursPerWeek}h`}
                hint={`${data.workload.summary.teachingHoursPerWeek}h teaching`}
              />
            )}
            {data.notices && <Stat label="Unread notices" value={data.notices.summary.unread} hint={`${data.notices.summary.total} total`} />}
          </div>

          <div className="sp-cards">
            <QuickLink to="/faculty/courses" label="My Courses" detail="Offerings you are assigned to teach." />
            <QuickLink to="/faculty/students" label="Students" detail="Rosters for your assigned offerings." />
            <QuickLink to="/faculty/timetable" label="Timetable" detail={data.timetable ? `${data.timetable.weeklyClasses} weekly classes` : 'No published timetable.'} />
            <QuickLink to="/faculty/attendance" label="Attendance" detail="Open sessions, mark a class, close and report." />
            <QuickLink to="/faculty/marks" label="Marks Entry" detail="Enter marks for your papers and submit." />
            <QuickLink to="/faculty/academics" label="Academics" detail="Teaching assignments, invigilation, advising, calendar." />
            <QuickLink to="/faculty/leave" label="Leave" detail="Balances, applications and self-service requests." />
            <QuickLink to="/faculty/workload" label="Workload" detail="Declared duties plus timetable-derived teaching load." />
            <QuickLink to="/faculty/notifications" label="Notifications" detail="Your in-app inbox." />
            <QuickLink to="/faculty/reports" label="Reports" detail="Attendance, marks and roster summaries." />
          </div>

          {data.courses && data.courses.length > 0 && (
            <Card>
              <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Assigned courses</h2>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {data.courses.slice(0, 8).map((course) => (
                  <li key={course.assignmentId}>
                    {course.offering.course.code} — {course.offering.course.name}{' '}
                    <span className="sp-muted">({course.role.replace(/_/g, ' ')})</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <span className="sp-muted">
              Snapshot generated {fmtDateTime(data.generatedAt)}. Modules disabled on your college&apos;s plan are hidden
              automatically.
            </span>
          </Card>
        </>
      )}
    </PageShell>
  );
}
