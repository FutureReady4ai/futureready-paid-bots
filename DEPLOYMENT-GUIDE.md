# 🔑 FutureReady Paid Bots — Deep Dive + Strategy Lab Deployment Guide

**Powered by free Google Gemini API · Activation key access · Pause/resume**

One Vercel deployment serves both paid chatbots. Customer pays → you generate a key → email it → they unlock their session.

---

## 🏗️ Architecture

```
  Customer Pays ($9 or $12)
           │
           ▼
  You → admin.html → Generate Key (FR-DD-... or FR-SL-...)
           │
           ▼
  Email key + access link to customer
           │
           ▼
  Customer clicks link or pastes key
           │
           ▼
  /api/validate-key → HMAC signature check → ✅ valid
           │
           ▼
  Chatbot unlocks → /api/chat-paid → Google Gemini (FREE)
           │
  ⏸ Pause anytime → localStorage saves everything
           │
  🔄 Resume within 14 days with same key
```

**No database.** Keys are HMAC-signed — the server verifies by recomputing the signature.

---

## 📁 Project Structure

```
futureready-paid-bots/
├── api/
│   ├── _lib/
│   │   ├── keys.js           ← HMAC key crypto (generates + validates)
│   │   └── prompts.js        ← System prompts + Gemini config per tier
│   ├── chat-paid.js           ← AI chat (validates key → calls Gemini)
│   ├── validate-key.js        ← Key check endpoint (used by unlock screen)
│   └── generate-key.js        ← Admin key generation (password-protected)
├── index.html                 ← 🔍 Deep Dive chatbot ($9 / 30 min)
├── strategy-lab.html          ← 🧪 Strategy Lab chatbot ($12 / 45 min)
├── admin.html                 ← 🔒 Admin panel (generate keys + email templates)
├── vercel.json / package.json / .gitignore
└── DEPLOYMENT-GUIDE.md        ← This file
```

## URLs After Deployment

| URL | Purpose |
|-----|---------|
| `your-project.vercel.app/` | Deep Dive chatbot (key gate) |
| `your-project.vercel.app/strategy-lab.html` | Strategy Lab chatbot (key gate) |
| `your-project.vercel.app/full-blueprint.html` | Full Blueprint chatbot (key gate) |
| `your-project.vercel.app/admin.html` | Admin panel (generate keys) |
| `your-project.vercel.app/?key=FR-DD-...` | Deep Dive auto-unlock link |
| `your-project.vercel.app/strategy-lab.html?key=FR-SL-...` | Strategy Lab auto-unlock link |
| `your-project.vercel.app/full-blueprint.html?key=FR-FB-...` | Full Blueprint auto-unlock link |

---

## ✅ What You Need

| Item | Cost |
|------|------|
| Google AI Studio API key | **FREE — no credit card** |
| GitHub account | Free |
| Vercel account | Free |

**Total ongoing cost: $0**

---

# STEP 1 — Get Your FREE Gemini API Key

1. Go to **https://aistudio.google.com/**
2. Sign in with any Google account
3. Click **Get API key** (left sidebar) → **Create API key**
4. Select **Create API key in new project** (or pick an existing project)
5. Copy the key (starts with `AIzaSy...`)
6. Save it somewhere safe

No credit card. No expiration.

---

# STEP 2 — Generate Your Two Secrets

**ACTIVATION_KEY_SECRET** — signs all activation keys. Run in any terminal:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Or use any 40+ character random string.

**ADMIN_PASSWORD** — protects the admin panel. Pick something strong:
`FutureReady-Admin-2026!`

---

# STEP 3 — Upload to GitHub

1. GitHub → **+** → **New repository** → name: `futureready-paid-bots` → **Private** → Create
2. Click **uploading an existing file**
3. Unzip `futureready-paid-bots.zip`, drag **all files inside** the folder into GitHub
4. Verify `api/_lib/keys.js` and `api/_lib/prompts.js` appear in the upload
5. Commit: `Initial commit`

💡 If `api/_lib/` folder didn't upload: use **Add file → Create new file**, type `api/_lib/keys.js` as filename (slashes create folders), paste content, commit. Repeat for `prompts.js`.

---

# STEP 4 — Deploy on Vercel

1. **vercel.com** → log in with GitHub → **Add New → Project**
2. Import `futureready-paid-bots`
3. Framework Preset: **Other**
4. Expand **Environment Variables** and add all three:

| Name (case-sensitive) | Value |
|-----------------------|-------|
| `GEMINI_API_KEY` | `AIzaSy...` (from Step 1) |
| `ACTIVATION_KEY_SECRET` | your 40+ char random string |
| `ADMIN_PASSWORD` | your admin password |

5. Click **Deploy** → wait ~30 seconds

---

# STEP 5 — Test Everything

## 5a. Admin Panel
1. Visit `https://your-project.vercel.app/admin.html`
2. Enter admin password → Unlock
3. Select **Deep Dive** → Generate Key → copy the key
4. Select **Strategy Lab** → Generate Key → copy that key too
5. Select **Full Blueprint** → Generate Key → copy that key too

## 5b. Deep Dive ($9)
1. Visit `https://your-project.vercel.app/`
2. Paste the DD key → Unlock → send a test message
3. Click ⏸ PAUSE → verify overlay appears
4. Click Resume → verify timer continues
5. Refresh page → enter same key → see "Saved Session Found"

## 5c. Strategy Lab ($12)
1. Visit `https://your-project.vercel.app/strategy-lab.html`
2. Paste the SL key → Unlock → send a test message
3. Test pause/resume same as above
4. Test sidebar lab tools (Mock Interview, Salary Benchmark, etc.)

