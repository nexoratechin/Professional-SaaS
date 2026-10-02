import React, { useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { Column, DataTable, PageShell, StatusBadge, apiFetch, fmtDateTime, usePortalData } from './portal-shared';

interface Ticket {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  source: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionSummary: string | null;
  category: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
}

interface TicketsResponse {
  items: Ticket[];
  total: number;
  summary: { open: number; total: number };
}

interface TicketComment {
  id: string;
  authorUserId: string | null;
  visibility: string;
  body: string;
  createdAt: string;
}

interface TicketDetail {
  ticket: Ticket;
  comments: TicketComment[];
}

function asItems<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  const candidate = value as { items?: T[] } | null;
  return candidate?.items ?? [];
}

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL'];

function TicketDetailPanel({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { data, error, loading, reload } = usePortalData<TicketDetail>(`/student-portal/tickets/${id}`);
  const [comment, setComment] = useState('');
  const [score, setScore] = useState('5');
  const [feedbackComment, setFeedbackComment] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const addComment = async () => {
    if (!comment.trim()) return;
    setActionError(null);
    try {
      await apiFetch(`/student-portal/tickets/${id}/comments`, { method: 'POST', body: JSON.stringify({ body: comment }) });
      setComment('');
      setNotice('Comment added.');
      await reload();
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to add comment.');
    }
  };

  const submitFeedback = async () => {
    setActionError(null);
    try {
      await apiFetch(`/student-portal/tickets/${id}/feedback`, {
        method: 'POST',
        body: JSON.stringify({ score: Number(score), comment: feedbackComment || undefined }),
      });
      setNotice('Thank you for your feedback.');
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to submit feedback.');
    }
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Ticket details</h2>
      {loading && <p className="sp-muted">Loading…</p>}
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {actionError && <p style={{ color: '#b91c1c' }}>{actionError}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <strong>{data.ticket.subject}</strong>
              <StatusBadge value={data.ticket.status} />
              <StatusBadge value={data.ticket.priority} />
            </div>
            <div className="sp-muted">
              {data.ticket.ticketNumber} · {data.ticket.category?.name ?? '—'} · opened {fmtDateTime(data.ticket.createdAt)}
            </div>
          </div>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{data.ticket.description}</p>
          {data.ticket.resolutionSummary && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 10 }}>
              <strong>Resolution:</strong> {data.ticket.resolutionSummary}
            </div>
          )}

          <div>
            <h3 style={{ fontSize: '0.9rem' }}>Conversation</h3>
            {data.comments.length === 0 ? (
              <p className="sp-muted">No comments yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.comments.map((item) => (
                  <div key={item.id} style={{ borderLeft: '3px solid #cbd5e1', paddingLeft: 10 }}>
                    <div className="sp-muted">{fmtDateTime(item.createdAt)}</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{item.body}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Input label="Add a comment" name="comment" value={comment} onChange={(event) => setComment(event.target.value)} />
          <div>
            <Button onClick={addComment} disabled={!comment.trim()}>
              Post comment
            </Button>
          </div>

          {(data.ticket.status === 'RESOLVED' || data.ticket.status === 'CLOSED') && (
            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
              <h3 style={{ fontSize: '0.9rem' }}>Rate this support request</h3>
              <div className="sp-cards" style={{ alignItems: 'end' }}>
                <label className="sp-row">
                  <span className="sp-muted">Score</span>
                  <select value={score} onChange={(event) => setScore(event.target.value)} style={{ padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }}>
                    {[1, 2, 3, 4, 5].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <Input label="Comment (optional)" name="feedbackComment" value={feedbackComment} onChange={(event) => setFeedbackComment(event.target.value)} />
                <Button onClick={submitFeedback}>Submit feedback</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function PortalTicketsPage() {
  const { data, error, loading, reload } = usePortalData<TicketsResponse>('/student-portal/tickets?take=100');
  const { data: lookups } = usePortalData<{ categories: unknown; departments: unknown }>('/student-portal/tickets/lookups');
  const [selected, setSelected] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const categories = asItems<{ id: string; name: string; isActive: boolean }>(lookups?.categories);
  const activeCategories = categories.filter((category) => category.isActive !== false);

  const create = async () => {
    setActionError(null);
    setNotice(null);
    if (!subject.trim() || !description.trim() || !categoryId) {
      setActionError('Subject, description and category are required.');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/student-portal/tickets', {
        method: 'POST',
        body: JSON.stringify({ subject, description, categoryId, priority }),
      });
      setNotice('Support ticket raised.');
      setSubject('');
      setDescription('');
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to raise ticket.');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: Column<Ticket>[] = [
    { label: 'Number', render: (row) => row.ticketNumber },
    { label: 'Subject', render: (row) => row.subject },
    { label: 'Category', render: (row) => row.category?.name ?? '—' },
    { label: 'Priority', render: (row) => <StatusBadge value={row.priority} /> },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    { label: 'Opened', render: (row) => fmtDateTime(row.createdAt) },
    {
      label: '',
      render: (row) => (
        <Button variant="secondary" onClick={() => setSelected(row.id)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <PageShell
      title="Support Tickets"
      subtitle="Raise an issue with any department and track its progress."
      error={error ?? actionError}
      notice={notice}
      loading={loading}
    >
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Raise a ticket</h2>
            <div className="sp-cards" style={{ alignItems: 'end' }}>
              <Input label="Subject" name="subject" value={subject} onChange={(event) => setSubject(event.target.value)} />
              <label className="sp-row">
                <span className="sp-muted">Category</span>
                <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} style={{ padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }}>
                  <option value="">Select a category</option>
                  {activeCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sp-row">
                <span className="sp-muted">Priority</span>
                <select value={priority} onChange={(event) => setPriority(event.target.value)} style={{ padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }}>
                  {PRIORITIES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <Button onClick={create} disabled={submitting}>
                {submitting ? 'Submitting…' : 'Raise ticket'}
              </Button>
            </div>
            <div style={{ marginTop: 10 }}>
              <Input label="Describe the issue" name="description" value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>My tickets</h2>
            <DataTable columns={columns} rows={data.items} rowKey={(row) => row.id} empty="No support tickets yet." />
          </Card>

          {selected && <TicketDetailPanel id={selected} onChanged={reload} />}
        </div>
      )}
    </PageShell>
  );
}
