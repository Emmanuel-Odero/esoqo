import { verifyChain } from '../audit';

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
