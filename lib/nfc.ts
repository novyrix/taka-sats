// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Web NFC helpers (DESIGN §6.4, ROADMAP M1-7/M1-8). `NDEFReader` is
 * Chrome-on-Android only — every caller must have a manual fallback (gate
 * G2). The DOM lib has no types for it, so a minimal surface is declared
 * here. Browser-only; do not import from a Server Component.
 */

type NdefRecordInit = { recordType: string; data?: string };
type NdefWriteMessage = { records: NdefRecordInit[] };
type NdefReadingEvent = { serialNumber: string };

type NDEFReader = {
  write(message: NdefWriteMessage, options?: { signal?: AbortSignal }): Promise<void>;
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  addEventListener(type: 'reading', listener: (event: NdefReadingEvent) => void): void;
  addEventListener(type: 'readingerror', listener: () => void): void;
};

type NDEFReaderConstructor = new () => NDEFReader;

function getNdefReader(): NDEFReaderConstructor | undefined {
  return (globalThis as { NDEFReader?: NDEFReaderConstructor }).NDEFReader;
}

export function isWebNfcAvailable(): boolean {
  return getNdefReader() !== undefined;
}

/**
 * Write a single URL record (the collector's LNURL-pay link / Lightning
 * Address) to whatever blank NTAG is presented, then read the tag back once
 * to capture its hardware serial number — that serial is our `tag_history.tag_id`.
 */
export async function writeTagAndReadSerial(url: string, signal?: AbortSignal): Promise<string> {
  const Reader = getNdefReader();
  if (!Reader) {
    throw new Error('Web NFC is not available on this device');
  }

  const writer = new Reader();
  await writer.write(
    { records: [{ recordType: 'url', data: url }] },
    signal ? { signal } : undefined,
  );

  const reader = new Reader();
  const serial = await new Promise<string>((resolve, reject) => {
    reader.addEventListener('reading', (event) => resolve(event.serialNumber));
    reader.addEventListener('readingerror', () => reject(new Error('Could not read the tag back')));
    reader.scan(signal ? { signal } : undefined).catch(reject);
  });

  return serial;
}

/**
 * Start a tag read (M1-8): `onSerial` fires with the NTAG hardware serial
 * every time a tag is presented, until `signal` aborts. Rejects if Web NFC
 * is unavailable or the scan cannot start (caller falls back to alias
 * search, G2).
 */
export async function startTagScan(
  onSerial: (serial: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const Reader = getNdefReader();
  if (!Reader) {
    throw new Error('Web NFC is not available on this device');
  }

  const reader = new Reader();
  reader.addEventListener('reading', (event) => onSerial(event.serialNumber));
  await reader.scan({ signal });
}
