import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CalendarDays,
  Download,
  FileCheck2,
  FileClock,
  Gauge,
  LogOut,
  Menu,
  PlugZap,
  ReceiptText,
  Search,
  Settings,
  Users,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Overview } from "../api/types";
import { getSessions } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import { formatDate, formatMoney } from "../lib/format";
import { AlertsPage } from "./AlertsPage";
import { AuditPage } from "./AuditPage";
import { SessionDetailPage } from "./SessionDetailPage";
import { SessionsPage } from "./SessionsPage";
import { TariffsPage } from "./TariffsPage";
import { UsersPage } from "./UsersPage";

type AppView = "Overview" | "Sessions" | "Tariffs" | "Alerts" | "Audit" | "Chargers" | "Reports" | "Users" | "Settings";

const alertColors = ["#ff6b78", "#f4b740", "#5aa7ff", "#31d0aa", "#a78bfa"];

const navItems: Array<{ label: AppView; icon: typeof Gauge }> = [
  { label: "Overview", icon: Gauge },
  { label: "Sessions", icon: Activity },
  { label: "Tariffs", icon: ReceiptText },
  { label: "Alerts", icon: ShieldAlert },
  { label: "Audit", icon: FileCheck2 },
  { label: "Chargers", icon: PlugZap },
  { label: "Reports", icon: FileClock },
  { label: "Users", icon: Users },
  { label: "Settings", icon: Settings },
];

const viewTitles: Record<AppView, { eyebrow: string; title: string }> = {
  Overview: { eyebrow: "Operations dashboard", title: "Session validation overview" },
  Sessions: { eyebrow: "Session operations", title: "Charging sessions" },
  Tariffs: { eyebrow: "Pricing control", title: "Tariff version management" },
  Alerts: { eyebrow: "Risk operations", title: "Validation alert board" },
  Audit: { eyebrow: "Daily assurance", title: "Tariff audit report" },
  Chargers: { eyebrow: "Charging network", title: "Charger activity" },
  Reports: { eyebrow: "Data exports", title: "Operational reports" },
  Users: { eyebrow: "Access control", title: "Operators and administrators" },
  Settings: { eyebrow: "Workspace", title: "Runtime configuration" },
};

