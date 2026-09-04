// SPDX-License-Identifier: AGPL-3.0-only

import type { DefaultSession } from 'next-auth';
import type { Role } from '@/lib/auth/permissions';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: Role;
      locale: string;
    } & DefaultSession['user'];
  }

  interface User {
    role: Role;
    locale: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: Role;
    locale?: string;
  }
}
