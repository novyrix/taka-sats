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
import { isRole, type Role } from '@/lib/auth/permissions';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { LoginThrottle } from '@/lib/auth/throttle';
import { getSettings } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { partners, supervisors } from '@/lib/db/schema';

const credentialsSchema = z.object({
  /** A supervisor's provisioned staff identifier/phone or a partner's login email. */
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
});

const SECONDS_PER_DAY = 24 * 60 * 60;

const { login_max_failures, login_window_minutes } = getSettings().auth;
/** Shared by every sign-in in this process; see lib/auth/throttle.ts for the rules and limits. */
export const loginThrottle = new LoginThrottle({
  maxFailures: login_max_failures,
  windowMs: login_window_minutes * 60_000,
});

/** A real hash to verify against when the account does not exist, so an unknown identifier costs the same time as a known one. */
let decoyHash: Promise<string> | undefined;
async function spendDecoyTime(password: string): Promise<null> {
  decoyHash ??= hashPassword('decoy-password-never-valid');
  await verifyPassword(password, await decoyHash);
  return null;
}

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
        identifier: { label: 'Staff code, phone or email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) {
          return null;
        }
        const { identifier, password } = parsed.data;
        if (loginThrottle.isLocked(identifier)) {
          // Same silent refusal as a wrong password: the response says nothing about why.
          console.warn('[auth] sign-in refused: too many failed attempts');
          return null;
        }
        const user = await authenticate(identifier, password);
        if (user) {
          loginThrottle.recordSuccess(identifier);
        } else {
          loginThrottle.recordFailure(identifier);
        }
        return user;
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

type SignedInUser = { id: string; name: string; role: Role; locale: string };

async function authenticate(identifier: string, password: string): Promise<SignedInUser | null> {
  const db = getDb();

  // A partner logs in with an email; staff with their provisioned identifier.
  if (identifier.includes('@')) {
    const [partner] = await db
      .select()
      .from(partners)
      .where(eq(partners.loginEmail, identifier.toLowerCase()));
    if (!partner || !partner.active || !partner.passwordHash) {
      return spendDecoyTime(password);
    }
    if (!(await verifyPassword(password, partner.passwordHash))) {
      return null;
    }
    return { id: partner.id, name: partner.name, role: 'partner' as const, locale: 'en' };
  }

  const [supervisor] = await db.select().from(supervisors).where(eq(supervisors.phone, identifier));
  if (!supervisor || !supervisor.active) {
    return spendDecoyTime(password);
  }
  if (!(await verifyPassword(password, supervisor.passwordHash))) {
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
}
