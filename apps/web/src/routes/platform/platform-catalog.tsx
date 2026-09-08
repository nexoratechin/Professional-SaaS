import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { platformApiFetch } from '../../lib/platform-http';

interface PlanDto {
  id: string;
  code: string;
  name: string;
  priceCents: number | null;
  isActive: boolean;
  isCustom: boolean;
  planFeatures: Array<{ featureFlag: { key: string; name: string } }>;
}

interface FeatureFlagDto {
  id: string;
  key: string;
  name: string;
  module: string;
  isActive: boolean;
}

export function PlatformCatalogPage() {
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [flags, setFlags] = useState<FeatureFlagDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [newPlan, setNewPlan] = useState({ code: '', name: '', priceCents: '' });
  const [newFlag, setNewFlag] = useState({ key: '', name: '', module: '' });

  const load = useCallback(async () => {
    try {
      const [plansRes, flagsRes] = await Promise.all([
        platformApiFetch<PlanDto[]>('/plans?includeInactive=true'),
        platformApiFetch<FeatureFlagDto[]>('/feature-flags'),
      ]);
      setPlans(plansRes);
      setFlags(flagsRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load catalog.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createPlan = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await platformApiFetch('/plans', {
        method: 'POST',
        body: JSON.stringify({
          code: newPlan.code,
          name: newPlan.name,
          priceCents: newPlan.priceCents ? Number(newPlan.priceCents) : undefined,
        }),
      });
      setNewPlan({ code: '', name: '', priceCents: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create plan.');
    }
  };

  const togglePlanActive = async (plan: PlanDto) => {
    try {
      await platformApiFetch(`/plans/${plan.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !plan.isActive }) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update plan.');
    }
  };

  const createFlag = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await platformApiFetch('/feature-flags', { method: 'POST', body: JSON.stringify(newFlag) });
      setNewFlag({ key: '', name: '', module: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create feature flag.');
    }
  };

  const toggleFlagActive = async (flag: FeatureFlagDto) => {
    try {
      await platformApiFetch(`/feature-flags/${flag.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !flag.isActive }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update feature flag.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: '1.25rem' }}>Plans &amp; Feature Flags</h1>
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Plans</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ padding: '6px 8px' }}>Code</th>
              <th style={{ padding: '6px 8px' }}>Name</th>
              <th style={{ padding: '6px 8px' }}>Price</th>
              <th style={{ padding: '6px 8px' }}>Features</th>
              <th style={{ padding: '6px 8px' }}>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '6px 8px' }}>{plan.code}</td>
                <td style={{ padding: '6px 8px' }}>{plan.name}</td>
                <td style={{ padding: '6px 8px' }}>{plan.priceCents != null ? `₹${(plan.priceCents / 100).toFixed(2)}` : '—'}</td>
                <td style={{ padding: '6px 8px' }}>{plan.planFeatures.length}</td>
                <td style={{ padding: '6px 8px' }}>{plan.isActive ? 'Yes' : 'No'}</td>
                <td style={{ padding: '6px 8px' }}>
                  <Button variant="secondary" onClick={() => togglePlanActive(plan)}>
                    {plan.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={createPlan} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Input label="Code" value={newPlan.code} onChange={(e) => setNewPlan({ ...newPlan, code: e.target.value })} required />
          <Input label="Name" value={newPlan.name} onChange={(e) => setNewPlan({ ...newPlan, name: e.target.value })} required />
          <Input
            label="Price (cents)"
            type="number"
            value={newPlan.priceCents}
            onChange={(e) => setNewPlan({ ...newPlan, priceCents: e.target.value })}
          />
          <Button type="submit">+ Add plan</Button>
        </form>
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Feature flags</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ padding: '6px 8px' }}>Key</th>
              <th style={{ padding: '6px 8px' }}>Name</th>
              <th style={{ padding: '6px 8px' }}>Module</th>
              <th style={{ padding: '6px 8px' }}>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {flags.map((flag) => (
              <tr key={flag.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '6px 8px' }}>{flag.key}</td>
                <td style={{ padding: '6px 8px' }}>{flag.name}</td>
                <td style={{ padding: '6px 8px' }}>{flag.module}</td>
                <td style={{ padding: '6px 8px' }}>{flag.isActive ? 'Yes' : 'No'}</td>
                <td style={{ padding: '6px 8px' }}>
                  <Button variant="secondary" onClick={() => toggleFlagActive(flag)}>
                    {flag.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={createFlag} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Input label="Key" value={newFlag.key} onChange={(e) => setNewFlag({ ...newFlag, key: e.target.value })} required />
          <Input label="Name" value={newFlag.name} onChange={(e) => setNewFlag({ ...newFlag, name: e.target.value })} required />
          <Input
            label="Module"
            value={newFlag.module}
            onChange={(e) => setNewFlag({ ...newFlag, module: e.target.value })}
            required
          />
          <Button type="submit">+ Add flag</Button>
        </form>
      </Card>
    </div>
  );
}
