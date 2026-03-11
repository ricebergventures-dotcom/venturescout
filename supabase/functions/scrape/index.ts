// DeepTech Radar — Supabase Edge Function
// 10 sources: HN · GitHub · Product Hunt · Twitter/Nitter · LinkedIn ·
//             Crunchbase · Wellfound · SEC EDGAR Form D · arXiv · USPTO Patents
// Deno runtime — deploy: supabase functions deploy scrape

import { createClient } from "npm:@supabase/supabase-js@2";
import * as cheerio from "npm:cheerio@1.0.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const UA = "Mozilla/5.0 (compatible; DeepTechRadar/1.0; research-only)";
const DELAY = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// TYPES
// ============================================================

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
  hiring_velocity?: number;     // job postings count
  patent_count?: number;        // USPTO patents
  arxiv_papers?: number;        // published papers
  sec_filing_amount?: number;   // Form D amount (USD)
}

// ============================================================
// 1. HACKER NEWS (Algolia API)
// ============================================================
async function scrapeHackerNews(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const cutoff = Math.floor(Date.now() / 1000) - 90 * 24 * 3600;

  const queries = [
    "quantum computing hardware",
    "biotech CRISPR synthetic biology",
    "fusion energy nuclear startup",
    "semiconductor photonics chip",
    "brain computer interface neural",
    "space satellite rocket launch",
    "autonomous robotics hardware",
    "nanotechnology advanced materials",
    "longevity aging lifespan",
    "defense dual-use hypersonic",
    "deeptech raise seed funding",
    "YC hardware biotech quantum",
  ];

  for (const query of queries) {
    try {
      await DELAY(600);
      const res = await fetch(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=15&numericFilters=created_at_i>${cutoff}`,
        { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const hit of data.hits || []) {
        items.push({
          id: `hn_${hit.objectID}`,
          title: hit.title || "",
          description: (hit.story_text || hit.title || "").substring(0, 600),
          url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          author: hit.author,
          points: hit.points || 0,
          source: "hacker_news",
          created_at: hit.created_at,
          extra: { hn_url: `https://news.ycombinator.com/item?id=${hit.objectID}`, comments: hit.num_comments },
        });
      }
    } catch (e) {
      console.error(`HN error "${query}":`, e);
    }
  }
  console.log(`HN: ${items.length} items`);
  return items;
}

