import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CheerioEl = any;
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA = "Mozilla/5.0 (compatible; DeepTechRadar/1.0; +https://deeptech-radar.vercel.app)";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  patent_count?: number;
  arxiv_papers?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function safeFetch(url: string, opts: RequestInit = {}, ms = 14000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    return res;
  } catch {
    return null;
  }
}

// ── 1. Hacker News — Show HN + deeptech queries ───────────────────────────────

async function scrapeHackerNews(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const cutoff = Math.floor(Date.now() / 1000) - 90 * 24 * 3600;

  const queries = [
    "Show HN deeptech hardware startup",
    "Show HN biotech CRISPR synthetic biology",
    "Show HN quantum computing hardware",
    "Show HN robotics autonomous",
    "Show HN fusion energy nuclear",
    "Show HN semiconductor photonic chip",
    "Show HN brain computer interface",
    "Launch HN hardware deeptech",
    "quantum computing startup raise seed hardware",
    "biotech CRISPR synthetic biology startup raise",
    "semiconductor photonics chip startup raise",
    "brain computer interface startup neural",
    "deeptech raise seed funding 2025",
    "YC hardware biotech quantum 2024 2025",
    "space startup raise Series launch",
    "robotics autonomous raise seed 2025",
    "climate carbon capture electrolyzer startup",
    "longevity aging therapeutics startup",
    "nuclear fusion reactor startup raise",
    "defense dual-use hypersonic startup",
  ];

  await Promise.all(
    queries.map(async (q) => {
      const res = await safeFetch(
        `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=15&numericFilters=created_at_i>${cutoff}`,
        { headers: { "User-Agent": UA } }
      );
      if (!res?.ok) return;
      const data = await res.json();
      for (const hit of data.hits || []) {
        if (!hit.title) continue;
        items.push({
          id: `hn_${hit.objectID}`,
          title: hit.title,
          description: (hit.story_text || hit.title).substring(0, 600),
          url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          author: hit.author,
          points: hit.points || 0,
          source: "hacker_news",
          created_at: hit.created_at,
          extra: {
            isShowHN: /^(Show HN|Launch HN)/i.test(hit.title),
            hn_id: hit.objectID,
            comments: hit.num_comments || 0,
          },
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

  // Weekly trending
  const res = await safeFetch("https://github.com/trending?since=weekly", {
    headers: { "User-Agent": UA, Accept: "text/html" },
  }, 15000);
  if (res?.ok) {
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
          id: `gh_weekly_${href.replace(/\//g, "_")}`,
          title: name,
          description: desc,
          url: `https://github.com${href}`,
          stars,
          source: "github",
          created_at: new Date().toISOString(),
        });
      }
    });
  }

  // Also fetch monthly trending for more coverage
  const res2 = await safeFetch("https://github.com/trending?since=monthly", {
    headers: { "User-Agent": UA, Accept: "text/html" },
  }, 15000);
  if (res2?.ok) {
    const html2 = await res2.text();
    const $2 = cheerio.load(html2);
    $2("article.Box-row").each((_: number, el: CheerioEl) => {
      const nameEl = $2(el).find("h2 a");
      const name = nameEl.text().trim().replace(/\s+/g, " ");
      const desc = $2(el).find("p.col-9").text().trim();
      const href = nameEl.attr("href") || "";
      const starsText = $2(el).find(".octicon-star").parent().text().trim().replace(/\s+/g, "");
      const stars = parseInt(starsText.replace(/,/g, "")) || 0;
      if (name && desc) {
        items.push({
          id: `gh_monthly_${href.replace(/\//g, "_")}`,
          title: name,
          description: desc,
          url: `https://github.com${href}`,
          stars,
          source: "github",
          created_at: new Date().toISOString(),
        });
      }
    });
  }

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

  $("entry, item").each((_: number, el: CheerioEl) => {
    const title = $(el).find("title").text().trim();
    const content = ($(el).find("content, description").text().trim())
      .replace(/<[^>]+>/g, "").trim();
    const link = $(el).find("link[rel='alternate']").attr("href") ||
      $(el).find("link").attr("href") ||
      $(el).find("link").text().trim() || "";
    const published = $(el).find("published, pubDate").text().trim();
    if (title) {
      items.push({
        id: `ph_${title.replace(/\W+/g, "_").toLowerCase().substring(0, 40)}`,
        title,
        description: content.substring(0, 500),
        url: link,
        source: "product_hunt",
        created_at: published ? new Date(published).toISOString() : new Date().toISOString(),
        extra: { recent_launch: true },
      });
    }
  });

  console.log(`Product Hunt: ${items.length}`);
  return items;
}

// ── 4. TechCrunch RSS ─────────────────────────────────────────────────────────

async function scrapeTechCrunch(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const feeds = [
    "https://techcrunch.com/category/startups/feed/",
    "https://techcrunch.com/tag/fundraising/feed/",
    "https://techcrunch.com/tag/biotech/feed/",
    "https://techcrunch.com/tag/robotics/feed/",
  ];

  await Promise.all(feeds.map(async (feedUrl) => {
    const res = await safeFetch(feedUrl, { headers: { "User-Agent": UA } });
    if (!res?.ok) return;
    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });

    $("item").each((_: number, el: CheerioEl) => {
      const title = $(el).find("title").text().trim();
      const desc = $(el).find("description").text().trim().replace(/<[^>]+>/g, "").substring(0, 500);
      const link = $(el).find("link").text().trim();
      const pubDate = $(el).find("pubDate").text().trim();
      if (title && /rais(ed|ing)|fundr|series [a-d]|seed round|pre-seed|deeptech|hardware|biotech|quantum|robotic/i.test(title + " " + desc)) {
        items.push({
          id: `tc_${title.replace(/\W+/g, "_").toLowerCase().substring(0, 50)}`,
          title,
          description: desc,
          url: link,
          source: "techcrunch",
          created_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
          extra: { open_round: /rais(ed|ing)|fundr|series [a-d]|seed round/i.test(title + desc) },
        });
      }
    });
  }));

  console.log(`TechCrunch: ${items.length}`);
  return items;
}

