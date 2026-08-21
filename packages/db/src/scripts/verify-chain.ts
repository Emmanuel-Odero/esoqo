import { verifyChain } from '../audit';

// Wrapped in main() rather than a bare top-level await — esbuild (via
// tsx) transpiles this file to CJS in some invocation contexts, where
// top-level await isn't supported.
async function main() {
  const res = await verifyChain();
  if (res.ok) {
    console.log(`audit chain OK — ${res.checked} events verified`);
    process.exit(0);
  }
  console.error(
    `AUDIT CHAIN BROKEN after ${res.checked} events.\n` +
    `First bad row: id=${res.brokenAtId} at ${res.brokenAtTime?.toISOString()}`,
  );
  process.exit(1);
}

main();
