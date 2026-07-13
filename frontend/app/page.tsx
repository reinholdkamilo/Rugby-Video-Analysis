"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnalysisJob, Match, Organisation, Team, api, apiUrl, uploadVideoInChunks } from "@/lib/api";

const fieldClass = "w-full px-3.5 py-3 text-sm outline-none";
const buttonClass = "rounded-xl bg-emerald-400 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
const cardClass = "rounded-2xl border border-slate-800 bg-slate-900 p-6";

type UploadProgress = { percent: number; message: string };

export default function Home() {
  const [connected, setConnected] = useState(false);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [selectedOrganisationId, setSelectedOrganisationId] = useState<number | null>(null);
  const [notice, setNotice] = useState("Loading workspace...");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<number, UploadProgress>>({});

  const loadData = useCallback(async () => {
    try {
      await api.health();
      const [organisationData, teamData, matchData, jobData] = await Promise.all([
        api.organisations.list(), api.teams.list(), api.matches.list(), api.jobs.list(),
      ]);
      setConnected(true); setOrganisations(organisationData); setTeams(teamData); setMatches(matchData); setJobs(jobData);
      setSelectedOrganisationId((current) => current && organisationData.some((item) => item.id === current) ? current : organisationData[0]?.id ?? null);
      setNotice("Workspace ready");
    } catch (error) {
      setConnected(false); setNotice(error instanceof Error ? error.message : "Backend unavailable");
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => {
    const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "processing");
    if (!activeJobs.length) return;
    const timer = window.setInterval(async () => {
      try {
        const refreshed = await Promise.all(activeJobs.map((job) => api.jobs.get(job.id)));
        setJobs((current) => current.map((job) => refreshed.find((item) => item.id === job.id) ?? job));
      } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to refresh jobs"); }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [jobs]);

  const filteredTeams = useMemo(() => teams.filter((team) => team.organisation_id === selectedOrganisationId), [teams, selectedOrganisationId]);
  const teamName = (id: number) => teams.find((team) => team.id === id)?.name ?? `Team ${id}`;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); } catch (error) { setNotice(error instanceof Error ? error.message : "Something went wrong"); }
    finally { setBusy(false); }
  }

  async function createOrganisation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    await run(async () => {
      const organisation = await api.organisations.create(String(form.get("name")).trim());
      setOrganisations((current) => [...current, organisation].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedOrganisationId(organisation.id); formElement.reset(); setNotice(`${organisation.name} created and selected`);
    });
  }

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget;
    if (!selectedOrganisationId) return setNotice("Create or select an organisation before adding a team.");
    const form = new FormData(formElement);
    await run(async () => {
      const team = await api.teams.create({ organisation_id: selectedOrganisationId, name: String(form.get("name")).trim(), age_group: String(form.get("age_group") || "").trim() || undefined });
      setTeams((current) => [...current, team].sort((a, b) => a.name.localeCompare(b.name))); formElement.reset(); setNotice(`${team.name} added successfully`);
    });
  }

  async function createMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; if (!selectedOrganisationId) return;
    const form = new FormData(formElement);
    await run(async () => {
      const match = await api.matches.create({ organisation_id: selectedOrganisationId, home_team_id: Number(form.get("home_team_id")), away_team_id: Number(form.get("away_team_id")), match_date: String(form.get("match_date")), competition: String(form.get("competition") || "").trim() || undefined, venue: String(form.get("venue") || "").trim() || undefined });
      setMatches((current) => [match, ...current]); formElement.reset(); setNotice("Match created and ready for footage");
    });
  }

  async function uploadAndAnalyse(event: FormEvent<HTMLFormElement>, matchId: number) {
    event.preventDefault(); const formElement = event.currentTarget; const input = formElement.elements.namedItem("video") as HTMLInputElement; const file = input.files?.[0];
    if (!file) return setNotice("Select a video first");
    setBusy(true); setUploadProgress((current) => ({ ...current, [matchId]: { percent: 0, message: "Starting resumable upload" } }));
    try {
      await uploadVideoInChunks(matchId, file, (percent, message) => { setUploadProgress((current) => ({ ...current, [matchId]: { percent, message } })); setNotice(`${file.name}: ${message}`); });
      formElement.reset(); setJobs(await api.jobs.list()); setNotice("Video uploaded successfully and processing has started");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed"; setUploadProgress((current) => ({ ...current, [matchId]: { percent: 0, message } })); setNotice(message);
    } finally { setBusy(false); }
  }

  return (
    <main>
      <header className="border-b border-slate-800 bg-white/70">
        <div className="mx-auto grid max-w-[1440px] gap-8 px-6 py-10 lg:grid-cols-[1fr_auto] lg:items-end lg:px-8">
          <div className="max-w-3xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-800 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Match preparation
            </div>
            <h1 className="text-4xl font-black sm:text-5xl">Your analysis workspace.</h1>
            <p className="mt-4 max-w-2xl text-base text-slate-500 sm:text-lg">Set up your programme in order, attach match footage, then move directly into coding and rugby intelligence.</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-white px-5 py-4 shadow-sm">
            <div className="flex items-center gap-3"><span className={`h-3 w-3 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400"}`} /><div><p className="text-sm font-bold">{connected ? "Platform connected" : "Platform offline"}</p><p className="text-xs text-slate-500">{apiUrl}</p></div></div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] px-6 py-8 lg:px-8">
        <div className="mb-8 flex items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-white px-5 py-4 shadow-sm">
          <div><p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Live status</p><p className="mt-1 text-sm font-semibold">{notice}</p></div>
          <button type="button" onClick={() => void loadData()} className="rounded-xl border border-slate-800 bg-white px-4 py-2 text-sm font-bold">Refresh</button>
        </div>

        <div className="mb-6 flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-400">Guided setup</p><h2 className="mt-1 text-2xl font-black">Build your match in three steps</h2></div><Link href="/catalog" className="hidden rounded-xl border border-slate-800 bg-white px-4 py-2 text-sm font-bold sm:block">Open programme manager →</Link></div>

        <section className="grid gap-5 lg:grid-cols-3">
          <form onSubmit={createOrganisation} className={cardClass}>
            <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-400 text-sm font-black text-white">1</span><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Foundation</p><h2 className="text-xl font-black">Organisation</h2></div></div>
            <p className="mt-4 text-sm text-slate-500">Create the club, school or programme that owns the teams and analysis.</p>
            <input name="name" required minLength={2} placeholder="e.g. ACT Brumbies" className={`${fieldClass} mt-5`} />
            <button type="submit" disabled={busy} className={`${buttonClass} mt-3 w-full`}>Create organisation</button>
          </form>

          <form onSubmit={createTeam} className={cardClass}>
            <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-400 text-sm font-black text-white">2</span><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Squads</p><h2 className="text-xl font-black">Teams</h2></div></div>
            <p className="mt-4 text-sm text-slate-500">Select the organisation and add the squads involved in your matches.</p>
            <select className={`${fieldClass} mt-5`} value={selectedOrganisationId ?? ""} onChange={(event) => setSelectedOrganisationId(event.target.value ? Number(event.target.value) : null)}><option value="">Select organisation</option>{organisations.map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}</select>
            <div className="mt-3 grid grid-cols-2 gap-3"><input name="name" required minLength={2} placeholder="Team name" className={fieldClass} /><input name="age_group" placeholder="Age group" className={fieldClass} /></div>
            <button type="submit" disabled={busy || !selectedOrganisationId} className={`${buttonClass} mt-3 w-full`}>Add team</button>
          </form>

          <form onSubmit={createMatch} className={cardClass}>
            <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-emerald-400 text-sm font-black text-white">3</span><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Fixture</p><h2 className="text-xl font-black">Create match</h2></div></div>
            <p className="mt-4 text-sm text-slate-500">Add fixture context before attaching footage for processing and coding.</p>
            <div className="mt-5 grid grid-cols-2 gap-3"><select name="home_team_id" required className={fieldClass}><option value="">Home team</option>{filteredTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select><select name="away_team_id" required className={fieldClass}><option value="">Away team</option>{filteredTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select><input name="match_date" type="date" required className={fieldClass} /><input name="competition" placeholder="Competition" className={fieldClass} /></div>
            <input name="venue" placeholder="Venue" className={`${fieldClass} mt-3`} />
            <button type="submit" disabled={busy || filteredTeams.length < 2} className={`${buttonClass} mt-3 w-full`}>Create match</button>
          </form>
        </section>

        <section className="mt-12">
          <div className="mb-5 flex items-end justify-between"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-400">Step 4 · Footage</p><h2 className="mt-1 text-3xl font-black">Matches ready for analysis</h2><p className="mt-2 text-sm text-slate-500">Upload a short clip, monitor processing and continue into the analyst tools.</p></div></div>
          <div className="space-y-5">
            {!matches.length && <div className="rounded-2xl border border-dashed border-slate-700 bg-white/60 p-14 text-center"><p className="text-lg font-bold">No matches yet</p><p className="mt-2 text-sm text-slate-500">Complete the guided setup above to create your first fixture.</p></div>}
            {matches.map((match) => {
              const job = jobs.find((item) => item.match_id === match.id); const progress = uploadProgress[match.id];
              return <article key={match.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-6"><div className="grid gap-6 lg:grid-cols-[1fr_390px] lg:items-center"><div><div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wider text-slate-500"><span>{match.match_date}</span><span>•</span><span>{match.competition || "Competition not set"}</span></div><h3 className="mt-3 text-2xl font-black">{teamName(match.home_team_id)} <span className="font-medium text-slate-500">vs</span> {teamName(match.away_team_id)}</h3><p className="mt-2 text-sm text-slate-500">{match.venue || "Venue not set"}</p>{job && <div className="mt-5 max-w-xl"><div className="mb-2 flex justify-between text-xs font-bold uppercase tracking-wider"><span>{job.status}</span><span>{job.progress_percent}%</span></div><div className="h-2.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${job.progress_percent}%` }} /></div><p className="mt-2 text-sm text-slate-500">{job.message}</p></div>}<div className="mt-5 flex flex-wrap gap-2"><Link href="/coding" className="rounded-xl border border-slate-800 bg-white px-4 py-2 text-sm font-bold">Open coding</Link><Link href="/timeline" className="rounded-xl border border-slate-800 bg-white px-4 py-2 text-sm font-bold">View timeline</Link></div></div><form onSubmit={(event) => uploadAndAnalyse(event, match.id)} className="rounded-2xl border border-slate-800 bg-white p-5"><label className="text-sm font-bold">Upload match footage</label><p className="mt-1 text-xs text-slate-500">Phase 1 supports short clips up to 100 MB.</p><input name="video" type="file" accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/x-m4v" required className="mt-4 block w-full text-sm" />{progress && <div className="mt-4"><div className="mb-2 flex justify-between text-xs font-semibold"><span>{progress.message}</span><span>{progress.percent}%</span></div><div className="h-2.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-sky-400 transition-all" style={{ width: `${progress.percent}%` }} /></div></div>}<button type="submit" disabled={busy} className={`${buttonClass} mt-4 w-full`}>{busy && progress ? "Uploading…" : "Upload and start analysis"}</button></form></div></article>;
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
