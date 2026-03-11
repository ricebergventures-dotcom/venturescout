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
  // Enrichment fields
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

/** Computed on the client — no DB column needed */
export function computeConfidence(c: Company): number {
  let score = 0;
  if (c.description && c.description.length > 20) score += 20;
  if (c.website_url) score += 15;
  if (c.founders && c.founders.length > 0) score += 15;
  if (c.funding_stage) score += 10;
  if (c.subsector) score += 10;
  if (c.sources && c.sources.length > 1) score += 15;
  if (c.linkedin_url) score += 5;
  if (c.github_url) score += 5;
  if (c.founded_year) score += 5;
  return Math.min(100, score);
}

/** Score breakdown for UI display */
export function computeScoreBreakdown(c: Company): {
  fundraising: number; team: number; activity: number; richness: number;
} {
  const s = c.signals || [];
  let fundraising = 5;
  if (s.includes("sec_filing")) fundraising += 20;
  else if (s.includes("open_round")) fundraising += 12;
  if (s.includes("yc_backed")) fundraising += 8;
  if (s.includes("sbir_grant")) fundraising += 10;
  fundraising = Math.min(35, fundraising);

  let team = 0;
  if (s.includes("yc_backed")) team += 10;
  if (s.includes("phd_founder")) team += 10;
  if (s.includes("has_patent")) team += 8;
  if (s.includes("research_paper")) team += 5;
  team = Math.min(25, team);

  let activity = 0;
  if (s.includes("recent_launch")) activity += 12;
  if (s.includes("hiring")) activity += 8;
  if (s.includes("high_engagement")) activity += 8;
  if (s.includes("recently_founded")) activity += 5;
  activity = Math.min(25, activity);

  const richness = Math.max(0, c.traction_score - fundraising - team - activity);
  return { fundraising, team, activity, richness: Math.min(15, richness) };
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
  "Quantum Computing & Sensing":    { bg: "rgba(59,130,246,0.12)",  text: "#60a5fa", border: "rgba(59,130,246,0.3)" },
  "Biotech & Synthetic Biology":    { bg: "rgba(34,197,94,0.12)",   text: "#4ade80", border: "rgba(34,197,94,0.3)" },
  "Aerospace & Space Tech":         { bg: "rgba(99,102,241,0.12)",  text: "#818cf8", border: "rgba(99,102,241,0.3)" },
  "Autonomous Systems & Robotics":  { bg: "rgba(249,115,22,0.12)",  text: "#fb923c", border: "rgba(249,115,22,0.3)" },
  "Climate Tech & Energy":          { bg: "rgba(16,185,129,0.12)",  text: "#34d399", border: "rgba(16,185,129,0.3)" },
  "Defense & Dual-Use Tech":        { bg: "rgba(239,68,68,0.12)",   text: "#f87171", border: "rgba(239,68,68,0.3)" },
  "Fusion & Advanced Energy":       { bg: "rgba(234,179,8,0.12)",   text: "#facc15", border: "rgba(234,179,8,0.3)" },
  "Hard Semiconductors & Photonics":{ bg: "rgba(6,182,212,0.12)",   text: "#22d3ee", border: "rgba(6,182,212,0.3)" },
  "Human Augmentation & BCI":       { bg: "rgba(168,85,247,0.12)",  text: "#c084fc", border: "rgba(168,85,247,0.3)" },
  "Nanotechnology":                 { bg: "rgba(236,72,153,0.12)",  text: "#f472b6", border: "rgba(236,72,153,0.3)" },
  "Nuclear Tech":                   { bg: "rgba(245,158,11,0.12)",  text: "#fbbf24", border: "rgba(245,158,11,0.3)" },
  "Longevity & Life Extension":     { bg: "rgba(20,184,166,0.12)",  text: "#2dd4bf", border: "rgba(20,184,166,0.3)" },
  "Advanced Materials & Manufacturing": { bg: "rgba(107,114,128,0.12)", text: "#9ca3af", border: "rgba(107,114,128,0.3)" },
};

export const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  hacker_news:  { label: "HN",      color: "#f97316" },
  github:       { label: "GitHub",  color: "#8b949e" },
  product_hunt: { label: "PH",      color: "#ef4444" },
  twitter:      { label: "X",       color: "#e7e9ea" },
  linkedin:     { label: "LinkedIn",color: "#0a66c2" },
  crunchbase:   { label: "CB",      color: "#146aff" },
  wellfound:    { label: "Wellfound",color: "#16a34a" },
  sec_edgar:    { label: "SEC",     color: "#eab308" },
  arxiv:        { label: "arXiv",   color: "#b45309" },
  yc:           { label: "YC",      color: "#f97316" },
  techcrunch:   { label: "TC",      color: "#1a8917" },
  sbir:         { label: "SBIR",    color: "#a855f7" },
  biorxiv:      { label: "bioRxiv", color: "#10b981" },
};

export const SIGNAL_META: Record<string, { label: string; color: string; description: string }> = {
  open_round:       { label: "● RAISING",    color: "#34d399", description: "Actively raising capital" },
  sec_filing:       { label: "§ SEC FILING", color: "#eab308", description: "SEC Form D fundraise disclosure" },
  recent_launch:    { label: "⚡ LAUNCHED",   color: "#38bdf8", description: "Recently launched product/service" },
  hiring:           { label: "⊕ HIRING",     color: "#a78bfa", description: "Actively expanding team" },
  yc_backed:        { label: "◈ YC",         color: "#f97316", description: "Y Combinator portfolio company" },
  phd_founder:      { label: "✦ PHD TEAM",   color: "#facc15", description: "Academic / PhD-credentialed founders" },
  has_patent:       { label: "⊛ PATENT",     color: "#60a5fa", description: "Holds one or more patents" },
  research_paper:   { label: "∮ PAPER",      color: "#b45309", description: "Published academic research" },
  recently_founded: { label: "◎ EARLY",      color: "#4ade80", description: "Founded within last 2 years" },
  high_engagement:  { label: "↑ TRENDING",   color: "#fb923c", description: "High community traction online" },
  sbir_grant:       { label: "$ GRANT",      color: "#a855f7", description: "Received SBIR/STTR government grant" },
};
