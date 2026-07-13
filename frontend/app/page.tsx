"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AnalysisJob, Match, Organisation, Team, api, apiUrl, uploadVideoInChunks } from "@/lib/api";

const fieldClass = "w-full px-3.5 py-3 text-sm outline-none";
const buttonClass = "rounded-xl bg-emerald-400 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";

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
      setSelectedOrganisationId((current) =>
        current && organisationData.some((item) => item.id === current) ? current : organisationData[0]?.id ?? null,
      );
      setNotice("Workspace ready");
    } catch (error) {
      setConnected(false);
      setNotice(error instanceof Error ? error.message : "Backend unavailable");
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
    try { await action(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Something went wrong"); }
    finally { setBusy(false); }
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
    if (!selectedOrganisationId) return setNotice("Create or select an organisation before adding a team.");
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
    setBusy(true);
    setUploadProgress((current) => ({ ...current, [matchId]: { percent: 0, message: "Starting resumable upload" } }));
    try {
      await uploadVideoInChunks(matchId, file, (percent, message) => {
        setUploadProgress((current) => ({ ...current, [matchId]: { percent, message } }));
        setNotice(`${file.name}: ${message}`);
      });
      formElement.reset();
      setJobs(await api.jobs.list());
      setNotice("Video uploaded successfully and processing has started");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setUploadProgress((current) => ({ ...current, [matchId]: { percent: 0, message } }));
      setNotice(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <section className="product-hero">
        <div className="hero-content mx-auto grid max-w-[1500px] gap-12 px-6 py-16 lg:grid-cols-[0.92fr_1.08fr] lg:items-center lg:px-8 lg:py-24">
          <div>
            <p className="hero-eyebrow">Rugby performance analysis, evolved</p>
            <h1 className="hero-title mt-4">Turn match footage into clear coaching decisions.</h1>
            <p className="hero-copy mt-6">Upload, code, review and understand rugby from one connected workspace. Built for coaches and analysts who need faster workflows and better conversations.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#workspace" className="hero-primary">Start your analysis</a>
              <Link href="/coding" className="hero-secondary">Open coding workspace</Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm font-semibold text-white/70">
              <span>✓ Match coding</span><span>✓ Video-linked timeline</span><span>✓ Rugby intelligence</span>
            </div>
          </div>

          <div className="device-stage" aria-label="Rugby analysis platform across devices">
            <div className="device-laptop">
              <div className="device-screen">
                <div className="device-toolbar" />
                <div className="device-grid">
                  <div className="device-video"><div className="device-timeline" /></div>
                  <div className="device-panel"><div className="device-chip" /><div className="device-chip" /><div className="device-chip" /><div className="device-chip" /><div className="device-chip" /></div>
                </div>
              </div>
            </div>
            <div className="device-tablet"><div className="device-tablet-screen"><div className="h-3 w-2/3 rounded bg-slate-800" /><div className="mt-4 grid grid-cols-2 gap-2"><div className="h-16 rounded-lg bg-emerald-400" /><div className="h-16 rounded-lg bg-slate-800" /><div className="h-16 rounded-lg bg-slate-800" /><div className="h-16 rounded-lg bg-sky-400" /></div></div></div>
            <div className="device-phone"><div className="device-phone-screen"><div className="mt-20 h-2 w-full rounded bg-slate-800" /><div className="mt-2 h-2 w-4/5 rounded bg-slate-800" /><div className="mt-5 h-9 rounded-lg bg-emerald-400" /></div></div>
          </div>
        </div>
      </section>

      <section className="dark-band">
        <div className="mx-auto grid max-w-[1400px] gap-8 px-6 py-10 text-center sm:grid-cols-3 lg:px-8">
          <div><p className="text-3xl font-black text-white">One workflow</p><p className="mt-1 text-sm text-white/55">From fixture setup to final insight</p></div>
          <div><p className="text-3xl font-black text-white">Rugby specific</p><p className="mt-1 text-sm text-white/55">Coding language built for the game</p></div>
          <div><p className="text-3xl font-black text-white">Any device</p><p className="mt-1 text-sm text-white/55">Review and share wherever you coach</p></div>
        </div>
      </section>

      <section className="section-shell text-center">
        <p className="section-kicker">Integrated analysis workspace</p>
        <h2 className="section-title">A clear path from video to performance.</h2>
        <p className="section-copy mx-auto mt-4">The platform is organised around the way rugby programmes actually work: establish the programme, prepare the fixture, code the match and convert evidence into action.</p>
        <div className="mt-10 grid gap-5 text-left md:grid-cols-2 lg:grid-cols-4">
          {[
            ["01", "Prepare", "Create organisations, squads, seasons and fixtures."],
            ["02", "Upload", "Attach footage and monitor processing from one place."],
            ["03", "Code", "Tag rugby events against video with fast analyst controls."],
            ["04", "Understand", "Turn coded evidence into timelines, suggestions and reports."],
          ].map(([number, title, copy]) => (
            <div key={number} className="workflow-card"><span className="workflow-number">{number}</span><h3 className="mt-5 text-xl font-black">{title}</h3><p className="mt-2 text-sm text-slate-500">{copy}</p></div>
          ))}
        </div>
      </section>

      <section id="workspace" className="border-y border-slate-800 bg-white">
        <div className="section-shell">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="section-kicker">Live workspace</p>
              <h2 className="section-title">Set up your next match.</h2>
              <p className="section-copy mt-4">Complete the three setup cards in order. The match will then appear in the footage area below, ready for upload and analysis.</p>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-5 py-4 shadow-sm">
              <span className={`h-3 w-3 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400"}`} />
              <div><p className="text-sm font-black">{connected ? "Platform connected" : "Platform offline"}</p><p className="text-xs text-slate-500">{apiUrl}</p></div>
            </div>
          </div>

          <div className="mt-8 flex items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900 px-5 py-4 shadow-sm">
            <div><p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">System status</p><p className="mt-1 text-sm font-semibold">{notice}</p></div>
            <button type="button" onClick={() => void loadData()} className="rounded-xl border border-slate-800 bg-white px-4 py-2 text-sm font-bold">Refresh</button>
          </div>

          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            <form onSubmit={createOrganisation} className="workflow-card">
              <div className="flex items-center gap-3"><span className="workflow-number">1</span><div><p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Foundation</p><h3 className="text-xl font-black">Organisation</h3></div></div>
              <p className="mt-4 text-sm text-slate-500">Create the club, school or programme that owns the analysis.</p>
              <input name="name" required minLength={2} placeholder="e.g. ACT Brumbies" className={`${fieldClass} mt-5`} />
              <button type="submit" disabled={busy} className={`${buttonClass} mt-3 w-full`}>Create organisation</button>
            </form>

            <form onSubmit={createTeam} className="workflow-card">
              <div className="flex items-center gap-3"><span className="workflow-number">2</span><div><p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Squads</p><h3 className="text-xl font-black">Teams</h3></div></div>
              <p className="mt-4 text-sm text-slate-500">Select the organisation and add the squads involved.</p>
              <select className={`${fieldClass} mt-5`} value={selectedOrganisationId ?? ""} onChange={(event) => setSelectedOrganisationId(event.target.value ? Number(event.target.value) : null)}><option value="">Select organisation</option>{organisations.map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}</select>
              <div className="mt-3 grid grid-cols-2 gap-3"><input name="name" required minLength={2} placeholder="Team name" className={fieldClass} /><input name="age_group" placeholder="Age group" className={fieldClass} /></div>
              <button type="submit" disabled={busy || !selectedOrganisationId} className={`${buttonClass} mt-3 w-full`}>Add team</button>
            </form>

            <form onSubmit={createMatch} className="workflow-card">
              <div className="flex items-center gap-3"><span className="workflow-number">3</span><div><p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Fixture</p><h3 className="text-xl font-black">Create match</h3></div></div>
              <p className="mt-4 text-sm text-slate-500">Add fixture context before attaching footage.</p>
              <div className="mt-5 grid grid-cols-2 gap-3"><select name="home_team_id" required className={fieldClass}><option value="">Home team</option>{filteredTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select><select name="away_team_id" required className={fieldClass}><option value="">Away team</option>{filteredTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select><input name="match_date" type="date" required className={fieldClass} /><input name="competition" placeholder="Competition" className={fieldClass} /></div>
              <input name="venue" placeholder="Venue" className={`${fieldClass} mt-3`} />
              <button type="submit" disabled={busy || filteredTeams.length < 2} className={`${buttonClass} mt-3 w-full`}>Create match</button>
            </form>
          </div>
        </div>
      </section>

      <section className="section-shell">
        <div className="grid gap-10 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
          <div className="lg:sticky lg:top-28">
            <p className="section-kicker">Match footage</p>
            <h2 className="section-title">Ready for analysis.</h2>
            <p className="section-copy mt-4">Upload a short clip, monitor the processing job, then move directly into coding or timeline review.</p>
            <Link href="/catalog" className="mt-6 inline-flex rounded-full border border-slate-800 bg-white px-5 py-3 text-sm font-black shadow-sm">Open programme manager →</Link>
          </div>

          <div className="space-y-5">
            {!matches.length && <div className="rounded-2xl border border-dashed border-slate-700 bg-white p-14 text-center"><p className="text-xl font-black">No matches yet</p><p className="mt-2 text-sm text-slate-500">Complete the guided setup above to create your first fixture.</p></div>}
            {matches.map((match) => {
              const job = jobs.find((item) => item.match_id === match.id);
              const progress = uploadProgress[match.id];
              return (
                <article key={match.id} className="rounded-2xl border border-slate-800 bg-white p-6 shadow-sm">
                  <div className="grid gap-6 xl:grid-cols-[1fr_360px] xl:items-center">
                    <div>
                      <div className="flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-wider text-slate-500"><span>{match.match_date}</span><span>•</span><span>{match.competition || "Competition not set"}</span></div>
                      <h3 className="mt-3 text-2xl font-black">{teamName(match.home_team_id)} <span className="font-medium text-slate-500">vs</span> {teamName(match.away_team_id)}</h3>
                      <p className="mt-2 text-sm text-slate-500">{match.venue || "Venue not set"}</p>
                      {job && <div className="mt-5 max-w-xl"><div className="mb-2 flex justify-between text-xs font-bold uppercase tracking-wider"><span>{job.status}</span><span>{job.progress_percent}%</span></div><div className="h-2.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${job.progress_percent}%` }} /></div><p className="mt-2 text-sm text-slate-500">{job.message}</p></div>}
                      <div className="mt-5 flex flex-wrap gap-2"><Link href="/coding" className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-bold text-white">Open coding</Link><Link href="/timeline" className="rounded-xl border border-slate-800 bg-white px-4 py-2 text-sm font-bold">View timeline</Link></div>
                    </div>
                    <form onSubmit={(event) => uploadAndAnalyse(event, match.id)} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                      <label className="text-sm font-black">Upload match footage</label>
                      <p className="mt-1 text-xs text-slate-500">Phase 1 supports short clips up to 100 MB.</p>
                      <input name="video" type="file" accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/x-m4v" required className="mt-4 block w-full text-sm" />
                      {progress && <div className="mt-4"><div className="mb-2 flex justify-between text-xs font-semibold"><span>{progress.message}</span><span>{progress.percent}%</span></div><div className="h-2.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-sky-400 transition-all" style={{ width: `${progress.percent}%` }} /></div></div>}
                      <button type="submit" disabled={busy} className={`${buttonClass} mt-4 w-full`}>{busy && progress ? "Uploading…" : "Upload and start analysis"}</button>
                    </form>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="dark-band">
        <div className="section-shell text-center">
          <p className="hero-eyebrow">Connected analysis tools</p>
          <h2 className="mt-3 text-4xl font-black text-white sm:text-5xl">Everything your review workflow needs.</h2>
          <div className="mt-10 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["C", "Coding", "Tag carries, tackles, rucks, kicks, set piece and outcomes."],
              ["T", "Timeline", "Review every coded event in chronological order against video."],
              ["S", "Suggestions", "Surface evidence-based event candidates for analyst review."],
              ["I", "Intelligence", "Convert coded evidence into clear rugby observations."],
            ].map(([icon, title, copy]) => <div key={title} className="rounded-2xl border border-white/10 bg-white/5 p-6"><span className="feature-icon">{icon}</span><h3 className="mt-5 text-xl font-black text-white">{title}</h3><p className="mt-2 text-sm text-white/55">{copy}</p></div>)}
          </div>
        </div>
      </section>

      <footer className="bg-[#0b171b] text-white">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-6 py-9 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <div><p className="font-black">Rugby Video Analysis</p><p className="mt-1 text-xs text-white/45">Professional performance intelligence for the modern rugby programme.</p></div>
          <div className="flex flex-wrap gap-5 text-xs font-bold text-white/55"><Link href="/catalog">Programme</Link><Link href="/coding">Coding</Link><Link href="/intelligence">Intelligence</Link><Link href="/system">System</Link></div>
        </div>
      </footer>
    </main>
  );
}
