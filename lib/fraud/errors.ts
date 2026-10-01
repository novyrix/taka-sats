// SPDX-License-Identifier: AGPL-3.0-only

export class AnomalyNotFoundError extends Error {
  constructor() {
    super('anomaly flag not found');
    this.name = 'AnomalyNotFoundError';
  }
}

/** A review that is final for this reviewer: only a DIFFERENT admin may change an outcome. */
export class AnomalyReviewError extends Error {
  constructor() {
    super('this flag is already reviewed; a different admin must change its outcome');
    this.name = 'AnomalyReviewError';
  }
}
