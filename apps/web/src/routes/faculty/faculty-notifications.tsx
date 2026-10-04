import React, { useState } from 'react';
import { Button, Card } from '@college-erp/ui';
import { PushToggle } from '../../features/pwa/pwa-ui';
import { PageShell, Stat, StatusBadge, apiFetch, fmtDateTime, usePortalData } from './faculty-shared';

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

export function FacultyNotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, error, loading, reload } = usePortalData<NoticesResponse>(
    `/faculty-portal/notifications?unreadOnly=${unreadOnly ? 'true' : 'false'}&take=100`,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const markRead = async (id: string) => {
    setActionError(null);
    try {
      await apiFetch(`/faculty-portal/notifications/${id}/read`, { method: 'POST' });
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update notification.');
    }
  };

  return (
    <PageShell
      title="Notifications"
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
          <PushToggle />
          {data.items.length === 0 && <Card>No notifications.</Card>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.items.map((notice) => (
              <Card key={notice.id} style={{ opacity: notice.readAt ? 0.65 : 1 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{notice.subject}</strong>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <StatusBadge value={notice.channel} />
                    <span className="sp-muted">{fmtDateTime(notice.createdAt)}</span>
                  </span>
                </div>
                <p style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>{notice.body}</p>
                {!notice.readAt && (
                  <Button variant="secondary" onClick={() => markRead(notice.id)}>
                    Mark as read
                  </Button>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}
