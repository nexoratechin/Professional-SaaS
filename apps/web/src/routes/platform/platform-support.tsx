import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { platformApiFetch, platformApiFetchPaged } from '../../lib/platform-http';

interface SupportTicketDto {
  id: string;
  tenantId: string | null;
  subject: string;
  description: string;
  status: string;
  priority: string;
  assignedToPlatformUserId: string | null;
  createdAt: string;
}

interface SupportTicketCommentDto {
  id: string;
  authorType: string;
  body: string;
  createdAt: string;
}

const STATUS_OPTIONS = ['', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

export function PlatformSupportPage() {
  const [tickets, setTickets] = useState<SupportTicketDto[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<(SupportTicketDto & { comments: SupportTicketCommentDto[] }) | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      const { data, total: totalCount } = await platformApiFetchPaged<SupportTicketDto[]>(
        `/platform/support/tickets?${params}`,
      );
      setTickets(data);
      setTotal(totalCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tickets.');
    }
  }, [statusFilter]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const ticket = await platformApiFetch<SupportTicketDto & { comments: SupportTicketCommentDto[] }>(
        `/platform/support/tickets/${id}`,
      );
      setSelected(ticket);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ticket.');
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail(selectedId);
    } else {
      setSelected(null);
    }
  }, [selectedId, loadDetail]);

  const updateStatus = async (status: string) => {
    if (!selectedId) return;
    try {
      await platformApiFetch(`/platform/support/tickets/${selectedId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await Promise.all([loadDetail(selectedId), loadList()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update ticket.');
    }
  };

  const addComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedId || !commentBody.trim()) return;
    try {
      await platformApiFetch(`/platform/support/tickets/${selectedId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: commentBody }),
      });
      setCommentBody('');
      await loadDetail(selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add comment.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: '1.25rem' }}>Support Tickets</h1>
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <h2 style={{ fontSize: '1rem' }}>All tickets ({total})</h2>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ padding: '0.4rem', borderRadius: 6, border: '1px solid #d1d5db' }}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option === '' ? 'All statuses' : option}
                </option>
              ))}
            </select>
          </div>
          {tickets.length === 0 ? (
            <p>No tickets.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {tickets.map((ticket) => (
                <li key={ticket.id}>
                  <button
                    onClick={() => setSelectedId(ticket.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px',
                      borderRadius: 6,
                      border: '1px solid #e5e7eb',
                      background: selectedId === ticket.id ? '#eff6ff' : '#fff',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                    }}
                  >
                    <strong>{ticket.subject}</strong>
                    <div style={{ color: '#6b7280' }}>
                      {ticket.status} · {ticket.priority} · {new Date(ticket.createdAt).toLocaleDateString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          {!selected ? (
            <p>Select a ticket to view details.</p>
          ) : (
            <div>
              <h2 style={{ fontSize: '1rem' }}>{selected.subject}</h2>
              <p style={{ fontSize: '0.85rem', color: '#374151' }}>{selected.description}</p>
              <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
                {STATUS_OPTIONS.filter((s) => s).map((option) => (
                  <Button key={option} variant={selected.status === option ? 'primary' : 'secondary'} onClick={() => updateStatus(option)}>
                    {option}
                  </Button>
                ))}
              </div>
              <div style={{ maxHeight: 240, overflowY: 'auto', borderTop: '1px solid #e5e7eb', paddingTop: 8 }}>
                {selected.comments.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: '#9ca3af' }}>No comments yet.</p>
                ) : (
                  selected.comments.map((comment) => (
                    <div key={comment.id} style={{ fontSize: '0.85rem', marginBottom: 8 }}>
                      <strong>{comment.authorType === 'PLATFORM_USER' ? 'Platform' : 'Tenant'}</strong>{' '}
                      <span style={{ color: '#9ca3af' }}>{new Date(comment.createdAt).toLocaleString()}</span>
                      <p style={{ margin: '2px 0' }}>{comment.body}</p>
                    </div>
                  ))
                )}
              </div>
              <form onSubmit={addComment} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Input
                  label="Reply"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  style={{ flex: 1 }}
                />
                <Button type="submit">Send</Button>
              </form>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
