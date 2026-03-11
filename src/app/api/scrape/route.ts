import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CheerioEl = any;
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA = "Mozilla/5.0 (compatible; DeepTechRadar/1.0; research-only)";

// ── Types ────────────────────────────────────────────────────────────────────

interface RawItem {
  id: string;
  title: string;
  description: string;
  url: string;
  author?: string;
  points?: number;
  stars?: number;
  source: string;
  created_at: string;
  extra?: Record<string, unknown>;
}

interface AnalyzedCompany {
  name: string;
  description: string;
  subsector: string | null;
  open_round: boolean;
  signals: string[];
  founded_year: number | null;
  founders: { name: string; role: string; background: string }[];
  funding_stage: string | null;
  funding_amount: string | null;
  sources: string[];
  website_url: string | null;
  github_url: string | null;
  twitter_url: string | null;
  linkedin_url: string | null;
  source_url: string;
  traction_score: number;
  last_seen: string;
  hiring_velocity?: number;
  sec_filing_amount?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeout(ms: number) {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

async function safeFetch(url: string, opts: RequestInit = {}, ms = 10000) {
  try {
    const res = await fetch(url, { ...opts, signal: timeout(ms) });
    return res;
  } catch {
    return null;
  }
}

// ── 1. Hacker News ────────────────────────────────────────────────────────────

async function scrapeHackerNews(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const cutoff = Math.floor(Date.now() / 1000) - 90 * 24 * 3600;
  const queries = [
    "quantum computing hardware",
    "biotech CRISPR synthetic biology",
    "fusion energy startup",
    "semiconductor photonics chip",
    "brain computer interface",
    "deeptech raise seed funding",
    "YC hardware biotech quantum",
  ];

  await Promise.all(
    queries.map(async (q) => {
      const res = await safeFetch(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=10&numericFilters=created_at_i>${cutoff}`,
        { headers: { "User-Agent": UA } }
      );
      if (!res?.ok) return;
      const data = await res.json();
      for (const hit of data.hits || []) {
        items.push({
          id: `hn_${hit.objectID}`,
          title: hit.title || "",
          description: (hit.story_text || hit.title || "").substring(0, 500),
          url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          author: hit.author,
          points: hit.points || 0,
          source: "hacker_news",
          created_at: hit.created_at,
        });
      }
    })
  );

  console.log(`HN: ${items.length}`);
  return items;
}

// ── 2. GitHub Trending ────────────────────────────────────────────────────────

async function scrapeGitHub(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const res = await safeFetch("https://github.com/trending?since=weekly", {
    headers: { "User-Agent": UA, Accept: "text/html" },
  }, 12000);
  if (!res?.ok) return items;
  const html = await res.text();
  const $ = cheerio.load(html);

  $("article.Box-row").each((_: number, el: CheerioEl) => {
    const nameEl = $(el).find("h2 a");
    const name = nameEl.text().trim().replace(/\s+/g, " ");
    const desc = $(el).find("p.col-9").text().trim();
    const href = nameEl.attr("href") || "";
    const starsText = $(el).find(".octicon-star").parent().text().trim().replace(/\s+/g, "");
    const stars = parseInt(starsText.replace(/,/g, "")) || 0;
    if (name && desc) {
      items.push({
        id: `gh_${href.replace(/\//g, "_")}`,
        title: name,
        description: desc,
        url: `https://github.com${href}`,
        stars,
        source: "github",
        created_at: new Date().toISOString(),
      });
    }
  });

  console.log(`GitHub: ${items.length}`);
  return items;
}

// ── 3. Product Hunt ───────────────────────────────────────────────────────────

async function scrapeProductHunt(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const res = await safeFetch("https://www.producthunt.com/feed", {
    headers: { "User-Agent": UA },
  });
  if (!res?.ok) return items;
  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });

  $("item").each((_: number, el: CheerioEl) => {
    const title = $(el).find("title").text().trim();
    const desc = $(el).find("description").text().trim().replace(/<[^>]+>/g, "");
    const link = $(el).find("link").text().trim();
    const pubDate = $(el).find("pubDate").text().trim();
    if (title) {
      items.push({
        id: `ph_${title.replace(/\W+/g, "_").toLowerCase().substring(0, 40)}`,
        title,
        description: desc.substring(0, 500),
        url: link,
        source: "product_hunt",
        created_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      });
    }
  });

  console.log(`Product Hunt: ${items.length}`);
  return items;
}

// ── 4. DuckDuckGo helper ──────────────────────────────────────────────────────

async function searchDDG(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  const res = await safeFetch(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { headers: { "User-Agent": UA, Accept: "text/html" } }
  );
  if (!res?.ok) return [];
  const html = await res.text();
  const $ = cheerio.load(html);
  const results: { title: string; url: string; snippet: string }[] = [];
  $(".result").each((_: number, el: CheerioEl) => {
    const title = $(el).find(".result__a").text().trim();
    const url = $(el).find(".result__url").text().trim();
    const snippet = $(el).find(".result__snippet").text().trim();
    if (title && url) results.push({ title, url: url.startsWith("http") ? url : `https://${url}`, snippet });
  });
  return results.slice(0, 6);
}

// ── 5. LinkedIn via DDG ───────────────────────────────────────────────────────

async function scrapeLinkedIn(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const queries = [
    'site:linkedin.com/company "quantum" "seed" 2025',
    'site:linkedin.com/company "biotech" deeptech raise 2025',
    'site:linkedin.com/company "hardware startup" raised',
  ];
  await Promise.all(queries.map(async (query) => {
    const results = await searchDDG(query);
    for (const r of results) {
      if (r.url.includes("linkedin.com/company")) {
        const name = r.title.replace(/\s*\|.*$/, "").replace(/LinkedIn$/, "").trim();
        if (name) items.push({ id: `li_${name.replace(/\W+/g, "_").toLowerCase().substring(0, 40)}`, title: name, description: r.snippet, url: r.url, source: "linkedin", created_at: new Date().toISOString() });
      }
    }
  }));
  console.log(`LinkedIn: ${items.length}`);
  return items;
}

// ── 6. Crunchbase via DDG ─────────────────────────────────────────────────────

async function scrapeCrunchbase(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const queries = [
    'site:crunchbase.com/organization "seed" deeptech 2025',
    'site:crunchbase.com/organization "quantum" "pre-seed" startup',
    'site:crunchbase.com/organization "biotech" seed 2025',
  ];
  await Promise.all(queries.map(async (query) => {
    const results = await searchDDG(query);
    for (const r of results) {
      if (r.url.includes("crunchbase.com/organization")) {
        const name = r.title.replace(/\s*[-|].*$/, "").replace("Crunchbase", "").trim();
        if (name) items.push({ id: `cb_${name.replace(/\W+/g, "_").toLowerCase().substring(0, 40)}`, title: name, description: r.snippet, url: r.url, source: "crunchbase", created_at: new Date().toISOString() });
      }
    }
  }));
  console.log(`Crunchbase: ${items.length}`);
  return items;
}

// ── 7. Wellfound via DDG ──────────────────────────────────────────────────────

async function scrapeWellfound(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const queries = [
    'site:wellfound.com/company "quantum" startup hiring',
    'site:wellfound.com/company "biotech" deeptech hiring',
    'site:wellfound.com/company "hardware" deeptech startup',
  ];
  await Promise.all(queries.map(async (query) => {
    const results = await searchDDG(query);
    for (const r of results) {
      if (r.url.includes("wellfound.com/company")) {
        const name = r.title.replace(/\s*[-|].*$/, "").replace(/Wellfound|AngelList/g, "").trim();
        if (name) items.push({ id: `wf_${name.replace(/\W+/g, "_").toLowerCase().substring(0, 40)}`, title: name, description: r.snippet, url: r.url, source: "wellfound", created_at: new Date().toISOString(), extra: { hiring: true } });
      }
    }
  }));
  console.log(`Wellfound: ${items.length}`);
  return items;
}

// ── 8. SEC EDGAR Form D ───────────────────────────────────────────────────────

async function scrapeSECEdgar(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const today = new Date();
  const start = new Date(today.getTime() - 120 * 24 * 60 * 60 * 1000);
  const startDate = start.toISOString().split("T")[0];
  const endDate = today.toISOString().split("T")[0];

  const keywords = ["quantum", "biotech", "synthetic biology", "fusion", "semiconductor", "robotics", "CRISPR", "aerospace"];

  await Promise.all(keywords.map(async (kw) => {
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(kw)}%22&forms=D&dateRange=custom&startdt=${startDate}&enddt=${endDate}`;
    const res = await safeFetch(url, { headers: { "User-Agent": "DeepTechRadar research@deeptech-radar.io", Accept: "application/json" } });
    if (!res?.ok) return;
    const data = await res.json();
    for (const hit of (data.hits?.hits || []).slice(0, 4)) {
      const src = hit._source || {};
      const name = src.entity_name || src.company_name || "";
      if (!name) continue;
      items.push({
        id: `sec_${(hit._id || "").replace(/\W+/g, "_")}`,
        title: name,
        description: `SEC Form D filing — ${kw} company raising capital`,
        url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(name)}&type=D&dateb=&owner=include&count=5`,
        source: "sec_edgar",
        created_at: src.file_date ? new Date(src.file_date).toISOString() : new Date().toISOString(),
        extra: { sec_filing: true, open_round: true },
      });
    }
  }));

  console.log(`SEC EDGAR: ${items.length}`);
  return items;
}

