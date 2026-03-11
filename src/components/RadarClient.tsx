"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { Company, ScrapeRun } from "@/types";
import {
  SUBSECTORS, SUBSECTOR_COLORS, SOURCE_LABELS, SIGNAL_META,
  computeConfidence, computeScoreBreakdown,
} from "@/types";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

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

function isNew(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 48 * 60 * 60 * 1000;
}

function stageLabel(s: string | null): string {
  if (!s) return "";
  const map: Record<string, string> = {
    "pre-seed": "PRE-SEED", seed: "SEED",
    "series-a": "SER-A", "series-b": "SER-B", "series-c": "SER-C",
  };
  return map[s.toLowerCase()] || s.toUpperCase();
}

function formatMoney(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

function scoreColor(n: number): string {
  if (n >= 70) return "#34d399";
  if (n >= 45) return "#60a5fa";
  if (n >= 25) return "#facc15";
  return "#6b7280";
}

function confidenceLabel(n: number): string {
  if (n >= 80) return "High";
  if (n >= 50) return "Medium";
  return "Low";
}

function exportCSV(companies: Company[]) {
  const headers = [
    "Name", "Subsector", "Description", "Funding Stage", "Funding Amount",
    "Open Round", "Traction Score", "Signals", "Sources", "Website",
    "GitHub", "LinkedIn", "Founded Year", "Hiring Velocity", "Patent Count",
    "SEC Filing Amount", "Source URL",
  ];
  const rows = companies.map((c) => [
    c.name,
    c.subsector || "",
    (c.description || "").replace(/"/g, '""'),
    c.funding_stage || "",
    c.funding_amount || "",
    c.open_round ? "Yes" : "No",
    c.traction_score,
    (c.signals || []).join(";"),
    (c.sources || []).join(";"),
    c.website_url || "",
    c.github_url || "",
    c.linkedin_url || "",
    c.founded_year || "",
    c.hiring_velocity || "",
    c.patent_count || "",
    c.sec_filing_amount ? formatMoney(c.sec_filing_amount) : "",
    c.source_url || "",
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `deeptech-radar-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE RING (SVG)
// ─────────────────────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 48 }: { score: number; size?: number }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = scoreColor(score);
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={5} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={5}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={circ / 4}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
      <text x="50%" y="50%" textAnchor="middle" dy="0.35em"
        style={{ fill: color, fontSize: size * 0.28, fontFamily: "JetBrains Mono, monospace", fontWeight: 600 }}>
        {score}
      </text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE DOTS
// ─────────────────────────────────────────────────────────────────────────────

function ConfidenceDots({ score }: { score: number }) {
  const filled = Math.round((score / 100) * 5);
  return (
    <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={{
          width: 5, height: 5, borderRadius: "50%",
          background: i < filled ? scoreColor(score) : "rgba(255,255,255,0.12)",
        }} />
      ))}
      <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 4 }}>
        {confidenceLabel(score)}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE BREAKDOWN TOOLTIP
// ─────────────────────────────────────────────────────────────────────────────

function ScoreBreakdown({ company, onClose }: { company: Company; onClose: () => void }) {
  const bd = computeScoreBreakdown(company);
  const dims = [
    { label: "Fundraising", value: bd.fundraising, max: 35, color: "#34d399" },
    { label: "Team Quality", value: bd.team, max: 25, color: "#60a5fa" },
    { label: "Activity",     value: bd.activity, max: 25, color: "#facc15" },
    { label: "Data Richness",value: bd.richness, max: 15, color: "#fb923c" },
  ];
  return (
    <div style={{
      position: "absolute", top: "100%", right: 0, zIndex: 100,
      background: "#111318", border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: 10, padding: "16px 18px", width: 240,
      boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
    }} onClick={(e) => e.stopPropagation()}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12, letterSpacing: "0.08em" }}>
        SCORE BREAKDOWN · {company.traction_score}/100
      </div>
      {dims.map((d) => (
        <div key={d.label} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
            <span style={{ color: "var(--text-2)" }}>{d.label}</span>
            <span style={{ color: d.color, fontFamily: "JetBrains Mono, monospace" }}>{d.value}/{d.max}</span>
          </div>
          <div style={{ height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2 }}>
            <div style={{ height: "100%", width: `${(d.value / d.max) * 100}%`, background: d.color, borderRadius: 2, transition: "width 0.4s ease" }} />
          </div>
        </div>
      ))}
      <button onClick={onClose} style={{
        marginTop: 8, fontSize: 10, color: "var(--text-muted)", background: "none",
        border: "none", cursor: "pointer", padding: 0,
      }}>close ✕</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY CARD
// ─────────────────────────────────────────────────────────────────────────────

function CompanyCard({
  company, rank, isWatched, onToggleWatch, onClick,
}: {
  company: Company;
  rank?: number;
  isWatched: boolean;
  onToggleWatch: (id: string) => void;
  onClick: (c: Company) => void;
}) {
  const [showScore, setShowScore] = useState(false);
  const sectorColor = SUBSECTOR_COLORS[company.subsector || ""] || {
    bg: "rgba(255,255,255,0.04)", text: "#8496ae", border: "rgba(255,255,255,0.1)",
  };
  const confidence = computeConfidence(company);
  const primaryFounder = company.founders?.[0] || null;
  const displaySignals = (company.signals || []).filter((s) => s !== "open_round").slice(0, 3);
  const fresh = isNew(company.created_at || company.last_seen);

  return (
    <div
      className={`company-card${company.open_round ? " raising" : ""}`}
      onClick={() => onClick(company)}
      style={{ cursor: "pointer", position: "relative" }}
    >
      {/* Rank badge */}
      {rank && rank <= 25 && (
        <div className="card-rank">#{rank}</div>
      )}

      {/* Top row */}
      <div className="card-top">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          {fresh && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
              background: "rgba(52,211,153,0.15)", color: "#34d399",
              border: "1px solid rgba(52,211,153,0.3)", borderRadius: 4,
              padding: "1px 5px", flexShrink: 0,
            }}>NEW</span>
          )}
          <div className="company-name" style={{ flex: 1, minWidth: 0 }}>{company.name}</div>
          {company.open_round && (
            <div className="raising-badge">
              <span className="raising-dot" />RAISING
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {/* Watch button */}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleWatch(company.id); }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 14, color: isWatched ? "#facc15" : "rgba(255,255,255,0.25)",
              padding: "2px 4px", lineHeight: 1,
            }}
            title={isWatched ? "Remove from watchlist" : "Add to watchlist"}
          >
            {isWatched ? "★" : "☆"}
          </button>
          {/* Score ring with breakdown toggle */}
          <div style={{ position: "relative" }}>
            <div
              onClick={(e) => { e.stopPropagation(); setShowScore((v) => !v); }}
              title="Click for score breakdown"
              style={{ cursor: "pointer" }}
            >
              <ScoreRing score={company.traction_score} size={44} />
            </div>
            {showScore && (
              <ScoreBreakdown company={company} onClose={() => setShowScore(false)} />
            )}
          </div>
        </div>
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
        {company.sec_filing_amount && company.sec_filing_amount > 0 && (
          <span className="tag" style={{ background: "rgba(234,179,8,0.1)", color: "#eab308", borderColor: "rgba(234,179,8,0.3)" }}>
            SEC {formatMoney(company.sec_filing_amount)}
          </span>
        )}
      </div>

      {/* Signal chips */}
      {displaySignals.length > 0 && (
        <div className="signal-chips">
          {displaySignals.map((sig) => {
            const meta = SIGNAL_META[sig];
            if (!meta) return null;
            return (
              <span key={sig} className="signal-chip" style={{ color: meta.color, borderColor: `${meta.color}30`, background: `${meta.color}0e` }}>
                {meta.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Enrichment metrics */}
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

          <div className="source-links" style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
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
              <a href={company.website_url} target="_blank" rel="noopener noreferrer" className="link-btn" onClick={(e) => e.stopPropagation()}>↗</a>
            )}
            {company.github_url && (
              <a href={company.github_url} target="_blank" rel="noopener noreferrer" className="link-btn" onClick={(e) => e.stopPropagation()}>GH</a>
            )}
            {company.linkedin_url && (
              <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer" className="link-btn" onClick={(e) => e.stopPropagation()}>LI</a>
            )}
          </div>
        </div>

        <ConfidenceDots score={confidence} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY DETAIL PANEL
// ─────────────────────────────────────────────────────────────────────────────

function CompanyDetailPanel({
  company, isWatched, onToggleWatch, onClose,
}: {
  company: Company;
  isWatched: boolean;
  onToggleWatch: (id: string) => void;
  onClose: () => void;
}) {
  const confidence = computeConfidence(company);
  const bd = computeScoreBreakdown(company);
  const sectorColor = SUBSECTOR_COLORS[company.subsector || ""] || {
    bg: "rgba(255,255,255,0.04)", text: "#8496ae", border: "rgba(255,255,255,0.1)",
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const dims = [
    { label: "Fundraising", value: bd.fundraising, max: 35, color: "#34d399" },
    { label: "Team Quality", value: bd.team, max: 25, color: "#60a5fa" },
    { label: "Activity", value: bd.activity, max: 25, color: "#facc15" },
    { label: "Data Richness", value: bd.richness, max: 15, color: "#fb923c" },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(2px)", zIndex: 200,
        }}
      />
      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "min(560px, 100vw)",
        background: "#0d0f14", borderLeft: "1px solid rgba(255,255,255,0.08)",
        zIndex: 201, overflowY: "auto", display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          padding: "24px 28px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          position: "sticky", top: 0, background: "#0d0f14", zIndex: 1,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
            <ScoreRing score={company.traction_score} size={56} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text-1)", lineHeight: 1.3 }}>
                  {company.name}
                </h2>
                {company.open_round && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                    background: "rgba(52,211,153,0.15)", color: "#34d399",
                    border: "1px solid rgba(52,211,153,0.3)", borderRadius: 4, padding: "2px 7px",
                  }}>● RAISING</span>
                )}
              </div>
              {company.subsector && (
                <span style={{
                  display: "inline-block", marginTop: 6, fontSize: 11,
                  background: sectorColor.bg, color: sectorColor.text,
                  border: `1px solid ${sectorColor.border}`, borderRadius: 4, padding: "2px 8px",
                }}>
                  {company.subsector}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button
                onClick={() => onToggleWatch(company.id)}
                style={{
                  background: isWatched ? "rgba(250,204,21,0.12)" : "rgba(255,255,255,0.06)",
                  border: `1px solid ${isWatched ? "rgba(250,204,21,0.3)" : "rgba(255,255,255,0.1)"}`,
                  color: isWatched ? "#facc15" : "var(--text-muted)",
                  borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 12,
                }}
              >
                {isWatched ? "★ Watching" : "☆ Watch"}
              </button>
              <button
                onClick={onClose}
                style={{
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                  color: "var(--text-muted)", borderRadius: 6, padding: "6px 10px", cursor: "pointer",
                }}
              >✕</button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "24px 28px", flex: 1 }}>

          {/* Description */}
          {company.description && (
            <section style={{ marginBottom: 24 }}>
              <div className="detail-section-label">OVERVIEW</div>
              <p style={{ margin: 0, fontSize: 14, color: "var(--text-2)", lineHeight: 1.7 }}>
                {company.description}
              </p>
            </section>
          )}

          {/* Funding info */}
          {(company.funding_stage || company.funding_amount || company.sec_filing_amount) && (
            <section style={{ marginBottom: 24 }}>
              <div className="detail-section-label">FUNDING</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {company.funding_stage && (
                  <div className="detail-stat">
                    <div className="detail-stat-val">{stageLabel(company.funding_stage)}</div>
                    <div className="detail-stat-label">Stage</div>
                  </div>
                )}
                {company.funding_amount && (
                  <div className="detail-stat">
                    <div className="detail-stat-val">{company.funding_amount}</div>
                    <div className="detail-stat-label">Raised</div>
                  </div>
                )}
                {company.sec_filing_amount && company.sec_filing_amount > 0 && (
                  <div className="detail-stat">
                    <div className="detail-stat-val" style={{ color: "#eab308" }}>{formatMoney(company.sec_filing_amount)}</div>
                    <div className="detail-stat-label">SEC Disclosed</div>
                  </div>
                )}
                {company.founded_year && (
                  <div className="detail-stat">
                    <div className="detail-stat-val">{company.founded_year}</div>
                    <div className="detail-stat-label">Founded</div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Traction score breakdown */}
          <section style={{ marginBottom: 24 }}>
            <div className="detail-section-label">TRACTION INTELLIGENCE · {company.traction_score}/100</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {dims.map((d) => (
                <div key={d.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                    <span style={{ color: "var(--text-2)" }}>{d.label}</span>
                    <span style={{ color: d.color, fontFamily: "JetBrains Mono, monospace", fontSize: 11 }}>{d.value}/{d.max}</span>
                  </div>
                  <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
                    <div style={{ height: "100%", width: `${(d.value / d.max) * 100}%`, background: d.color, borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Profile confidence:</span>
              <ConfidenceDots score={confidence} />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{confidence}%</span>
            </div>
          </section>

          {/* Signals */}
          {(company.signals || []).length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <div className="detail-section-label">SIGNALS DETECTED</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {(company.signals || []).map((sig) => {
                  const meta = SIGNAL_META[sig];
                  if (!meta) return null;
                  return (
                    <div key={sig} style={{
                      background: `${meta.color}10`, border: `1px solid ${meta.color}30`,
                      borderRadius: 6, padding: "6px 10px",
                    }}>
                      <div style={{ fontSize: 11, color: meta.color, fontWeight: 600 }}>{meta.label}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{meta.description}</div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Founders */}
          {(company.founders || []).length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <div className="detail-section-label">TEAM ({company.founders.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {company.founders.map((f, i) => (
                  <div key={i} style={{
                    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: 8, padding: "12px 14px",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{f.name}</span>
                      {f.role && <span style={{ fontSize: 11, color: "var(--text-muted)", background: "rgba(255,255,255,0.06)", borderRadius: 4, padding: "1px 7px" }}>{f.role}</span>}
                    </div>
                    {f.background && (
                      <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 6 }}>{f.background}</div>
                    )}
                    {(f.linkedin || f.twitter) && (
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        {f.linkedin && <a href={f.linkedin} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#0a66c2" }}>LinkedIn ↗</a>}
                        {f.twitter && <a href={f.twitter} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#e7e9ea" }}>X/Twitter ↗</a>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Metrics */}
          {(company.hiring_velocity || company.patent_count || company.arxiv_papers) && (
            <section style={{ marginBottom: 24 }}>
              <div className="detail-section-label">VELOCITY METRICS</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {company.hiring_velocity && (
                  <div className="detail-stat">
                    <div className="detail-stat-val" style={{ color: "#a78bfa" }}>{company.hiring_velocity}</div>
                    <div className="detail-stat-label">Open Roles</div>
                  </div>
                )}
                {company.patent_count && (
                  <div className="detail-stat">
                    <div className="detail-stat-val" style={{ color: "#60a5fa" }}>{company.patent_count}</div>
                    <div className="detail-stat-label">Patents</div>
                  </div>
                )}
                {company.arxiv_papers && (
                  <div className="detail-stat">
                    <div className="detail-stat-val" style={{ color: "#b45309" }}>{company.arxiv_papers}</div>
                    <div className="detail-stat-label">Publications</div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Intelligence sources */}
          <section style={{ marginBottom: 24 }}>
            <div className="detail-section-label">INTELLIGENCE SOURCES</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {(company.sources || []).map((src) => {
                const meta = SOURCE_LABELS[src];
                if (!meta) return null;
                return (
                  <span key={src} style={{
                    background: `${meta.color}14`, color: meta.color,
                    border: `1px solid ${meta.color}30`, borderRadius: 6, padding: "5px 10px",
                    fontSize: 11, fontWeight: 600,
                  }}>{meta.label}</span>
                );
              })}
            </div>
            {company.source_url && (
              <a href={company.source_url} target="_blank" rel="noopener noreferrer"
                style={{ display: "inline-block", marginTop: 10, fontSize: 11, color: "var(--text-muted)", textDecoration: "underline" }}>
                View primary source ↗
              </a>
            )}
          </section>

          {/* Links */}
          <section style={{ marginBottom: 24 }}>
            <div className="detail-section-label">LINKS</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {company.website_url && (
                <a href={company.website_url} target="_blank" rel="noopener noreferrer" className="detail-link-btn">
                  🌐 Website
                </a>
              )}
              {company.github_url && (
                <a href={company.github_url} target="_blank" rel="noopener noreferrer" className="detail-link-btn">
                  GitHub
                </a>
              )}
              {company.linkedin_url && (
                <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer" className="detail-link-btn">
                  LinkedIn
                </a>
              )}
              {company.twitter_url && (
                <a href={company.twitter_url} target="_blank" rel="noopener noreferrer" className="detail-link-btn">
                  X/Twitter
                </a>
              )}
            </div>
          </section>

          {/* Last seen */}
          <div style={{ fontSize: 11, color: "var(--text-muted)", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 14 }}>
            Last detected {timeAgo(company.last_seen)} · First added {timeAgo(company.created_at)}
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HOT 25
// ─────────────────────────────────────────────────────────────────────────────

function Hot25({ companies, isWatched, onToggleWatch, onSelect }: {
  companies: Company[];
  isWatched: (id: string) => boolean;
  onToggleWatch: (id: string) => void;
  onSelect: (c: Company) => void;
}) {
  const top25 = useMemo(
    () => [...companies].sort((a, b) => b.traction_score - a.traction_score).slice(0, 25),
    [companies]
  );
  if (top25.length === 0) return null;

  return (
    <section className="hot25-section">
      <div className="hot25-header">
        <span className="hot25-title">RADAR HOT {Math.min(top25.length, 25)}</span>
        <span className="hot25-sub">Highest-traction deeptech companies this cycle</span>
      </div>
      <div className="hot25-list">
        {top25.map((c, i) => (
          <div key={c.id} className="hot25-row" onClick={() => onSelect(c)} style={{ cursor: "pointer" }}>
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
              {c.signals?.includes("sbir_grant") && <span className="hot25-badge" style={{ background: "rgba(168,85,247,0.15)", color: "#a855f7", borderColor: "rgba(168,85,247,0.3)" }}>GRANT</span>}
              {c.signals?.includes("hiring") && <span className="hot25-badge hiring">HIRING</span>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleWatch(c.id); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: isWatched(c.id) ? "#facc15" : "rgba(255,255,255,0.2)", fontSize: 13 }}
              >
                {isWatched(c.id) ? "★" : "☆"}
              </button>
              <span className={`hot25-score`} style={{ color: scoreColor(c.traction_score), fontFamily: "JetBrains Mono, monospace", fontSize: 14, fontWeight: 700 }}>
                {c.traction_score}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKET INTELLIGENCE VIEW
// ─────────────────────────────────────────────────────────────────────────────

function MarketIntelligence({ companies }: { companies: Company[] }) {
  const subsectorCounts = useMemo(() => {
    const map: Record<string, { count: number; raising: number; avgScore: number }> = {};
    for (const c of companies) {
      const key = c.subsector || "Other";
      if (!map[key]) map[key] = { count: 0, raising: 0, avgScore: 0 };
      map[key].count++;
      if (c.open_round) map[key].raising++;
      map[key].avgScore += c.traction_score;
    }
    for (const key in map) map[key].avgScore = Math.round(map[key].avgScore / map[key].count);
    return Object.entries(map).sort((a, b) => b[1].count - a[1].count);
  }, [companies]);

  const signalCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of companies) {
      for (const sig of (c.signals || [])) {
        map[sig] = (map[sig] || 0) + 1;
      }
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [companies]);

  const sourceCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of companies) {
      for (const src of (c.sources || [])) {
        map[src] = (map[src] || 0) + 1;
      }
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [companies]);

  const stageDist = useMemo(() => {
    const map: Record<string, number> = { "pre-seed": 0, seed: 0, "series-a": 0, "series-b+": 0, unknown: 0 };
    for (const c of companies) {
      const stage = c.funding_stage?.toLowerCase() || "";
      if (stage === "pre-seed") map["pre-seed"]++;
      else if (stage === "seed") map.seed++;
      else if (stage === "series-a") map["series-a"]++;
      else if (stage === "series-b" || stage === "series-c") map["series-b+"]++;
      else map.unknown++;
    }
    return Object.entries(map).filter(([, v]) => v > 0);
  }, [companies]);

  const maxCount = Math.max(...subsectorCounts.map(([, v]) => v.count), 1);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20, padding: "0 0 40px" }}>

      {/* Subsector breakdown */}
      <section style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "20px 22px" }}>
        <div className="detail-section-label" style={{ marginBottom: 16 }}>SUBSECTOR BREAKDOWN</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {subsectorCounts.map(([sector, stats]) => {
            const color = SUBSECTOR_COLORS[sector]?.text || "#8496ae";
            return (
              <div key={sector}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                  <span style={{ color: "var(--text-2)", maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sector}</span>
                  <div style={{ display: "flex", gap: 10, color: "var(--text-muted)" }}>
                    {stats.raising > 0 && <span style={{ color: "#34d399" }}>●{stats.raising}</span>}
                    <span style={{ color }}>{stats.count}</span>
                  </div>
                </div>
                <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
                  <div style={{ height: "100%", width: `${(stats.count / maxCount) * 100}%`, background: color, borderRadius: 3, opacity: 0.8 }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Signal intelligence */}
      <section style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "20px 22px" }}>
        <div className="detail-section-label" style={{ marginBottom: 16 }}>SIGNAL FREQUENCY</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {signalCounts.map(([sig, count]) => {
            const meta = SIGNAL_META[sig];
            if (!meta) return null;
            const maxSig = signalCounts[0]?.[1] || 1;
            return (
              <div key={sig}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                  <span style={{ color: meta.color }}>{meta.label}</span>
                  <span style={{ color: "var(--text-muted)", fontFamily: "JetBrains Mono, monospace" }}>{count}</span>
                </div>
                <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
                  <div style={{ height: "100%", width: `${(count / maxSig) * 100}%`, background: meta.color, borderRadius: 2, opacity: 0.7 }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Source intelligence */}
      <section style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "20px 22px" }}>
        <div className="detail-section-label" style={{ marginBottom: 16 }}>SOURCE INTELLIGENCE</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sourceCounts.map(([src, count]) => {
            const meta = SOURCE_LABELS[src];
            if (!meta) return null;
            const maxSrc = sourceCounts[0]?.[1] || 1;
            return (
              <div key={src}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                  <span style={{ color: meta.color }}>{meta.label}</span>
                  <span style={{ color: "var(--text-muted)", fontFamily: "JetBrains Mono, monospace" }}>{count}</span>
                </div>
                <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
                  <div style={{ height: "100%", width: `${(count / maxSrc) * 100}%`, background: meta.color, borderRadius: 2, opacity: 0.7 }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Funding stage distribution */}
      <section style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "20px 22px" }}>
        <div className="detail-section-label" style={{ marginBottom: 16 }}>FUNDING STAGE DISTRIBUTION</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {stageDist.map(([stage, count]) => (
            <div key={stage} style={{
              flex: 1, minWidth: 80, textAlign: "center",
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8, padding: "14px 10px",
            }}>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", color: "var(--text-1)" }}>{count}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.07em" }}>{stage}</div>
            </div>
          ))}
        </div>

        {/* Key stats */}
        <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[
            { label: "Avg Traction Score", value: companies.length ? Math.round(companies.reduce((s, c) => s + c.traction_score, 0) / companies.length) : 0, color: "#60a5fa" },
            { label: "Open Rounds", value: companies.filter(c => c.open_round).length, color: "#34d399" },
            { label: "Multi-Source", value: companies.filter(c => (c.sources || []).length > 1).length, color: "#facc15" },
            { label: "With Patents", value: companies.filter(c => c.signals?.includes("has_patent")).length, color: "#f472b6" },
          ].map((stat) => (
            <div key={stat.label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", color: stat.color }}>{stat.value}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

type ViewMode = "directory" | "raising" | "hot25" | "market" | "saved";
type SortMode = "traction" | "recent" | "new" | "funding";

interface Props {
  initialCompanies: Company[];
  lastRun: ScrapeRun | null;
}

const SOURCES_SCANNED = [
  "HN", "GitHub", "Product Hunt", "TechCrunch", "YC",
  "SBIR/STTR", "bioRxiv", "LinkedIn", "Crunchbase", "Wellfound",
  "SEC EDGAR", "arXiv",
];

export default function RadarClient({ initialCompanies, lastRun }: Props) {
  const [companies, setCompanies] = useState<Company[]>(initialCompanies);
  const [search, setSearch] = useState("");
  const [subsectorFilter, setSubsectorFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [openRoundOnly, setOpenRoundOnly] = useState(false);
  const [signalFilter, setSignalFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [minScore, setMinScore] = useState(0);
  const [sortMode, setSortMode] = useState<SortMode>("traction");
  const [viewMode, setViewMode] = useState<ViewMode>("directory");
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState(lastRun?.status || "idle");
  const [refreshTime, setRefreshTime] = useState<string | null>(
    lastRun?.completed_at || lastRun?.started_at || null
  );
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  // Load watchlist from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("dtr_watchlist");
      if (saved) setWatchlist(new Set(JSON.parse(saved)));
    } catch { /* ignore */ }
  }, []);

  // Persist watchlist
  const toggleWatch = useCallback((id: string) => {
    setWatchlist((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem("dtr_watchlist", JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Always fetch latest on mount
  useEffect(() => {
    async function loadCompanies() {
      try {
        const r = await fetch("/api/companies?limit=500");
        if (r.ok) {
          const { companies: fresh } = await r.json();
          if (fresh?.length) setCompanies(fresh);
        }
      } catch { /* ignore */ }
    }
    loadCompanies();
  }, []);

  const triggerScrape = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    setScanStatus("running");
    try {
      const res = await fetch("/api/scrape", { method: "POST" });
      const data = await res.json();
      const r2 = await fetch("/api/companies?limit=500");
      if (r2.ok) {
        const { companies: fresh } = await r2.json();
        if (fresh?.length) setCompanies(fresh);
      }
      setRefreshTime(new Date().toISOString());
      setScanStatus(data.success ? "completed" : "completed");
    } catch {
      setScanStatus("failed");
    } finally {
      setScanning(false);
    }
  }, [scanning]);

  // ── FILTERING + SORTING ─────────────────────────────────────────────────────
  const baseCompanies = useMemo(() => {
    if (viewMode === "saved") return companies.filter((c) => watchlist.has(c.id));
    if (viewMode === "raising") return companies.filter((c) => c.open_round);
    return companies;
  }, [companies, viewMode, watchlist]);

  const filtered = useMemo(() => {
    return baseCompanies.filter((c) => {
      if (minScore > 0 && c.traction_score < minScore) return false;
      if (stageFilter !== "all" && c.funding_stage !== stageFilter) return false;
      if (subsectorFilter !== "all" && c.subsector !== subsectorFilter) return false;
      if (signalFilter !== "all" && !(c.signals || []).includes(signalFilter)) return false;
      if (sourceFilter !== "all" && !(c.sources || []).includes(sourceFilter)) return false;
      if (search.trim()) {
        const term = search.toLowerCase();
        const blob = [
          c.name, c.description,
          ...(c.founders || []).map((f) => f.name),
          c.subsector,
          ...(c.signals || []),
        ].filter(Boolean).join(" ").toLowerCase();
        if (!blob.includes(term)) return false;
      }
      return true;
    });
  }, [baseCompanies, search, subsectorFilter, stageFilter, signalFilter, sourceFilter, minScore]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortMode === "traction") return b.traction_score - a.traction_score;
      if (sortMode === "recent") return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime();
      if (sortMode === "new") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortMode === "funding") {
        const aAmt = a.sec_filing_amount || 0;
        const bAmt = b.sec_filing_amount || 0;
        return bAmt - aAmt || b.traction_score - a.traction_score;
      }
      return 0;
    });
  }, [filtered, sortMode]);

  // ── GROUP BY SUBSECTOR (directory only) ────────────────────────────────────
  const grouped = useMemo((): [string, Company[]][] => {
    if (sortMode !== "traction") return [["All", sorted]];
    const map = new Map<string, Company[]>();
    for (const c of sorted) {
      const key = c.subsector || "Other";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    const result: [string, Company[]][] = [];
    for (const sector of SUBSECTORS) {
      if (map.has(sector)) result.push([sector, map.get(sector)!]);
    }
    for (const [k, v] of Array.from(map.entries())) {
      if (!result.find(([s]) => s === k)) result.push([k, v]);
    }
    return result;
  }, [sorted, sortMode]);

  const stats = useMemo(() => ({
    total: companies.length,
    openRounds: companies.filter((c) => c.open_round).length,
    subsectors: new Set(companies.map((c) => c.subsector).filter(Boolean)).size,
    newToday: companies.filter((c) => isNew(c.created_at || c.last_seen)).length,
    grants: companies.filter((c) => (c.signals || []).includes("sbir_grant")).length,
  }), [companies]);

  const availableStages = useMemo(() => {
    const s = new Set(companies.map((c) => c.funding_stage).filter(Boolean) as string[]);
    return Array.from(s).sort();
  }, [companies]);

  const availableSources = useMemo(() => {
    const s = new Set(companies.flatMap((c) => c.sources || []));
    return Array.from(s).sort();
  }, [companies]);

  const isLoading = companies.length === 0 && scanning;
  const hasFilters = search || subsectorFilter !== "all" || stageFilter !== "all" ||
    signalFilter !== "all" || sourceFilter !== "all" || openRoundOnly || minScore > 0;

  const clearFilters = () => {
    setSearch(""); setSubsectorFilter("all"); setStageFilter("all");
    setSignalFilter("all"); setSourceFilter("all"); setOpenRoundOnly(false); setMinScore(0);
  };

  return (
    <>
      {/* ── HEADER ── */}
      <header className="header">
        <div className="logo">
          <span className="logo-text">Deep<span className="logo-accent">Tech</span> Radar</span>
          <span className="logo-sub">Founder &amp; startup intelligence</span>
        </div>

        <div className="header-center">
          {(["directory", "raising", "hot25", "market", "saved"] as ViewMode[]).map((v) => (
            <button
              key={v}
              className={`view-tab${viewMode === v ? " active" : ""}`}
              onClick={() => setViewMode(v)}
            >
              {v === "directory" && "DIRECTORY"}
              {v === "raising" && `RAISING ${stats.openRounds}`}
              {v === "hot25" && `HOT ${Math.min(companies.length, 25)}`}
              {v === "market" && "MARKET"}
              {v === "saved" && `★ ${watchlist.size}`}
            </button>
          ))}
        </div>

        <div className="header-right">
          {refreshTime && <span style={{ fontSize: 11 }}>{timeAgo(refreshTime)}</span>}
          <div className="status-pill">
            <span className={`status-dot${scanning ? " scanning" : scanStatus === "completed" ? "" : " idle"}`} />
            {scanning ? "scanning" : scanStatus === "completed" ? "live" : "idle"}
          </div>
          <button
            className="refresh-btn"
            onClick={() => exportCSV(sorted)}
            title="Export visible companies to CSV"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            ↓ CSV
          </button>
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
          <span className="stat-label">Raising</span>
        </div>
        <div className="stat">
          <span className="stat-value accent">{stats.subsectors}</span>
          <span className="stat-label">Subsectors</span>
        </div>
        <div className="stat">
          <span className="stat-value" style={{ color: "#eab308" }}>
            {companies.filter(c => c.signals?.includes("sec_filing")).length}
          </span>
          <span className="stat-label">SEC Filings</span>
        </div>
        <div className="stat">
          <span className="stat-value" style={{ color: "#a855f7" }}>{stats.grants}</span>
          <span className="stat-label">Gov Grants</span>
        </div>
        <div className="stat">
          <span className="stat-value" style={{ color: "#34d399" }}>{stats.newToday}</span>
          <span className="stat-label">New (48h)</span>
        </div>
        <div className="stat" style={{ marginLeft: "auto", borderRight: "none" }}>
          <span className="stat-value">{SOURCES_SCANNED.length}</span>
          <span className="stat-label">Sources</span>
        </div>
      </div>

      {/* ── SOURCES BAR ── */}
      <div className="sources-bar">
        <span className="sources-label">Scanning:</span>
        {SOURCES_SCANNED.map((s) => (
          <span key={s} className="source-pill">{s}</span>
        ))}
      </div>

      {/* ── FILTER BAR ── */}
      {(viewMode === "directory" || viewMode === "raising" || viewMode === "saved") && (
        <div className="filter-bar">
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input
              ref={searchRef}
              className="search-input"
              type="text"
              placeholder="Search companies, founders, signals..."
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
            {availableStages.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <select className="filter-select" value={signalFilter} onChange={(e) => setSignalFilter(e.target.value)}>
            <option value="all">All signals</option>
            <option value="open_round">Raising</option>
            <option value="sec_filing">SEC Filing</option>
            <option value="sbir_grant">Gov Grant</option>
            <option value="yc_backed">YC-backed</option>
            <option value="recent_launch">Recently launched</option>
            <option value="hiring">Hiring</option>
            <option value="phd_founder">PhD team</option>
            <option value="has_patent">Has patent</option>
            <option value="research_paper">Research paper</option>
            <option value="recently_founded">Founded ≤2yr</option>
            <option value="high_engagement">Trending</option>
          </select>

          <select className="filter-select" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
            <option value="all">All sources</option>
            {availableSources.map((s) => {
              const meta = SOURCE_LABELS[s];
              return <option key={s} value={s}>{meta?.label || s}</option>;
            })}
          </select>

          <select className="filter-select" value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
            <option value="traction">Sort: Traction</option>
            <option value="recent">Sort: Recent signal</option>
            <option value="new">Sort: Newly added</option>
            <option value="funding">Sort: Funding amount</option>
          </select>

          {minScore > 0 ? (
            <button className="toggle-btn active" onClick={() => setMinScore(0)}>
              <span className="toggle-dot" />Score ≥{minScore}
            </button>
          ) : (
            <button className="toggle-btn" onClick={() => setMinScore(40)} title="Show only score ≥ 40">
              <span className="toggle-dot" />Score ≥40
            </button>
          )}

          <button
            className={`toggle-btn${openRoundOnly ? " active" : ""}`}
            onClick={() => setOpenRoundOnly((v) => !v)}
          >
            <span className="toggle-dot" />Open rounds
          </button>

          {hasFilters && (
            <button className="refresh-btn" onClick={clearFilters}>✕ clear</button>
          )}

          <span className="filter-count">{sorted.length} results</span>
        </div>
      )}

      {/* ── MAIN ── */}
      <main className="main">
        {viewMode === "hot25" ? (
          <Hot25
            companies={companies}
            isWatched={(id) => watchlist.has(id)}
            onToggleWatch={toggleWatch}
            onSelect={setSelectedCompany}
          />
        ) : viewMode === "market" ? (
          <MarketIntelligence companies={companies} />
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
        ) : sorted.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">◈</div>
            <div className="empty-title">
              {companies.length === 0
                ? "No companies found yet"
                : viewMode === "saved"
                ? "No companies in watchlist"
                : "No results match your filters"}
            </div>
            <div className="empty-sub">
              {companies.length === 0
                ? "Click ↻ rescan to begin scanning all 12 sources including SEC EDGAR, SBIR grants, and arXiv."
                : viewMode === "saved"
                ? "Click ☆ on any company card to add it to your watchlist."
                : "Try adjusting your search or removing filters."}
            </div>
          </div>
        ) : sortMode !== "traction" || viewMode === "raising" || viewMode === "saved" ? (
          // Flat list for non-traction sorts
          <div className="company-grid" style={{ padding: "8px 0 40px" }}>
            {sorted.map((company, i) => (
              <CompanyCard
                key={company.id}
                company={company}
                rank={sortMode === "traction" ? i + 1 : undefined}
                isWatched={watchlist.has(company.id)}
                onToggleWatch={toggleWatch}
                onClick={setSelectedCompany}
              />
            ))}
          </div>
        ) : (
          // Grouped by subsector
          grouped.map(([sector, sectorCompanies]) => (
            <section key={sector} className="sector-section">
              <div className="sector-header">
                <span className="sector-name" style={{ color: SUBSECTOR_COLORS[sector]?.text || "var(--text-2)" }}>
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
                  <CompanyCard
                    key={company.id}
                    company={company}
                    isWatched={watchlist.has(company.id)}
                    onToggleWatch={toggleWatch}
                    onClick={setSelectedCompany}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </main>

      {/* ── FOOTER ── */}
      <footer className="footer">
        <span>DEEPTECH RADAR · {SOURCES_SCANNED.join(" · ")}</span>
        <span>Powered by Gemini 2.5 Flash · SEC EDGAR · SBIR/STTR · arXiv</span>
      </footer>

      {/* ── COMPANY DETAIL PANEL ── */}
      {selectedCompany && (
        <CompanyDetailPanel
          company={selectedCompany}
          isWatched={watchlist.has(selectedCompany.id)}
          onToggleWatch={toggleWatch}
          onClose={() => setSelectedCompany(null)}
        />
      )}

      {/* ── GLOBAL STYLES ── */}
      <style>{`
        .detail-section-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.12em;
          color: var(--text-muted);
          text-transform: uppercase;
          margin-bottom: 10px;
        }
        .detail-stat {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 8px;
          padding: 10px 14px;
          min-width: 80px;
        }
        .detail-stat-val {
          font-size: 16px;
          font-weight: 700;
          font-family: JetBrains Mono, monospace;
          color: var(--text-1);
        }
        .detail-stat-label {
          font-size: 10px;
          color: var(--text-muted);
          margin-top: 3px;
          text-transform: uppercase;
          letter-spacing: 0.07em;
        }
        .detail-link-btn {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          color: var(--text-2);
          border-radius: 6px;
          padding: 6px 12px;
          font-size: 12px;
          text-decoration: none;
          transition: background 0.15s;
        }
        .detail-link-btn:hover {
          background: rgba(255,255,255,0.1);
          color: var(--text-1);
        }
      `}</style>
    </>
  );
}
