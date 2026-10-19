import { useEffect, useState } from "react";
import { ArrowLeft, Ban, Clock3, Gauge, ReceiptText, ShieldAlert, Zap } from "lucide-react";
import { getSession, invalidateSession } from "../api/client";
import type { SessionRow } from "../api/types";
import { StatusBadge } from "../components/StatusBadge";
import { ViewState } from "../components/ViewState";
import { formatDate, formatMoney } from "../lib/format";

export function SessionDetailPage({ sessionId, onBack }: { sessionId: string; onBack: () => void }) {
  const [session, setSession] = useState<SessionRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(0);
  const [reason, setReason] = useState("");
  const [invalidating, setInvalidating] = useState(false);

  useEffect(() => {
    let active = true;
    setSession(null);
    setError(null);
    getSession(sessionId).then((value) => active && setSession(value)).catch((reason: Error) => active && setError(reason.message));
    return () => { active = false; };
  }, [requestId, sessionId]);

  if (error) return <ViewState title="Session unavailable" body={error} kind="error" onRetry={() => setRequestId((value) => value + 1)} />;
  if (!session) return <ViewState title="Loading session" body="Retrieving the immutable input and validation result." kind="loading" />;

  const priceRows = [
    ["Energy amount", session.price?.energyAmount],
    ["Session fee", session.price?.sessionFee],
    ["Idle amount", session.price?.idleAmount],
    ["Subtotal", session.price?.subtotal],
    ["Tax", session.price?.tax],
  ];

  async function invalidate() {
    if (reason.trim().length < 3) return;
    setInvalidating(true);
    try {
      setSession(await invalidateSession(sessionId, reason.trim()));
      setReason("");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setInvalidating(false);
    }
  }

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="flex items-center gap-2 text-sm font-semibold text-slate-400 hover:text-white"><ArrowLeft size={16} />Back to sessions</button>

      <section className="border border-line bg-panel p-5 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase text-mint">Session result</p><h2 className="mt-2 text-2xl font-semibold">{session.sessionId}</h2><p className="mt-1 text-sm text-slate-500">{session.chargerId} · {session.userId}</p></div>
          <StatusBadge status={session.status} />
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Detail icon={Clock3} label="Started" value={formatDate(session.startedAt)} />
          <Detail icon={Zap} label="Energy" value={session.energyKwh ? `${session.energyKwh} kWh` : "Pending"} />
          <Detail icon={Gauge} label="Idle time" value={`${session.idleMinutes ?? 0} minutes`} />
          <Detail icon={ReceiptText} label="Total" value={session.price ? formatMoney(session.price.displayTotal, session.price.currency) : "Not calculated"} />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="border border-line bg-panel p-5 shadow-panel">
          <h3 className="font-semibold">Price breakdown</h3>
          <div className="mt-4 divide-y divide-line">
            {priceRows.map(([label, value]) => <div key={label} className="flex justify-between py-3 text-sm"><span className="text-slate-400">{label}</span><span>{value ? formatMoney(value, session.price?.currency) : "-"}</span></div>)}
            <div className="flex justify-between pt-4 font-semibold"><span>Total</span><span className="text-mint">{session.price ? formatMoney(session.price.displayTotal, session.price.currency) : "-"}</span></div>
          </div>
        </section>

        <section className="border border-line bg-panel p-5 shadow-panel">
          <h3 className="font-semibold">Tariff snapshot</h3>
          {session.tariffSnapshot ? (
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <Snapshot label="Tariff" value={session.tariffSnapshot.tariffId} />
              <Snapshot label="Effective" value={formatDate(session.tariffSnapshot.validFrom)} />
              <Snapshot label="Energy rate" value={`${formatMoney(session.tariffSnapshot.pricePerKwh, session.tariffSnapshot.currency)}/kWh`} />
              <Snapshot label="Session fee" value={formatMoney(session.tariffSnapshot.sessionFee, session.tariffSnapshot.currency)} />
              <Snapshot label="Idle rate" value={`${formatMoney(session.tariffSnapshot.idleFeePerMinute, session.tariffSnapshot.currency)}/min`} />
              <Snapshot label="Tax rate" value={`${Number(session.tariffSnapshot.taxRate) * 100}%`} />
            </div>
          ) : <p className="mt-4 text-sm text-slate-500">Tariff selection is pending or unavailable.</p>}
        </section>
      </div>

      <section className="border border-line bg-panel p-5 shadow-panel">
        <div className="flex items-center gap-2"><ShieldAlert size={18} className="text-amber" /><h3 className="font-semibold">Validation flags</h3></div>
        {session.validationFlags?.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {session.validationFlags.map((flag) => <article key={flag.code} className="border-l-2 border-danger bg-danger/5 p-4"><div className="flex justify-between gap-3"><p className="text-sm font-semibold">{flag.code.split("_").join(" ")}</p><span className="text-xs font-semibold text-danger">{flag.severity}</span></div><p className="mt-2 text-sm text-slate-400">{flag.message}</p>{flag.metric && <p className="mt-3 text-xs font-semibold text-slate-300">{flag.metric}</p>}</article>)}
          </div>
        ) : <p className="mt-4 text-sm text-slate-500">No validation flags were raised for this session.</p>}
      </section>

      <section className="border border-line bg-[#080d17] p-5 shadow-panel">
        <h3 className="font-semibold">Raw input</h3>
        <pre className="mt-4 overflow-x-auto text-xs leading-6 text-slate-400">{JSON.stringify(session.rawPayload ?? session, null, 2)}</pre>
      </section>

      <section className="border border-danger/25 bg-danger/5 p-5">
        <div className="flex items-center gap-2"><Ban size={18} className="text-danger" /><h3 className="font-semibold">Invalidate session</h3></div>
        <p className="mt-2 text-sm text-slate-400">Exclude a compromised or incorrect session from active operational results while preserving its audit record.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input disabled={session.status === "INVALIDATED"} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for invalidation" className="h-10 min-w-0 flex-1 rounded border border-line bg-ink px-3 text-sm outline-hidden focus:border-danger/50" /><button disabled={invalidating || reason.trim().length < 3 || session.status === "INVALIDATED"} onClick={invalidate} className="h-10 rounded bg-danger px-4 text-sm font-semibold text-white disabled:opacity-40">{session.status === "INVALIDATED" ? "Invalidated" : "Invalidate"}</button></div>
      </section>
    </div>
  );
}

function Detail({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) {
  return <div className="border border-line bg-ink/50 p-3"><Icon size={15} className="text-mint" /><p className="mt-3 text-xs text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold">{value}</p></div>;
}

function Snapshot({ label, value }: { label: string; value: string }) {
  return <div className="border border-line bg-ink/40 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-words font-medium">{value}</p></div>;
}
