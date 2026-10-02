// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { useTranslations } from 'next-intl';
import { useConsoleUser } from '@/components/console/context';
import { useApi } from '@/components/console/hooks';
import {
  ActionButton,
  DataState,
  Pill,
  PageHeader,
  TableWrap,
  Td,
  Th,
} from '@/components/console/kit';
import { api } from '@/lib/console/api';

type Person = { id: string; name: string; role: string; active: boolean };

/** The staff roster. Accounts are created by the operator scripts; here an admin can switch one off or on. */
export function Staff() {
  const t = useTranslations('Console.staff');
  const user = useConsoleUser();
  const { data, error, loading, reload } = useApi<{ supervisors: Person[] }>(
    '/supervisors?includeInactive=1',
  );
  const rows = data?.supervisors ?? [];

  return (
    <div>
      <PageHeader title={t('title')} description={t('intro')} />
      <DataState
        loading={loading}
        error={error}
        empty={rows.length === 0}
        emptyText={t('empty')}
        onRetry={reload}
      >
        <TableWrap minWidth="36rem">
          <thead>
            <tr>
              <Th>{t('col.name')}</Th>
              <Th>{t('col.role')}</Th>
              <Th>{t('col.status')}</Th>
              <Th>{t('col.actions')}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} data-testid="staff-row">
                <Td className="font-medium">
                  {p.name}
                  {p.id === user.id ? (
                    <span className="ml-2 text-muted-foreground">{t('you')}</span>
                  ) : null}
                </Td>
                <Td>{t(`roles.${p.role}`)}</Td>
                <Td>
                  <Pill
                    status={p.active ? 'confirmed' : 'failed'}
                    label={p.active ? t('active') : t('inactive')}
                  />
                </Td>
                <Td>
                  {p.id === user.id ? (
                    <span className="text-xs text-muted-foreground">{t('selfNote')}</span>
                  ) : p.active ? (
                    <ActionButton
                      label={t('deactivate')}
                      variant="outline"
                      confirm={t('deactivateConfirm', { name: p.name })}
                      run={() =>
                        api(`/supervisors/${p.id}`, { method: 'PATCH', body: { active: false } })
                      }
                      onDone={reload}
                    />
                  ) : (
                    <ActionButton
                      label={t('reactivate')}
                      run={() =>
                        api(`/supervisors/${p.id}`, { method: 'PATCH', body: { active: true } })
                      }
                      onDone={reload}
                    />
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </DataState>
    </div>
  );
}
