import { useEffect, useState } from "react";
import { Copy, LoaderCircle, Plus, Shield, UserRound } from "lucide-react";
import { createOperator, getOperators, setOperatorEnabled } from "../api/client";
import type { CreatedOperator, Operator } from "../api/types";
import { ViewState } from "../components/ViewState";

export function UsersPage() {
  const [users, setUsers] = useState<Operator[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"operator" | "admin">("operator");
  const [created, setCreated] = useState<CreatedOperator | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    return getOperators().then(setUsers).catch((reason: Error) => setError(reason.message));
  }

  useEffect(() => { refresh(); }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCreated(await createOperator(email, role));
      setEmail("");
      await refresh();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(user: Operator) {
    setBusy(true);
    try {
      await setOperatorEnabled(user.username, !user.enabled);
      await refresh();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!users && !error) return <ViewState title="Loading operators" body="Reading users and administrator roles from Cognito." kind="loading" />;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="border border-line bg-panel shadow-panel">
        <div className="border-b border-line p-5"><h2 className="font-semibold">Access directory</h2><p className="mt-1 text-xs text-slate-500">{users?.length ?? 0} Cognito accounts</p></div>
        {error && <div className="border-b border-danger/30 bg-danger/5 px-5 py-3 text-sm text-danger">{error}</div>}
        <div className="divide-y divide-line">
          {users?.map((user) => (
            <div key={user.username} className="flex flex-wrap items-center gap-4 p-5">
              <span className="grid h-10 w-10 place-items-center rounded bg-sky/10 text-sky">{user.role === "admin" ? <Shield size={18} /> : <UserRound size={18} />}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{user.email}</p><p className="mt-1 text-xs text-slate-500">{user.role} · {user.status.split("_").join(" ")}</p></div>
              <button disabled={busy} onClick={() => toggle(user)} className={`rounded border px-3 py-2 text-xs font-semibold ${user.enabled ? "border-danger/30 text-danger" : "border-mint/30 text-mint"}`}>{user.enabled ? "Disable" : "Enable"}</button>
            </div>
          ))}
        </div>
      </section>

      <div className="space-y-5">
        <form onSubmit={submit} className="border border-line bg-panel p-5 shadow-panel">
          <div className="flex items-center gap-2"><Plus size={17} className="text-mint" /><h2 className="font-semibold">Add operator</h2></div>
          <label className="mt-5 block text-xs font-semibold text-slate-400">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-11 w-full rounded border border-line bg-ink px-3 text-sm text-white outline-hidden focus:border-mint/50" /></label>
          <label className="mt-4 block text-xs font-semibold text-slate-400">Role<select value={role} onChange={(event) => setRole(event.target.value as "operator" | "admin")} className="mt-2 h-11 w-full rounded border border-line bg-ink px-3 text-sm text-white outline-hidden"><option value="operator">Operator</option><option value="admin">Administrator</option></select></label>
          <button disabled={busy} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded bg-mint text-sm font-semibold text-slate-950 disabled:opacity-60">{busy && <LoaderCircle size={16} className="animate-spin" />}Create account</button>
        </form>

        {created && <section className="border border-amber/30 bg-amber/5 p-5"><p className="text-xs font-semibold uppercase text-amber">Shown once</p><p className="mt-2 text-sm text-slate-300">Give this temporary password to {created.email} through a secure channel.</p><div className="mt-4 flex items-center gap-2 rounded border border-line bg-ink p-3"><code className="min-w-0 flex-1 break-all text-sm">{created.temporaryPassword}</code><button onClick={() => navigator.clipboard.writeText(created.temporaryPassword)} aria-label="Copy temporary password" className="grid h-8 w-8 shrink-0 place-items-center rounded border border-line"><Copy size={14} /></button></div></section>}
      </div>
    </div>
  );
}