// ── 9. arXiv ─────────────────────────────────────────────────────────────────

async function scrapeArXiv(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const searches = [
    "quantum hardware startup spin-off",
    "CRISPR therapeutics clinical trial",
    "brain computer interface hardware",
    "fusion plasma engineering device",
    "photonic integrated circuit chip",
    "autonomous robot manipulation learning",
  ];

  await Promise.all(searches.map(async (query) => {
    const res = await safeFetch(
      `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=4&sortBy=submittedDate&sortOrder=descending`,
      { headers: { "User-Agent": UA } }
    );
    if (!res?.ok) return;
    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });

    $("entry").each((_: number, el: CheerioEl) => {
      const arxivId = $(el).find("id").text().trim();
      const title = $(el).find("title").text().trim().replace(/\s+/g, " ");
      const summary = $(el).find("summary").text().trim().replace(/\s+/g, " ").substring(0, 500);
      const authors = $(el).find("author name").map((_: number, a: CheerioEl) => $(a).text()).get().join(", ");
      const published = $(el).find("published").text().trim();
      if (title && summary) {
        items.push({
          id: `arxiv_${arxivId.split("/").pop()?.replace(/\W/g, "_") || Math.random().toString(36)}`,
          title: `[Paper] ${title}`,
          description: `Authors: ${authors.substring(0, 100)}. ${summary}`,
          url: arxivId,
          source: "arxiv",
          created_at: published || new Date().toISOString(),
          extra: { is_paper: true },
        });
      }
    });
  }));

  console.log(`arXiv: ${items.length}`);
  return items;
}

