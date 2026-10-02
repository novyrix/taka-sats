// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Blink (Galoy) `LightningProvider` (D-11, D-23): the shipped default operating-float rail; also
 * resolves/validates a collector's Lightning Address for enrolment.
 *
 * Field names, enums and the payment-status semantics below were checked against Blink's public
 * GraphQL schema (`core/api/src/graphql/public/schema.graphql` in the open source Blink
 * repository) and its resolvers, and against dev.blink.sv. The provider page
 * `docs/providers/blink.md` records exactly what was verified and what has still never been run
 * against a live account.
 *
 * How a payment is classified (the rule that prevents a double payment):
 *   SUCCESS (+ a matching proof when Blink returns one)   -> paid
 *   FAILURE with only codes that mean "nothing was sent"  -> PaymentFailedError (may be retried)
 *   anything else: PENDING, ALREADY_PAID, an unlisted error code, an HTTP 5xx/408/429, a timeout,
 *   a lost connection, an unreadable answer              -> PaymentOutcomeUnknownError (a person
 *   checks; never retried). The unknown error carries the payment hash so it can be looked up.
 */

import { createHash } from 'node:crypto';
import { sats, type Sats } from '@/lib/money';
import { bolt11PaymentHash } from './bolt11';
import {
  isDefinitiveHttpRejection,
  PaymentFailedError,
  PaymentOutcomeUnknownError,
} from './errors';
import type {
  FloatBalance,
  LightningProvider,
  PaymentLookup,
  PaymentLookupQuery,
  ProviderWallet,
  PayoutDestination,
  PayResult,
  ResolvedAddress,
} from './LightningProvider';
import { requestInvoiceFor, resolveLnurlPay } from './lnurlPay';

