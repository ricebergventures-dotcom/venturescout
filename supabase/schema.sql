-- ============================================================
-- DeepTech Radar — Supabase Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- Companies table
-- ============================================================
CREATE TABLE IF NOT EXISTS companies (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  name_key      TEXT GENERATED ALWAYS AS (
                  LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]', '', 'g'))
                ) STORED,
  description   TEXT,
  founders      JSONB DEFAULT '[]'::jsonb,
  subsector     TEXT,
  funding_stage TEXT,
  funding_amount TEXT,
  open_round    BOOLEAN DEFAULT FALSE,
  sources       TEXT[] DEFAULT '{}',
  website_url   TEXT,
  github_url    TEXT,
  twitter_url   TEXT,
  linkedin_url  TEXT,
  source_url    TEXT,
  traction_score INTEGER DEFAULT 0,
  founded_year  INTEGER,
  signals       TEXT[] DEFAULT '{}',
  tags          TEXT[] DEFAULT '{}',
  last_seen      TIMESTAMPTZ DEFAULT NOW(),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  -- Harmonic/Specter-style enrichment fields
  hiring_velocity  INTEGER,        -- open job postings count
  patent_count     INTEGER,        -- USPTO patent count
  arxiv_papers     INTEGER,        -- published research papers
  sec_filing_amount BIGINT         -- Form D filing amount in USD
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_key ON companies (name_key);
CREATE INDEX IF NOT EXISTS idx_companies_subsector ON companies (subsector);
CREATE INDEX IF NOT EXISTS idx_companies_traction ON companies (traction_score DESC);
CREATE INDEX IF NOT EXISTS idx_companies_open_round ON companies (open_round) WHERE open_round = TRUE;
CREATE INDEX IF NOT EXISTS idx_companies_fts ON companies USING GIN (
  to_tsvector('english', COALESCE(name, '') || ' ' || COALESCE(description, ''))
);

-- ============================================================
-- Scrape runs table
-- ============================================================
CREATE TABLE IF NOT EXISTS scrape_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  companies_found INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'running',
  sources_scraped TEXT[] DEFAULT '{}',
  error           TEXT
);

-- ============================================================
-- Auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Row Level Security (allow public read)
-- ============================================================
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read companies"
  ON companies FOR SELECT USING (TRUE);

CREATE POLICY "Public read scrape_runs"
  ON scrape_runs FOR SELECT USING (TRUE);

-- Service role can do everything (bypasses RLS by default)

-- ============================================================
-- Optional: pg_cron to auto-trigger the edge function every 4h
-- Enable pg_cron in Supabase Dashboard → Database → Extensions
-- Then run:
-- ============================================================
-- SELECT cron.schedule(
--   'scrape-deeptech',
--   '0 */4 * * *',
--   $$
--     SELECT net.http_post(
--       url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/scrape',
--       headers := '{"Authorization": "Bearer YOUR_ANON_KEY", "Content-Type": "application/json"}'::jsonb,
--       body := '{}'::jsonb
--     )
--   $$
-- );
