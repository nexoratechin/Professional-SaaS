import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card } from '@college-erp/ui';
import { QrScanner } from '../../features/pwa/qr-scanner';
import {
  Column,
  DataTable,
  PageShell,
  Stat,
  StatusBadge,
  apiFetch,
  fmtDate,
  usePortalData,
} from './portal-shared';

interface AttendanceRow {
  id: string;
  date: string;
  attendanceType: string;
  subjectCode: string | null;
  subjectName: string | null;
  status: string;
  markMethod: string;
  remarks: string | null;
  session: { id: string; title: string | null; subjectName: string | null } | null;
}

interface AttendanceResponse {
  rows: AttendanceRow[];
  total: number;
  summary: { total: number; present: number; absent: number; late: number; leave: number; percentage: number | null };
}

interface CheckInResponse {
  alreadyMarked: boolean;
  session: { id: string; title: string | null; subjectCode: string | null; subjectName: string | null; date: string };
}

const STATUS_OPTIONS = ['', 'PRESENT', 'ABSENT', 'LATE', 'LEAVE'];

/**
 * Parses a scanned QR value into a check-in payload. Accepts the faculty-generated deep link
 * (`/portal/attendance?checkin=<id>&token=<token>`), a raw query string, or a JSON object — so
 * an in-app scan, a camera-app deep link, and a pasted code all work.
 */
function parseCheckInPayload(value: string): { sessionId: string; token: string } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const sessionId = (parsed.sessionId ?? parsed.checkin) as string | undefined;
      const token = (parsed.token ?? parsed.code) as string | undefined;
      if (sessionId && token) return { sessionId, token };
    } catch {
      return null;
    }
    return null;
  }

  try {
    const url = trimmed.startsWith('http') ? new URL(trimmed) : null;
    const params = url ? url.searchParams : new URLSearchParams(trimmed.replace(/^\?/, ''));
    const sessionId = params.get('checkin') ?? params.get('sessionId');
    const token = params.get('token');
    if (sessionId && token) return { sessionId, token };
  } catch {
    return null;
  }
  return null;
}

export function PortalAttendancePage() {
  const [status, setStatus] = useState('');
  const [skip, setSkip] = useState(0);
  const take = 50;
  const [searchParams, setSearchParams] = useSearchParams();
  const [scanOpen, setScanOpen] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInMessage, setCheckInMessage] = useState<string | null>(null);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const handledDeepLink = useRef(false);

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('skip', String(skip));
  params.set('take', String(take));

  const { data, error, loading, reload } = usePortalData<AttendanceResponse>(
    `/student-portal/attendance?${params.toString()}`,
  );

  const submitCheckIn = useCallback(
    async (sessionId: string, token: string) => {
      setCheckingIn(true);
      setCheckInMessage(null);
      setCheckInError(null);
      try {
        const result = await apiFetch<CheckInResponse>('/student-portal/attendance/check-in', {
          method: 'POST',
          body: JSON.stringify({ sessionId, token }),
        });
        const label = result.session.subjectName ?? result.session.title ?? result.session.subjectCode ?? 'session';
        setCheckInMessage(
          result.alreadyMarked ? `You were already marked present for ${label}.` : `Checked in — you are marked present for ${label}.`,
        );
        setScanOpen(false);
        await reload();
      } catch (err) {
        setCheckInError(err instanceof Error ? err.message : 'Check-in failed.');
      } finally {
        setCheckingIn(false);
      }
    },
    [reload],
  );

  // Deep link from the faculty QR / native camera: /portal/attendance?checkin=…&token=…
  useEffect(() => {
    if (handledDeepLink.current) return;
    const sessionId = searchParams.get('checkin') ?? searchParams.get('sessionId');
    const token = searchParams.get('token');
    if (!sessionId || !token) return;
    handledDeepLink.current = true;
    void submitCheckIn(sessionId, token);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, submitCheckIn]);

  const columns: Column<AttendanceRow>[] = [
    { label: 'Date', render: (row) => fmtDate(row.date) },
    { label: 'Type', render: (row) => row.attendanceType },
    { label: 'Subject', render: (row) => row.subjectName ?? row.session?.subjectName ?? row.subjectCode ?? '—' },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    { label: 'Captured via', render: (row) => row.markMethod },
    { label: 'Remarks', render: (row) => row.remarks ?? '—' },
  ];

  return (
    <PageShell
      title="Attendance"
      subtitle="Your session-by-session attendance record. Scan your faculty member's QR to check in."
      error={error ?? checkInError}
      notice={checkInMessage}
      loading={loading}
      actions={
        <div className="sp-actions">
          <Button onClick={() => setScanOpen(true)} disabled={checkingIn}>
            {checkingIn ? 'Checking in…' : 'Scan to check in'}
          </Button>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setSkip(0);
            }}
            style={{ padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option || 'all'} value={option}>
                {option ? option.replace(/_/g, ' ') : 'All statuses'}
              </option>
            ))}
          </select>
        </div>
      }
    >
      {scanOpen && (
        <QrScanner
          hint="Point the camera at the check-in QR shown by your faculty member."
          onClose={() => setScanOpen(false)}
          onResult={(value) => {
            const payload = parseCheckInPayload(value);
            if (!payload) {
              setCheckInError('That QR code is not a valid attendance check-in code.');
              setScanOpen(false);
              return;
            }
            void submitCheckIn(payload.sessionId, payload.token);
          }}
        />
      )}
      {data && (
        <>
          <div className="sp-grid">
            <Stat label="Overall" value={data.summary.percentage === null ? '—' : `${data.summary.percentage}%`} hint={`${data.summary.total} records`} />
            <Stat label="Present" value={data.summary.present} />
            <Stat label="Absent" value={data.summary.absent} />
            <Stat label="Late" value={data.summary.late} />
            <Stat label="Leave" value={data.summary.leave} />
          </div>
          <Card>
            <DataTable columns={columns} rows={data.rows} rowKey={(row) => row.id} empty="No attendance records yet." />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
              <Button variant="secondary" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - take))}>
                Previous
              </Button>
              <span className="sp-muted">
                {skip + 1}–{Math.min(skip + take, data.total)} of {data.total}
              </span>
              <Button variant="secondary" disabled={skip + take >= data.total} onClick={() => setSkip(skip + take)}>
                Next
              </Button>
            </div>
          </Card>
        </>
      )}
    </PageShell>
  );
}
