import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PlatformTenantDto } from '@college-erp/types';
import { Button, Card, Input } from '@college-erp/ui';
import { platformApiFetch } from '../../lib/platform-http';

interface FormState {
  slug: string;
  name: string;
  billingEmail: string;
  timezone: string;
  adminEmail: string;
  adminFullName: string;
  adminPassword: string;
}

const EMPTY_FORM: FormState = {
  slug: '',
  name: '',
  billingEmail: '',
  timezone: 'Asia/Kolkata',
  adminEmail: '',
  adminFullName: '',
  adminPassword: '',
};

/** Tenant creation AND onboarding in one step — POST /tenants provisions the tenant record plus
 * its first College Admin user, default roles, and example workflow definitions in a single
 * call (see TenantProvisioningService), so a platform admin never touches SQL to onboard a
 * college. */
export function PlatformTenantNewPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const setField = (key: keyof FormState, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const tenant = await platformApiFetch<PlatformTenantDto>('/tenants', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      navigate(`/platform/tenants/${tenant.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tenant.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 480 }}>
      <h1 style={{ fontSize: '1.25rem' }}>New tenant</h1>
      <Card>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input label="Slug" value={form.slug} onChange={(e) => setField('slug', e.target.value)} placeholder="stmarys" required />
          <Input label="Name" value={form.name} onChange={(e) => setField('name', e.target.value)} required />
          <Input
            label="Billing email"
            type="email"
            value={form.billingEmail}
            onChange={(e) => setField('billingEmail', e.target.value)}
            required
          />
          <Input label="Timezone" value={form.timezone} onChange={(e) => setField('timezone', e.target.value)} />
          <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '4px 0' }} />
          <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: 0 }}>First College Admin user</p>
          <Input
            label="Admin email"
            type="email"
            value={form.adminEmail}
            onChange={(e) => setField('adminEmail', e.target.value)}
            required
          />
          <Input
            label="Admin full name"
            value={form.adminFullName}
            onChange={(e) => setField('adminFullName', e.target.value)}
            required
          />
          <Input
            label="Admin password"
            type="password"
            value={form.adminPassword}
            onChange={(e) => setField('adminPassword', e.target.value)}
            required
          />
          {error && <div style={{ color: '#dc2626', fontSize: '0.85rem' }}>{error}</div>}
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create tenant'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