## 5d. Full Blueprint ($15 — Premium)
1. Visit `https://your-project.vercel.app/full-blueprint.html`
2. Paste the FB key → Unlock → send a test message
3. Verify 7-phase tracker appears (INTAKE → 5 C's AUDIT → 3-PATH SIM → MOCK INTERVIEW → ESSAY/COVER → 2030 PROOFING → EXPORT)
4. Test premium sidebar tools (Mock Interview, Cover Letter Gen, Essay Generator, 3-Path Simulation, 2030 Skills Audit, Salary Deep Data)
5. Test pause/resume same as above
6. After phase 2 completes, verify **📄 Download Career Blueprint** button enables in sidebar

## 5e. Access Links (what customers click from email)
1. In admin panel, click **🔗 Copy Access Link** for a DD key
2. Open in new tab → should auto-unlock without typing the key

---

# STEP 6 — Your Workflow After a Customer Pays

### Customer buys Deep Dive ($9):
1. Open `your-project.vercel.app/admin.html` → log in
2. Select **Deep Dive** → enter customer name/email → **Generate Key**
3. Click **📋 Copy Email Body** or **✉️ Open in Mail Client**
4. Send the email — it contains the key + direct access link

### Customer buys Strategy Lab ($12):
Same steps, select **Strategy Lab** instead. Key will start with `FR-SL-...`

### Customer buys Full Blueprint ($15):
Same steps, select **Full Blueprint** instead. Key will start with `FR-FB-...`

### What the customer sees:
- Clicks link from email → chatbot unlocks instantly
- Gets 30 min (DD), 45 min (SL), or 60 min (FB) of AI career consulting
- Can pause anytime → come back within 14 days → resume
- Full Blueprint customers can download their career blueprint as a document

---

# STEP 7 — Embed in Hostinger

### Deep Dive embed:
```html
<iframe
  src="https://your-project.vercel.app"
  width="100%" height="800" frameborder="0"
  style="border:none; border-radius:16px; max-width:1100px; display:block; margin:0 auto; box-shadow:0 12px 40px rgba(0,0,0,0.15);"
  allow="clipboard-write"
  title="FutureReady AI Deep Dive">
</iframe>
```

### Strategy Lab embed:
```html
<iframe
  src="https://your-project.vercel.app/strategy-lab.html"
  width="100%" height="800" frameborder="0"
  style="border:none; border-radius:16px; max-width:1200px; display:block; margin:0 auto; box-shadow:0 12px 40px rgba(0,0,0,0.15);"
  allow="clipboard-write"
  title="FutureReady AI Strategy Lab">
</iframe>
```

### Full Blueprint embed (Premium):
```html
<iframe
  src="https://your-project.vercel.app/full-blueprint.html"
  width="100%" height="800" frameborder="0"
  style="border:none; border-radius:16px; max-width:1280px; display:block; margin:0 auto; box-shadow:0 12px 40px rgba(0,0,0,0.15);"
  allow="clipboard-write"
  title="FutureReady AI Full Blueprint">
</iframe>
```

---

# 💰 Cost Summary

| Component | Cost |
|-----------|------|
| Google Gemini API | **$0** (free tier) |
| Vercel hosting | **$0** |
| Key system | **$0** (no database) |
| **Per-session cost** | **$0** |
| **Revenue per DD** | **$9** |
| **Revenue per SL** | **$12** |
| **Revenue per FB** | **$15** |
| **Margin** | **100%** |

### Daily Gemini Quota
- `gemini-2.5-flash`: ~250 req/day → ~25 paid sessions/day
- `gemini-2.5-flash-lite`: ~1000 req/day → ~100 paid sessions/day

Switch model in `api/chat-paid.js` line 7 if you need more capacity.

---

# 🔒 Security

- **Key validation on every message** — not just at unlock
- **HMAC-SHA256 signatures** — can't be forged without the secret
- **Tier enforcement** — DD keys rejected on Strategy Lab page and vice versa
- **Rate limiting** — 80 messages per key per 90 minutes
- **Admin password** — brute-force delayed (500ms per failed attempt)
- **No stored keys** — nothing to steal from a database

---

# 🔧 Troubleshooting

| Problem | Fix |
|---------|-----|
| "Server not configured" | Check all 3 env vars in Vercel. Redeploy after fixing. |
| "Invalid activation key" | Key mistyped or wrong tier. Copy cleanly from admin panel. |
| Admin says "Unauthorized" | Wrong ADMIN_PASSWORD. Check env var. |
| "This key is for Deep Dive..." | DD key used on Strategy Lab page (or vice versa). |
| "Today's AI quota reached" | Daily Gemini limit hit. Wait until midnight PT or switch to flash-lite. |
| Pause/resume doesn't find session | Different device/browser. localStorage is device-specific. |

---

# 🔄 Updating Later

Edit files on GitHub → Vercel auto-redeploys in ~30 seconds.

| What to change | File | What to edit |
|----------------|------|--------------|
| System prompts | `api/_lib/prompts.js` | Edit the prompt strings |
| AI model | `api/chat-paid.js` | Change `MODEL` constant (line 7) |
| Session duration | `api/_lib/prompts.js` | Change `durationMinutes` in TIER_CONFIG |
| Prices (display) | `index.html` / `strategy-lab.html` | Search for "$9" or "$12" |
| Upgrade links | `index.html` / `strategy-lab.html` | Search for "futureready.ai" |

---

*Built with Claude · Powered by free Google Gemini · Secured with HMAC · $0 cost, 100% margin 🚀*