// ── 5. Y Combinator ───────────────────────────────────────────────────────────

async function scrapeYCombinator(): Promise<RawItem[]> {
  const items: RawItem[] = [];

  // YC company directory — hardware & biotech batches
  const batches = ["W25", "S24", "W24", "S23"];
  const industries = ["Hardware", "Biotech", "Aerospace", "Robotics", "Energy", "Quantum+Computing"];

  await Promise.all(batches.map(async (batch) => {
    await Promise.all(industries.map(async (industry) => {
      const res = await safeFetch(
        `https://www.ycombinator.com/companies?batch=${batch}&industry=${encodeURIComponent(industry)}`,
        { headers: { "User-Agent": UA, Accept: "text/html" } }
      );
      if (!res?.ok) return;
      const html = await res.text();
      const $ = cheerio.load(html);
      $("a[href*='/companies/']").each((_: number, el: CheerioEl) => {
        const href = $(el).attr("href") || "";
        const name = $(el).find("h2, [class*='company'], strong, span").first().text().trim();
        const desc = $(el).find("p").first().text().trim();
        if (name && name.length > 2 && href.includes("/companies/")) {
          items.push({
            id: `yc_${batch}_${name.replace(/\W+/g, "_").toLowerCase().substring(0, 40)}`,
            title: name,
            description: desc || `YC ${batch} company`,
            url: `https://www.ycombinator.com${href}`,
            source: "yc",
            created_at: new Date().toISOString(),
            extra: { yc_backed: true, batch },
          });
        }
      });
    }));
  }));

  // YC HN search
  const hnRes = await safeFetch(
    `https://hn.algolia.com/api/v1/search?query=YC+W25+S24+hardware+biotech+deeptech&tags=story&hitsPerPage=25`,
    { headers: { "User-Agent": UA } }
  );
  if (hnRes?.ok) {
    const data = await hnRes.json();
    for (const hit of data.hits || []) {
      if (/YC|Y Combinator/i.test(hit.title || "")) {
        items.push({
          id: `yc_hn_${hit.objectID}`,
          title: hit.title || "",
          description: (hit.story_text || hit.title || "").substring(0, 500),
          url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          points: hit.points || 0,
          source: "yc",
          created_at: hit.created_at,
          extra: { yc_backed: true },
        });
      }
    }
  }

  console.log(`YC: ${items.length}`);
  return items;
}

// ── 6. SBIR / STTR Grants (FREE Gov API — deeptech goldmine) ─────────────────

async function scrapeSBIR(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const currentYear = new Date().getFullYear();
  const prevYear = currentYear - 1;

  const keywords = [
    "quantum", "biotech", "synthetic biology", "fusion", "semiconductor",
    "robotics", "photonics", "aerospace", "nanotechnology", "CRISPR",
    "brain computer interface", "nuclear", "longevity", "autonomous",
    "deep tech", "gene therapy", "carbon capture", "hydrogen",
  ];

  await Promise.all(keywords.slice(0, 12).map(async (kw) => {
    for (const year of [currentYear, prevYear]) {
      const res = await safeFetch(
        `https://api.sbir.gov/public/api/awards?rows=8&keyword=${encodeURIComponent(kw)}&year=${year}&_format=json`,
        { headers: { "User-Agent": UA, Accept: "application/json" } }
      );
      if (!res?.ok) continue;
      let data;
      try { data = await res.json(); } catch { continue; }

      for (const award of (data.docs || data.data || [])) {
        const company = award.firm || award.company || award.company_name || "";
        if (!company || company.length < 3) continue;

        const awardTitle = award.title || award.award_title || award.project_title || "";
        const abstract = award.abstract || award.project_abstract || "";
        const amount = Number(award.award_amount || award.funding_amount || 0);
        const phase = award.phase || "";
        const agency = award.agency || award.funding_agency || "";

        items.push({
          id: `sbir_${company.replace(/\W+/g, "_").toLowerCase().substring(0, 40)}_${year}`,
          title: company,
          description: `SBIR/STTR Phase ${phase} grant from ${agency}. ${awardTitle}. ${abstract.substring(0, 300)}`,
          url: `https://www.sbir.gov/sbirsearch/award/all/?q=${encodeURIComponent(company)}`,
          source: "sbir",
          created_at: award.date || award.award_date || `${year}-01-01`,
          extra: {
            grant_amount: amount > 0 ? amount : null,
            phase,
            agency,
            sbir: true,
            open_round: false, // grants aren't equity raises
          },
        });
      }
    }
  }));

  console.log(`SBIR: ${items.length}`);
  return items;
}