// ── Classification ────────────────────────────────────────────────────────────

const SUBSECTORS: [string, string[]][] = [
  ["Quantum Computing & Sensing", ["qubit", "quantum computer", "quantum error", "quantum sensor", "quantum network", "quantum hardware", "quantum cryptography", "photonic quantum", "superconducting qubit"]],
  ["Fusion & Advanced Energy", ["fusion reactor", "fusion energy", "tokamak", "inertial confinement", "stellarator", "plasma physics", "nuclear fusion", "deuterium", "tritium"]],
  ["Nuclear Tech", ["fission", "nuclear reactor", "small modular reactor", " smr ", "radioisotope", "thorium reactor", "molten salt", "nuclear power"]],
  ["Biotech & Synthetic Biology", ["crispr", "gene editing", "gene therapy", "synthetic biology", "biomanufacturing", "mrna therapy", "cell therapy", "protein engineering", "genomics platform", "bioreactor", "therapeutic antibody"]],
  ["Human Augmentation & BCI", ["brain computer interface", "brain-computer", "neural implant", "neural interface", "neuroprosthetic", "brain interface", "neural recording", "bci device", "neurotechnology", "cortical implant"]],
  ["Nanotechnology", ["nanotube", "nanoparticle", "nanoscale manufacturing", "molecular machine", "mems device", "nanofabrication", "graphene device"]],
  ["Hard Semiconductors & Photonics", ["silicon carbide", "gallium nitride", "photonic integrated", "lidar chip", "chip design", "semiconductor fab", "asic design", "compound semiconductor", "integrated photonics"]],
  ["Aerospace & Space Tech", ["rocket engine", "launch vehicle", "satellite constellation", "spacecraft", "reentry vehicle", "in-orbit", "lunar", "smallsat", "nanosatellite", "propellant"]],
  ["Autonomous Systems & Robotics", ["robotic arm", "autonomous robot", "robot manipulation", "warehouse robot", "surgical robot", "legged robot", "drone swarm", "autonomous drone", "lidar navigation"]],
  ["Climate Tech & Energy", ["carbon capture", "direct air capture", "electrolyzer", "green hydrogen", "perovskite solar", "solid state battery", "grid storage", "long duration storage", "geothermal energy"]],
  ["Defense & Dual-Use Tech", ["defense technology", "electronic warfare", "counter-uas", "hypersonic vehicle", "isr platform", "counter-drone", "dual-use", "autonomous weapons system"]],
  ["Longevity & Life Extension", ["longevity research", "aging biology", "senolytic", "cellular senescence", "lifespan extension", "rejuvenation", "anti-aging", "epigenetic reprogramming", "geroprotector"]],
  ["Advanced Materials & Manufacturing", ["metamaterial", "carbon fiber composite", "advanced alloy", "3d printed metal", "additive manufacturing hardware", "piezoelectric", "shape memory alloy", "superconducting material", "2d material"]],
];

