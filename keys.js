// api/_lib/keys.js — shared key generation & validation
// HMAC-SHA256 signed self-validating activation keys
// Format: FR-{TIER}-{NONCE}-{SIG}  (e.g., FR-DD-K7M9X3PN-A8F2C9E1)

import crypto from 'crypto';

// Crockford base32 alphabet (no 0/O/I/L/1 to avoid confusion when typing)
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const TIER_CODES = {
  'deep-dive': 'DD',
  'strategy-lab': 'SL',
  'full-blueprint': 'FB'
};

export const TIER_NAMES = {
  'DD': 'deep-dive',
  'SL': 'strategy-lab',
  'FB': 'full-blueprint'
};

export const TIER_LABELS = {
  'deep-dive': 'Deep Dive',
  'strategy-lab': 'Strategy Lab',
  'full-blueprint': 'Full Blueprint'
};

function bytesToBase32(bytes, length) {
  let result = '';
  let bits = 0, value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) result += ALPHABET[(value << (5 - bits)) & 31];
  return result.slice(0, length);
}

function randomNonce(length = 8) {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (const byte of bytes) result += ALPHABET[byte % ALPHABET.length];
  return result.slice(0, length);
}

function computeSignature(tier, nonce, secret) {
  const payload = `${tier}-${nonce}`;
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest();
  return bytesToBase32(hmac, 8);
}

export function generateKey(tier, secret) {
  if (!secret) throw new Error('Missing key secret');
  const tierCode = TIER_CODES[tier];
  if (!tierCode) throw new Error('Invalid tier');
  const nonce = randomNonce(8);
  const sig = computeSignature(tierCode, nonce, secret);
  return `FR-${tierCode}-${nonce}-${sig}`;
}

export function validateKey(rawKey, secret) {
  if (!rawKey || !secret) return null;
  // Normalize: uppercase, strip non-alphanumeric
  const cleaned = String(rawKey).toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Expected format: FR + 2 char tier + 8 char nonce + 8 char sig = 20 chars
  if (cleaned.length !== 20 || !cleaned.startsWith('FR')) return null;
  const tierCode = cleaned.slice(2, 4);
  const nonce = cleaned.slice(4, 12);
  const providedSig = cleaned.slice(12, 20);
  const tierName = TIER_NAMES[tierCode];
  if (!tierName) return null;
  const expectedSig = computeSignature(tierCode, nonce, secret);
  // Constant-time comparison
  if (providedSig.length !== expectedSig.length) return null;
  let diff = 0;
  for (let i = 0; i < providedSig.length; i++) {
    diff |= providedSig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (diff !== 0) return null;
  return { tier: tierName, label: TIER_LABELS[tierName], code: tierCode, nonce };
}

export function formatKeyForDisplay(key) {
  // Add visual dashes every 4 chars for readability: FR-DD-K7M9-X3PN-A8F2-C9E1
  const cleaned = key.replace(/[^A-Z0-9-]/gi, '').toUpperCase();
  const parts = cleaned.split('-');
  if (parts.length === 4) {
    const [pre, tier, nonce, sig] = parts;
    return `${pre}-${tier}-${nonce.slice(0, 4)}-${nonce.slice(4)}-${sig.slice(0, 4)}-${sig.slice(4)}`;
  }
  return key;
}