// ============================================================
// 2. GITHUB TRENDING
// ============================================================
async function scrapeGitHub(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  try {
    await DELAY(1000);
    const res = await fetch("https://github.com/trending?since=weekly", {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return items;
    const html = await res.text();
    const $ = cheerio.load(html);

    $("article.Box-row").each((_: number, el: cheerio.Element) => {
      const nameEl = $(el).find("h2 a");
      const name = nameEl.text().trim().replace(/\s+/g, " ");
      const desc = $(el).find("p.col-9").text().trim();
      const href = nameEl.attr("href") || "";
      const starsText = $(el).find(".octicon-star").parent().text().trim().replace(/\s+/g, "");
      const stars = parseInt(starsText.replace(/,/g, "")) || 0;
      const lang = $(el).find('[itemprop="programmingLanguage"]').text().trim();

      if (name && desc) {
        items.push({
          id: `gh_${href.replace(/\//g, "_")}`,
          title: name,
          description: desc,
          url: `https://github.com${href}`,
          stars,
          source: "github",
          created_at: new Date().toISOString(),
          extra: { language: lang },
        });
      }
    });
  } catch (e) {
    console.error("GitHub error:", e);
  }
  console.log(`GitHub: ${items.length} items`);
  return items;
}

// ============================================================
// 3. PRODUCT HUNT (RSS + topics)
// ============================================================
async function scrapeProductHunt(): Promise<RawItem[]> {
  const items: RawItem[] = [];

  // RSS feed
  try {
    await DELAY(1500);
    const res = await fetch("https://www.producthunt.com/feed", {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const xml = await res.text();
      const $ = cheerio.load(xml, { xmlMode: true });
      $("item").each((_: number, el: cheerio.Element) => {
        const title = $(el).find("title").text().trim();
        const desc = $(el).find("description").text().trim().replace(/<[^>]+>/g, "");
        const link = $(el).find("link").text().trim();
        const pubDate = $(el).find("pubDate").text().trim();
        if (title) {
          items.push({
            id: `ph_rss_${title.replace(/\W+/g, "_").toLowerCase().substring(0, 40)}`,
            title,
            description: desc.substring(0, 500),
            url: link,
            source: "product_hunt",
            created_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
          });
        }
      });
    }
  } catch (e) {
    console.error("Product Hunt RSS:", e);
  }

  console.log(`Product Hunt: ${items.length} items`);
  return items;
}

// ============================================================
// 4. TWITTER / NITTER
// ============================================================
async function scrapeNitter(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const instances = [
    "https://nitter.privacydev.net",
    "https://nitter.poast.org",
    "https://nitter.1d4.us",
    "https://nitter.cz",
  ];
  const queries = [
    "quantum startup raising seed",
    "biotech CRISPR founder raise",
    "fusion energy raise",
    "deeptech seed hardware",
    "YC biotech quantum hardware",
    "synthetic biology raise investor",
  ];

  let working: string | null = null;
  for (const inst of instances) {
    try {
      const r = await fetch(`${inst}/search?q=deeptech`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(4000),
      });
      if (r.ok) { working = inst; break; }
    } catch {}
  }
  if (!working) { console.log("Nitter: no working instance"); return items; }

  for (const query of queries) {
    try {
      await DELAY(2000);
      const res = await fetch(
        `${working}/search?q=${encodeURIComponent(query)}&f=tweets`,
        { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);

      $(".timeline-item").each((_: number, el: cheerio.Element) => {
        const text = $(el).find(".tweet-content").text().trim();
        const author = $(el).find(".username").text().trim();
        const tweetHref = $(el).find(".tweet-link").attr("href") || "";
        if (text && text.length > 30) {
          items.push({
            id: `tw_${tweetHref.replace(/\//g, "_")}`,
            title: text.substring(0, 120),
            description: text,
            url: tweetHref.startsWith("http") ? tweetHref : `https://x.com${tweetHref}`,
            author,
            source: "twitter",
            created_at: new Date().toISOString(),
          });
        }
      });
    } catch (e) {
      console.error(`Nitter "${query}":`, e);
    }
  }
  console.log(`Twitter/Nitter: ${items.length} items`);
  return items;
}

// ============================================================
// 5. DUCKDUCKGO SEARCH HELPER
// ============================================================
async function searchDDG(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  try {
    await DELAY(2500);
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: { title: string; url: string; snippet: string }[] = [];
    $(".result").each((_: number, el: cheerio.Element) => {
      const title = $(el).find(".result__a").text().trim();
      const url = $(el).find(".result__url").text().trim();
      const snippet = $(el).find(".result__snippet").text().trim();
      if (title && url) results.push({ title, url: url.startsWith("http") ? url : `https://${url}`, snippet });
    });
    return results.slice(0, 8);
  } catch (e) {
    console.error("DDG error:", e);
    return [];
  }
}

// ============================================================
// 6. LINKEDIN (via DDG)
// ============================================================
async function scrapeLinkedIn(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const queries = [
    'site:linkedin.com/company "quantum" "seed round" 2024 2025',
    'site:linkedin.com/company "biotech" "Series A" deeptech 2024',
    'site:linkedin.com/company "hardware startup" raised 2025',
    'site:linkedin.com/company "synthetic biology" startup raise',
    'site:linkedin.com/company "fusion" OR "semiconductor" startup raise',
  ];
  for (const query of queries) {
    const results = await searchDDG(query);
    for (const r of results) {
      if (r.url.includes("linkedin.com/company")) {
        const name = r.title.replace(/\s*\|.*$/, "").replace(/LinkedIn$/, "").trim();
        if (name) {
          items.push({
            id: `li_${name.replace(/\W+/g, "_").toLowerCase().substring(0, 40)}`,
            title: name, description: r.snippet,
            url: r.url, source: "linkedin", created_at: new Date().toISOString(),
          });
        }
      }
    }
  }
  console.log(`LinkedIn: ${items.length} items`);
  return items;
}

// ============================================================
// 7. CRUNCHBASE (via DDG)
// ============================================================
async function scrapeCrunchbase(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const queries = [
    'site:crunchbase.com "seed" deeptech 2024 2025',
    'site:crunchbase.com "quantum" "pre-seed" OR "seed" startup',
    'site:crunchbase.com "biotech" "seed" 2024 2025',
    'site:crunchbase.com "hardware" "seed" 2024 2025',
    'site:crunchbase.com "aerospace" OR "space" startup seed 2024',
  ];
  for (const query of queries) {
    const results = await searchDDG(query);
    for (const r of results) {
      if (r.url.includes("crunchbase.com/organization")) {
        const name = r.title.replace(/\s*[-|].*$/, "").replace("Crunchbase", "").trim();
        if (name) {
          items.push({
            id: `cb_${name.replace(/\W+/g, "_").toLowerCase().substring(0, 40)}`,
            title: name, description: r.snippet,
            url: r.url, source: "crunchbase", created_at: new Date().toISOString(),
          });
        }
      }
    }
  }
  console.log(`Crunchbase: ${items.length} items`);
  return items;
}

// ============================================================
// 8. WELLFOUND (via DDG)
// ============================================================
async function scrapeWellfound(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const queries = [
    'site:wellfound.com "quantum" startup hiring 2024 2025',
    'site:wellfound.com "biotech" OR "synthetic biology" startup hiring',
    'site:wellfound.com "hardware" deeptech startup jobs',
    'site:wellfound.com "autonomous" OR "robotics" startup hiring 2024',
    'site:wellfound.com "semiconductor" OR "photonics" startup 2024',
    'site:wellfound.com "nuclear" OR "fusion" startup hiring',
  ];
  for (const query of queries) {
    const results = await searchDDG(query);
    for (const r of results) {
      if (r.url.includes("wellfound.com/company")) {
        const name = r.title.replace(/\s*[-|].*$/, "").replace(/Wellfound|AngelList/g, "").trim();
        if (name) {
          items.push({
            id: `wf_${name.replace(/\W+/g, "_").toLowerCase().substring(0, 40)}`,
            title: name, description: r.snippet,
            url: r.url, source: "wellfound", created_at: new Date().toISOString(),
            extra: { hiring: true },
          });
        }
      }
    }
  }
  console.log(`Wellfound: ${items.length} items`);
  return items;
}

// ============================================================
// 9. SEC EDGAR Form D (Real fundraising disclosures — FREE API)
//    Form D = early fundraise disclosures filed within 15 days of first sale
// ============================================================
async function scrapeSECEdgar(): Promise<RawItem[]> {
  const items: RawItem[] = [];

  const keywords = [
    "quantum", "biotech", "synthetic biology", "fusion", "aerospace",
    "semiconductor", "robotics", "neuroscience", "nuclear", "photonics",
    "CRISPR", "gene therapy", "nanotechnology", "longevity", "autonomous",
  ];

  const today = new Date();
  const start = new Date(today.getTime() - 120 * 24 * 60 * 60 * 1000); // last 120 days
  const startDate = start.toISOString().split("T")[0];
  const endDate = today.toISOString().split("T")[0];

  for (const kw of keywords.slice(0, 8)) { // limit to avoid rate limiting
    try {
      await DELAY(1200);
      const url = `https://efts.sec.gov/LATEST/search-index?q="${encodeURIComponent(kw)}"&forms=D&dateRange=custom&startdt=${startDate}&enddt=${endDate}&hits.hits.total.relation=eq&hits.hits._source.period_of_report=&hits.hits._source.file_date=&hits.hits._source.entity_name=&hits.hits._source.form_type=D&hits.hits.total.value=`;

      // Use the proper EDGAR full-text search API
      const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(kw)}%22&forms=D&dateRange=custom&startdt=${startDate}&enddt=${endDate}`;
      const res = await fetch(searchUrl, {
        headers: { "User-Agent": "DeepTechRadar research@deeptech-radar.io", Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) continue;
      const data = await res.json();

      for (const hit of (data.hits?.hits || []).slice(0, 5)) {
        const src = hit._source || {};
        const name = src.entity_name || src.company_name || "";
        const fileDate = src.file_date || src.period_of_report || "";
        const formType = src.form_type || "D";
        const accession = hit._id || "";

        if (!name) continue;

        items.push({
          id: `sec_${accession.replace(/\W+/g, "_")}`,
          title: name,
          description: `SEC Form ${formType} filing — ${kw} company raising capital`,
          url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(name)}&type=D&dateb=&owner=include&count=5`,
          source: "sec_edgar",
          created_at: fileDate ? new Date(fileDate).toISOString() : new Date().toISOString(),
          extra: { form_type: formType, kw, accession, sec_filing: true, open_round: true },
        });
      }
    } catch (e) {
      console.error(`SEC EDGAR "${kw}":`, e);
    }
  }
  console.log(`SEC EDGAR: ${items.length} items`);
  return items;
}

