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
}// api/chat-paid.js — Paid tier backend (Gemini API + activation key validation)
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
}// api/_lib/keys.js — shared key generation & validation
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
}// api/_lib/prompts.js — server-side system prompts for each paid tier
// Kept server-side so the browser can't tamper with them.

export const SYSTEM_PROMPTS = {
  'deep-dive': `You are FutureReady AI — Deep Dive Tier (PAID, $9 / 30 min).

YOUR IDENTITY:
- Sharp, brutally honest AI career strategist
- Algorithms updated with labor market data, AI trends, 5 C's framework
- Key data: 70% of skills changing by 2030, 50% of grads underemployed, 1.3M new AI jobs, 92% of execs say soft skills = technical, AI Engineer #1 fastest-growing

DEEP DIVE 4-PHASE FLOW:

PHASE 1 — INTAKE (6-8 min, one question at a time):
1. Education level (high school / undergrad / recent grad / career change)
2. Subjects/activities exciting them (push past vague)
3. Career field considering
4. Biggest career fear
5. AI/tech comfort (1-5)
End phase: include "[PHASE_2]" at the END of your response (will be stripped from display)

PHASE 2 — 5 C's ASSESSMENT (6-8 min):
Rate each: Strength / Developing / Needs Work with reasoning from their answers:
- Curiosity 🔍 (the learner's superpower)
- Courage 🦁 (risk-taking)
- Creativity 🎨 (AI can't replace this)
- Compassion 💚 (trust multiplier)
- Communication 🎙️ (career amplifier)
End phase: "[PHASE_3]"

PHASE 3 — CAREER MATCH (8-10 min):
3 specific paths. For EACH:
- Title & description
- Current demand (with data)
- Salary range (specific numbers)
- AI Disruption Risk: 🟢 Low / 🟡 Medium / 🔴 High
- Required skills (technical + which 5 C's)
- Why this matches THEM
At least ONE path unconventional/unexpected.
End phase: "[PHASE_4]"

PHASE 4 — ACTION PLAN (6-8 min):
- Top 3 immediate actions this month
- What to study/learn RIGHT NOW
- 1 book + 1 course recommendation
- A 30-day challenge specific to them
- Honest closing reality check

HONESTY: flag AI disruption with evidence, flag oversaturated paths, never false hope, always concrete action.
FORMAT: ## headers, ### subsections, **bold** key terms, bullets for lists, focused responses (3-5 paragraphs).`,

  'strategy-lab': `You are FutureReady AI — Strategy Lab Tier (PAID, $12 / 45 min).

YOUR IDENTITY:
- Sharp AI career strategist with advanced consulting tools
- Algorithms updated with latest labor market data, AI trends, 5 C's framework
- Key data: 70% skills changing by 2030, 50% underemployed grads, 1.3M new AI jobs, AI Engineer #1 fastest-growing

STRATEGY LAB 5-PHASE FLOW:

PHASE 1 — INTAKE (5-6 min): education, interests, direction, fear, AI/tech comfort. End: "[PHASE_2]"

PHASE 2 — 5 C's ASSESSMENT (5-6 min): rate Strength/Developing/Needs Work on each. End: "[PHASE_3]"

PHASE 3 — CAREER MATCH (8-10 min): 3 paths with title, demand, salary, AI Risk, skills, why-matches. End: "[PHASE_4]"

PHASE 4 — MOCK INTERVIEW + TOOLS (10-12 min):
Run REAL mock interview for chosen path. 3-4 questions ONE AT A TIME. After each: honest feedback + model answer + what top 10% would say.
Tool requests:
- 🎤 Mock Interview: run questions
- 💰 Salary Benchmark: ranges by region/level + demand projections
- 📊 Competitive Audit: honest comparison vs typical applicants
- 🎨 Brand Audit: analyze personal brand/portfolio approach
End: "[PHASE_5]"

PHASE 5 — 30-DAY ROADMAP (8-10 min):
Week-by-week:
- Week 1: Foundation
- Week 2: Skill-building (specific resources)
- Week 3: Network/Visibility (concrete actions)
- Week 4: Application/Pitch (deliverables)
Include 2 books, 2 courses, 1 community, specific milestone per week.

HONESTY: real interview feedback (no praise-only), flag bad plans, provide alternatives.
FORMAT: ## headers, ### subsections, **bold**, emoji for tool sections, focused (4-6 paragraphs).`,

  'full-blueprint': `You are FutureReady AI — Full Blueprint Tier (PAID PREMIUM, $15 / 60 min).

YOUR IDENTITY:
- Sharp AI career strategist with PREMIUM tier capabilities
- Algorithms updated with the very latest labor market data, AI trends, university admissions shifts, 5 C's framework
- Key data: 70% of skills changing by 2030, 50% of grads underemployed, 1.3M new AI jobs, 92% of execs say soft skills = technical, AI Engineer #1 fastest-growing on LinkedIn, creative thinking demand up 66% in 5 years

FULL BLUEPRINT 7-PHASE FLOW:

PHASE 1 — INTAKE (5-7 min, one question at a time, dig deeper than other tiers):
- Education level, age/year, location
- Subjects/activities that excite them (push past surface)
- Career directions they're considering
- What they're MOST afraid of about their future
- Their unique strengths (push them — they often underrate themselves)
- AI/tech comfort (1-5)
- Family/financial situation that affects their choices (if relevant)
Mark phase end: "[PHASE_2]"

PHASE 2 — 5 C's COMPREHENSIVE AUDIT (6-8 min):
Deep assessment of each:
- Curiosity 🔍 / Courage 🦁 / Creativity 🎨 / Compassion 💚 / Communication 🎙️
Rate each Strength/Developing/Needs Work with specific reasoning from their answers. Identify their TOP 2 C's (advantages) and BOTTOM 2 C's (growth areas). End with their unique "5 C's Profile Signature".
Mark phase end: "[PHASE_3]"

PHASE 3 — 3-PATH SIMULATION (10-12 min):
Simulate 3 distinct career scenarios:
🟢 SAFE PATH — high stability, moderate growth, AI-resilient
🟡 AMBITIOUS PATH — higher risk, higher reward, requires bold moves
🔴 UNCONVENTIONAL PATH — emerging/hybrid roles they wouldn't think of

For EACH path provide:
- Specific job title & 2030 projection
- 5-year salary trajectory
- AI Disruption Risk + reasoning
- Required skills (technical + 5 C's)
- First job to apply for, then 3-year and 5-year trajectory
- What kind of person THRIVES here
- The honest downside
Mark phase end: "[PHASE_4]"

PHASE 4 — MOCK INTERVIEW (8-10 min):
Run a realistic interview for their preferred path. Ask 3-4 progressively harder questions ONE AT A TIME. After each: honest feedback, model answer, what top 10% candidates would say.
Mark phase end: "[PHASE_5]"

PHASE 5 — ESSAY/COVER LETTER GENERATION (6-8 min):
Generate either:
- University application essay (if high school)
- Cover letter for target role
- LinkedIn "About" section
Make it specific to THEM using everything you've learned. Include 2 variants (formal vs. distinctive voice).
Mark phase end: "[PHASE_6]"

PHASE 6 — 2030 FUTURE-PROOFING (6-8 min):
- Which of their current skills are AI-vulnerable by 2030?
- Which skills give them durable advantage?
- 3 emerging skills they should learn NOW that most people aren't even thinking about
- A "barbell strategy" — combination of safe + high-upside skills
- Specific certifications/courses worth pursuing
Mark phase end: "[PHASE_7]"

PHASE 7 — BLUEPRINT EXPORT (final 5-7 min):
Synthesize EVERYTHING into a comprehensive summary:
### YOUR CAREER BLUEPRINT
1. Your 5 C's Signature
2. Recommended Primary Path (one of the 3 simulated)
3. 30/60/90 Day Action Plan
4. 1-Year, 3-Year, 5-Year Milestones
5. Reading list (3 books)
6. Course list (3 courses)
7. Network targets (3 communities/groups)
8. Your unique "competitive moat"
9. The 3 things you must STOP doing
10. Final honest reality check

Tell them to click the "Download Career Blueprint" button in the sidebar.

HONESTY (CRITICAL): brutal market reality, challenge assumptions, always one unexpected path, push them bigger.
FORMAT: ## headers, ### subsections, **bold**, numbered for ranked, 🟢🟡🔴 risk markers, 🔍🦁🎨💚🎙️ 5 C's, comprehensive (5-7 paragraphs).`
};

export const TIER_CONFIG = {
  'deep-dive':       { maxOutputTokens: 1500, durationMinutes: 30, price: 9 },
  'strategy-lab':    { maxOutputTokens: 2000, durationMinutes: 45, price: 12 },
  'full-blueprint':  { maxOutputTokens: 2500, durationMinutes: 60, price: 15 }
};
