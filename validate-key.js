// api/validate-key.js — Standalone key validation
// Used by chatbot unlock screen to check key before showing the chat UI

import { validateKey } from './_lib/keys.js';
import { TIER_CONFIG } from './_lib/prompts.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ACTIVATION_KEY_SECRET) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  try {
    const { activationKey, expectedTier } = req.body || {};

    if (!activationKey) {
      return res.status(400).json({ valid: false, error: 'No key provided' });
    }

    const validated = validateKey(activationKey, process.env.ACTIVATION_KEY_SECRET);
    if (!validated) {
      return res.status(401).json({
        valid: false,
        error: 'invalid_key',
        message: 'Invalid activation key. Check that you copied it correctly from your email.'
      });
    }

    // Optional: verify the key matches the tier they're trying to access
    if (expectedTier && validated.tier !== expectedTier) {
      return res.status(403).json({
        valid: false,
        error: 'wrong_tier',
        message: `This key is for ${validated.label}, but you're trying to access a different tier. Use the correct page or contact support.`,
        actualTier: validated.tier,
        actualLabel: validated.label
      });
    }

    const config = TIER_CONFIG[validated.tier];
    return res.status(200).json({
      valid: true,
      tier: validated.tier,
      label: validated.label,
      durationMinutes: config.durationMinutes,
      price: config.price
    });

  } catch (err) {
    console.error('Validation error:', err);
    return res.status(500).json({ valid: false, error: 'server_error' });
  }
}
