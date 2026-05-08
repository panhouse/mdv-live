/**
 * Single source of truth for the file-content ETag format.
 * `sha256:<hex>` over UTF-8 bytes of the source. Replaces the duplicated
 * helpers previously embedded in rendering/index.js and api/marpNote.js.
 */

import crypto from 'node:crypto';

export function makeEtag(rawSource) {
  return 'sha256:' + crypto.createHash('sha256').update(rawSource).digest('hex');
}
