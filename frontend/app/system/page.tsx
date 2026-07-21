"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiUrl } from "@/lib/api";

type Check = {
  enabled?: boolean;
  healthy: boolean;
  provider?: string;
  bucket?: string;
  message?: string;
  detail: string;
};
type RuntimeDiagnostics = {
  hosted_runtime?: boolean;
  embedded_worker_enabled?: boolean;
  max_concurrent_heavy_jobs?: number;
  max_local_upload_bytes?: number;
  max_processing_video_bytes?: number;
  ffmpeg_threads?: string;
  memory?: Record<string, number>;
};
type SystemStatus = {
  status: "healthy" | "degraded";
  checked_at: string;
  version: string;
  git_commit: string;
  environment: string;
  python: string;
  checks: Record<string, Check>;
  runtime?: RuntimeDiagnostics;
};
type ProbeResult = {
  ok: boolean;
  status: number | null;
  detail: string;
  backendOrigin: string | null;
  data: SystemStatus | { status?: string } | null;
};

const CONNECTION_PROBES = [
  { key: "health", label: "Frontend to /backend/health", path: "/health" },
  { key: "ready", label: "Frontend to /backend/api/system/ready", path: "/api/system/ready" },
] as const;

export default function SystemPage() {
  const [probes, setProbes] = useState<Record<string, ProbeResult>>({});
  const [loading, setLoading] = useState(true);

  const readyStatus = useMemo(() => {
    const data = probes.ready?.data;
    return data && "checks" in data ? data : null;
  }, [probes.ready?.data]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const results: Record<string, ProbeResult> = {};
    for (const probe of CONNECTION_PROBES) {
      results[probe.key] = await runProbe(probe.path);
    }
    setProbes(results);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-400">Connection diagnostics</p>
            <h1 className="mt-2 text-3xl font-bold">System status</h1>
            <p className="mt-2 text-sm text-slate-400">Live checks from this frontend through the Vercel /backend proxy to the Render API.</p>
          </div>
          <div className="flex gap-3">
            <Link href="/" className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:border-slate-500">Dashboard</Link>
            <button onClick={() => void refresh()} disabled={loading} className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50">{loading ? "Checking..." : "Run checks"}</button>
          </div>
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-2">
          {CONNECTION_PROBES.map((probe) => (
            <ProbeCard key={probe.key} label={probe.label} path={`${apiUrl}${probe.path}`} result={probes[probe.key]} />
          ))}
        </section>

        {readyStatus && (
          <>
            <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Summary label="Overall" value={readyStatus.status} healthy={readyStatus.status === "healthy"} />
              <Summary label="Database" value={readyStatus.checks.database?.healthy ? "healthy" : "unavailable"} healthy={readyStatus.checks.database?.healthy} />
              <Summary label="R2 storage" value={storageLabel(readyStatus.checks.object_storage)} healthy={readyStatus.checks.object_storage?.healthy} />
              <Summary label="Git commit" value={readyStatus.git_commit.slice(0, 12)} />
            </section>

            <section className="mt-6 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              {Object.entries(readyStatus.checks).map(([name, check]) => (
                <div key={name} className="grid gap-2 border-b border-slate-800 px-5 py-4 last:border-b-0 sm:grid-cols-[180px_140px_1fr] sm:items-center">
                  <p className="font-semibold capitalize">{name.replace("_", " ")}</p>
                  <p className={check.healthy ? "text-emerald-400" : "text-rose-400"}>{check.healthy ? "Healthy" : "Unavailable"}</p>
                  <p className="break-all text-sm text-slate-400">{check.detail ?? check.message ?? "No detail returned"}</p>
                </div>
              ))}
            </section>

            <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-400">
              <p>Backend origin: {probes.ready?.backendOrigin ?? "not reported"}</p>
              <p className="mt-1">Environment: {readyStatus.environment}</p>
              <p className="mt-1">Python {readyStatus.python}</p>
              <p className="mt-1">Checked {new Date(readyStatus.checked_at).toLocaleString()}</p>
              {readyStatus.runtime?.memory && <p className="mt-1">Backend memory: {JSON.stringify(readyStatus.runtime.memory)}</p>}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

async function runProbe(path: string): Promise<ProbeResult> {
  try {
    const response = await fetch(`${apiUrl}${path}`, { cache: "no-store" });
    const contentType = response.headers.get("content-type") ?? "";
    const backendOrigin = response.headers.get("x-rugby-backend-origin");
    const data = contentType.includes("application/json") ? await response.json().catch(() => null) : null;
    return {
      ok: response.ok,
      status: response.status,
      detail: response.ok ? "Request succeeded" : response.statusText || "Request failed",
      backendOrigin,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      detail: error instanceof Error ? error.message : "Request failed before a response was returned",
      backendOrigin: null,
      data: null,
    };
  }
}

function storageLabel(check?: Check) {
  if (!check) return "unknown";
  if (check.enabled === false) return "not configured";
  return check.healthy ? "healthy" : "unavailable";
}

function ProbeCard({ label, path, result }: { label: string; path: string; result?: ProbeResult }) {
  const healthy = result?.ok === true;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-3 text-lg font-bold ${healthy ? "text-emerald-400" : "text-rose-400"}`}>{result ? (healthy ? "Reachable" : "Failed") : "Checking"}</p>
      <p className="mt-2 break-all text-sm text-slate-400">{path}</p>
      {result && (
        <>
          <p className="mt-2 text-sm text-slate-300">HTTP status: {result.status ?? "none"}</p>
          <p className="mt-1 break-all text-sm text-slate-400">{result.detail}</p>
          {result.backendOrigin && <p className="mt-1 break-all text-sm text-slate-400">Origin: {result.backendOrigin}</p>}
        </>
      )}
    </div>
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
