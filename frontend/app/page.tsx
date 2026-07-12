"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  AnalysisJob,
  Match,
  Organisation,
  Team,
  VideoProcessingResult,
  api,
  apiUrl,
  thumbnailUrl,
} from "@/lib/api";

const fieldClass =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none transition focus:border-emerald-400";
const buttonClass =
  "rounded-lg bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50";

function formatDuration(seconds: number) {
  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  return [hours, minutes, remainingSeconds]
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0")))
    .join(":");
}

export default function Home() {
  const [connected, setConnected] = useState(false);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [processingResults, setProcessingResults] = useState<Record<number, VideoProcessingResult>>({});
  const [selectedOrganisationId, setSelectedOrganisationId] = useState<number | null>(null);
  const [notice, setNotice] = useState("Loading workspace...");
  const [busy, setBusy] = useState(false);

  const loadResults = useCallback(async (jobData: AnalysisJob[]) => {
    const completed = jobData.filter(
      (job) => job.status === "completed" && job.video_asset_id !== null,
    );
    const entries = await Promise.all(
      completed.map(async (job) => {
        try {
          const result = await api.videos.processingResult(job.video_asset_id as number);
          return [job.id, result] as const;
        } catch {
          return null;
        }
      }),
    );
    setProcessingResults((current) => {
      const next = { ...current };
      entries.forEach((entry) => {
        if (entry) next[entry[0]] = entry[1];
      });
      return next;
    });
  }, []);

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
      setSelectedOrganisationId((current) => current ?? organisationData[0]?.id ?? null);
      await loadResults(jobData);
      setNotice("Workspace ready");
    } catch (error) {
      setConnected(false);
      setNotice(error instanceof Error ? error.message : "Backend unavailable");
    }
  }, [loadResults]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "processing");
    if (activeJobs.length === 0) return;
    const timer = window.setInterval(async () => {
      try {
        const refreshed = await Promise.all(activeJobs.map((job) => api.jobs.get(job.id)));
        setJobs((current) => current.map((job) => refreshed.find((item) => item.id === job.id) ?? job));
        await loadResults(refreshed);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Unable to refresh analysis status");
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [jobs, loadResults]);

  const filteredTeams = useMemo(
    () => teams.filter((team) => team.organisation_id === selectedOrganisationId),
    [teams, selectedOrganisationId],
  );
  const teamName = (id: number) => teams.find((team) => team.id === id)?.name ?? `Team ${id}`;

  async function perform(action: () => Promise<void>) {
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
    const form = new FormData(event.currentTarget);
    await perform(async () => {
      const organisation = await api.organisations.create(String(form.get("name")));
      setOrganisations((current) => [...current, organisation]);
      setSelectedOrganisationId(organisation.id);
      event.currentTarget.reset();
      setNotice(`${organisation.name} created`);
    });
  }

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrganisationId) return;
    const form = new FormData(event.currentTarget);
    await perform(async () => {
      const team = await api.teams.create({
        organisation_id: selectedOrganisationId,
        name: String(form.get("name")),
        age_group: String(form.get("age_group") || "") || undefined,
      });
      setTeams((current) => [...current, team]);
      event.currentTarget.reset();
      setNotice(`${team.name} created`);
    });
  }

  async function createMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrganisationId) return;
    const form = new FormData(event.currentTarget);
    await perform(async () => {
      const match = await api.matches.create({
        organisation_id: selectedOrganisationId,
        home_team_id: Number(form.get("home_team_id")),
        away_team_id: Number(form.get("away_team_id")),
        match_date: String(form.get("match_date")),
        competition: String(form.get("competition") || "") || undefined,
        venue: String(form.get("venue") || "") || undefined,
      });
      setMatches((current) => [match, ...current]);
      event.currentTarget.reset();
      setNotice("Match created and ready for footage");
    });
  }

  async function uploadAndAnalyse(event: FormEvent<HTMLFormElement>, matchId: number) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("video") as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return setNotice("Select a video first");
    await perform(async () => {
      setNotice(`Uploading ${file.name}...`);
      const video = await api.matches.uploadVideo(matchId, file);
      const job = await api.jobs.create({ match_id: matchId, video_asset_id: video.id });
      setJobs((current) => [job, ...current]);
      event.currentTarget.reset();
      setNotice("Video uploaded and processing queued");
    });
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-950/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-400">Rugby intelligence platform</p>
            <h1 className="mt-1 text-2xl font-bold">Video Analysis Workspace</h1>
          </div>
          <div className="text-right text-sm">
            <p className={connected ? "text-emerald-400" : "text-rose-400"}>{connected ? "● Connected" : "● Offline"}</p>
            <p className="mt-1 text-xs text-slate-500">{apiUrl}</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 rounded-xl border border-slate-800 bg-slate-900 px-5 py-4 text-sm text-slate-300">{notice}</div>

        <section className="grid gap-6 lg:grid-cols-3">
          <form onSubmit={createOrganisation} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Step 1</p>
            <h2 className="mt-2 text-xl font-bold">Organisation</h2>
            <input name="name" required minLength={2} placeholder="e.g. ACT Brumbies" className={`${fieldClass} mt-5`} />
            <button disabled={busy} className={`${buttonClass} mt-3 w-full`}>Create organisation</button>
          </form>

          <form onSubmit={createTeam} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Step 2</p>
            <h2 className="mt-2 text-xl font-bold">Teams</h2>
            <select className={`${fieldClass} mt-5`} value={selectedOrganisationId ?? ""} onChange={(e) => setSelectedOrganisationId(Number(e.target.value))}>
              <option value="">Select organisation</option>
              {organisations.map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}
            </select>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <input name="name" required placeholder="Team name" className={fieldClass} />
              <input name="age_group" placeholder="Age group" className={fieldClass} />
            </div>
            <button disabled={busy || !selectedOrganisationId} className={`${buttonClass} mt-3 w-full`}>Add team</button>
          </form>

          <form onSubmit={createMatch} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Step 3</p>
            <h2 className="mt-2 text-xl font-bold">Create match</h2>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <select name="home_team_id" required className={fieldClass}><option value="">Home team</option>{filteredTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
              <select name="away_team_id" required className={fieldClass}><option value="">Away team</option>{filteredTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
              <input name="match_date" type="date" required className={fieldClass} />
              <input name="competition" placeholder="Competition" className={fieldClass} />
            </div>
            <input name="venue" placeholder="Venue" className={`${fieldClass} mt-3`} />
            <button disabled={busy || filteredTeams.length < 2} className={`${buttonClass} mt-3 w-full`}>Create match</button>
          </form>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-end justify-between">
            <div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Step 4</p><h2 className="mt-1 text-2xl font-bold">Matches and footage</h2></div>
            <button onClick={() => void loadData()} className="rounded-lg border border-slate-700 px-4 py-2 text-sm">Refresh</button>
          </div>
          <div className="space-y-4">
            {matches.length === 0 && <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center text-slate-500">Create your first match above.</div>}
            {matches.map((match) => {
              const job = jobs.find((item) => item.match_id === match.id);
              const result = job ? processingResults[job.id] : undefined;
              return (
                <article key={match.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
                  {result && <img src={thumbnailUrl(result)} alt="Generated match video thumbnail" className="h-52 w-full object-cover" />}
                  <div className="grid gap-5 p-5 lg:grid-cols-[1fr_360px] lg:items-center">
                    <div>
                      <p className="text-sm text-slate-500">{match.match_date} · {match.competition || "Unspecified competition"}</p>
                      <h3 className="mt-2 text-xl font-bold">{teamName(match.home_team_id)} <span className="text-slate-500">vs</span> {teamName(match.away_team_id)}</h3>
                      <p className="mt-1 text-sm text-slate-400">{match.venue || "Venue not set"}</p>
                      {job && <div className="mt-4 max-w-xl"><div className="mb-2 flex justify-between text-xs uppercase tracking-wider"><span className={job.status === "failed" ? "text-rose-400" : "text-emerald-400"}>{job.status}</span><span>{job.progress_percent}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-800"><div className={`h-full transition-all ${job.status === "failed" ? "bg-rose-400" : "bg-emerald-400"}`} style={{ width: `${job.progress_percent}%` }} /></div><p className="mt-2 text-sm text-slate-400">{job.message || "Waiting for processing worker"}</p></div>}
                      {result && <div className="mt-5 grid max-w-2xl grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div className="rounded-lg bg-slate-950 p-3"><p className="text-slate-500">Duration</p><p className="mt-1 font-semibold">{formatDuration(result.duration_seconds)}</p></div><div className="rounded-lg bg-slate-950 p-3"><p className="text-slate-500">Resolution</p><p className="mt-1 font-semibold">{result.width} × {result.height}</p></div><div className="rounded-lg bg-slate-950 p-3"><p className="text-slate-500">Frame rate</p><p className="mt-1 font-semibold">{result.frame_rate} fps</p></div><div className="rounded-lg bg-slate-950 p-3"><p className="text-slate-500">Codec</p><p className="mt-1 font-semibold uppercase">{result.video_codec || "Unknown"}</p></div></div>}
                    </div>
                    <form onSubmit={(event) => uploadAndAnalyse(event, match.id)} className="rounded-lg border border-slate-700 bg-slate-950 p-4">
                      <label className="text-sm font-semibold">Upload match video</label>
                      <input name="video" type="file" accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska" required className="mt-3 block w-full text-sm text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-white" />
                      <button disabled={busy} className={`${buttonClass} mt-4 w-full`}>{job ? "Upload another video" : "Upload and start analysis"}</button>
                    </form>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
