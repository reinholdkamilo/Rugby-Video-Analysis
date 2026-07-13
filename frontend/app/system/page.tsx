"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { apiUrl } from "@/lib/api";

type Check = { healthy: boolean; detail: string };
type SystemStatus = {
  status: "healthy" | "degraded";
  checked_at: string;
  version: string;
  git_commit: string;
  environment: string;
  python: string;
  checks: Record<string, Check>;
};

export default function SystemPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/api/system`, { cache: "no-store" });
      if (!response.ok) throw new Error(`System check failed with status ${response.status}`);
      setStatus((await response.json()) as SystemStatus);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load system status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-400">Development stabilisation</p>
            <h1 className="mt-2 text-3xl font-bold">System status</h1>
            <p className="mt-2 text-sm text-slate-400">Live checks for the services required to upload and analyse rugby footage.</p>
          </div>
          <div className="flex gap-3">
            <Link href="/" className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:border-slate-500">Dashboard</Link>
            <button onClick={() => void refresh()} disabled={loading} className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50">{loading ? "Checking…" : "Run checks"}</button>
          </div>
        </div>

        {error && <div className="mt-8 rounded-xl border border-rose-700 bg-rose-950/40 p-5 text-rose-200">{error}</div>}

        {status && (
          <>
            <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Summary label="Overall" value={status.status} healthy={status.status === "healthy"} />
              <Summary label="Version" value={status.version} />
              <Summary label="Environment" value={status.environment} />
              <Summary label="Git commit" value={status.git_commit.slice(0, 12)} />
            </section>

            <section className="mt-6 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              {Object.entries(status.checks).map(([name, check]) => (
                <div key={name} className="grid gap-2 border-b border-slate-800 px-5 py-4 last:border-b-0 sm:grid-cols-[180px_120px_1fr] sm:items-center">
                  <p className="font-semibold capitalize">{name}</p>
                  <p className={check.healthy ? "text-emerald-400" : "text-rose-400"}>{check.healthy ? "● Healthy" : "● Unavailable"}</p>
                  <p className="break-all text-sm text-slate-400">{check.detail}</p>
                </div>
              ))}
            </section>

            <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400">
              <p>Python {status.python}</p>
              <p className="mt-1">Checked {new Date(status.checked_at).toLocaleString()}</p>
              <p className="mt-1">API route {apiUrl}/api/system</p>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function Summary({ label, value, healthy }: { label: string; value: string; healthy?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 break-all text-lg font-bold ${healthy === true ? "text-emerald-400" : healthy === false ? "text-rose-400" : "text-white"}`}>{value}</p>
    </div>
  );
}
