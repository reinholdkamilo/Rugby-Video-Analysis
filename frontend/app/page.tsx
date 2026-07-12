"use client";

import { useEffect, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

export default function Home() {
  const [status, setStatus] = useState("Checking backend connection...");

  useEffect(() => {
    fetch(`${apiUrl}/health`)
      .then((response) => {
        if (!response.ok) throw new Error("Backend unavailable");
        return response.json();
      })
      .then(() => setStatus("Backend connected"))
      .catch(() => setStatus("Backend is not connected"));
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-20">
        <p className="mb-6 text-sm font-semibold uppercase tracking-[0.25em] text-slate-400">Professional rugby intelligence</p>
        <h1 className="max-w-4xl text-5xl font-bold tracking-tight sm:text-7xl">Rugby Video Analysis</h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">Upload rugby footage, identify match events, create video clips and generate professional coaching reports.</p>
        <div className="mt-10 flex gap-4">
          <button className="rounded-lg bg-white px-6 py-3 font-semibold text-slate-950">Create Match</button>
          <button className="rounded-lg border border-slate-700 px-6 py-3 font-semibold">View Matches</button>
        </div>
        <div className="mt-16 rounded-xl border border-slate-800 bg-slate-900 p-6">
          <p className="text-sm uppercase tracking-wider text-slate-400">System status</p>
          <p className="mt-3">{status}</p>
          <p className="mt-2 text-sm text-slate-500">API: {apiUrl}</p>
        </div>
      </section>
    </main>
  );
}
