// SPDX-License-Identifier: AGPL-3.0-only

'use client';

import { createContext, type ReactNode, useContext } from 'react';
import { type Role, type Scope, roleHasScope } from '@/lib/auth/permissions';

export type ConsoleUser = {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly timeZone: string;
};

const ConsoleContext = createContext<ConsoleUser | null>(null);

/** Who is signed in, for hiding actions the API would refuse anyway (the API still decides). */
export function ConsoleProvider({
  user,
  children,
}: {
  readonly user: ConsoleUser;
  readonly children: ReactNode;
}) {
  return <ConsoleContext.Provider value={user}>{children}</ConsoleContext.Provider>;
}

export function useConsoleUser(): ConsoleUser & { readonly can: (scope: Scope) => boolean } {
  const value = useContext(ConsoleContext);
  if (!value) {
    throw new Error('useConsoleUser must be used inside <ConsoleProvider>');
  }
  return { ...value, can: (scope) => roleHasScope(value.role, scope) };
}