const DEEPTECH_SIGNALS = ["hardware", "physical", "molecule", "biological", "scientific", "lab", "laboratory", "research", "phd", "professor", "patent", "device", "chip", "sensor", "quantum", "biotech", "robot", "drone", "space", "fusion", "semiconductor", "photonic", "nanotech", "gene", "cell therapy", "crispr", "nuclear", "lidar", "satellite", "bci", "plasma"];
const SOFTWARE_EXCLUSIONS = ["saas platform", "crm software", "no-code", "low-code", "analytics tool", "browser extension", "mobile app only", "software as a service", "dashboard for"];

function classifySubsector(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [subsector, keywords] of SUBSECTORS) {
    if (keywords.some((kw) => lower.includes(kw))) return subsector;
  }
  if (lower.includes("quantum")) return "Quantum Computing & Sensing";
  if (lower.includes("biotech") || lower.includes("genomic")) return "Biotech & Synthetic Biology";
  if (lower.includes("robotics") || lower.includes("autonomous vehicle")) return "Autonomous Systems & Robotics";
  if (lower.includes("aerospace") || lower.includes("satellite")) return "Aerospace & Space Tech";
  return null;
}

function isLikelyDeeptech(text: string): boolean {
  const lower = text.toLowerCase();
  return DEEPTECH_SIGNALS.some((s) => lower.includes(s)) && !SOFTWARE_EXCLUSIONS.some((s) => lower.includes(s));
}

