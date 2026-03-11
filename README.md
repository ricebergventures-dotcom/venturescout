# DeepTech Radar

Real-time discovery engine for deeptech founders and startups showing signs of traction, new launches, or open funding rounds.

Scrapes **7 public sources**: Hacker News · GitHub · Product Hunt · X/Twitter · LinkedIn · Crunchbase · Wellfound

Classifies companies into **13 deeptech subsectors** using Gemini AI (free tier) with keyword fallback.

---

## Quick Start (local)

```bash
git clone https://github.com/your-org/deeptech-radar
cd deeptech-radar
npm install
cp .env.example .env.local   # fill in your keys
npm run dev                   # → http://localhost:3000
```

On first load, click **↻ rescan** or wait for the automatic trigger to begin scraping.

---

## Setup

### 1. Supabase

1. Create a free project at [app.supabase.com](https://app.supabase.com)
2. Go to **SQL Editor** → paste the contents of `supabase/schema.sql` → run
3. Go to **Settings → API** → copy:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

### 2. Gemini API (free)

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Create a free API key
3. Add as `GEMINI_API_KEY`

Free tier: 15 requests/minute, 1M tokens/day — plenty for this use case.

### 3. Deploy Supabase Edge Function

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Set edge function secrets
supabase secrets set GEMINI_API_KEY=your_key
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_key

# Deploy the scraper
supabase functions deploy scrape
```

### 4. Deploy to Vercel

```bash
npm install -g vercel
vercel --prod
```

Set environment variables in Vercel Dashboard:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_EDGE_FUNCTION_SECRET`

The `vercel.json` cron triggers `/api/scrape` every 4 hours automatically.

> **Note**: The `/api/scrape` route has `maxDuration: 60` set — this requires **Vercel Pro**. On Hobby, the cron will time out but the Supabase Edge Function will still complete in the background.

---

## Sources Scraped

| Source | Method | Notes |
|--------|--------|-------|
| Hacker News | Algolia API | Free, no key. Searches for deeptech terms in the last 90 days |
| GitHub | HTML scrape | Weekly trending repos filtered by scientific keywords |
| Product Hunt | RSS + HTML | Science, hardware, biotech topics |
| X / Twitter | Nitter (fallback chain) | Tries multiple public Nitter instances |
| LinkedIn | DuckDuckGo search | Searches `site:linkedin.com/company` for deeptech terms |
| Crunchbase | DuckDuckGo search | Searches `site:crunchbase.com/organization` for seed-stage deeptech |
| Wellfound | DuckDuckGo search | Searches `site:wellfound.com/company` for hiring deeptech companies |

---

## Traction Score (0–100)

| Signal | Points |
|--------|--------|
| Open funding round mentioned | +25 |
| Recent launch / product announcement | +20 |
| YC-backed | +15 |
| PhD / national lab founder | +10 |
| Actively hiring | +10 |
| Founded ≤ 24 months ago | +10 |
| High engagement (100+ HN points, 500+ GitHub stars) | +10 |

---

## Deeptech Subsectors

Advanced Materials · Aerospace & Space · Autonomous Systems & Robotics · Biotech & Synthetic Biology · Climate Tech & Energy · Defense & Dual-Use · Fusion & Advanced Energy · Hard Semiconductors & Photonics · Human Augmentation & BCI · Nanotechnology · Nuclear Tech · Quantum Computing & Sensing · Longevity & Life Extension

---

## Architecture

```
Vercel (Next.js 14)          Supabase
┌─────────────────┐          ┌────────────────────────┐
│  page.tsx       │◄────────►│  companies table        │
│  (SSR + ISR)    │          │  scrape_runs table      │
│                 │          │                         │
│  /api/scrape ───┼─────────►│  Edge Function: scrape  │
│  (Vercel cron)  │          │  (150s timeout, Deno)   │
│                 │          │    ├─ HN Algolia API     │
│  /api/companies │          │    ├─ GitHub trending    │
│  /api/status    │          │    ├─ Product Hunt RSS   │
└─────────────────┘          │    ├─ Nitter / Twitter  │
                             │    ├─ DDG → LinkedIn     │
                             │    ├─ DDG → Crunchbase   │
                             │    └─ DDG → Wellfound    │
                             │                         │
                             │  Gemini 1.5 Flash       │
                             │  (classify + extract)   │
                             └────────────────────────┘
```
