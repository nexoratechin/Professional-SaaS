import { createContext, useContext } from 'react';
import { usePortalData } from '../portal/portal-shared';

/** A child as returned by GET /parent-portal/children. */
export interface ParentChild {
  studentId: string;
  fullName: string;
  admissionNumber: string;
  rollNumber: string | null;
  status: string;
  profilePhotoKey: string | null;
  guardianKind: string;
  guardianRole: string;
}

interface ParentPortalContextValue {
  children: ParentChild[];
  selected: ParentChild | null;
  selectedId: string | null;
  selectChild: (id: string) => void;
  reloadChildren: () => Promise<void>;
}

export const ParentPortalContext = createContext<ParentPortalContextValue | null>(null);

export function useParentPortal(): ParentPortalContextValue {
  const ctx = useContext(ParentPortalContext);
  if (!ctx) throw new Error('useParentPortal must be used within a ParentGate');
  return ctx;
}

/** Builds the `/parent-portal/...?studentId=...` path for the currently selected child and loads
 *  it with the shared portal data hook. The API re-validates the studentId against the caller's
 *  linked children, so the selector is never a grant of access. */
export function useParentData<T>(
  base: string,
  extra?: Record<string, string | number | boolean | undefined>,
) {
  const { selectedId } = useParentPortal();
  const params = new URLSearchParams();
  if (selectedId) params.set('studentId', selectedId);
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const query = params.toString();
  return usePortalData<T>(`${base}${query ? `?${query}` : ''}`);
}
