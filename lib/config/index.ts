// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Layered configuration loader (D-21, REQUIREMENTS §13).
 *
 * Precedence, lowest to highest:
 *   1. `config/settings.default.toml`  — committed, every key present.
 *   2. `config/settings.toml`          — git-ignored operator overrides (optional).
 *   3. environment variables           — `TAKASATS__SECTION__KEY=value` (optional).
 *
 * The merged result is validated by {@link settingsSchema}. An invalid or
 * out-of-range value throws here — the process must never start on a
 * half-valid config. Secrets never live in TOML (D-21 §13.1): they stay in the
 * environment and are read by the modules that need them, not by this loader.
 *
 * Zero framework imports (D-04). Node-only by design — this is a boot concern.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { type Settings, settingsSchema } from './schema';

export { PROVISIONING_ACKNOWLEDGEMENT, settingsSchema } from './schema';
export type { Settings } from './schema';

const ENV_PREFIX = 'TAKASATS__';
const PATH_SEPARATOR = '__';

export type LoadOptions = {
  /** Directory holding `settings.default.toml` (+ optional `settings.toml`). */
  readonly configDir?: string;
  /** Environment map to read `TAKASATS__*` overrides from. */
  readonly env?: Readonly<Record<string, string | undefined>>;
};

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Recursively merge `override` onto `base`; arrays and scalars replace wholesale. */
function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override;
  }

  const result: PlainObject = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    result[key] = key in base ? deepMerge(base[key], overrideValue) : overrideValue;
  }
  return result;
}

/**
 * Coerce a string env value to the JSON type it represents so it can satisfy
 * the schema (`"900"` → number, `"true"` → boolean, `'["a","b"]'` → array).
 * A value that is not valid JSON is kept as the raw string.
 */
function coerceEnvValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function readTomlFile(path: string): PlainObject {
  const contents = readFileSync(path, 'utf8');
  const parsed = parseToml(contents);
  if (!isPlainObject(parsed)) {
    throw new Error(`Config file ${path} did not parse to a table`);
  }
  return parsed;
}

function tryReadTomlFile(path: string): PlainObject | undefined {
  try {
    return readTomlFile(path);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/** Build a partial config tree from `TAKASATS__A__B=value` variables. */
function envOverrides(env: Readonly<Record<string, string | undefined>>): PlainObject {
  const tree: PlainObject = {};

  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || !name.startsWith(ENV_PREFIX)) {
      continue;
    }

    const segments = name.slice(ENV_PREFIX.length).toLowerCase().split(PATH_SEPARATOR);
    if (segments.some((segment) => segment.length === 0)) {
      throw new Error(`Malformed config env var: ${name}`);
    }

    let cursor = tree;
    for (const segment of segments.slice(0, -1)) {
      const next = cursor[segment];
      if (next === undefined) {
        cursor[segment] = {};
      } else if (!isPlainObject(next)) {
        throw new Error(`Config env var ${name} conflicts with an earlier scalar override`);
      }
      cursor = cursor[segment] as PlainObject;
    }

    const leaf = segments.at(-1);
    if (leaf !== undefined) {
      cursor[leaf] = coerceEnvValue(value);
    }
  }

  return tree;
}

function formatIssues(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'issues' in error &&
    Array.isArray((error as { issues: unknown }).issues)
  ) {
    const { issues } = error as { issues: { path: PropertyKey[]; message: string }[] };
    return issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
  }
  return `  - ${String(error)}`;
}

/**
 * Load, merge, and validate configuration from the given sources. Throws with a
 * readable summary of every schema violation when the merged config is invalid.
 */
export function loadSettings(options: LoadOptions = {}): Settings {
  const configDir = options.configDir ?? join(process.cwd(), 'config');
  const env = options.env ?? process.env;

  const defaults = readTomlFile(join(configDir, 'settings.default.toml'));
  const overrides = tryReadTomlFile(join(configDir, 'settings.toml')) ?? {};

  const merged = deepMerge(deepMerge(defaults, overrides), envOverrides(env));

  const result = settingsSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(`Invalid Taka Sats configuration:\n${formatIssues(result.error)}`);
  }

  return deepFreeze(result.data);
}

function deepFreeze<T>(value: T): T {
  if (isPlainObject(value) || Array.isArray(value)) {
    for (const nested of Object.values(value as PlainObject)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

let cached: Settings | undefined;

/**
 * The process-wide settings singleton, loaded from the default sources on first
 * access. Use {@link loadSettings} directly in tests to supply explicit sources.
 */
export function getSettings(): Settings {
  cached ??= loadSettings();
  return cached;
}

/** Test helper: drop the memoised singleton so the next `getSettings()` reloads. */
export function resetSettingsCache(): void {
  cached = undefined;
}