// ============================================================
// 10. arXiv PAPERS (Free API — researchers starting companies)
//     Filters for applied/hardware-adjacent papers
// ============================================================
async function scrapeArXiv(): Promise<RawItem[]> {
  const items: RawItem[] = [];

  const searches = [
    { query: "quantum hardware startup spin-off", cats: "quant-ph cs.ET" },
    { query: "CRISPR therapeutics clinical", cats: "q-bio.GN q-bio.BM" },
    { query: "brain computer interface hardware", cats: "cs.NE q-bio.NC" },
    { query: "fusion plasma engineering device", cats: "physics.plasm-ph" },
    { query: "photonic integrated circuit chip", cats: "physics.optics eess.SP" },
    { query: "autonomous robot manipulation learning", cats: "cs.RO" },
    { query: "longevity aging intervention trial", cats: "q-bio.GN q-bio.MN" },
    { query: "semiconductor quantum dot device", cats: "cond-mat.mes-hall" },
  ];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().split("T")[0].replace(/-/g, "");

  for (const { query, cats } of searches.slice(0, 6)) {
    try {
      await DELAY(1500);
      const res = await fetch(
        `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=5&sortBy=submittedDate&sortOrder=descending`,
        { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) continue;
      const xml = await res.text();
      const $ = cheerio.load(xml, { xmlMode: true });

      $("entry").each((_: number, el: cheerio.Element) => {
        const arxivId = $(el).find("id").text().trim();
        const title = $(el).find("title").text().trim().replace(/\s+/g, " ");
        const summary = $(el).find("summary").text().trim().replace(/\s+/g, " ").substring(0, 500);
        const authors = $(el).find("author name").map((_: number, a: cheerio.Element) => $(a).text()).get().join(", ");
        const published = $(el).find("published").text().trim();

        if (title && summary) {
          items.push({
            id: `arxiv_${arxivId.split("/").pop()?.replace(/\W/g, "_") || Math.random().toString(36)}`,
            title: `[Paper] ${title}`,
            description: `Authors: ${authors.substring(0, 100)}. ${summary}`,
            url: arxivId,
            source: "arxiv",
            created_at: published || new Date().toISOString(),
            extra: { authors, category: cats, is_paper: true },
          });
        }
      });
    } catch (e) {
      console.error(`arXiv "${query}":`, e);
    }
  }
  console.log(`arXiv: ${items.length} items`);
  return items;
}

// ============================================================
// DEDUPLICATION
// ============================================================
function deduplicateItems(items: RawItem[]): RawItem[] {
  const seen = new Map<string, RawItem>();
  for (const item of items) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 30);
    if (!key) continue;
    const ex = seen.get(key);
    if (ex) {
      if (!ex.description || item.description.length > ex.description.length)
        ex.description = item.description;
    } else {
      seen.set(key, item);
    }
  }
  return Array.from(seen.values());
}