// ── 7. BioRxiv / MedRxiv (biotech preprints) ─────────────────────────────────

async function scrapeBioRxiv(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const servers = ["biorxiv", "medrxiv"];
  const today = new Date().toISOString().split("T")[0];
  const monthAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  await Promise.all(servers.map(async (server) => {
    const res = await safeFetch(
      `https://api.biorxiv.org/details/${server}/${monthAgo}/${today}/0/json`,
      { headers: { "User-Agent": UA } }
    );
    if (!res?.ok) return;
    let data;
    try { data = await res.json(); } catch { return; }

    for (const paper of (data.collection || []).slice(0, 30)) {
      const title = paper.title || "";
      const abstract = paper.abstract || "";
      // Only include papers with commercial/spinout potential
      if (!/commercial|startup|company|therapeutic|clinical|device|trial|patent/i.test(abstract + " " + title)) continue;

      items.push({
        id: `biorxiv_${paper.doi?.replace(/\//g, "_") || Math.random().toString(36).substring(2)}`,
        title: `[Preprint] ${title}`,
        description: `Authors: ${(paper.authors || "").substring(0, 80)}. ${abstract.substring(0, 350)}`,
        url: `https://doi.org/${paper.doi}`,
        source: "biorxiv",
        created_at: paper.date ? new Date(paper.date).toISOString() : new Date().toISOString(),
        extra: { is_paper: true, category: paper.category },
      });
    }
  }));

  console.log(`BioRxiv/MedRxiv: ${items.length}`);
  return items;
}

// ── 8. DuckDuckGo helper ──────────────────────────────────────────────────────

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
    const rawUrl = $(el).find(".result__url").text().trim();
    const snippet = $(el).find(".result__snippet").text().trim();
    const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    if (title && rawUrl) results.push({ title, url, snippet });
  });
  return results.slice(0, 8);
}

// ── 9. LinkedIn + Crunchbase + Wellfound (via DDG) ────────────────────────────

async function scrapeLinkedIn(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const queries = [
    'site:linkedin.com/company "quantum computing" startup seed 2025',
    'site:linkedin.com/company "synthetic biology" startup raised 2025',
    'site:linkedin.com/company "hardware startup" raised seed 2024 2025',
    'site:linkedin.com/company "fusion energy" startup raise',
    'site:linkedin.com/company "semiconductor" deeptech 2025',
    'site:linkedin.com/company "autonomous robotics" startup raise',
    'site:linkedin.com/company "CRISPR" OR "gene therapy" startup 2025',
    'site:linkedin.com/company "aerospace" deeptech startup 2025',
  ];
  await Promise.all(queries.map(async (query) => {
    const results = await searchDDG(query);
    for (const r of results) {
      if (r.url.includes("linkedin.com/company")) {
        const name = r.title.replace(/\s*[|\-–].*$/, "").replace(/LinkedIn.*$/, "").trim();
        if (name && name.length > 3) {
          items.push({
            id: `li_${name.replace(/\W+/g, "_").toLowerCase().substring(0, 40)}`,
            title: name,
            description: r.snippet,
            url: r.url,
            source: "linkedin",
            created_at: new Date().toISOString(),
          });
        }
      }
    }
  }));
  console.log(`LinkedIn: ${items.length}`);
  return items;
}

async function scrapeCrunchbase(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const queries = [
    'site:crunchbase.com/organization quantum startup seed 2024 2025',
    'site:crunchbase.com/organization biotech "seed" 2024 2025',
    'site:crunchbase.com/organization "synthetic biology" startup',
    'site:crunchbase.com/organization "fusion" OR "nuclear" startup raise',
    'site:crunchbase.com/organization "robotics" "hardware" seed 2025',
    'site:crunchbase.com/organization "semiconductor" deeptech startup',
    'site:crunchbase.com/organization "aerospace" startup seed 2025',
    'site:crunchbase.com/organization "longevity" startup raise 2025',
  ];
  await Promise.all(queries.map(async (query) => {
    const results = await searchDDG(query);
    for (const r of results) {
      if (r.url.includes("crunchbase.com/organization")) {
        const name = r.title.replace(/\s*[-|–].*$/, "").replace(/Crunchbase.*$/, "").trim();
        if (name && name.length > 3) {
          items.push({
            id: `cb_${name.replace(/\W+/g, "_").toLowerCase().substring(0, 40)}`,
            title: name,
            description: r.snippet,
            url: r.url,
            source: "crunchbase",
            created_at: new Date().toISOString(),
          });
        }
      }
    }
  }));
  console.log(`Crunchbase: ${items.length}`);
  return items;
}

