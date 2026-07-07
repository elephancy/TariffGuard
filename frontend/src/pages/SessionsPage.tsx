import { useEffect, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Filter, LoaderCircle, Search } from "lucide-react";
import { getSessions } from "../api/client";
import type { SessionPage, SessionRow, SessionStatus } from "../api/types";
import { StatusBadge } from "../components/StatusBadge";
import { formatDate, formatMoney } from "../lib/format";

const statuses: Array<SessionStatus | "ALL"> = ["ALL", "VALIDATED", "FLAGGED", "REJECTED", "PENDING_VALIDATION", "FAILED_PROCESSING"];
const pageSizes = [25, 50, 100];

export function SessionsPage({ onOpenSession }: { onOpenSession: (sessionId: string) => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SessionStatus | "ALL">("ALL");
  const [pageSize, setPageSize] = useState(100);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<string | undefined>>([undefined]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [stats, setStats] = useState<SessionPage["stats"]>({ total: 0, attention: 0, estimatedRevenue: "0" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPageIndex(0);
    setPageCursors([undefined]);
  }, [status, pageSize, query]);

  useEffect(() => {
    loadPage(0, undefined);
  }, [status, pageSize, query]);

  function loadPage(targetPage: number, cursor: string | undefined) {
    setLoading(true);
    setError(null);
    getSessions(cursor, status, pageSize, query)
      .then((page) => {
        setSessions(page.sessions);
        setNextCursor(page.nextCursor);
        setStats(page.stats);
        setPageIndex(targetPage);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }

  function goNext() {
    if (!nextCursor) return;
    const targetPage = pageIndex + 1;
    setPageCursors((current) => {
      const next = [...current];
      next[targetPage] = nextCursor;
      return next;
    });
    loadPage(targetPage, nextCursor);
  }

  function goPrevious() {
    if (pageIndex === 0) return;
    const targetPage = pageIndex - 1;
    loadPage(targetPage, pageCursors[targetPage]);
  }

  const totalPages = Math.max(1, Math.ceil(stats.total / pageSize));
  const pageStart = stats.total === 0 ? 0 : pageIndex * pageSize + 1;
  const pageEnd = Math.min(stats.total, pageIndex * pageSize + sessions.length);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="Sessions" value={stats.total.toLocaleString()} detail={status === "ALL" ? "All matching sessions" : status.split("_").join(" ").toLowerCase()} />
        <Metric label="Requires attention" value={stats.attention.toLocaleString()} detail="Flagged or rejected in this filter" />
        <Metric label="Processed value" value={formatMoney(stats.estimatedRevenue)} detail="Full filtered result set" />
      </div>

      <section className="border border-line bg-panel shadow-panel">
        <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold">Session registry</h2>
            <p className="mt-1 text-xs text-slate-500">Inspect validation outcomes and calculated totals</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex h-10 items-center gap-2 rounded border border-line bg-ink px-3 text-slate-400">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Session, charger, user" className="w-full bg-transparent text-sm text-white outline-none sm:w-48" />
            </label>
            <label className="flex h-10 items-center gap-2 rounded border border-line bg-ink px-3 text-slate-400">
              <Filter size={16} />
              <select value={status} onChange={(event) => setStatus(event.target.value as SessionStatus | "ALL")} className="bg-transparent text-sm text-white outline-none">
                {statuses.map((item) => <option key={item} value={item} className="bg-panel">{item.split("_").join(" ")}</option>)}
              </select>
            </label>
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="h-10 rounded border border-line bg-ink px-3 text-sm text-white outline-none">
              {pageSizes.map((size) => <option key={size} value={size} className="bg-panel">{size} / page</option>)}
            </select>
          </div>
        </div>

        {error ? (
          <div className="grid min-h-52 place-items-center px-5 text-center"><div><p className="text-sm font-semibold text-danger">Sessions unavailable</p><p className="mt-2 text-xs text-slate-500">{error}</p></div></div>
        ) : loading && sessions.length === 0 ? (
          <div className="grid min-h-52 place-items-center"><LoaderCircle className="animate-spin text-mint" /></div>
        ) : sessions.length === 0 ? (
          <div className="grid min-h-52 place-items-center text-center">
            <div><Search className="mx-auto text-slate-600" /><p className="mt-3 text-sm font-medium">No sessions match these filters</p></div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-panelSoft/40 text-xs uppercase text-slate-500">
                <tr>{["Session", "Charger", "User", "Started", "Energy", "Total", "Status", ""].map((header, index) => <th key={`${header}-${index}`} className="px-5 py-3 font-semibold">{header}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sessions.map((session) => (
                  <tr key={session.sessionId} className="group hover:bg-panelSoft/50">
                    <td className="px-5 py-4 font-semibold">{session.sessionId}</td>
                    <td className="px-5 py-4 text-slate-300">{session.chargerId}</td>
                    <td className="px-5 py-4 text-slate-400">{session.userId}</td>
                    <td className="whitespace-nowrap px-5 py-4 text-slate-400">{formatDate(session.startedAt)}</td>
                    <td className="px-5 py-4 tabular-nums">{session.price?.energyKwh ? `${session.price.energyKwh} kWh` : "-"}</td>
                    <td className="px-5 py-4 tabular-nums">{session.price ? formatMoney(session.price.displayTotal, session.price.currency) : "-"}</td>
                    <td className="px-5 py-4"><StatusBadge status={session.status} /></td>
                    <td className="px-5 py-4 text-right"><button onClick={() => onOpenSession(session.sessionId)} aria-label={`Open ${session.sessionId}`} className="grid h-8 w-8 place-items-center rounded border border-line text-slate-400 group-hover:border-mint/40 group-hover:text-mint"><ArrowRight size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-col gap-3 border-t border-line p-4 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span>{pageStart.toLocaleString()}-{pageEnd.toLocaleString()} of {stats.total.toLocaleString()} sessions</span>
          <div className="flex items-center gap-2">
            <button disabled={loading || pageIndex === 0} onClick={goPrevious} className="flex h-10 items-center gap-2 rounded border border-line bg-panelSoft px-3 font-semibold text-slate-200 hover:border-mint/40 disabled:opacity-40"><ChevronLeft size={16} />Previous</button>
            <span className="min-w-24 rounded border border-line bg-ink px-3 py-2 text-center text-slate-300">Page {pageIndex + 1} of {totalPages}</span>
            <button disabled={loading || !nextCursor} onClick={goNext} className="flex h-10 items-center gap-2 rounded border border-line bg-panelSoft px-3 font-semibold text-slate-200 hover:border-mint/40 disabled:opacity-40">Next<ChevronRight size={16} /></button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="border border-line bg-panel p-4 shadow-panel"><p className="text-xs font-semibold uppercase text-slate-500">{label}</p><p className="mt-3 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></article>;
}
