// api/generate-key.js — Admin endpoint to generate new activation keys
// Protected by ADMIN_PASSWORD environment variable

import { generateKey, formatKeyForDisplay, TIER_LABELS } from './_lib/keys.js';
import { TIER_CONFIG } from './_lib/prompts.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ACTIVATION_KEY_SECRET || !process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Server not configured (missing ACTIVATION_KEY_SECRET or ADMIN_PASSWORD)' });
  }

  try {
    const { adminPassword, tier, quantity = 1 } = req.body || {};

    // ─── Admin auth ───
    if (!adminPassword || adminPassword !== process.env.ADMIN_PASSWORD) {
      // Slight delay to discourage brute force
      await new Promise(r => setTimeout(r, 500));
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // ─── Validate tier ───
    const validTiers = ['deep-dive', 'strategy-lab', 'full-blueprint'];
    if (!validTiers.includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier. Must be: deep-dive, strategy-lab, or full-blueprint' });
    }

    // ─── Validate quantity ───
    const qty = Math.max(1, Math.min(50, parseInt(quantity) || 1));

    // ─── Generate keys ───
    const keys = [];
    for (let i = 0; i < qty; i++) {
      const key = generateKey(tier, process.env.ACTIVATION_KEY_SECRET);
      keys.push({
        raw: key,
        formatted: formatKeyForDisplay(key)
      });
    }

    return res.status(200).json({
      success: true,
      tier,
      tierLabel: TIER_LABELS[tier],
      durationMinutes: TIER_CONFIG[tier].durationMinutes,
      price: TIER_CONFIG[tier].price,
      count: keys.length,
      keys,
      generatedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error('Generate error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
}
