// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The hot wallet as the treasury sees it: only its balance. The Lightning provider is built on
 * each call, so a misconfigured rail surfaces as "float unavailable" (nothing is guessed) rather
 * than as a crash, exactly like `GET /treasury/float`.
 */

import { getLightningProvider } from '@/lib/lightning';
import type { FloatReader } from './topups';

export const hotWallet: FloatReader = {
  getFloatBalance: () => getLightningProvider().getFloatBalance(),
};