function extractSignals(text: string, item: RawItem): string[] {
  const signals: string[] = [];
  if (/rais(ing|ed|e)|open to invest|funding round|pre-seed|seed round|series [a-c]/i.test(text)) signals.push("open_round");
  if (item.extra?.open_round || item.source === "sec_edgar") signals.push("open_round");
  if (/launch(ing|ed)|introduc(ing|ed)|announc(ing|ed)|show hn/i.test(text)) signals.push("recent_launch");
  if (/hir(ing|ed)|join our team|open roles|we.re growing/i.test(text) || item.extra?.hiring) signals.push("hiring");
  if (/yc|y combinator|ycombinator/i.test(text)) signals.push("yc_backed");
  if (/phd|dr\.|professor|postdoc|national lab|darpa|mit|stanford|caltech|cern/i.test(text)) signals.push("phd_founder");
  if ((item.points && item.points > 100) || (item.stars && item.stars > 500)) signals.push("high_engagement");
  if (/founded (in |year )?202[3-9]|est\.? 202[3-9]/i.test(text)) signals.push("recently_founded");
  if (item.source === "arxiv") signals.push("research_paper");
  if (item.source === "sec_edgar") signals.push("sec_filing");
  if (/patent(ed|ing|s)?|USPTO/i.test(text)) signals.push("has_patent");
  return [...new Set(signals)];
}

function scoreCompany(signals: string[], item: RawItem): number {
  let score = 0;
  if (signals.includes("open_round") || signals.includes("sec_filing")) score += 25;
  if (signals.includes("recent_launch")) score += 20;
  if (signals.includes("yc_backed")) score += 15;
  if (signals.includes("phd_founder") || signals.includes("research_paper")) score += 10;
  if (signals.includes("hiring")) score += 10;
  if (signals.includes("recently_founded")) score += 10;
  if (signals.includes("high_engagement")) score += 10;
  if (signals.includes("has_patent")) score += 5;
  if (item.points && item.points > 200) score += 15;
  else if (item.points && item.points > 100) score += 10;
  if (item.stars && item.stars > 1000) score += 10;
  else if (item.stars && item.stars > 500) score += 5;
  return Math.min(100, score);
}

function isWebsite(url: string): boolean {
  return !["github.com", "linkedin.com", "twitter.com", "x.com", "producthunt.com", "news.ycombinator.com", "crunchbase.com", "wellfound.com", "arxiv.org", "sec.gov"].some((d) => url.includes(d)) && url.startsWith("http");
}

function extractName(title: string): string {
  return title
    .replace(/^\[Paper\]\s*/i, "")
    .replace(/^(Show HN:|Ask HN:|Launch HN:)\s*/i, "")
    .replace(/\s*[-–|].*$/, "")
    .trim()
    .substring(0, 60);
}

// ── Gemini Analysis ───────────────────────────────────────────────────────────

