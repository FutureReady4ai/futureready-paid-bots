// api/chat-paid.js — Paid tier backend (Gemini API + activation key validation)
// Validates key on every message, calls Google Gemini, normalizes response.

import { validateKey } from './_lib/keys.js';
import { SYSTEM_PROMPTS, TIER_CONFIG } from './_lib/prompts.js';

// Gemini model — gemini-3.5-flash: latest working model on free tier
const MODELS = ['gemini-3.5-flash', 'gemini-2.5-flash'];
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

// Rate limiting per activation key (more lenient since they paid)
const keyMessageCounts = new Map();
const RATE_LIMIT_MAX = 80;
const RATE_LIMIT_WINDOW_MS = 90 * 60 * 1000;

function checkRateLimit(keyId) {
  const now = Date.now();
  const entry = keyMessageCounts.get(keyId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    keyMessageCounts.set(keyId, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, e] of keyMessageCounts.entries()) {
    if (now - e.windowStart > RATE_LIMIT_WINDOW_MS * 2) keyMessageCounts.delete(k);
  }
}, 30 * 60 * 1000);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.GEMINI_API_KEY || !process.env.ACTIVATION_KEY_SECRET) {
    console.error('Missing environment variables');
    return res.status(500).json({ error: 'Server not configured' });
  }

  try {
    const { messages, activationKey, elapsedSeconds, currentPhase } = req.body || {};

    // ─── Validate activation key ───
    const validated = validateKey(activationKey, process.env.ACTIVATION_KEY_SECRET);
    if (!validated) {
      return res.status(401).json({
        error: 'invalid_key',
        message: 'Invalid or expired activation key. Please check the key from your email.'
      });
    }

    const tier = validated.tier;
    const config = TIER_CONFIG[tier];
    if (!config) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    // ─── Validate input ───
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid messages array' });
    }
    if (messages.length > 60) {
      return res.status(400).json({ error: 'session_too_long', message: 'Session message limit reached.' });
    }
    for (const m of messages) {
      if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
        return res.status(400).json({ error: 'Invalid message format' });
      }
      if (m.content.length > 8000) {
        return res.status(400).json({ error: 'Message too long' });
      }
    }

    // ─── Rate limit ───
    if (!checkRateLimit(validated.nonce)) {
      return res.status(429).json({
        error: 'rate_limit',
        message: 'Too many messages too quickly. Please wait a moment.'
      });
    }

    // ─── Build system prompt with session context ───
    const totalSeconds = config.durationMinutes * 60;
    const elapsed = elapsedSeconds || 0;
    const isLowTime = elapsed > totalSeconds * 0.85;
    let systemPrompt = SYSTEM_PROMPTS[tier];
    systemPrompt += `\n\nSESSION STATUS: ${Math.floor(elapsed/60)}/${config.durationMinutes} min used. Current phase: ${currentPhase || 1}.`;
    if (isLowTime) systemPrompt += '\nTIME RUNNING LOW — wrap up with clear final outputs now.';

    // ─── Convert messages to Gemini format ───
    // Gemini uses { role: 'user' | 'model', parts: [{ text }] }
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    // ─── Call Gemini API with model fallback ───
    let geminiResponse = null;
    let lastError = null;

    for (const model of MODELS) {
      const url = GEMINI_BASE + model + ':generateContent?key=' + process.env.GEMINI_API_KEY;
      geminiResponse = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }]
          },
          contents,
          generationConfig: {
            maxOutputTokens: config.maxOutputTokens,
            temperature: 0.7,
            topP: 0.95
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
          ]
        })
      });

      if (geminiResponse.ok) break;
      lastError = await geminiResponse.text();
      console.error('Model', model, 'failed:', lastError);
    }

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error', geminiResponse.status, errorText);
      if (geminiResponse.status === 429) {
        return res.status(429).json({
          error: 'quota_exhausted',
          message: "Today's AI quota has been reached. Your session is saved — resume tomorrow and your timer picks up where you left off."
        });
      }
      if (geminiResponse.status === 400) {
        return res.status(400).json({
          error: 'bad_request',
          message: 'There was an issue with your message. Please rephrase and try again.'
        });
      }
      return res.status(502).json({
        error: 'upstream_error',
        message: 'AI service temporarily unavailable. Please try again in a moment.'
      });
    }

    const data = await geminiResponse.json();

    // ─── Extract response text ───
    let responseText = '';
    let finishReason = null;
    if (data.candidates && data.candidates[0]) {
      finishReason = data.candidates[0].finishReason;
      if (data.candidates[0].content && Array.isArray(data.candidates[0].content.parts)) {
        for (const part of data.candidates[0].content.parts) {
          if (part.text) responseText += part.text;
        }
      }
    }

    // Handle safety blocks gracefully
    if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT') {
      responseText = "I can't engage with that specific angle. Let's reframe — what career outcome are you trying to figure out?";
    }
    if (!responseText.trim()) {
      responseText = "Let me try that again — could you rephrase your question?";
    }

    // ─── Normalize to stable response format ───
    // Frontend expects { content: [{ type: 'text', text }] }
    return res.status(200).json({
      content: [{ type: 'text', text: responseText }]
    });

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
  }
}
