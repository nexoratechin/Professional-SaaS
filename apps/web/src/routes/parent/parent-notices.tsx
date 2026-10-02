import React, { useState } from 'react';
import { Button, Card } from '@college-erp/ui';
import { PageShell, Stat, StatusBadge, apiFetch, fmtDateTime } from '../portal/portal-shared';
import { useParentData } from './parent-context';

interface Notice {
  id: string;
  channel: string;
  subject: string;
  body: string;
  status: string;
  readAt: string | null;
  createdAt: string;
}

interface NoticesResponse {
  items: Notice[];
  summary: { unread: number; total: number };
}

export function ParentNoticesPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, error, loading, reload } = useParentData<NoticesResponse>('/parent-portal/notices', {
    unreadOnly: unreadOnly ? 'true' : 'false',
    take: 100,
  });
  const [actionError, setActionError] = useState<string | null>(null);

  const markRead = async (id: string) => {
    setActionError(null);
    try {
      await apiFetch(`/parent-portal/notices/${id}/read`, { method: 'POST' });
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update notice.');
    }
  };

  return (
    <PageShell
      title="Notices"
      subtitle="Announcements and alerts addressed to you."
      error={error ?? actionError}
      loading={loading}
      actions={
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />
          Unread only
        </label>
      }
    >
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sp-grid">
            <Stat label="Unread" value={data.summary.unread} />
            <Stat label="Total" value={data.summary.total} />
          </div>
          {data.items.length === 0 && <Card>No notices.</Card>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.items.map((notice) => (
              <Card key={notice.id} style={{ opacity: notice.readAt ? 0.65 : 1 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{notice.subject}</strong>
                  <span className="sp-muted">{fmtDateTime(notice.createdAt)}</span>
                </div>
                <p style={{ margin: '8px 0', whiteSpace: 'pre-wrap' }}>{notice.body}</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <StatusBadge value={notice.channel} />
                  {notice.readAt ? <span className="sp-muted">Read {fmtDateTime(notice.readAt)}</span> : null}
                  {!notice.readAt && notice.channel === 'IN_APP' && (
                    <Button variant="secondary" onClick={() => markRead(notice.id)}>
                      Mark as read
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}
