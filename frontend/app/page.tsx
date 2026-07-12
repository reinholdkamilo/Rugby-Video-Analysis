"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { AnalysisJob, Match, Organisation, Team, api, apiUrl } from "@/lib/api";

const fieldClass =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400";
const buttonClass =
  "rounded-lg bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50";

export default function Home() {
  const [connected, setConnected] = useState(false);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [selectedOrganisationId, setSelectedOrganisationId] = useState<number | null>(null);
  const [notice, setNotice] = useState("Loading workspace...");
  const [busy, setBusy] = useState(false);

  const loadData = useCallback(async () => {
    try {
      await api.health();
      const [organisationData, teamData, matchData, jobData] = await Promise.all([
        api.organisations.list(),
        api.teams.list(),
        api.matches.list(),
        api.jobs.list(),
      ]);
      setConnected(true);
      setOrganisations(organisationData);
      setTeams(teamData);
      setMatches(matchData);
      setJobs(jobData);
      setSelectedOrganisationId((current) => {
        if (current && organisationData.some((item) => item.id === current)) return current;
        return organisationData[0]?.id ?? null;
      });
      setNotice("Workspace ready");
    } catch (error) {
      setConnected(false);
      setNotice(error instanceof Error ? error.message : "Backend unavailable");
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "processing");
    if (!activeJobs.length) return;
    const timer = window.setInterval(async () => {
      try {
        const refreshed = await Promise.all(activeJobs.map((job) => api.jobs.get(job.id)));
        setJobs((current) => current.map((job) => refreshed.find((item) => item.id === job.id) ?? job));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Unable to refresh jobs");
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [jobs]);

  const filteredTeams = useMemo(
    () => teams.filter((team) => team.organisation_id === selectedOrganisationId),
    [teams, selectedOrganisationId],
  );

  const teamName = (id: number) => teams.find((team) => team.id === id)?.name ?? `Team ${id}`;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function createOrganisation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await run(async () => {
      const organisation = await api.organisations.create(String(form.get("name")).trim());
      setOrganisations((current) => [...current, organisation].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedOrganisationId(organisation.id);
      formElement.reset();
      setNotice(`${organisation.name} created and selected`);
    });
  }

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!selectedOrganisationId) {
      setNotice("Create or select an organisation before adding a team.");
      return;
    }
    const form = new FormData(formElement);
    await run(async () => {
      const team = await api.teams.create({
        organisation_id: selectedOrganisationId,
        name: String(form.get("name")).trim(),
        age_group: String(form.get("age_group") || "").trim() || undefined,
      });
      setTeams((current) => [...current, team].sort((a, b) => a.name.localeCompare(b.name)));
      formElement.reset();
      setNotice(`${team.name} added successfully`);
    });
  }

  async function createMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!selectedOrganisationId) return;
    const form = new FormData(formElement);
    await run(async () => {
      const match = await api.matches.create({
        organisation_id: selectedOrganisationId,
        home_team_id: Number(form.get("home_team_id")),
        away_team_id: Number(form.get("away_team_id")),
        match_date: String(form.get("match_date")),
        competition: String(form.get("competition") || "").trim() || undefined,
        venue: String(form.get("venue") || "").trim() || undefined,
      });
      setMatches((current) => [match, ...current]);
      formElement.reset();
      setNotice("Match created and ready for footage");
    });
  }

  async function uploadAndAnalyse(event: FormEvent<HTMLFormElement>, matchId: number) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const input = formElement.elements.namedItem("video") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return setNotice("Select a video first");
    await run(async () => {
      setNotice(`Uploading ${file.name}...`);
      const video = await api.matches.uploadVideo(matchId, file);
      const job = await api.jobs.create({ match_id: matchId, video_asset_id: video.id });
      setJobs((current) => [job, ...current]);
      formElement.reset();
      setNotice("Video uploaded and processing queued");
    });
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div><p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-400">Rugby intelligence platform</p><h1 className="mt-1 text-2xl font-bold">Video Analysis Workspace</h1></div>
          <div className="text-right text-sm"><p className={connected ? "text-emerald-400" : "text-rose-400"}>{connected ? "● Connected" : "● Offline"}</p><p className="mt-1 text-xs text-slate-500">{apiUrl}</p></div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 rounded-xl border border-slate-800 bg-slate-900 px-5 py-4 text-sm text-slate-300">{notice}</div>

        <section className="grid gap-6 lg:grid-cols-3">
          <form onSubmit={createOrganisation} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs font-bold uppercase text-slate-500">Step 1</p><h2 className="mt-2 text-xl font-bold">Organisation</h2>
            <input name="name" required minLength={2} placeholder="e.g. ACT Brumbies" className={`${fieldClass} mt-5`} />
            <button type="submit" disabled={busy} className={`${buttonClass} mt-3 w-full`}>Create organisation</button>
          </form>

          <form onSubmit={createTeam} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs font-bold uppercase text-slate-500">Step 2</p><h2 className="mt-2 text-xl font-bold">Teams</h2>
            <select className={`${fieldClass} mt-5`} value={selectedOrganisationId ?? ""} onChange={(event) => setSelectedOrganisationId(event.target.value ? Number(event.target.value) : null)}>
              <option value="">Select organisation</option>
              {organisations.map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}
            </select>
            <div className="mt-3 grid grid-cols-2 gap-3"><input name="name" required minLength={2} placeholder="Team name" className={fieldClass} /><input name="age_group" placeholder="Age group" className={fieldClass} /></div>
            <button type="submit" disabled={busy || !selectedOrganisationId} className={`${buttonClass} mt-3 w-full`}>Add team</button>
            {!selectedOrganisationId && <p className="mt-3 text-xs text-amber-300">Create or select an organisation first.</p>}
          </form>

          <form onSubmit={createMatch} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs font-bold uppercase text-slate-500">Step 3</p><h2 className="mt-2 text-xl font-bold">Create match</h2>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <select name="home_team_id" required className={fieldClass}><option value="">Home team</option>{filteredTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
              <select name="away_team_id" required className={fieldClass}><option value="">Away team</option>{filteredTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
              <input name="match_date" type="date" required className={fieldClass} /><input name="competition" placeholder="Competition" className={fieldClass} />
            </div>
            <input name="venue" placeholder="Venue" className={`${fieldClass} mt-3`} />
            <button type="submit" disabled={busy || filteredTeams.length < 2} className={`${buttonClass} mt-3 w-full`}>Create match</button>
          </form>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-bold uppercase text-slate-500">Step 4</p><h2 className="mt-1 text-2xl font-bold">Matches and footage</h2></div><button type="button" onClick={() => void loadData()} className="rounded-lg border border-slate-700 px-4 py-2 text-sm">Refresh</button></div>
          <div className="space-y-4">
            {!matches.length && <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center text-slate-500">Create your first match above.</div>}
            {matches.map((match) => {
              const job = jobs.find((item) => item.match_id === match.id);
              return <article key={match.id} className="rounded-xl border border-slate-800 bg-slate-900 p-5"><div className="grid gap-5 lg:grid-cols-[1fr_360px] lg:items-center"><div><p className="text-sm text-slate-500">{match.match_date} · {match.competition || "Unspecified competition"}</p><h3 className="mt-2 text-xl font-bold">{teamName(match.home_team_id)} <span className="text-slate-500">vs</span> {teamName(match.away_team_id)}</h3><p className="mt-1 text-sm text-slate-400">{match.venue || "Venue not set"}</p>{job && <div className="mt-4"><div className="mb-2 flex justify-between text-xs uppercase"><span>{job.status}</span><span>{job.progress_percent}%</span></div><div className="h-2 rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${job.progress_percent}%` }} /></div><p className="mt-2 text-sm text-slate-400">{job.message}</p></div>}</div><form onSubmit={(event) => uploadAndAnalyse(event, match.id)} className="rounded-lg border border-slate-700 bg-slate-950 p-4"><label className="text-sm font-semibold">Upload match video</label><input name="video" type="file" accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska" required className="mt-3 block w-full text-sm" /><button type="submit" disabled={busy} className={`${buttonClass} mt-4 w-full`}>Upload and start analysis</button></form></div></article>;
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