async function scrapeWellfound(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const queries = [
    'site:wellfound.com/company quantum startup hiring 2025',
    'site:wellfound.com/company biotech "synthetic biology" startup jobs',
    'site:wellfound.com/company "hardware" deeptech startup 2024',
    'site:wellfound.com/company "fusion" OR "nuclear" startup hiring',
    'site:wellfound.com/company "robotics" startup engineer jobs 2025',
    'site:wellfound.com/company "semiconductor" OR "photonics" startup 2024',
    'site:wellfound.com/company "defense" OR "aerospace" startup engineer',
  ];
  await Promise.all(queries.map(async (query) => {
    const results = await searchDDG(query);
    for (const r of results) {
      if (r.url.includes("wellfound.com/company")) {
        const name = r.title.replace(/\s*[-|–].*$/, "").replace(/Wellfound|AngelList/g, "").trim();
        if (name && name.length > 3) {
          items.push({
            id: `wf_${name.replace(/\W+/g, "_").toLowerCase().substring(0, 40)}`,
            title: name,
            description: r.snippet,
            url: r.url,
            source: "wellfound",
            created_at: new Date().toISOString(),
            extra: { hiring: true },
          });
        }
      }
    }
  }));
  console.log(`Wellfound: ${items.length}`);
  return items;
}

// ── 10. SEC EDGAR Form D ──────────────────────────────────────────────────────

async function scrapeSECEdgar(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const today = new Date();
  const start = new Date(today.getTime() - 150 * 24 * 60 * 60 * 1000);
  const startDate = start.toISOString().split("T")[0];
  const endDate = today.toISOString().split("T")[0];

  const FUND_PATTERNS = /\b(LP|L\.P\.|fund|capital partners|ventures lp|venture fund|real estate|art fund|coinvest|icapital|quail|opportunity fund)\b/i;
  const COMPANY_PATTERNS = /\b(inc\.?|corp\.?|systems|technologies|therapeutics|bio|sciences|labs|industries|solutions|robotics|quantum|photonics|aerospace)\b/i;

  const keywords = [
    "quantum", "biotech", "synthetic biology", "fusion", "semiconductor",
    "robotics", "CRISPR", "aerospace", "nuclear", "photonics",
    "nanotechnology", "longevity", "autonomous", "deep tech",
    "gene therapy", "brain computer", "carbon capture", "hydrogen fuel",
    "advanced materials", "space tech",
  ];

  await Promise.all(keywords.map(async (kw) => {
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(kw)}%22&forms=D&dateRange=custom&startdt=${startDate}&enddt=${endDate}`;
    const res = await safeFetch(url, {
      headers: { "User-Agent": "DeepTechRadar/1.0 research@deeptech-radar.io", Accept: "application/json" },
    });
    if (!res?.ok) return;
    let data;
    try { data = await res.json(); } catch { return; }

    for (const hit of (data.hits?.hits || []).slice(0, 8)) {
      const src = hit._source || {};
      const rawName = (src.display_names?.[0] || "").replace(/\s*\(.*?\)\s*/g, "").trim();
      if (!rawName || rawName.length < 4) continue;
      if (FUND_PATTERNS.test(rawName) && !COMPANY_PATTERNS.test(rawName)) continue;

      // Extract offering amount from the filing
      const totalOffering = Number(src.total_offering || 0);

      items.push({
        id: `sec_${(hit._id || "").replace(/\W+/g, "_")}`,
        title: rawName,
        description: `SEC Form D fundraising disclosure — ${kw} sector. Filed ${src.file_date || "recently"} in ${src.biz_locations?.[0] || "US"}.`,
        url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${src.ciks?.[0] || ""}&type=D&dateb=&owner=include&count=5`,
        source: "sec_edgar",
        created_at: src.file_date ? new Date(src.file_date).toISOString() : new Date().toISOString(),
        extra: {
          sec_filing: true,
          open_round: true,
          cik: src.ciks?.[0],
          sec_filing_amount: totalOffering > 0 ? totalOffering : null,
        },
      });
    }
  }));

  console.log(`SEC EDGAR: ${items.length}`);
  return items;
}

// ── 11. arXiv ─────────────────────────────────────────────────────────────────