export type BlinkProviderConfig = {
  /** e.g. https://api.blink.sv/graphql (settings.lightning.blink.api_url). */
  readonly apiUrl: string;
  /** The float wallet id (settings.lightning.blink.float_wallet_id). Non-secret; must be the BTC wallet. */
  readonly floatWalletId: string;
  /** `X-API-KEY` value ("blink_..."). From the environment only (D-21), never in settings.toml. */
  readonly apiKey: string;
  /** Per-request timeout. A timeout on a payment is an unknown outcome. Default 30 s. */
  readonly timeoutMs?: number;
  /** How many recent wallet transactions a lookup by memo scans. Default 100. */
  readonly lookupScanLimit?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SCAN_LIMIT = 100;

/**
 * Payload error codes (Blink `Error.code`) that mean the payment was refused before any money
 * moved or was reversed by Blink. Anything not listed here is treated as unknown, on purpose:
 * Blink maps internal faults (database, node offline, unexpected errors) to FAILURE too, and
 * those can occur after the payment left the node.
 */
const DEFINITE_FAILURE_CODES: ReadonlySet<string> = new Set([
  'INSUFFICIENT_BALANCE',
  'ROUTE_FINDING_ERROR',
  'INVALID_INPUT',
  'INVOICE_DECODE_ERROR',
  'CANT_PAY_SELF',
  'TRANSACTION_RESTRICTED',
  'OPERATION_RESTRICTED',
  'NEW_ACCOUNT_WITHDRAWAL_RESTRICTED',
  'ENTERED_DUST_AMOUNT',
  'NOT_AUTHENTICATED',
  'NOT_AUTHORIZED',
  'TOO_MANY_REQUEST',
]);

/** Top-level GraphQL error codes that mean the request was rejected before execution. */
const DEFINITE_REQUEST_CODES: ReadonlySet<string> = new Set([
  'GRAPHQL_VALIDATION_FAILED',
  'GRAPHQL_PARSE_FAILED',
  'BAD_USER_INPUT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_AUTHENTICATED',
  'NOT_AUTHORIZED',
  'INVALID_INPUT',
]);

type GraphQlError = { message: string; extensions?: { code?: string } };
type GraphQlResponse<T> = { data?: T | null; errors?: GraphQlError[] };
type PayloadError = { message: string; code?: string | null };

/** The selection reused by the send mutation and the lookup queries. */
const TRANSACTION_FIELDS = /* GraphQL */ `
  id
  status
  direction
  memo
  createdAt
  settlementFee
  initiationVia {
    ... on InitiationViaLn {
      paymentHash
    }
  }
  settlementVia {
    ... on SettlementViaLn {
      preImage
    }
    ... on SettlementViaIntraLedger {
      preImage
    }
  }
`;

const PAY_INVOICE_MUTATION = /* GraphQL */ `
  mutation LnInvoicePaymentSend($input: LnInvoicePaymentInput!) {
    lnInvoicePaymentSend(input: $input) {
      status
      errors {
        message
        code
        path
      }
      transaction {
        ${TRANSACTION_FIELDS}
      }
    }
  }
`;

const WALLET_BALANCE_QUERY = /* GraphQL */ `
  query FloatWalletBalance($walletId: WalletId!) {
    me {
      defaultAccount {
        walletById(walletId: $walletId) {
          id
          balance
          walletCurrency
        }
      }
    }
  }
`;

const WALLETS_QUERY = /* GraphQL */ `
  query Wallets {
    me {
      defaultAccount {
        wallets {
          id
          walletCurrency
          balance
        }
      }
    }
  }
`;

const LOOKUP_BY_HASH_QUERY = /* GraphQL */ `
  query PaymentByHash($walletId: WalletId!, $paymentHash: PaymentHash!) {
    me {
      defaultAccount {
        walletById(walletId: $walletId) {
          transactionsByPaymentHash(paymentHash: $paymentHash) {
            ${TRANSACTION_FIELDS}
          }
        }
      }
    }
  }
`;

const RECENT_TRANSACTIONS_QUERY = /* GraphQL */ `
  query RecentTransactions($walletId: WalletId!, $first: Int!) {
    me {
      defaultAccount {
        walletById(walletId: $walletId) {
          transactions(first: $first) {
            edges {
              node {
                ${TRANSACTION_FIELDS}
              }
            }
          }
        }
      }
    }
  }
`;

type BlinkTransaction = {
  id: string;
  status: 'SUCCESS' | 'PENDING' | 'FAILURE' | string;
  direction: 'SEND' | 'RECEIVE' | string;
  memo?: string | null;
  createdAt?: number | null;
  settlementFee?: number | null;
  initiationVia?: { paymentHash?: string } | null;
  settlementVia?: { preImage?: string | null } | null;
};

type PayInvoiceData = {
  lnInvoicePaymentSend: {
    status: string | null;
    errors: PayloadError[];
    transaction: BlinkTransaction | null;
  } | null;
};

type WalletBalanceData = {
  me: {
    defaultAccount: {
      walletById: { id: string; balance: number; walletCurrency: string } | null;
    };
  } | null;
};

type LookupByHashData = {
  me: {
    defaultAccount: {
      walletById: { transactionsByPaymentHash: BlinkTransaction[] } | null;
    };
  } | null;
};

type RecentTransactionsData = {
  me: {
    defaultAccount: {
      walletById: { transactions: { edges: { node: BlinkTransaction }[] | null } | null } | null;
    };
  } | null;
};

/** `sha256(preimage) === paymentHash` is the cryptographic proof that the payee was paid. */
function preimageMatches(preImage: string | null | undefined, paymentHash: string): boolean {
  if (!preImage || !/^[0-9a-f]{64}$/i.test(preImage)) {
    return false;
  }
  return (
    createHash('sha256').update(Buffer.from(preImage, 'hex')).digest('hex') ===
    paymentHash.toLowerCase()
  );
}

function feeOf(transaction: BlinkTransaction | null | undefined): Sats {
  const fee = transaction?.settlementFee;
  return sats(typeof fee === 'number' && Number.isFinite(fee) && fee > 0 ? Math.trunc(fee) : 0);
}

function settledAtOf(transaction: BlinkTransaction | null | undefined): Date {
  const seconds = transaction?.createdAt;
  return typeof seconds === 'number' && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

export class BlinkProvider implements LightningProvider {
  readonly kind = 'blink';

  constructor(private readonly config: BlinkProviderConfig) {}

  /**
   * One GraphQL round trip. `moneyMoved` marks the payment mutation: there every ambiguous
   * result (lost connection, timeout, 5xx, unreadable body, unlisted error) is an UNKNOWN
   * outcome carrying `paymentRef`; for a read it is an ordinary failure.
   */
  private async graphql<T>(
    query: string,
    variables: Record<string, unknown>,
    moneyMoved?: { readonly paymentRef: string },
  ): Promise<GraphQlResponse<T>> {
    if (!this.config.apiKey) {
      throw new PaymentFailedError('BLINK_API_KEY is not set, required to use Blink');
    }
    const unknown = (message: string): Error =>
      moneyMoved
        ? new PaymentOutcomeUnknownError(message, moneyMoved.paymentRef)
        : new PaymentFailedError(message);

    let response: Response;
    try {
      response = await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-API-KEY': this.config.apiKey },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch {
      // The request may have reached Blink before the connection was lost.
      throw unknown('Blink request did not complete (network error or timeout)');
    }

    if (!response.ok) {
      // A 4xx means the request was rejected and nothing was attempted; a 5xx / timeout /
      // rate-limit may have been processed before the response was lost.
      throw isDefinitiveHttpRejection(response.status) || !moneyMoved
        ? new PaymentFailedError(`Blink API returned HTTP ${response.status}`)
        : unknown(`Blink API returned HTTP ${response.status}`);
    }

    try {
      return (await response.json()) as GraphQlResponse<T>;
    } catch {
      throw unknown('Blink API returned an unreadable answer');
    }
  }

  /** Top-level GraphQL errors: a read, or a request rejected before execution. */
  private static throwTopLevel(
    errors: GraphQlError[],
    moneyMoved?: { readonly paymentRef: string },
  ): never {
    const codes = errors.map((e) => e.extensions?.code ?? '');
    const message = errors.map((e) => e.message).join('; ');
    const definite = codes.every((code) => DEFINITE_REQUEST_CODES.has(code));
    if (!moneyMoved || definite) {
      throw new PaymentFailedError(message, codes[0] || undefined);
    }
    throw new PaymentOutcomeUnknownError(message, moneyMoved.paymentRef);
  }

  async resolveReceiveAddress(lnurlOrAddress: string): Promise<ResolvedAddress> {
    return resolveLnurlPay(lnurlOrAddress);
  }

  async pay(
    destination: PayoutDestination,
    amount: Sats,
    idempotencyKey: string,
  ): Promise<PayResult> {
    // The destination is an already-resolved receive-capable target; never trust it blindly,
    // resolve again to get a fresh invoice at pay time (its amount is checked inside).
    const bolt11 = await requestInvoiceFor(destination.lnurlOrAddress, amount);
    let paymentHash: string;
    try {
      paymentHash = bolt11PaymentHash(bolt11);
    } catch {
      throw new PaymentFailedError('The destination returned an invoice without a payment hash');
    }
    const sent = { paymentRef: paymentHash } as const;

    const body = await this.graphql<PayInvoiceData>(
      PAY_INVOICE_MUTATION,
      {
        input: {
          walletId: this.config.floatWalletId,
          paymentRequest: bolt11,
          memo: idempotencyKey,
        },
      },
      sent,
    );

    const payload = body.data?.lnInvoicePaymentSend ?? null;
    if (!payload) {
      if (body.errors && body.errors.length > 0) {
        BlinkProvider.throwTopLevel(body.errors, sent);
      }
      throw new PaymentOutcomeUnknownError('Blink API returned no payment result', paymentHash);
    }

    const errors = payload.errors ?? [];
    const { status } = payload;

    if (status === 'SUCCESS') {
      const proof = payload.transaction?.settlementVia?.preImage;
      if (proof && !preimageMatches(proof, paymentHash)) {
        // A "success" whose proof does not match the invoice is not something to trust.
        throw new PaymentOutcomeUnknownError('Blink proof of payment did not match', paymentHash);
      }
      return {
        paymentRef: paymentHash,
        amount,
        feeSats: feeOf(payload.transaction),
        settledAt: settledAtOf(payload.transaction),
      };
    }

    const message = errors.map((e) => e.message).join('; ');
    const definite =
      errors.length > 0 && errors.every((e) => e.code && DEFINITE_FAILURE_CODES.has(e.code));
    if (status === 'FAILURE' && definite) {
      throw new PaymentFailedError(message || 'Blink payment failed', errors[0]?.code ?? undefined);
    }
    // A payload with errors and no status is Blink rejecting the input before it did anything.
    if ((status === null || status === undefined) && errors.length > 0 && !payload.transaction) {
      throw new PaymentFailedError(message, errors[0]?.code ?? undefined);
    }
    // PENDING (it may still settle), ALREADY_PAID (not proof that THIS payment was ours), an
    // unlisted error code, or a status we do not recognise: never "failed".
    throw new PaymentOutcomeUnknownError(
      `Blink payment status: ${status ?? 'none'}${errors[0]?.code ? ` (${errors[0].code})` : ''}`,
      paymentHash,
    );
  }

  /**
   * Ask Blink what became of a payment, by its payment hash (stored when the outcome was
   * unknown) or, failing that, by scanning the wallet's most recent transactions for our memo
   * (the payout id). Read only. `not_found` is NOT proof that nothing was sent when the scan
   * window is the only evidence: a person decides.
   */
  async lookupPayment(query: PaymentLookupQuery): Promise<PaymentLookup> {
    const walletId = this.config.floatWalletId;
    let candidates: BlinkTransaction[];

    if (query.paymentRef) {
      const body = await this.graphql<LookupByHashData>(LOOKUP_BY_HASH_QUERY, {
        walletId,
        paymentHash: query.paymentRef,
      });
      if (body.errors?.length) {
        BlinkProvider.throwTopLevel(body.errors);
      }
      candidates = (
        body.data?.me?.defaultAccount.walletById?.transactionsByPaymentHash ?? []
      ).filter((t) => t.direction === 'SEND');
    } else {
      const body = await this.graphql<RecentTransactionsData>(RECENT_TRANSACTIONS_QUERY, {
        walletId,
        first: this.config.lookupScanLimit ?? DEFAULT_SCAN_LIMIT,
      });
      if (body.errors?.length) {
        BlinkProvider.throwTopLevel(body.errors);
      }
      const edges = body.data?.me?.defaultAccount.walletById?.transactions?.edges ?? [];
      candidates = edges
        .map((edge) => edge.node)
        .filter((t) => t.direction === 'SEND' && t.memo === query.idempotencyKey);
    }

    const paid = candidates.find((t) => t.status === 'SUCCESS');
    const pending = candidates.find((t) => t.status === 'PENDING');
    const tx = paid ?? pending ?? candidates[0];
    if (!tx) {
      return { state: 'not_found', matches: 0 };
    }
    const hash = tx.initiationVia?.paymentHash ?? query.paymentRef;
    return {
      state: paid ? 'paid' : pending ? 'pending' : 'failed',
      ...(hash ? { paymentRef: hash } : {}),
      feeSats: feeOf(tx),
      settledAt: settledAtOf(tx),
      proofVerified: hash ? preimageMatches(tx.settlementVia?.preImage, hash) : false,
      // More than one matching send is itself something a person must see.
      matches: candidates.length,
    };
  }

  /** Every wallet on the account (a Blink account has a BTC and a USD wallet). Needs the Read scope. */
  async discoverWallets(): Promise<ProviderWallet[]> {
    const body = await this.graphql<{
      me: {
        defaultAccount: { wallets: { id: string; walletCurrency: string; balance: number }[] };
      } | null;
    }>(WALLETS_QUERY, {});
    if (body.errors?.length) {
      BlinkProvider.throwTopLevel(body.errors);
    }
    return (body.data?.me?.defaultAccount.wallets ?? []).map((w) => ({
      id: w.id,
      currency: w.walletCurrency,
      balance: w.balance,
    }));
  }

  async getFloatBalance(): Promise<FloatBalance> {
    const body = await this.graphql<WalletBalanceData>(WALLET_BALANCE_QUERY, {
      walletId: this.config.floatWalletId,
    });
    if (body.errors?.length) {
      BlinkProvider.throwTopLevel(body.errors);
    }
    const wallet = body.data?.me?.defaultAccount.walletById;
    if (!wallet) {
      throw new PaymentFailedError(
        `Float wallet ${this.config.floatWalletId} not found on this Blink account`,
      );
    }
    if (wallet.walletCurrency !== 'BTC') {
      // A USD wallet's balance is in cents, not sats: reading it as sats would mis-state the float.
      throw new PaymentFailedError(
        'The Blink float wallet must be the BTC wallet (its balance is read in sats)',
      );
    }
    return { available: sats(Math.max(0, Math.trunc(wallet.balance))), asOf: new Date() };
  }
}