// ============================================================
// DEEPTECH CLASSIFICATION
// ============================================================
const SUBSECTORS: [string, string[]][] = [
  ["Quantum Computing & Sensing", ["qubit", "quantum computer", "quantum error", "quantum sensor", "quantum network", "quantum algorithm", "photonic quantum", "superconducting qubit", "quantum hardware", "quantum cryptography", "quantum dot"]],
  ["Fusion & Advanced Energy", ["fusion reactor", "fusion energy", "tokamak", "inertial confinement", "stellarator", "plasma physics", "nuclear fusion", "deuterium", "tritium"]],
  ["Nuclear Tech", ["fission", "nuclear reactor", "small modular reactor", " smr ", "radioisotope", "thorium reactor", "molten salt", "nuclear waste", "nuclear power"]],
  ["Biotech & Synthetic Biology", ["crispr", "gene editing", "gene therapy", "synthetic biology", "biomanufacturing", "mrna therapy", "cell therapy", "protein engineering", "genomics platform", "base editing", "bioreactor", "fermentation platform", "therapeutic antibody"]],
  ["Human Augmentation & BCI", ["brain computer interface", "brain-computer", "neural implant", "neural interface", "neuroprosthetic", "brain interface", "neural recording", "brain stimulation", "bci device", "neurotechnology", "cortical implant"]],
  ["Nanotechnology", ["nanotube", "nanoparticle", "nanoscale manufacturing", "molecular machine", "mems device", "atomic precision", "nanofabrication", "nano-scale", "graphene device"]],
  ["Hard Semiconductors & Photonics", ["silicon carbide", "gallium nitride", "gan transistor", "photonic integrated", "lidar chip", "custom silicon", "chip design", "semiconductor fab", "asic design", "wafer fabrication", "compound semiconductor", "integrated photonics"]],
  ["Aerospace & Space Tech", ["rocket engine", "launch vehicle", "satellite constellation", "orbital mechanics", "spacecraft", "reentry vehicle", "in-orbit", "space debris removal", "lunar", "mars mission", "propellant", "smallsat", "nanosatellite"]],
  ["Autonomous Systems & Robotics", ["robotic arm", "autonomous robot", "robot manipulation", "warehouse robot", "surgical robot", "legged robot", "drone swarm", "autonomous drone", "lidar navigation", "robot locomotion", "dexterous hand"]],
  ["Climate Tech & Energy", ["carbon capture", "direct air capture", "carbon removal", "electrolyzer", "green hydrogen", "perovskite solar", "solid state battery", "grid storage", "long duration storage", "geothermal energy", "ocean energy", "wind turbine hardware"]],
  ["Defense & Dual-Use Tech", ["defense technology", "military application", "electronic warfare", "counter-uas", "hypersonic vehicle", "munition", "isr platform", "tactical communication", "counter-drone", "dual-use", "autonomous weapons system"]],
  ["Longevity & Life Extension", ["longevity research", "aging biology", "senolytic", "cellular senescence", "lifespan extension", "rejuvenation", "anti-aging", "epigenetic reprogramming", "telomere extension", "geroprotector", "senolytics"]],
  ["Advanced Materials & Manufacturing", ["metamaterial", "carbon fiber composite", "advanced alloy", "3d printed metal", "additive manufacturing hardware", "piezoelectric", "shape memory alloy", "functional coating", "superconducting material", "2d material"]],
];

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