async function analyzeWithGemini(items: RawItem[], apiKey: string): Promise<AnalyzedCompany[]> {
  const BATCH = 8;
  const results: AnalyzedCompany[] = [];
  const subsectorList = SUBSECTORS.map(([s]) => s).join(", ");

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const prompt = `Analyze these startup signals. Only include companies building something physically or scientifically novel (deeptech). Exclude pure SaaS/software.

Valid subsectors: ${subsectorList}

Items:
${batch.map((item, idx) => `[${idx + 1}]
Title: ${item.title}
Description: ${item.description?.substring(0, 300) || ""}
URL: ${item.url}
Source: ${item.source}
`).join("\n---\n")}

Return JSON array (same order), one object per item:
{
  "is_deeptech": boolean,
  "name": "clean company/project name",
  "description": "one sentence ≤120 chars about what they build",
  "subsector": "exact name from list or null",
  "open_round": boolean,
  "signals": ["open_round","recent_launch","hiring","yc_backed","phd_founder","high_engagement","recently_founded","research_paper","sec_filing","has_patent"],
  "founded_year": number or null,
  "founders": [{"name":"Full Name","role":"CEO/CTO","background":"PhD MIT, ex-NASA"}],
  "funding_stage": "pre-seed|seed|series-a|series-b|series-c or null",
  "funding_amount": "$XM or null",
  "website": "https://... or null (not linkedin/github/twitter/arxiv)",
  "github_url": "https://github.com/... or null",
  "twitter_url": "https://x.com/... or null",
  "linkedin_url": "https://linkedin.com/company/... or null",
  "hiring_velocity": number or null
}`;

    try {
      const res = await safeFetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4096, temperature: 0.1 },
          }),
        },
        25000
      );

      if (!res?.ok) {
        results.push(...fallbackAnalyze(batch));
        continue;
      }

      const geminiData = await res.json();
      const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
      const analyzed = JSON.parse(text);

      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const a = analyzed[j] || {};
        if (!a.is_deeptech || !a.subsector) continue;
        const allSignals = [...new Set([...(a.signals || []), ...extractSignals(`${item.title} ${item.description}`, item)])];
        results.push({
          name: a.name || extractName(item.title),
          description: a.description || item.description?.substring(0, 120) || "",
          subsector: a.subsector,
          open_round: a.open_round || allSignals.includes("open_round"),
          signals: allSignals,
          founded_year: a.founded_year || null,
          founders: a.founders || [],
          funding_stage: a.funding_stage || null,
          funding_amount: a.funding_amount || null,
          sources: [item.source],
          website_url: a.website || (isWebsite(item.url) ? item.url : null),
          github_url: a.github_url || (item.url.includes("github.com") ? item.url : null),
          twitter_url: a.twitter_url || null,
          linkedin_url: a.linkedin_url || (item.url.includes("linkedin.com") ? item.url : null),
          source_url: item.url,
          traction_score: scoreCompany(allSignals, item),
          last_seen: item.created_at,
          hiring_velocity: a.hiring_velocity || null,
        });
      }
    } catch (e) {
      console.error("Gemini batch error:", e);
      results.push(...fallbackAnalyze(batch));
    }
  }
  return results;
}

function fallbackAnalyze(items: RawItem[]): AnalyzedCompany[] {
  const results: AnalyzedCompany[] = [];
  for (const item of items) {
    const text = `${item.title} ${item.description}`;
    if (!isLikelyDeeptech(text)) continue;
    const subsector = classifySubsector(text);
    if (!subsector) continue;
    const signals = extractSignals(text, item);
    results.push({
      name: extractName(item.title),
      description: item.description?.substring(0, 120) || item.title,
      subsector,
      open_round: signals.includes("open_round"),
      signals,
      founded_year: null,
      founders: [],
      funding_stage: null,
      funding_amount: null,
      sources: [item.source],
      website_url: isWebsite(item.url) ? item.url : null,
      github_url: item.url.includes("github.com") ? item.url : null,
      twitter_url: null,
      linkedin_url: item.url.includes("linkedin.com") ? item.url : null,
      source_url: item.url,
      traction_score: scoreCompany(signals, item),
      last_seen: item.created_at,
    });
  }
  return results;
}

function deduplicateItems(items: RawItem[]): RawItem[] {
  const seen = new Map<string, RawItem>();
  for (const item of items) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 30);
    if (!key) continue;
    const ex = seen.get(key);
    if (!ex || item.description.length > (ex.description?.length || 0)) seen.set(key, item);
  }
  return Array.from(seen.values());
}

function deduplicateCompanies(companies: AnalyzedCompany[]): AnalyzedCompany[] {
  const map = new Map<string, AnalyzedCompany>();
  for (const c of companies) {
    const key = c.name.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 30);
    if (!key) continue;
    const ex = map.get(key);
    if (ex) {
      ex.sources = [...new Set([...ex.sources, ...c.sources])];
      ex.signals = [...new Set([...ex.signals, ...c.signals])];
      ex.open_round = ex.open_round || c.open_round;
      if (c.traction_score > ex.traction_score) ex.traction_score = c.traction_score;
      if (!ex.website_url && c.website_url) ex.website_url = c.website_url;
      if (!ex.github_url && c.github_url) ex.github_url = c.github_url;
      if (!ex.founders.length && c.founders.length) ex.founders = c.founders;
    } else {
      map.set(key, { ...c });
    }
  }
  return Array.from(map.values());
}