async function scrapeArXiv(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  const searches = [
    "quantum hardware commercial device company spinoff",
    "CRISPR gene therapy clinical startup company",
    "brain computer interface commercial startup",
    "fusion plasma reactor commercial company",
    "photonic chip commercial application",
    "autonomous robot commercial deployment company",
    "longevity aging therapeutic clinical company",
    "semiconductor quantum dot commercial device",
    "carbon capture direct air electrochemical",
    "protein design therapeutic company venture",
    "nuclear microreactor commercial power",
    "synthetic biology biomanufacturing industrial",
  ];

  await Promise.all(searches.map(async (query) => {
    const res = await safeFetch(
      `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=5&sortBy=submittedDate&sortOrder=descending`,
      { headers: { "User-Agent": UA } }
    );
    if (!res?.ok) return;
    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });

    $("entry").each((_: number, el: CheerioEl) => {
      const arxivId = $(el).find("id").text().trim();
      const title = $(el).find("title").text().trim().replace(/\s+/g, " ");
      const summary = $(el).find("summary").text().trim().replace(/\s+/g, " ").substring(0, 400);
      const authors = $(el).find("author name").map((_: number, a: CheerioEl) => $(a).text()).get().slice(0, 4).join(", ");
      const published = $(el).find("published").text().trim();
      if (title && summary && /commercial|startup|company|venture|spin.?off|deploy|therapeutic|clinical|device/i.test(summary + " " + title)) {
        items.push({
          id: `arxiv_${arxivId.split("/").pop()?.replace(/\W/g, "_") || Math.random().toString(36).substring(2)}`,
          title: `[Paper] ${title}`,
          description: `Authors: ${authors}. ${summary}`,
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

// ── Classification ─────────────────────────────────────────────────────────────

const SUBSECTORS: [string, string[]][] = [
  ["Quantum Computing & Sensing", ["qubit", "quantum computer", "quantum error", "quantum sensor", "quantum network", "quantum hardware", "quantum cryptography", "photonic quantum", "superconducting qubit", "quantum gate", "quantum chip", "quantum dot"]],
  ["Fusion & Advanced Energy", ["fusion reactor", "fusion energy", "tokamak", "inertial confinement", "stellarator", "plasma physics", "nuclear fusion", "deuterium", "tritium", "net energy gain", "fusion power"]],
  ["Nuclear Tech", ["fission", "nuclear reactor", "small modular reactor", " smr ", "radioisotope", "thorium reactor", "molten salt", "nuclear power", "microreactor", "nuclear waste"]],
  ["Biotech & Synthetic Biology", ["crispr", "gene editing", "gene therapy", "synthetic biology", "biomanufacturing", "mrna therapy", "cell therapy", "protein engineering", "genomics platform", "bioreactor", "therapeutic antibody", "gene circuit", "base editing", "biologics", "genome"]],
  ["Human Augmentation & BCI", ["brain computer interface", "brain-computer", "neural implant", "neural interface", "neuroprosthetic", "brain interface", "neural recording", "bci device", "neurotechnology", "cortical implant", "brain stimulation", "neural chip"]],
  ["Nanotechnology", ["nanotube", "nanoparticle", "nanoscale manufacturing", "molecular machine", "mems device", "nanofabrication", "graphene device", "nano-scale", "atomic layer", "nanomedicine"]],
  ["Hard Semiconductors & Photonics", ["silicon carbide", "gallium nitride", "photonic integrated", "lidar chip", "chip design", "semiconductor fab", "asic design", "compound semiconductor", "integrated photonics", "photonic chip", "wafer fab", "gan transistor", "sic device"]],
  ["Aerospace & Space Tech", ["rocket engine", "launch vehicle", "satellite constellation", "spacecraft", "reentry vehicle", "in-orbit servicing", "lunar", "smallsat", "nanosatellite", "propellant", "orbital mechanics", "space debris", "hypersonic flight"]],
  ["Autonomous Systems & Robotics", ["robotic arm", "autonomous robot", "robot manipulation", "warehouse robot", "surgical robot", "legged robot", "drone swarm", "autonomous drone", "lidar navigation", "dexterous manipulation", "actuator control", "robot locomotion"]],
  ["Climate Tech & Energy", ["carbon capture", "direct air capture", "electrolyzer", "green hydrogen", "perovskite solar", "solid state battery", "grid storage", "long duration storage", "geothermal energy", "ocean energy", "clean energy", "decarbonization"]],
  ["Defense & Dual-Use Tech", ["defense technology", "electronic warfare", "counter-uas", "hypersonic vehicle", "isr platform", "counter-drone", "dual-use", "autonomous weapons", "directed energy", "hardened communication", "tactical system"]],
  ["Longevity & Life Extension", ["longevity research", "aging biology", "senolytic", "cellular senescence", "lifespan extension", "rejuvenation", "anti-aging", "epigenetic reprogramming", "geroprotector", "age reversal", "healthspan"]],
  ["Advanced Materials & Manufacturing", ["metamaterial", "carbon fiber composite", "advanced alloy", "3d printed metal", "additive manufacturing hardware", "piezoelectric", "shape memory alloy", "superconducting material", "2d material", "programmable matter", "functional material"]],
];

const DEEPTECH_SIGNALS = [
  "hardware", "physical", "molecule", "biological", "scientific", "laboratory",
  "phd", "professor", "patent", "device", "chip", "sensor", "quantum", "biotech",
  "robot", "drone", "space", "fusion", "semiconductor", "photonic", "nanotech",
  "gene", "cell therapy", "crispr", "nuclear", "lidar", "satellite", "bci",
  "plasma", "reactor", "therapeutic", "clinical", "instrument", "actuator",
  "grant", "sbir", "sttr", "doe", "darpa", "nsf", "nih",
];

const SOFTWARE_EXCLUSIONS = [
  "saas platform", "crm software", "no-code", "low-code", "browser extension",
  "mobile app only", "software as a service", "workflow automation",
  "marketing platform", "analytics tool", "dashboard for",
];

const GENERIC_WORDS = new Set([
  "the", "and", "for", "new", "lab", "labs", "tech", "ai", "inc", "llc", "corp",
  "company", "startup", "venture", "group", "project", "open", "team", "show",
  "ask", "tell", "just", "use", "make", "build", "get", "set", "run", "try",
  "one", "two", "three", "four", "five", "paper", "study", "analysis", "review",
]);

function isValidCompanyName(name: string): boolean {
  if (!name || name.length < 3 || name.length > 80) return false;
  if (GENERIC_WORDS.has(name.toLowerCase())) return false;
  if (/^[a-z]$/i.test(name)) return false;
  if (/\b(paper|study|survey|review|analysis|approach|method|framework|using|toward)\b/i.test(name)) return false;
  return true;
}

function classifySubsector(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [subsector, keywords] of SUBSECTORS) {
    if (keywords.some((kw) => lower.includes(kw))) return subsector;
  }
  if (lower.includes("quantum")) return "Quantum Computing & Sensing";
  if (lower.includes("biotech") || lower.includes("genomic") || lower.includes("crispr")) return "Biotech & Synthetic Biology";
  if (lower.includes("robotics") || lower.includes("autonomous")) return "Autonomous Systems & Robotics";
  if (lower.includes("aerospace") || lower.includes("satellite") || lower.includes("rocket")) return "Aerospace & Space Tech";
  if (lower.includes("fusion") || lower.includes("nuclear")) return "Fusion & Advanced Energy";
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
  if (/launch(ing|ed)|introduc(ing|ed)|announc(ing|ed)|show hn|launch hn/i.test(text)) signals.push("recent_launch");
  if (item.extra?.recent_launch) signals.push("recent_launch");
  if (/hir(ing|ed)|join our team|open roles|looking for engineers|we.re growing/i.test(text) || item.extra?.hiring) signals.push("hiring");
  if (/yc|y combinator|ycombinator/i.test(text) || item.extra?.yc_backed || item.source === "yc") signals.push("yc_backed");
  if (/phd|dr\.|professor|postdoc|national lab|darpa|mit|stanford|caltech|cern|eth zurich|nasa|doe\b/i.test(text)) signals.push("phd_founder");
  if ((item.points && item.points > 100) || (item.stars && item.stars > 500)) signals.push("high_engagement");
  if (/founded (in |year )?202[3-9]|est\.? 202[3-9]|started in 202[3-9]/i.test(text)) signals.push("recently_founded");
  if (item.source === "arxiv" || item.source === "biorxiv" || item.extra?.is_paper) signals.push("research_paper");
  if (item.source === "sec_edgar") signals.push("sec_filing");
  if (/patent(ed|ing|s)?|USPTO/i.test(text)) signals.push("has_patent");
  if (item.source === "sbir" || item.extra?.sbir) signals.push("sbir_grant");
  return [...new Set(signals)];
}

/**
 * Multi-factor traction score (0–100):
 *  Fundraising evidence  0–35  (SEC filing, open round, SBIR grant, YC)
 *  Team quality          0–25  (PhD, patent, YC backing, publications)
 *  Market activity       0–25  (launch, hiring, engagement, recent founding)
 *  Data richness         0–15  (stars, points, multi-source)
 */
function scoreCompany(signals: string[], item: RawItem): number {
  // Fundraising evidence (0–35)
  let fundraising = 5; // base
  if (signals.includes("sec_filing")) fundraising += 20;
  else if (signals.includes("open_round")) fundraising += 12;
  if (signals.includes("yc_backed")) fundraising += 8;
  if (signals.includes("sbir_grant")) fundraising += 10;
  fundraising = Math.min(35, fundraising);

  // Team quality (0–25)
  let team = 0;
  if (signals.includes("yc_backed")) team += 10;
  if (signals.includes("phd_founder")) team += 10;
  if (signals.includes("has_patent")) team += 8;
  if (signals.includes("research_paper")) team += 5;
  team = Math.min(25, team);

  // Market activity (0–25)
  let activity = 0;
  if (signals.includes("recent_launch")) activity += 12;
  if (signals.includes("hiring")) activity += 8;
  if (signals.includes("high_engagement")) activity += 8;
  if (signals.includes("recently_founded")) activity += 5;
  activity = Math.min(25, activity);

  // Data richness (0–15)
  let richness = 0;
  if (item.points && item.points > 300) richness += 15;
  else if (item.points && item.points > 100) richness += 10;
  else if (item.points && item.points > 50) richness += 6;
  if (item.stars && item.stars > 1000) richness += 10;
  else if (item.stars && item.stars > 200) richness += 6;
  richness = Math.min(15, richness);

  return Math.min(100, fundraising + team + activity + richness);
}

function isWebsite(url: string): boolean {
  return !["github.com", "linkedin.com", "twitter.com", "x.com", "producthunt.com",
    "news.ycombinator.com", "ycombinator.com", "crunchbase.com", "wellfound.com",
    "arxiv.org", "sec.gov", "techcrunch.com", "biorxiv.org", "medrxiv.org",
    "sbir.gov", "doi.org"].some((d) => url.includes(d))
    && url.startsWith("http");
}

function extractName(title: string, item: RawItem): string {
  let name = title;
  const showHnMatch = name.match(/^(?:Show HN|Launch HN):\s*([^–—:]+)/i);
  if (showHnMatch) return showHnMatch[1].trim().substring(0, 60);
  name = name.replace(/^\[(?:Paper|Preprint)\]\s*/i, "");
  name = name.replace(/^(?:Ask HN|Tell HN):\s*/i, "");
  const stripped = name.replace(/\s*[-–—|:,].*$/, "").trim();
  if (stripped.length >= 3 && stripped.split(" ").length <= 5) return stripped.substring(0, 60);
  if (["linkedin", "crunchbase", "wellfound", "sec_edgar", "sbir"].includes(item.source)) {
    return title.replace(/\s*[-–—|:,].*$/, "").trim().substring(0, 60);
  }
  return name.substring(0, 60);
}

// ── Gemini 2.5 Flash Analysis (parallel batches) ──────────────────────────────

async function analyzeBatch(
  batch: RawItem[],
  apiKey: string,
  subsectorList: string
): Promise<AnalyzedCompany[]> {
  const prompt = `Analyze these startup/company signals. Only include REAL companies or research groups building physically novel deeptech. Exclude pure SaaS/software.

Valid subsectors: ${subsectorList}

Items:
${batch.map((item, idx) => `[${idx + 1}]
Title: ${item.title}
Description: ${item.description?.substring(0, 300) || ""}
URL: ${item.url}
Source: ${item.source}
Extra: ${JSON.stringify(item.extra || {})}
`).join("\n---\n")}

Return JSON array (one object per item, same order):
[{
  "is_deeptech": boolean,
  "name": "clean short company name (2–5 words, not an article title)",
  "description": "one sentence ≤150 chars: what they BUILD or discovered commercially",
  "subsector": "exact subsector name from list or null",
  "open_round": boolean,
  "signals": ["open_round","recent_launch","hiring","yc_backed","phd_founder","high_engagement","recently_founded","research_paper","sec_filing","has_patent","sbir_grant"],
  "founded_year": number or null,
  "founders": [{"name":"Full Name","role":"CEO/CTO","background":"PhD MIT, ex-SpaceX, 3 patents"}],
  "funding_stage": "pre-seed|seed|series-a|series-b|series-c or null",
  "funding_amount": "$XM or null",
  "website": "https://companywebsite.com or null (not github/linkedin/arxiv)",
  "github_url": "https://github.com/... or null",
  "twitter_url": "https://x.com/... or null",
  "linkedin_url": "https://linkedin.com/company/... or null",
  "hiring_velocity": estimated_open_jobs_count_or_null,
  "patent_count": estimated_patent_count_or_null,
  "arxiv_papers": number_of_related_papers_or_null
}]`;

  const res = await safeFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 3000,
          temperature: 0.1,
        },
      }),
    },
    35000
  );

  if (!res?.ok) {
    console.error(`Gemini ${res?.status}`);
    return fallbackAnalyze(batch);
  }

  const geminiData = await res.json();
  const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  let analyzed: {
    is_deeptech: boolean; name: string; description: string;
    subsector: string | null; open_round: boolean; signals: string[];
    founded_year: number | null; founders: { name: string; role: string; background: string }[];
    funding_stage: string | null; funding_amount: string | null;
    website: string | null; github_url: string | null; twitter_url: string | null;
    linkedin_url: string | null; hiring_velocity: number | null;
    patent_count: number | null; arxiv_papers: number | null;
  }[] = [];

  try { analyzed = JSON.parse(text); } catch { return fallbackAnalyze(batch); }

  const results: AnalyzedCompany[] = [];
  for (let j = 0; j < batch.length; j++) {
    const item = batch[j];
    const a = analyzed[j] || {};
    if (!a.is_deeptech || !a.subsector || !a.name) continue;
    if (!isValidCompanyName(a.name)) continue;
    const allSignals = [...new Set([...(a.signals || []), ...extractSignals(`${item.title} ${item.description}`, item)])];
    results.push({
      name: a.name,
      description: a.description || item.description?.substring(0, 150) || "",
      subsector: a.subsector,
      open_round: a.open_round || allSignals.includes("open_round"),
      signals: allSignals,
      founded_year: a.founded_year || null,
      founders: a.founders || [],
      funding_stage: a.funding_stage || null,
      funding_amount: a.funding_amount || null,
      sources: [item.source],
      website_url: a.website && isWebsite(a.website) ? a.website : (isWebsite(item.url) ? item.url : null),
      github_url: a.github_url || (item.url.includes("github.com") ? item.url : null),
      twitter_url: a.twitter_url || null,
      linkedin_url: a.linkedin_url || (item.url.includes("linkedin.com") ? item.url : null),
      source_url: item.url,
      traction_score: scoreCompany(allSignals, item),
      last_seen: item.created_at,
      hiring_velocity: a.hiring_velocity ?? undefined,
      patent_count: a.patent_count ?? undefined,
      arxiv_papers: a.arxiv_papers ?? undefined,
      sec_filing_amount: typeof item.extra?.sec_filing_amount === "number" ? item.extra.sec_filing_amount :
                         typeof item.extra?.grant_amount === "number" ? item.extra.grant_amount : undefined,
    });
  }
  return results;
}

async function analyzeWithGemini(items: RawItem[], apiKey: string): Promise<AnalyzedCompany[]> {
  const BATCH_SIZE = 10;
  const CONCURRENCY = 3; // 3 parallel Gemini calls
  const subsectorList = SUBSECTORS.map(([s]) => s).join(", ");

  const batches: RawItem[][] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batches.push(items.slice(i, i + BATCH_SIZE));
  }

  const results: AnalyzedCompany[] = [];

  // Process in groups of CONCURRENCY
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const group = batches.slice(i, i + CONCURRENCY);
    const groupResults = await Promise.all(
      group.map((batch) => analyzeBatch(batch, apiKey, subsectorList))
    );
    results.push(...groupResults.flat());
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
    const name = extractName(item.title, item);
    if (!isValidCompanyName(name)) continue;
    const signals = extractSignals(text, item);
    results.push({
      name,
      description: item.description?.substring(0, 150) || item.title.substring(0, 150),
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
      sec_filing_amount: typeof item.extra?.sec_filing_amount === "number" ? item.extra.sec_filing_amount :
                         typeof item.extra?.grant_amount === "number" ? item.extra.grant_amount : undefined,
    });
  }
  return results;
}