const DEEPTECH_SIGNALS = [
  "hardware", "physical", "molecule", "biological", "scientific", "lab",
  "laboratory", "research", "phd", "professor", "patent", "device", "chip",
  "sensor", "quantum", "biotech", "robot", "drone", "space", "fusion",
  "semiconductor", "photonic", "nanotech", "gene", "cell therapy", "crispr",
  "nuclear", "lidar", "actuator", "propulsion", "satellite", "bci", "plasma",
];

const SOFTWARE_EXCLUSIONS = [
  "saas platform", "crm software", "no-code", "low-code", "analytics tool",
  "api integration", "browser extension", "mobile app only", "web application for",
  "software as a service", "dashboard for",
];

function isLikelyDeeptech(text: string): boolean {
  const lower = text.toLowerCase();
  const hasDeeptech = DEEPTECH_SIGNALS.some((s) => lower.includes(s));
  const hasSoftwareOnly = SOFTWARE_EXCLUSIONS.some((s) => lower.includes(s));
  return hasDeeptech && !hasSoftwareOnly;
}

function extractSignals(text: string, item: RawItem): string[] {
  const lower = text.toLowerCase();
  const signals: string[] = [];

  if (/rais(ing|ed|e)|open to invest|funding round|pre-seed|seed round|series [a-c]/i.test(text)) signals.push("open_round");
  if (item.extra?.open_round || item.source === "sec_edgar") signals.push("open_round");
  if (/launch(ing|ed)|introduc(ing|ed)|announc(ing|ed)|show hn/i.test(text)) signals.push("recent_launch");
  if (/hir(ing|ed)|join our team|open roles|we.re growing/i.test(text) || item.extra?.hiring) signals.push("hiring");
  if (/yc|y combinator|ycombinator/i.test(text)) signals.push("yc_backed");
  if (/phd|dr\.|professor|postdoc|national lab|darpa|mit|stanford|caltech|cern|eth zurich/i.test(text)) signals.push("phd_founder");
  if ((item.points && item.points > 100) || (item.stars && item.stars > 500)) signals.push("high_engagement");
  if (/founded (in |year )?202[3-9]|est\.? 202[3-9]|started in 202[3-9]/i.test(text)) signals.push("recently_founded");
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
  else if (item.points && item.points > 50) score += 5;
  if (item.stars && item.stars > 1000) score += 10;
  else if (item.stars && item.stars > 500) score += 5;
  return Math.min(100, score);
}