// ── Main scrape logic ─────────────────────────────────────────────────────────

async function runScrape(): Promise<{ companies_found: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data: run } = await db.from("scrape_runs").insert({ status: "running" }).select().single();
  const runId = run?.id;

  try {
    const [hnItems, ghItems, phItems, liItems, cbItems, wfItems, secItems, arxivItems] =
      await Promise.all([
        scrapeHackerNews(),
        scrapeGitHub(),
        scrapeProductHunt(),
        scrapeLinkedIn(),
        scrapeCrunchbase(),
        scrapeWellfound(),
        scrapeSECEdgar(),
        scrapeArXiv(),
      ]);

    const allRaw = deduplicateItems([...hnItems, ...ghItems, ...phItems, ...liItems, ...cbItems, ...wfItems, ...secItems, ...arxivItems]);
    console.log(`Raw items after dedup: ${allRaw.length}`);

    const geminiKey = process.env.GEMINI_API_KEY || "";
    const analyzed = geminiKey
      ? await analyzeWithGemini(allRaw, geminiKey)
      : fallbackAnalyze(allRaw);

    const companies = deduplicateCompanies(analyzed);
    console.log(`Final companies: ${companies.length}`);

    if (companies.length > 0) {
      const rows = companies.map((c) => ({
        name: c.name,
        description: c.description,
        founders: c.founders,
        subsector: c.subsector,
        funding_stage: c.funding_stage,
        funding_amount: c.funding_amount,
        open_round: c.open_round,
        sources: c.sources,
        website_url: c.website_url,
        github_url: c.github_url,
        twitter_url: c.twitter_url,
        linkedin_url: c.linkedin_url,
        source_url: c.source_url,
        traction_score: c.traction_score,
        founded_year: c.founded_year,
        signals: c.signals,
        tags: c.subsector ? [c.subsector] : [],
        last_seen: c.last_seen,
        hiring_velocity: c.hiring_velocity || null,
        sec_filing_amount: c.sec_filing_amount || null,
      }));

      const { error } = await db.from("companies").upsert(rows, { onConflict: "name_key", ignoreDuplicates: false });
      if (error) console.error("Upsert error:", error);
    }

    await db.from("scrape_runs").update({
      completed_at: new Date().toISOString(),
      companies_found: companies.length,
      status: "completed",
      sources_scraped: ["hacker_news", "github", "product_hunt", "linkedin", "crunchbase", "wellfound", "sec_edgar", "arxiv"],
    }).eq("id", runId);

    return { companies_found: companies.length };
  } catch (err) {
    console.error("Scrape error:", err);
    if (runId) {
      await db.from("scrape_runs").update({
        completed_at: new Date().toISOString(),
        status: "failed",
        error: String(err),
      }).eq("id", runId);
    }
    throw err;
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

async function handler() {
  const db = createServiceClient();

  // Cooldown: skip if last completed run was < 4 hours ago
  const { data: lastRun } = await db
    .from("scrape_runs")
    .select("started_at, status")
    .eq("status", "completed")
    .order("started_at", { ascending: false })
    .limit(1)
    .single() as { data: { started_at: string; status: string } | null };

  if (lastRun?.started_at) {
    const age = Date.now() - new Date(lastRun.started_at).getTime();
    if (age < 4 * 60 * 60 * 1000) {
      return NextResponse.json({ message: "Scrape skipped — ran less than 4 hours ago", last_run: lastRun.started_at });
    }
  }

  const result = await runScrape();
  return NextResponse.json({ success: true, ...result });
}

export const POST = handler;
export const GET = handler;
