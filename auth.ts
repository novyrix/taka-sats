// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Auth.js v5 — supervisor credentials login (M2-1, pulled forward to unblock
 * M1-4's RBAC-gated routes).
 *
 * JWT session strategy (no `sessions` table, no DB round trip to validate a
 * session): `session.maxAge` comes from `settings.auth.session_max_age_days`,
 * long enough that a supervisor's PWA session survives an extended offline
 * period (§3.1, ADR-0002). `AUTH_SECRET` signs the JWT — environment only
 * (D-21 §13.1), never in `config/*.toml`.
 *
 * Only the credentials provider exists here; `partners` login and revocation
 * UX are the rest of M2-1, not needed to unblock M1.
 */

import { eq } from 'drizzle-orm';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';
import { isRole } from '@/lib/auth/permissions';
import { verifyPassword } from '@/lib/auth/password';
import { getSettings } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { supervisors } from '@/lib/db/schema';

const credentialsSchema = z.object({
  phone: z.string().trim().min(1),
  password: z.string().min(1),
});

const SECONDS_PER_DAY = 24 * 60 * 60;

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: getSettings().auth.session_max_age_days * SECONDS_PER_DAY,
  },
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      credentials: {
        phone: { label: 'Phone', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) {
          return null;
        }

        const db = getDb();
        const [supervisor] = await db
          .select()
          .from(supervisors)
          .where(eq(supervisors.phone, parsed.data.phone));

        if (!supervisor || !supervisor.active) {
          return null;
        }

        const valid = await verifyPassword(parsed.data.password, supervisor.passwordHash);
        if (!valid) {
          return null;
        }
        // The DB CHECK constraint already guarantees this, but a route that
        // trusts an unvalidated role string is exactly the kind of bug this
        // guards against — refuse to sign in rather than trust it blindly.
        if (!isRole(supervisor.role) || supervisor.role === 'partner') {
          return null;
        }

        await db
          .update(supervisors)
          .set({ lastLoginAt: new Date() })
          .where(eq(supervisors.id, supervisor.id));

        return {
          id: supervisor.id,
          name: supervisor.name,
          role: supervisor.role,
          locale: supervisor.locale,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.locale = user.locale;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = isRole(token.role) ? token.role : 'supervisor';
        session.user.locale = typeof token.locale === 'string' ? token.locale : 'en';
      }
      return session;
    },
  },
});
