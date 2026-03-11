export interface Founder {
  name: string;
  role?: string;
  background?: string;
  linkedin?: string;
  twitter?: string;
}

export interface Company {
  id: string;
  name: string;
  description: string | null;
  founders: Founder[];
  subsector: string | null;
  funding_stage: string | null;
  funding_amount: string | null;
  open_round: boolean;
  sources: string[];
  website_url: string | null;
  github_url: string | null;
  twitter_url: string | null;
  linkedin_url: string | null;
  source_url: string | null;
  traction_score: number;
  founded_year: number | null;
  signals: string[];
  tags: string[];
  last_seen: string;
  created_at: string;
  updated_at: string;
  // Enrichment fields (Harmonic/Specter-style)
  hiring_velocity: number | null;
  patent_count: number | null;
  arxiv_papers: number | null;
  sec_filing_amount: number | null;
}

export interface ScrapeRun {
  id: string;
  started_at: string;
  completed_at: string | null;
  companies_found: number;
  status: "running" | "completed" | "failed";
  sources_scraped: string[];
  error: string | null;
}

export const SUBSECTORS = [
  "Advanced Materials & Manufacturing",
  "Aerospace & Space Tech",
  "Autonomous Systems & Robotics",
  "Biotech & Synthetic Biology",
  "Climate Tech & Energy",
  "Defense & Dual-Use Tech",
  "Fusion & Advanced Energy",
  "Hard Semiconductors & Photonics",
  "Human Augmentation & BCI",
  "Nanotechnology",
  "Nuclear Tech",
  "Quantum Computing & Sensing",
  "Longevity & Life Extension",
] as const;

export type Subsector = (typeof SUBSECTORS)[number];

export const SUBSECTOR_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "Quantum Computing & Sensing":   { bg: "rgba(59,130,246,0.12)",  text: "#60a5fa", border: "rgba(59,130,246,0.3)" },
  "Biotech & Synthetic Biology":   { bg: "rgba(34,197,94,0.12)",   text: "#4ade80", border: "rgba(34,197,94,0.3)" },
  "Aerospace & Space Tech":        { bg: "rgba(99,102,241,0.12)",  text: "#818cf8", border: "rgba(99,102,241,0.3)" },
  "Autonomous Systems & Robotics": { bg: "rgba(249,115,22,0.12)",  text: "#fb923c", border: "rgba(249,115,22,0.3)" },
  "Climate Tech & Energy":         { bg: "rgba(16,185,129,0.12)",  text: "#34d399", border: "rgba(16,185,129,0.3)" },
  "Defense & Dual-Use Tech":       { bg: "rgba(239,68,68,0.12)",   text: "#f87171", border: "rgba(239,68,68,0.3)" },
  "Fusion & Advanced Energy":      { bg: "rgba(234,179,8,0.12)",   text: "#facc15", border: "rgba(234,179,8,0.3)" },
  "Hard Semiconductors & Photonics":{ bg: "rgba(6,182,212,0.12)", text: "#22d3ee", border: "rgba(6,182,212,0.3)" },
  "Human Augmentation & BCI":      { bg: "rgba(168,85,247,0.12)",  text: "#c084fc", border: "rgba(168,85,247,0.3)" },
  "Nanotechnology":                { bg: "rgba(236,72,153,0.12)",  text: "#f472b6", border: "rgba(236,72,153,0.3)" },
  "Nuclear Tech":                  { bg: "rgba(245,158,11,0.12)",  text: "#fbbf24", border: "rgba(245,158,11,0.3)" },
  "Longevity & Life Extension":    { bg: "rgba(20,184,166,0.12)",  text: "#2dd4bf", border: "rgba(20,184,166,0.3)" },
  "Advanced Materials & Manufacturing": { bg: "rgba(107,114,128,0.12)", text: "#9ca3af", border: "rgba(107,114,128,0.3)" },
};

export const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  hacker_news:  { label: "HN",    color: "#f97316" },
  github:       { label: "GH",    color: "#8b949e" },
  product_hunt: { label: "PH",    color: "#ef4444" },
  twitter:      { label: "X",     color: "#e7e9ea" },
  linkedin:     { label: "LI",    color: "#0a66c2" },
  crunchbase:   { label: "CB",    color: "#146aff" },
  wellfound:    { label: "WF",    color: "#16a34a" },
  sec_edgar:    { label: "SEC",   color: "#eab308" },
  arxiv:        { label: "arXiv", color: "#b45309" },
};