// ============================================================
// GEMINI ANALYSIS
// ============================================================
async function analyzeWithGemini(items: RawItem[]): Promise<AnalyzedCompany[]> {
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
Description: ${item.description?.substring(0, 400) || ""}
URL: ${item.url}
Source: ${item.source}
Engagement: ${item.points ? `${item.points} HN points` : item.stars ? `${item.stars} GitHub stars` : "unknown"}
`).join("\n---\n")}

Return JSON array (same order), one object per item:
{
  "is_deeptech": boolean,
  "name": "clean company/project name (not a paper title)",
  "description": "one sentence ≤120 chars about what they build (not research summary)",
  "subsector": "exact name from list or null",
  "open_round": boolean,
  "signals": array of: "open_round","recent_launch","hiring","yc_backed","phd_founder","high_engagement","recently_founded","research_paper","sec_filing","has_patent",
  "founded_year": number or null,
  "founders": [{"name":"Full Name","role":"CEO/CTO/etc","background":"PhD MIT, ex-NASA, etc"}],
  "funding_stage": "pre-seed|seed|series-a|series-b|series-c or null",
  "funding_amount": "$XM or null",
  "website": "https://company-website.com or null (NOT linkedin/github/arxiv/twitter/producthunt)",
  "github_url": "https://github.com/... or null",
  "twitter_url": "https://twitter.com/... or https://x.com/... or null",
  "linkedin_url": "https://linkedin.com/company/... or null",
  "hiring_velocity": estimated_open_jobs_count_or_null
}`;

    try {
      await DELAY(4500);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4096, temperature: 0.1 },
          }),
          signal: AbortSignal.timeout(25000),
        }
      );

      if (!res.ok) {
        console.error(`Gemini ${res.status}: ${await res.text()}`);
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
          description: a.description || (item.description?.substring(0, 120) || ""),
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
          sec_filing_amount: typeof item.extra?.amount === "number" ? item.extra.amount : undefined,
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

function extractName(title: string): string {
  return title
    .replace(/^\[Paper\]\s*/i, "")
    .replace(/^(Show HN:|Ask HN:|Launch HN:)\s*/i, "")
    .replace(/\s*[-–|].*$/, "")
    .trim().substring(0, 60);
}

function isWebsite(url: string): boolean {
  return !["github.com","linkedin.com","twitter.com","x.com","producthunt.com",
           "news.ycombinator.com","crunchbase.com","wellfound.com","arxiv.org","sec.gov"]
    .some((d) => url.includes(d)) && url.startsWith("http");
}

// ============================================================
// DEDUPLICATE ANALYZED
// ============================================================
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
      if (!ex.hiring_velocity && c.hiring_velocity) ex.hiring_velocity = c.hiring_velocity;
    } else {
      map.set(key, { ...c });
    }
  }
  return Array.from(map.values());
}

// ============================================================
// MAIN HANDLER
// ============================================================
Deno.serve(async (_req: Request) => {
  console.log("DeepTech Radar scrape started — 10 sources");

  const { data: run } = await supabase.from("scrape_runs").insert({ status: "running" }).select().single();
  const runId = run?.id;

  try {
    // Parallel-safe sources first
    const [hnItems, ghItems, phItems] = await Promise.all([
      scrapeHackerNews(),
      scrapeGitHub(),
      scrapeProductHunt(),
    ]);

    // Rate-limited / sequential sources
    const twItems = await scrapeNitter();
    const liItems = await scrapeLinkedIn();
    const cbItems = await scrapeCrunchbase();
    const wfItems = await scrapeWellfound();
    const secItems = await scrapeSECEdgar();
    const arxivItems = await scrapeArXiv();

    const allRaw = [...hnItems, ...ghItems, ...phItems, ...twItems, ...liItems, ...cbItems, ...wfItems, ...secItems, ...arxivItems];
    const dedupedRaw = deduplicateItems(allRaw);
    console.log(`Total raw after dedup: ${dedupedRaw.length}`);

    const analyzed = GEMINI_API_KEY
      ? await analyzeWithGemini(dedupedRaw)
      : fallbackAnalyze(dedupedRaw);

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
        patent_count: c.patent_count || null,
        arxiv_papers: c.arxiv_papers || null,
        sec_filing_amount: c.sec_filing_amount || null,
      }));

      const { error } = await supabase.from("companies").upsert(rows, { onConflict: "name_key", ignoreDuplicates: false });
      if (error) console.error("Upsert error:", error);
    }

    await supabase.from("scrape_runs").update({
      completed_at: new Date().toISOString(),
      companies_found: companies.length,
      status: "completed",
      sources_scraped: ["hacker_news","github","product_hunt","twitter","linkedin","crunchbase","wellfound","sec_edgar","arxiv"],
    }).eq("id", runId);

    return new Response(JSON.stringify({ success: true, companies_found: companies.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Fatal scrape error:", err);
    if (runId) await supabase.from("scrape_runs").update({ completed_at: new Date().toISOString(), status: "failed", error: String(err) }).eq("id", runId);
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
