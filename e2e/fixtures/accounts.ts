// SPDX-License-Identifier: AGPL-3.0-only

/** The field supervisor the e2e suites sign in as. Seeded by `global-setup.ts`. */
export const FIELD_SUPERVISOR = {
  name: 'Ed Field',
  phone: '+254711000111',
  password: 'e2e-pass-correct-horse-9',
} as const;

const PASSWORD = 'e2e-pass-correct-horse-9';

/** A second field supervisor with NO session: the full-story spec creates and starts one for them. */
export const STORY_SUPERVISOR = {
  name: 'Story Sup',
  phone: '+254711000222',
  password: PASSWORD,
} as const;

/** Three admins: a treasury refill needs a proposer and two other approvers. */
export const ADMINS = [
  { name: 'Admin One', phone: '+254711000301', password: PASSWORD },
  { name: 'Admin Two', phone: '+254711000302', password: PASSWORD },
  { name: 'Admin Three', phone: '+254711000303', password: PASSWORD },
] as const;

export const HUB_LEAD = {
  name: 'Hub Lead',
  phone: '+254711000401',
  password: PASSWORD,
} as const;

export type Account = { readonly name: string; readonly phone: string; readonly password: string };