function deduplicateItems(items: RawItem[]): RawItem[] {
  const seen = new Map<string, RawItem>();
  for (const item of items) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 30);
    if (!key || key.length < 4) continue;
    const ex = seen.get(key);
    if (!ex || (item.description?.length || 0) > (ex.description?.length || 0)) {
      seen.set(key, item);
    }
  }
  return Array.from(seen.values());
}

function deduplicateCompanies(companies: AnalyzedCompany[]): AnalyzedCompany[] {
  const map = new Map<string, AnalyzedCompany>();
  for (const c of companies) {
    const key = c.name.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 30);
    if (!key || key.length < 3) continue;
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
      if (!ex.sec_filing_amount && c.sec_filing_amount) ex.sec_filing_amount = c.sec_filing_amount;
      // Boost score for multi-source confirmation
      ex.traction_score = Math.min(100, ex.traction_score + (ex.sources.length > 1 ? 5 : 0));
    } else {
      map.set(key, { ...c });
    }
  }
  return Array.from(map.values());
}

// ── Main scrape ────────────────────────────────────────────────────────────────

async function runScrape(): Promise<{ companies_found: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data: run } = await db.from("scrape_runs").insert({ status: "running" }).select().single();
  const runId = run?.id;

  try {
    // All sources in parallel — maximise use of the 60s window
    const [hnItems, ghItems, phItems, tcItems, ycItems, sbirItems, biorxivItems,
      liItems, cbItems, wfItems, secItems, arxivItems] = await Promise.all([
        scrapeHackerNews(),
        scrapeGitHub(),
        scrapeProductHunt(),
        scrapeTechCrunch(),
        scrapeYCombinator(),
        scrapeSBIR(),
        scrapeBioRxiv(),
        scrapeLinkedIn(),
        scrapeCrunchbase(),
        scrapeWellfound(),
        scrapeSECEdgar(),
        scrapeArXiv(),
      ]);

    const allRaw = deduplicateItems([
      ...hnItems, ...ghItems, ...phItems, ...tcItems, ...ycItems,
      ...sbirItems, ...biorxivItems,
      ...liItems, ...cbItems, ...wfItems, ...secItems, ...arxivItems,
    ]);
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
        patent_count: c.patent_count || null,
        arxiv_papers: c.arxiv_papers || null,
        sec_filing_amount: c.sec_filing_amount || null,
      }));

      const { error } = await db.from("companies").upsert(rows, {
        onConflict: "name_key",
        ignoreDuplicates: false,
      });
      if (error) console.error("Upsert error:", error);
    }

    await db.from("scrape_runs").update({
      completed_at: new Date().toISOString(),
      companies_found: companies.length,
      status: "completed",
      sources_scraped: ["hacker_news", "github", "product_hunt", "techcrunch", "yc",
        "sbir", "biorxiv", "linkedin", "crunchbase", "wellfound", "sec_edgar", "arxiv"],
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

// ── Route handler ──────────────────────────────────────────────────────────────

async function handler(req: Request) {
  const db = createServiceClient();
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  if (!force) {
    const { data: lastRun } = await db
      .from("scrape_runs")
      .select("started_at, status")
      .eq("status", "completed")
      .order("started_at", { ascending: false })
      .limit(1)
      .single() as { data: { started_at: string; status: string } | null };

    if (lastRun?.started_at) {
      const age = Date.now() - new Date(lastRun.started_at).getTime();
      if (age < 30 * 60 * 1000) {
        return NextResponse.json({
          message: "Scrape skipped — ran less than 30 minutes ago",
          last_run: lastRun.started_at,
        });
      }
    }
  }

  const result = await runScrape();
  return NextResponse.json({ success: true, ...result });
}

export async function POST(req: Request) { return handler(req); }
export async function GET(req: Request) { return handler(req); }
