import React, { useState } from 'react';
import { Button } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { MyTab } from './timetable-my';
import { OperationsTab } from './timetable-operations';
import { StructureTab } from './timetable-structure';

export const VIEW_PERMISSION = 'timetable.view';
export const CREATE_PERMISSION = 'timetable.create';
export const UPDATE_PERMISSION = 'timetable.update';
export const PUBLISH_PERMISSION = 'timetable.publish';
export const MANAGE_PERMISSION = 'timetable.manage';

type Tab = 'structure' | 'operations' | 'my';

export function TimetablePage() {
  const { permissions } = useAuth();
  const [tab, setTab] = useState<Tab>('structure');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canCreate = permissions.includes(CREATE_PERMISSION);
  const canUpdate = permissions.includes(UPDATE_PERMISSION);
  const canManage = permissions.includes(MANAGE_PERMISSION);
  const canPublish = permissions.includes(PUBLISH_PERMISSION);

  return (
    <div style={{ maxWidth: 1150, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>Timetable</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setTab('structure')}>Structure</Button>
          <Button variant="secondary" onClick={() => setTab('operations')}>Operations</Button>
          <Button variant="secondary" onClick={() => setTab('my')}>My timetable</Button>
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      {tab === 'structure' && (
        <StructureTab
          canCreate={canCreate}
          canUpdate={canUpdate}
          canManage={canManage}
          canPublish={canPublish}
          activeId={activeId}
          onSelectActive={setActiveId}
          onError={setError}
          onNotice={setNotice}
        />
      )}
      {tab === 'operations' && (
        <OperationsTab
          timetableId={activeId}
          canCreate={canCreate}
          canUpdate={canUpdate}
          onError={setError}
          onNotice={setNotice}
        />
      )}
      {tab === 'my' && (
        <MyTab onError={setError} onNotice={setNotice} />
      )}
    </div>
  );
}