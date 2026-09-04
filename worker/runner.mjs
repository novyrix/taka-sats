// SPDX-License-Identifier: AGPL-3.0-only

const heartbeat = setInterval(() => undefined, 60_000);

function shutdown() {
  clearInterval(heartbeat);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('Taka Sats worker scaffold ready');
