import React from 'react';
import { Card } from '@college-erp/ui';
import { PageShell, Stat, StatusBadge, fmtDate, money } from '../portal/portal-shared';
import { useParentData } from './parent-context';

interface TransportPass {
  id: string;
  routeCode: string | null;
  routeName: string;
  pickupPoint: string | null;
  dropPoint: string | null;
  vehicleNumber: string | null;
  periodStart: string;
  periodEnd: string | null;
  status: string;
  amountCents: number | null;
  dailyPickupTime: string | null;
  dailyDropTime: string | null;
  route: {
    code: string;
    name: string;
    stops: Array<{ id: string; name: string; order: number; pickupTime: string | null; dropTime: string | null }>;
    vehicle: { registrationNumber: string; type: string } | null;
  } | null;
  stop: { name: string; pickupTime: string | null } | null;
  dropStop: { name: string; dropTime: string | null } | null;
  vehicle: { registrationNumber: string } | null;
  driver: { name: string; phone: string | null } | null;
  feeCharges: Array<{ id: string; headName: string; amountCents: number; paidCents: number; status: string }>;
}

interface TransportResponse {
  passes: TransportPass[];
  summary: { activePasses: number };
}

export function ParentTransportPage() {
  const { data, error, loading } = useParentData<TransportResponse>('/parent-portal/transport');

  return (
    <PageShell title="Transport" subtitle="Bus pass, route and pickup details." error={error} loading={loading}>
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sp-grid">
            <Stat label="Active passes" value={data.summary.activePasses} />
          </div>
          {data.passes.length === 0 && <Card>No transport pass on record.</Card>}
          {data.passes.map((pass) => (
            <Card key={pass.id}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ fontSize: '1rem', margin: 0 }}>{pass.route?.name ?? pass.routeName}</h2>
                  <div className="sp-muted">
                    {pass.route?.code ?? pass.routeCode ?? '—'} · {fmtDate(pass.periodStart)} – {fmtDate(pass.periodEnd)}
                  </div>
                </div>
                <StatusBadge value={pass.status} />
              </div>
              <div className="sp-cards" style={{ marginTop: 10 }}>
                <div className="sp-stat">
                  <div className="sp-muted">Pickup</div>
                  <div style={{ fontWeight: 600 }}>{pass.stop?.name ?? pass.pickupPoint ?? '—'}</div>
                  <div className="sp-muted">{pass.stop?.pickupTime ?? pass.dailyPickupTime ?? '—'}</div>
                </div>
                <div className="sp-stat">
                  <div className="sp-muted">Drop</div>
                  <div style={{ fontWeight: 600 }}>{pass.dropStop?.name ?? pass.dropPoint ?? '—'}</div>
                  <div className="sp-muted">{pass.dropStop?.dropTime ?? pass.dailyDropTime ?? '—'}</div>
                </div>
                <div className="sp-stat">
                  <div className="sp-muted">Vehicle / Driver</div>
                  <div style={{ fontWeight: 600 }}>{pass.vehicle?.registrationNumber ?? pass.vehicleNumber ?? '—'}</div>
                  <div className="sp-muted">{pass.driver ? `${pass.driver.name} · ${pass.driver.phone ?? '—'}` : '—'}</div>
                </div>
                <div className="sp-stat">
                  <div className="sp-muted">Fee</div>
                  <div style={{ fontWeight: 600 }}>{money(pass.amountCents)}</div>
                  <div className="sp-muted">{pass.feeCharges.length} charge line(s)</div>
                </div>
              </div>
              {pass.route && pass.route.stops.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="sp-muted">Route stops</div>
                  <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {pass.route.stops.map((stop) => (
                      <li key={stop.id}>
                        {stop.name}
                        {stop.pickupTime ? ` · pickup ${stop.pickupTime}` : ''}
                        {stop.dropTime ? ` · drop ${stop.dropTime}` : ''}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
