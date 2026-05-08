/**
 * Promise-chain mutex keyed by an arbitrary string.
 *
 * Replaces the naive Map-based implementation in api/marpNote.js, which the
 * concurrency audit identified as susceptible to a thundering-herd race:
 * with two or more waiters, all of them could observe an empty map after
 * the previous holder cleared it and then proceed in parallel.
 *
 * This implementation chains every new request onto the tail of the
 * existing promise chain for the key, guaranteeing strict FIFO order.
 */

const tails = new Map(); // key → Promise (tail of the chain)

export async function withLock(key, fn) {
  const previous = tails.get(key) || Promise.resolve();

  // Create the next tail BEFORE starting fn so subsequent callers chain after us.
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  tails.set(key, next);

  try {
    // Wait for the previous chain to settle (success OR failure).
    await previous.catch(() => {});
    return await fn();
  } finally {
    release();
    // If we are still the tail, drop the entry so the map doesn't grow
    // unboundedly. If a subsequent caller has already replaced us as the
    // tail, leave their entry intact.
    if (tails.get(key) === next) tails.delete(key);
  }
}

/** Test helper. */
export function _activeKeyCount() {
  return tails.size;
}
