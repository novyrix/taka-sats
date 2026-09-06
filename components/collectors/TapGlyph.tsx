// SPDX-License-Identifier: AGPL-3.0-only

import type { SVGProps } from 'react';

/**
 * The "tap here" glyph (DESIGN §8, §17 M1 row) — a tag held to a phone.
 * `currentColor`, 24×24 grid, 2px stroke to match Lucide (§8).
 *
 * TODO(M1-8/M3): the animated version — a one-shot anime.js ripple on the
 * tap-prompt moment (DESIGN §9.4), lazy-loaded (§9.3, §13.5). Static for now.
 */
export function TapGlyph({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <rect x="7" y="2" width="10" height="16" rx="2" />
      <path d="M12 6v6" opacity={0.5} />
      <path d="M4 14c0 4 3.5 8 8 8s8-4 8-8" opacity={0.35} />
      <path d="M9 22h6" opacity={0.35} />
    </svg>
  );
}
