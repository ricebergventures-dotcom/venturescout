"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import type { Company, ScrapeRun } from "@/types";
import { SUBSECTORS, SUBSECTOR_COLORS, SOURCE_LABELS } from "@/types";

// ============================================================
// HELPERS
// ============================================================

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}

function scoreClass(n: number): string {
  if (n >= 70) return "high";
  if (n >= 40) return "mid";
  return "low";
}

function stageLabel(s: string | null): string {
  if (!s) return "";
  const map: Record<string, string> = {
    "pre-seed": "PRE-SEED", seed: "SEED",
    "series-a": "SERIES A", "series-b": "SERIES B", "series-c": "SERIES C",
  };
  return map[s.toLowerCase()] || s.toUpperCase();
}

function formatAmount(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

const SIGNAL_LABELS: Record<string, { label: string; color: string }> = {
  open_round:       { label: "● RAISING",    color: "#34d399" },
  recent_launch:    { label: "⚡ LAUNCHED",   color: "#38bdf8" },
  hiring:           { label: "⊕ HIRING",     color: "#a78bfa" },
  yc_backed:        { label: "◈ YC",         color: "#f97316" },
  phd_founder:      { label: "✦ PHD",        color: "#facc15" },
  sec_filing:       { label: "§ SEC FILING", color: "#eab308" },
  research_paper:   { label: "∮ PAPER",      color: "#b45309" },
  has_patent:       { label: "⊛ PATENT",     color: "#60a5fa" },
  recently_founded: { label: "◎ EARLY",      color: "#4ade80" },
  high_engagement:  { label: "↑ TRENDING",   color: "#fb923c" },
};

// ============================================================
// COMPANY CARD
// ============================================================

function CompanyCard({ company, rank }: { company: Company; rank?: number }) {
  const sectorColor = SUBSECTOR_COLORS[company.subsector || ""] || {
    bg: "rgba(255,255,255,0.04)", text: "#8496ae", border: "rgba(255,255,255,0.1)",
  };
  const founders = company.founders || [];
  const primaryFounder = founders[0] || null;
  const displaySignals = (company.signals || []).filter((s) => s !== "open_round").slice(0, 3);

  return (
    <div className={`company-card${company.open_round ? " raising" : ""}`}>
      {rank && rank <= 25 && (
        <div className="card-rank">#{rank}</div>
      )}

      {/* Top row */}
      <div className="card-top">
        <div className="company-name">{company.name}</div>
        {company.open_round && (
          <div className="raising-badge">
            <span className="raising-dot" />
            RAISING
          </div>
        )}
      </div>

      {/* Description */}
      {company.description && (
        <p className="company-desc">{company.description}</p>
      )}

      {/* Sector + Stage tags */}
      <div className="card-tags">
        {company.subsector && (
          <span className="tag" style={{ background: sectorColor.bg, color: sectorColor.text, borderColor: sectorColor.border }}>
            {company.subsector}
          </span>
        )}
        {company.funding_stage && (
          <span className="tag stage-tag">{stageLabel(company.funding_stage)}</span>
        )}
        {company.funding_amount && (
          <span className="tag amount-tag">{company.funding_amount}</span>
        )}
        {company.sec_filing_amount && (
          <span className="tag" style={{ background: "rgba(234,179,8,0.1)", color: "#eab308", borderColor: "rgba(234,179,8,0.3)" }}>
            SEC {formatAmount(company.sec_filing_amount)}
          </span>
        )}
      </div>

      {/* Signal chips */}
      {displaySignals.length > 0 && (
        <div className="signal-chips">
          {displaySignals.map((sig) => {
            const meta = SIGNAL_LABELS[sig];
            if (!meta) return null;
            return (
              <span key={sig} className="signal-chip" style={{ color: meta.color, borderColor: `${meta.color}30`, background: `${meta.color}0e` }}>
                {meta.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Enrichment metrics (Harmonic-style velocity) */}
      {(company.hiring_velocity || company.arxiv_papers || company.patent_count) && (
        <div className="metrics-row">
          {company.hiring_velocity && (
            <div className="metric-pill">
              <span className="metric-icon">⊕</span>
              <span className="metric-val">{company.hiring_velocity}</span>
              <span className="metric-label">open roles</span>
            </div>
          )}
          {company.arxiv_papers && (
            <div className="metric-pill">
              <span className="metric-icon">∮</span>
              <span className="metric-val">{company.arxiv_papers}</span>
              <span className="metric-label">papers</span>
            </div>
          )}
          {company.patent_count && (
            <div className="metric-pill">
              <span className="metric-icon">⊛</span>
              <span className="metric-val">{company.patent_count}</span>
              <span className="metric-label">patents</span>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="card-footer">
        <div className="founder-block">
          {primaryFounder ? (
            <>
              <div className="founder-name">
                {primaryFounder.name}
                {primaryFounder.role && (
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                    {" "}· {primaryFounder.role}
                  </span>
                )}
              </div>
              {primaryFounder.background && (
                <div className="founder-bg">{primaryFounder.background}</div>
              )}
            </>
          ) : (
            <div className="founder-role">—</div>
          )}

          <div className="source-links" style={{ marginTop: 8 }}>
            {(company.sources || []).map((src) => {
              const meta = SOURCE_LABELS[src];
              if (!meta) return null;
              return (
                <span key={src} className="source-badge"
                  style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}35` }}>
                  {meta.label}
                </span>
              );
            })}
            {company.website_url && (
              <a href={company.website_url} target="_blank" rel="noopener noreferrer" className="link-btn">↗</a>
            )}
            {company.github_url && (
              <a href={company.github_url} target="_blank" rel="noopener noreferrer" className="link-btn">GH</a>
            )}
            {company.twitter_url && (
              <a href={company.twitter_url} target="_blank" rel="noopener noreferrer" className="link-btn">X</a>
            )}
            {company.linkedin_url && (
              <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer" className="link-btn">LI</a>
            )}
          </div>
        </div>

        <div className="card-right">
          <div className="traction-score">
            <span className={`score-value ${scoreClass(company.traction_score)}`}>
              {company.traction_score}
            </span>
            <span className="score-label">traction</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// RADAR HOT 25 (Harmonic-style leaderboard)
// ============================================================
function Hot25({ companies }: { companies: Company[] }) {
  const top25 = useMemo(
    () => [...companies].sort((a, b) => b.traction_score - a.traction_score).slice(0, 25),
    [companies]
  );
  if (top25.length === 0) return null;

  return (
    <section className="hot25-section">
      <div className="hot25-header">
        <span className="hot25-title">RADAR HOT {Math.min(top25.length, 25)}</span>
        <span className="hot25-sub">Highest traction deeptech companies this cycle</span>
      </div>
      <div className="hot25-list">
        {top25.map((c, i) => (
          <div key={c.id} className="hot25-row">
            <span className="hot25-rank">#{i + 1}</span>
            <div className="hot25-info">
              <span className="hot25-name">{c.name}</span>
              {c.subsector && (
                <span className="hot25-sector" style={{ color: SUBSECTOR_COLORS[c.subsector]?.text || "#8496ae" }}>
                  {c.subsector}
                </span>
              )}
            </div>
            <div className="hot25-signals">
              {c.open_round && <span className="hot25-badge raising">RAISING</span>}
              {c.signals?.includes("yc_backed") && <span className="hot25-badge yc">YC</span>}
              {c.signals?.includes("sec_filing") && <span className="hot25-badge sec">SEC</span>}
              {c.signals?.includes("hiring") && <span className="hot25-badge hiring">HIRING</span>}
            </div>
            <span className={`hot25-score ${scoreClass(c.traction_score)}`}>{c.traction_score}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============================================================
// MAIN CLIENT COMPONENT
// ============================================================

type ViewMode = "directory" | "hot25";

interface Props {
  initialCompanies: Company[];
  lastRun: ScrapeRun | null;
}

export default function RadarClient({ initialCompanies, lastRun }: Props) {
  const [companies, setCompanies] = useState<Company[]>(initialCompanies);
  const [search, setSearch] = useState("");
  const [subsectorFilter, setSubsectorFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [openRoundOnly, setOpenRoundOnly] = useState(false);
  const [signalFilter, setSignalFilter] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("directory");
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState(lastRun?.status || "idle");
  const [refreshTime, setRefreshTime] = useState<string | null>(
    lastRun?.completed_at || lastRun?.started_at || null
  );

  useEffect(() => {
    const shouldScrape =
      !lastRun ||
      (lastRun.status === "completed" &&
        Date.now() - new Date(lastRun.started_at).getTime() > 4 * 60 * 60 * 1000) ||
      lastRun.status === "failed";
    if (shouldScrape && companies.length === 0) triggerScrape();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerScrape = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    setScanStatus("running");
    try {
      const res = await fetch("/api/scrape", { method: "POST" });
      const data = await res.json();
      if (data.success || data.companies_found != null) {
        const r2 = await fetch("/api/companies");
        if (r2.ok) {
          const { companies: fresh } = await r2.json();
          if (fresh?.length) setCompanies(fresh);
        }
        setRefreshTime(new Date().toISOString());
        setScanStatus("completed");
      }
    } catch {
      setScanStatus("failed");
    } finally {
      setScanning(false);
    }
  }, [scanning]);

  // ── FILTERING ──
  const filtered = useMemo(() => {
    return companies.filter((c) => {
      if (openRoundOnly && !c.open_round) return false;
      if (stageFilter !== "all" && c.funding_stage !== stageFilter) return false;
      if (subsectorFilter !== "all" && c.subsector !== subsectorFilter) return false;
      if (signalFilter !== "all" && !(c.signals || []).includes(signalFilter)) return false;
      if (search.trim()) {
        const term = search.toLowerCase();
        const blob = [c.name, c.description, ...(c.founders || []).map((f) => f.name), c.subsector]
          .filter(Boolean).join(" ").toLowerCase();
        if (!blob.includes(term)) return false;
      }
      return true;
    });
  }, [companies, search, subsectorFilter, stageFilter, openRoundOnly, signalFilter]);

  // ── GROUP BY SUBSECTOR ──
  const grouped = useMemo((): [string, Company[]][] => {
    const map = new Map<string, Company[]>();
    for (const c of filtered) {
      const key = c.subsector || "Other";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    for (const [, arr] of Array.from(map.entries())) {
      arr.sort((a: Company, b: Company) => {
        const aLast = a.founders?.[0]?.name?.split(" ").pop() || a.name;
        const bLast = b.founders?.[0]?.name?.split(" ").pop() || b.name;
        return aLast.localeCompare(bLast);
      });
    }
    const sorted: [string, Company[]][] = [];
    for (const sector of SUBSECTORS) {
      if (map.has(sector)) sorted.push([sector, map.get(sector)!]);
    }
    for (const [k, v] of Array.from(map.entries())) {
      if (!sorted.find(([s]) => s === k)) sorted.push([k, v]);
    }
    return sorted;
  }, [filtered]);

  const stats = useMemo(() => ({
    total: companies.length,
    openRounds: companies.filter((c) => c.open_round).length,
    subsectors: new Set(companies.map((c) => c.subsector).filter(Boolean)).size,
    secFilings: companies.filter((c) => c.signals?.includes("sec_filing")).length,
  }), [companies]);

  const availableStages = useMemo(() => {
    const s = new Set(companies.map((c) => c.funding_stage).filter(Boolean) as string[]);
    return Array.from(s).sort();
  }, [companies]);

  const isLoading = companies.length === 0 && scanning;

  const SOURCES_SCANNED = ["HN", "GitHub", "Product Hunt", "X", "LinkedIn", "Crunchbase", "Wellfound", "SEC EDGAR", "arXiv"];

  return (
    <>
      {/* ── HEADER ── */}
      <header className="header">
        <div className="logo">
          <span className="logo-text">Deep<span className="logo-accent">Tech</span> Radar</span>
          <span className="logo-sub">Founder &amp; startup intelligence</span>
        </div>

        <div className="header-center">
          <button
            className={`view-tab${viewMode === "directory" ? " active" : ""}`}
            onClick={() => setViewMode("directory")}
          >
            DIRECTORY
          </button>
          <button
            className={`view-tab${viewMode === "hot25" ? " active" : ""}`}
            onClick={() => setViewMode("hot25")}
          >
            RADAR HOT {Math.min(companies.length, 25)}
          </button>
        </div>

        <div className="header-right">
          {refreshTime && <span>{timeAgo(refreshTime)}</span>}
          <div className="status-pill">
            <span className={`status-dot${scanning ? " scanning" : scanStatus === "completed" ? "" : " idle"}`} />
            {scanning ? "scanning" : scanStatus === "completed" ? "live" : "idle"}
          </div>
          <button className={`refresh-btn${scanning ? " scanning" : ""}`} onClick={triggerScrape} disabled={scanning}>
            {scanning ? "scanning..." : "↻ rescan"}
          </button>
        </div>
      </header>

      {/* ── STATS BAR ── */}
      <div className="stats-bar">
        <div className="stat">
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">Companies</span>
        </div>
        <div className="stat">
          <span className="stat-value green">{stats.openRounds}</span>
          <span className="stat-label">Open rounds</span>
        </div>
        <div className="stat">
          <span className="stat-value accent">{stats.subsectors}</span>
          <span className="stat-label">Subsectors</span>
        </div>
        <div className="stat">
          <span className="stat-value" style={{ color: "#eab308" }}>{stats.secFilings}</span>
          <span className="stat-label">SEC filings</span>
        </div>
        <div className="stat" style={{ marginLeft: "auto", borderRight: "none" }}>
          <span className="stat-value">{SOURCES_SCANNED.length}</span>
          <span className="stat-label">Sources</span>
        </div>
      </div>

      {/* ── SOURCE BADGES BAR ── */}
      <div className="sources-bar">
        <span className="sources-label">Scanning:</span>
        {SOURCES_SCANNED.map((s) => (
          <span key={s} className="source-pill">{s}</span>
        ))}
      </div>

      {/* ── FILTER BAR (directory only) ── */}
      {viewMode === "directory" && (
        <div className="filter-bar">
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input
              className="search-input"
              type="text"
              placeholder="Search companies, founders, descriptions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select className="filter-select" value={subsectorFilter} onChange={(e) => setSubsectorFilter(e.target.value)}>
            <option value="all">All subsectors</option>
            {SUBSECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <select className="filter-select" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
            <option value="all">Any stage</option>
            {availableStages.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
          </select>

          <select className="filter-select" value={signalFilter} onChange={(e) => setSignalFilter(e.target.value)}>
            <option value="all">All signals</option>
            <option value="open_round">Raising</option>
            <option value="recent_launch">Recently launched</option>
            <option value="hiring">Hiring</option>
            <option value="yc_backed">YC-backed</option>
            <option value="phd_founder">PhD founder</option>
            <option value="sec_filing">SEC filing</option>
            <option value="research_paper">Research paper</option>
            <option value="has_patent">Has patent</option>
            <option value="recently_founded">Founded ≤2yr</option>
          </select>

          <button
            className={`toggle-btn${openRoundOnly ? " active" : ""}`}
            onClick={() => setOpenRoundOnly((v) => !v)}
          >
            <span className="toggle-dot" />
            Open rounds
          </button>

          {(search || subsectorFilter !== "all" || stageFilter !== "all" || openRoundOnly || signalFilter !== "all") && (
            <button className="refresh-btn" onClick={() => {
              setSearch(""); setSubsectorFilter("all"); setStageFilter("all");
              setOpenRoundOnly(false); setSignalFilter("all");
            }}>
              ✕ clear
            </button>
          )}

          <span className="filter-count">{filtered.length} results</span>
        </div>
      )}

      {/* ── MAIN ── */}
      <main className="main">
        {viewMode === "hot25" ? (
          <Hot25 companies={companies} />
        ) : isLoading ? (
          <div>
            <div className="scanning-banner">
              SCANNING · {SOURCES_SCANNED.join(" · ")}
            </div>
            <div className="loading-grid">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="skeleton-card" style={{ animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">◈</div>
            <div className="empty-title">
              {companies.length === 0 ? "No companies found yet" : "No results match your filters"}
            </div>
            <div className="empty-sub">
              {companies.length === 0
                ? "Click ↻ rescan to begin scanning all 9 sources including SEC EDGAR Form D and arXiv."
                : "Try adjusting your search or removing filters."}
            </div>
          </div>
        ) : (
          grouped.map(([sector, sectorCompanies]) => (
            <section key={sector} className="sector-section">
              <div className="sector-header">
                <span
                  className="sector-name"
                  style={{ color: SUBSECTOR_COLORS[sector]?.text || "var(--text-2)" }}
                >
                  {sector}
                </span>
                <span className="sector-count">{sectorCompanies.length}</span>
                <div className="sector-line" />
                {sectorCompanies.some((c) => c.open_round) && (
                  <span className="sector-raising-count">
                    {sectorCompanies.filter((c) => c.open_round).length} raising
                  </span>
                )}
              </div>
              <div className="company-grid">
                {sectorCompanies.map((company) => (
                  <CompanyCard key={company.id} company={company} />
                ))}
              </div>
            </section>
          ))
        )}
      </main>

      {/* ── FOOTER ── */}
      <footer className="footer">
        <span>DEEPTECH RADAR · {SOURCES_SCANNED.join(" · ")}</span>
        <span>Powered by Gemini AI · SEC EDGAR · arXiv</span>
      </footer>
    </>
  );
}