export function OverviewPage({
  overview,
  date,
  onDateChange,
  operatorName,
  onSignOut,
}: {
  overview: Overview;
  date: string;
  onDateChange: (value: string) => void;
  operatorName: string;
  onSignOut?: () => void;
}) {
  const [path, setPath] = useState(window.location.pathname);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredSessions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return overview.recentSessions;
    return overview.recentSessions.filter((session) =>
      [session.sessionId, session.chargerId, session.userId, session.status].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [overview.recentSessions, query]);

  useEffect(() => {
    const updatePath = () => setPath(window.location.pathname);
    window.addEventListener("popstate", updatePath);
    if (window.location.pathname === "/") {
      window.history.replaceState({}, "", "/overview");
      updatePath();
    }
    return () => window.removeEventListener("popstate", updatePath);
  }, []);

  const detailSessionId = path.startsWith("/sessions/") ? decodeURIComponent(path.split("/")[2] || "") : null;
  const routeView = path.split("/")[1];
  const activeView = (Object.keys(viewTitles).find((view) => view.toLowerCase() === routeView) ?? "Overview") as AppView;
  const alertTotal = overview.topAlertTypes.reduce((total, item) => total + item.value, 0);
  const currentTitle = detailSessionId ? { eyebrow: "Session operations", title: "Session detail" } : viewTitles[activeView];

  function navigate(view: AppView) {
    window.history.pushState({}, "", `/${view.toLowerCase()}`);
    setPath(window.location.pathname);
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openSession(sessionId: string) {
    window.history.pushState({}, "", `/sessions/${encodeURIComponent(sessionId)}`);
    setPath(window.location.pathname);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function exportSessions() {
    const sessions = [];
    let cursor: string | undefined;
    do {
      const page = await getSessions(cursor);
      sessions.push(...page.sessions);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    const header = ["sessionId", "chargerId", "userId", "startedAt", "energyKwh", "total", "status"];
    const rows = sessions.map((session) => [session.sessionId, session.chargerId, session.userId, session.startedAt, session.energyKwh ?? "", session.price?.displayTotal ?? "", session.status]);
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).split('"').join('""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tariffguard-sessions-${date}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-ink text-slate-100">
      <Sidebar className="fixed inset-y-0 left-0 hidden w-60 border-r border-line bg-sidebar lg:flex" activeView={activeView} onNavigate={navigate} />

      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 cursor-default bg-black/70" aria-label="Dismiss navigation" onClick={() => setMobileNavOpen(false)} />
          <Sidebar className="relative flex h-full w-[280px] border-r border-line bg-sidebar shadow-2xl" activeView={activeView} onNavigate={navigate} onClose={() => setMobileNavOpen(false)} />
        </div>
      )}

      <main className="lg:pl-60">
        <header className="sticky top-0 z-30 border-b border-line bg-ink/95 px-4 py-4 backdrop-blur md:px-6 lg:px-8">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <button className="grid h-10 w-10 shrink-0 place-items-center rounded border border-line bg-panel lg:hidden" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={19} /></button>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-mint">{currentTitle.eyebrow}</p>
                <h1 className="truncate text-xl font-semibold md:text-2xl">{currentTitle.title}</h1>
              </div>
            </div>

            <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
              {activeView === "Overview" && !detailSessionId && (
                <div className={`flex h-10 items-center rounded border border-line bg-panel transition-[width] ${searchOpen ? "w-full sm:w-64" : "w-10"}`}>
                  <button className="grid h-10 w-10 shrink-0 place-items-center text-slate-300" aria-label="Search sessions" onClick={() => setSearchOpen((value) => !value)}><Search size={17} /></button>
                  {searchOpen && <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recent sessions" className="min-w-0 flex-1 bg-transparent pr-3 text-sm text-white placeholder:text-slate-500 focus:outline-hidden" />}
                </div>
              )}
              <button onClick={() => navigate("Alerts")} className="relative grid h-10 w-10 place-items-center rounded border border-line bg-panel text-slate-300" aria-label={`${alertTotal} alerts`}><Bell size={17} />{alertTotal > 0 && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-danger ring-2 ring-panel" />}</button>
              <span className="hidden max-w-40 truncate rounded border border-line bg-panel px-3 py-2.5 text-sm font-medium sm:block" title={operatorName}>{operatorName}</span>
              <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded border border-line bg-panel px-3 text-sm text-slate-300 sm:flex-none">
                <CalendarDays size={16} className="shrink-0 text-slate-500" />
                <input className="min-w-0 bg-transparent text-slate-100 outline-hidden [color-scheme:dark]" type="date" value={date} onChange={(event) => onDateChange(event.target.value)} aria-label="Dashboard date" />
              </label>
              <button onClick={exportSessions} aria-label="Export sessions" className="flex h-10 items-center gap-2 rounded bg-mint px-3 text-sm font-semibold text-slate-950"><Download size={16} /><span className="hidden sm:inline">Export</span></button>
              {onSignOut && <button onClick={onSignOut} className="grid h-10 w-10 place-items-center rounded border border-line bg-panel text-slate-300 hover:text-white" aria-label="Sign out"><LogOut size={17} /></button>}
            </div>
          </div>
        </header>

        <section className="mx-auto max-w-[1600px] p-4 md:p-6 lg:p-8">
          {detailSessionId ? (
            <SessionDetailPage sessionId={detailSessionId} onBack={() => navigate("Sessions")} />
          ) : activeView === "Overview" ? (
            <OverviewContent overview={overview} filteredSessions={filteredSessions} query={query} onClearSearch={() => setQuery("")} onOpenSession={openSession} />
          ) : activeView === "Sessions" ? (
            <SessionsPage onOpenSession={openSession} />
          ) : activeView === "Tariffs" ? (
            <TariffsPage />
          ) : activeView === "Alerts" ? (
            <AlertsPage date={date} onOpenSession={openSession} />
          ) : activeView === "Audit" ? (
            <AuditPage date={date} />
          ) : activeView === "Users" ? (
            <UsersPage />
          ) : (
            <AuxiliaryPage view={activeView} overview={overview} onExport={exportSessions} />
          )}
        </section>
      </main>
    </div>
  );
}

function OverviewContent({
  overview,
  filteredSessions,
  query,
  onClearSearch,
  onOpenSession,
}: {
  overview: Overview;
  filteredSessions: Overview["recentSessions"];
  query: string;
  onClearSearch: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const alertTotal = overview.topAlertTypes.reduce((total, item) => total + item.value, 0);
  const validationRate = overview.kpis.sessionsProcessed ? Math.round((overview.kpis.validated / overview.kpis.sessionsProcessed) * 100) : 0;
  const kpis = [
    { label: "Sessions Processed", value: overview.kpis.sessionsProcessed.toLocaleString(), hint: "Completed sessions", icon: Activity, tone: "text-sky bg-sky/10" },
    { label: "Validated", value: overview.kpis.validated.toLocaleString(), hint: `${validationRate}% validation rate`, icon: ShieldCheck, tone: "text-mint bg-mint/10" },
    { label: "Flagged", value: overview.kpis.flagged.toLocaleString(), hint: "Needs operator review", icon: AlertTriangle, tone: "text-amber bg-amber/10" },
    { label: "Rejected", value: overview.kpis.rejected.toLocaleString(), hint: "Invalid source data", icon: X, tone: "text-danger bg-danger/10" },
    { label: "Est. Revenue", value: formatMoney(overview.kpis.estimatedRevenue), hint: "Validated and flagged", icon: ReceiptText, tone: "text-violet-300 bg-violet-400/10" },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map(({ label, value, hint, icon: Icon, tone }) => (
          <article key={label} className="border border-line bg-panel p-4 shadow-panel">
            <div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-slate-400">{label}</p><span className={`grid h-8 w-8 shrink-0 place-items-center rounded ${tone}`}><Icon size={16} /></span></div>
            <p className="mt-4 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-2 text-xs text-slate-500">{hint}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <article className="min-w-0 border border-line bg-panel p-4 shadow-panel md:p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-base font-semibold">Session Validations</h2><p className="mt-1 text-xs text-slate-500">Seven-day processing outcome</p></div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400"><LegendDot color="bg-mint" label="Validated" /><LegendDot color="bg-amber" label="Flagged" /><LegendDot color="bg-danger" label="Rejected" /></div>
          </div>
          <div className="h-72 md:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={overview.validationTrend} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <XAxis dataKey="date" stroke="#64748b" tickLine={false} axisLine={{ stroke: "#273247" }} tick={{ fontSize: 12 }} />
                <YAxis stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ background: "#111827", border: "1px solid #273247", borderRadius: 4, boxShadow: "0 12px 32px rgb(0 0 0 / 30%)" }} />
                <Line isAnimationActive={false} type="monotone" dataKey="validated" stroke="#31d0aa" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                <Line isAnimationActive={false} type="monotone" dataKey="flagged" stroke="#f4b740" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                <Line isAnimationActive={false} type="monotone" dataKey="rejected" stroke="#f87171" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="overflow-hidden border border-line bg-panel shadow-panel">
          <div className="flex items-start justify-between border-b border-line p-5">
            <div><p className="text-[10px] font-semibold uppercase tracking-widest text-amber">Risk signals</p><h2 className="mt-1 text-base font-semibold">Top Alert Types</h2><p className="mt-1 text-xs text-slate-500">Frequency and share of active flags</p></div>
            <span className="rounded bg-danger/10 px-2.5 py-1 text-xs font-semibold text-danger">{alertTotal} total</span>
          </div>
          <div className="grid items-center gap-5 p-5 sm:grid-cols-[170px_1fr] xl:grid-cols-1 2xl:grid-cols-[170px_1fr]">
            <div className="relative h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie isAnimationActive={false} data={overview.topAlertTypes} dataKey="value" nameKey="name" innerRadius={53} outerRadius={78} paddingAngle={3} cornerRadius={7} stroke="#111827" strokeWidth={2}>{overview.topAlertTypes.map((entry, index) => <Cell key={entry.name} fill={alertColors[index % alertColors.length]} />)}</Pie><Tooltip contentStyle={{ background: "#111827", border: "1px solid #273247", borderRadius: 4 }} formatter={(value) => [`${value} signals`, "Count"]} /></PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-content-center text-center"><span className="text-3xl font-semibold tabular-nums">{alertTotal}</span><span className="mt-1 text-[9px] font-semibold uppercase tracking-widest text-slate-500">Total signals</span></div>
            </div>
            <div className="divide-y divide-line">
              {overview.topAlertTypes.map((item, index) => (
                <div key={item.name} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: alertColors[index % alertColors.length] }} />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-300">{item.name.split("_").join(" ")}</span>
                  <div className="text-right"><p className="text-xs font-semibold tabular-nums">{item.value}</p><p className="text-[10px] tabular-nums text-slate-500">{alertTotal ? Math.round((item.value / alertTotal) * 100) : 0}%</p></div>
                </div>
              ))}
            </div>
          </div>
        </article>
      </div>

      <AnalyticsCharts overview={overview} />

      <article className="border border-line bg-panel shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4 md:px-5">
          <div><h2 className="text-base font-semibold">Recent Sessions</h2><p className="mt-1 text-xs text-slate-500">Latest validation activity</p></div>
          <div className="flex items-center gap-2 text-xs text-slate-500"><SlidersHorizontal size={14} />{filteredSessions.length} of {overview.recentSessions.length}</div>
        </div>
        {filteredSessions.length === 0 ? (
          <div className="grid min-h-48 place-items-center px-5 text-center"><div><Search className="mx-auto text-slate-600" size={24} /><p className="mt-3 text-sm font-medium">{query ? "No matching sessions" : "No sessions yet"}</p><p className="mt-1 text-xs text-slate-500">{query ? "Try a different session, charger, user, or status." : "Seed demo data or ingest a completed session."}</p>{query && <button className="mt-2 text-xs font-semibold text-mint" onClick={onClearSearch}>Clear search</button>}</div></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-panelSoft/40 text-xs uppercase text-slate-500"><tr>{["Session", "Charger", "User", "Started", "Energy", "Total", "Status"].map((header) => <th key={header} className="px-5 py-3 font-semibold">{header}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {filteredSessions.map((session) => (
                  <tr key={session.sessionId} onClick={() => onOpenSession(session.sessionId)} className="cursor-pointer transition-colors hover:bg-panelSoft/60">
                    <td className="px-5 py-4 font-semibold text-white">{session.sessionId}</td><td className="px-5 py-4 text-slate-300">{session.chargerId}</td><td className="px-5 py-4 text-slate-300">{session.userId}</td><td className="whitespace-nowrap px-5 py-4 text-slate-400">{formatDate(session.startedAt)}</td><td className="px-5 py-4 tabular-nums text-slate-300">{session.energyKwh ? `${session.energyKwh} kWh` : "-"}</td><td className="px-5 py-4 tabular-nums text-slate-300">{session.price ? formatMoney(session.price.displayTotal, session.price.currency) : "-"}</td><td className="px-5 py-4"><StatusBadge status={session.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  );
}

function AnalyticsCharts({ overview }: { overview: Overview }) {
  const tooltipStyle = { background: "#111827", border: "1px solid #273247", borderRadius: 4, boxShadow: "0 12px 32px rgb(0 0 0 / 30%)" };
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <ChartPanel title="Session Volume" subtitle="Completed outcomes by day">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={overview.validationTrend} margin={{ top: 10, right: 4, bottom: 0, left: -22 }}>
            <CartesianGrid vertical={false} stroke="#273247" strokeDasharray="3 5" />
            <XAxis dataKey="date" stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <YAxis stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar isAnimationActive={false} dataKey="sessions" name="Sessions" fill="#5aa7ff" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>

      <ChartPanel title="Estimated Revenue" subtitle="Priced sessions in EUR">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={overview.validationTrend} margin={{ top: 10, right: 6, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="#273247" strokeDasharray="3 5" />
            <XAxis dataKey="date" stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <YAxis stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={(value) => `€${value}`} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`€${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, "Revenue"]} />
            <Area isAnimationActive={false} type="monotone" dataKey="revenue" stroke="#31d0aa" strokeWidth={2.5} fill="#31d0aa" fillOpacity={0.12} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartPanel>

      <ChartPanel title="Busiest Chargers" subtitle="Sessions in the selected window">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={overview.topChargers} layout="vertical" margin={{ top: 4, right: 10, bottom: 0, left: 8 }}>
            <CartesianGrid horizontal={false} stroke="#273247" strokeDasharray="3 5" />
            <XAxis type="number" stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={88} stroke="#94a3b8" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar isAnimationActive={false} dataKey="value" name="Sessions" fill="#a78bfa" radius={[0, 4, 4, 0]} maxBarSize={15} />
          </BarChart>
        </ResponsiveContainer>
      </ChartPanel>
    </div>
  );
}

function ChartPanel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <article className="min-w-0 border border-line bg-panel p-5 shadow-panel"><div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs text-slate-500">{subtitle}</p></div><div className="mt-4 h-56">{children}</div></article>;
}

function AuxiliaryPage({ view, overview, onExport }: { view: "Chargers" | "Reports" | "Settings"; overview: Overview; onExport: () => void }) {
  if (view === "Chargers") {
    return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{overview.recentSessions.map((session) => <article key={session.chargerId} className="border border-line bg-panel p-5 shadow-panel"><div className="flex items-center justify-between"><span className="grid h-10 w-10 place-items-center rounded bg-sky/10 text-sky"><PlugZap size={18} /></span><StatusBadge status={session.status} /></div><h2 className="mt-5 font-semibold">{session.chargerId}</h2><p className="mt-1 text-sm text-slate-500">Latest session {session.sessionId}</p><div className="mt-4 border-t border-line pt-4 text-xs text-slate-500">{formatDate(session.startedAt)}</div></article>)}</div>;
  }
  if (view === "Reports") {
    return <section className="border border-line bg-panel p-6 shadow-panel"><span className="grid h-11 w-11 place-items-center rounded bg-violet-400/10 text-violet-300"><FileClock size={20} /></span><h2 className="mt-5 text-xl font-semibold">Session activity export</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Generate a CSV containing the currently loaded session IDs, chargers, users, timestamps, totals, and final statuses.</p><button onClick={onExport} className="mt-6 flex items-center gap-2 rounded bg-mint px-4 py-2.5 text-sm font-semibold text-slate-950"><Download size={16} />Download CSV</button></section>;
  }
  return <div className="grid gap-5 lg:grid-cols-2"><section className="border border-line bg-panel p-5 shadow-panel"><h2 className="font-semibold">Data source</h2><div className="mt-5 space-y-4"><Setting label="Mode" value={import.meta.env.VITE_USE_MOCKS === "true" || !import.meta.env.VITE_API_BASE_URL ? "Mock fallback" : "AWS API"} /><Setting label="API base URL" value={import.meta.env.VITE_API_BASE_URL || "Not configured"} /></div></section><section className="border border-line bg-panel p-5 shadow-panel"><h2 className="font-semibold">Pipeline policy</h2><div className="mt-5 space-y-4"><Setting label="Money precision" value="Decimal" /><Setting label="Worker delivery" value="Partial batch failures" /><Setting label="Log retention" value="7 days" /></div></section></div>;
}

function Setting({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4 border-b border-line pb-4 last:border-0"><span className="text-sm text-slate-500">{label}</span><span className="max-w-[65%] break-all text-right text-sm font-semibold">{value}</span></div>;
}

function Sidebar({ className, activeView, onNavigate, onClose }: { className: string; activeView: AppView; onNavigate: (view: AppView) => void; onClose?: () => void }) {
  return (
    <aside className={`${className} flex-col p-5`}>
      <div className="flex items-center justify-between"><Brand />{onClose && <button className="grid h-9 w-9 place-items-center rounded border border-line text-slate-400" aria-label="Close navigation" onClick={onClose}><X size={18} /></button>}</div>
      <nav className="mt-10 space-y-1" aria-label="Primary">
        {navItems.map(({ label, icon: Icon }) => <button key={label} onClick={() => onNavigate(label)} className={`flex h-10 w-full items-center gap-3 rounded px-3 text-left text-sm font-medium transition-colors ${label === activeView ? "bg-mint/10 text-mint" : "text-slate-400 hover:bg-panel hover:text-white"}`} aria-current={label === activeView ? "page" : undefined}><Icon size={17} />{label}</button>)}
      </nav>
    </aside>
  );
}

function Brand() {
  return <div className="flex items-center gap-3"><img src={`${import.meta.env.BASE_URL}assets/brand/elephant-logo.png`} alt="" className="h-10 w-10 object-contain" /><div><p className="text-base font-semibold leading-5 text-white">TariffGuard</p><p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">EV operations</p></div></div>;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${color}`} />{label}</span>;
}
