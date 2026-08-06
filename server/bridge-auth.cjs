'use strict';

/**
 * Optional shared-secret auth for Media Bridge mutating / sensitive routes.
 * When MEDIA_BRIDGE_API_SECRET is unset, middleware is a no-op (local/dev).
 * When set, clients must send: Authorization: Bearer <secret>
 *   or X-Media-Bridge-Api-Key: <secret>
 */

function getApiSecret() {
  return String(process.env.MEDIA_BRIDGE_API_SECRET || '').trim();
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  const crypto = require('crypto');
  return crypto.timingSafeEqual(ba, bb);
}

function extractPresentedSecret(req) {
  const auth = String(req.headers.authorization || '').trim();
  if (/^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }
  const headerKey = String(
    req.headers['x-media-bridge-api-key'] || req.headers['x-api-key'] || ''
  ).trim();
  return headerKey || '';
}

function requireBridgeApiSecret(req, res, next) {
  const secret = getApiSecret();
  if (!secret) {
    return next();
  }
  const presented = extractPresentedSecret(req);
  if (!presented || !safeEqual(presented, secret)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  return next();
}

function isApiSecretConfigured() {
  return Boolean(getApiSecret());
}

module.exports = {
  requireBridgeApiSecret,
  isApiSecretConfigured,
  getApiSecret,
};
