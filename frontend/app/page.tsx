"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AnalysisJob, Match, Organisation, Team, api, apiUrl, uploadVideoInChunks } from "@/lib/api";

const fieldClass = "workspace-field";
const buttonClass = "button button--primary";
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
      setConnected(true);
      setOrganisations(organisationData);
      setTeams(teamData);
      setMatches(matchData);
      setJobs(jobData);
      setSelectedOrganisationId((current) => current && organisationData.some((item) => item.id === current) ? current : organisationData[0]?.id ?? null);
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

  const filteredTeams = useMemo(() => teams.filter((team) => team.organisation_id === selectedOrganisationId), [teams, selectedOrganisationId]);
  const selectedOrganisation = useMemo(
    () => organisations.find((organisation) => organisation.id === selectedOrganisationId) ?? null,
    [organisations, selectedOrganisationId],
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

  async function deleteSelectedOrganisation() {
    if (!selectedOrganisation) return;
    const confirmed = window.confirm(`Delete ${selectedOrganisation.name}? This removes its teams, matches, uploads, jobs and catalogue records.`);
    if (!confirmed) return;
    await run(async () => {
      await api.organisations.delete(selectedOrganisation.id);
      await loadData();
      setNotice(`${selectedOrganisation.name} deleted`);
    });
  }

  async function deleteTeamRecord(team: Team) {
    const confirmed = window.confirm(`Delete ${team.name}? Matches using this team must be deleted first.`);
    if (!confirmed) return;
    await run(async () => {
      await api.teams.delete(team.id);
      await loadData();
      setNotice(`${team.name} deleted`);
    });
  }

  async function deleteMatchRecord(match: Match) {
    const confirmed = window.confirm(`Delete ${teamName(match.home_team_id)} vs ${teamName(match.away_team_id)}? This removes uploads, analysis jobs, timeline events, clips and observations for this match.`);
    if (!confirmed) return;
    await run(async () => {
      await api.matches.delete(match.id);
      await loadData();
      setNotice("Match deleted");
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
      <section className="hero-section">
        <div className="site-container hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Rugby performance intelligence</span>
            <h1>Turn every match into a clearer coaching decision.</h1>
            <p>Upload footage, code the game, review the timeline and convert rugby events into practical insight for coaches and players.</p>
            <div className="hero-actions">
              <a href="#workspace" className="button button--gold">Start a match</a>
              <Link href="/coding" className="button button--ghost-light">Open coding workspace</Link>
            </div>
            <div className="hero-proof"><span>✓ Guided setup</span><span>✓ Rugby event coding</span><span>✓ Video-linked reports</span></div>
          </div>

          <div className="product-stage" aria-label="Rugby analysis interface preview">
            <div className="product-screen product-screen--main">
              <div className="screen-top"><span className="screen-logo">RVA</span><span>ACT Brumbies U16 v Waratahs U16</span><span className="live-pill">LIVE</span></div>
              <div className="screen-body"><div className="video-placeholder"><div className="pitch-lines"/><div className="play-button">▶</div></div><div className="analysis-panel"><div className="metric-row"><span>Possession</span><strong>54%</strong></div><div className="metric-row"><span>Territory</span><strong>61%</strong></div><div className="metric-row"><span>Ruck speed</span><strong>3.1s</strong></div><div className="tag-grid"><b>Carry</b><b>Tackle</b><b>Ruck</b><b>Kick</b></div></div></div>
              <div className="timeline-bars"><i/><i/><i/><i/><i/><i/><i/></div>
            </div>
            <div className="product-screen product-screen--tablet"><div className="mini-title">Match report</div><div className="report-chart"/><div className="report-list"><span/><span/><span/></div></div>
            <div className="product-screen product-screen--phone"><div className="phone-video"/><strong>Clip review</strong><small>12 tagged moments</small></div>
          </div>
        </div>
      </section>

      <section className="workflow-band"><div className="site-container workflow-band__grid">{[['01','Prepare','Build the organisation, teams and fixture.'],['02','Upload','Attach footage and process the source video.'],['03','Analyse','Code events, review sequences and create clips.'],['04','Understand','Convert evidence into rugby intelligence.']].map(([number,title,text]) => <div key={number} className="workflow-step"><span>{number}</span><div><strong>{title}</strong><p>{text}</p></div></div>)}</div></section>

      <section className="feature-section"><div className="site-container feature-grid"><div className="feature-copy"><span className="eyebrow eyebrow--dark">Flexible by design</span><h2>A workflow built around how rugby coaches actually review a game.</h2><p>Move from programme setup to coding and reporting without switching between disconnected tools. Every match, event and insight stays linked to the footage.</p><Link href="/timeline" className="text-link">Explore the timeline →</Link></div><div className="feature-cards"><article><span>01</span><h3>Code what matters</h3><p>Tag carries, tackles, rucks, kicks, set piece and custom events with keyboard-first controls.</p></article><article><span>02</span><h3>See the sequence</h3><p>Review match moments chronologically and seek directly back to the source footage.</p></article><article><span>03</span><h3>Share the evidence</h3><p>Build clips and reports that connect coaching language to visible match behaviour.</p></article></div></div></section>

      <section id="workspace" className="workspace-section"><div className="site-container"><div className="section-heading section-heading--split"><div><span className="eyebrow eyebrow--dark">Live workspace</span><h2>Prepare your next match.</h2><p>Complete the setup in order, then upload footage and move into analysis.</p></div><div className="connection-card"><span className={connected ? "status-dot status-dot--live" : "status-dot status-dot--off"}/><div><strong>{connected ? "Platform connected" : "Platform offline"}</strong><small>{apiUrl}</small></div></div></div>

        <div className="workspace-status"><div><span>Current status</span><strong>{notice}</strong></div><button onClick={() => void loadData()} className="button button--secondary">Refresh</button></div>

        <div className="workspace-layout"><aside className="workspace-rail"><span className="rail-label">Match setup</span><a href="#step-1"><b>1</b><span>Organisation<small>Programme owner</small></span></a><a href="#step-2"><b>2</b><span>Teams<small>Home and away squads</small></span></a><a href="#step-3"><b>3</b><span>Match<small>Fixture details</small></span></a><a href="#step-4"><b>4</b><span>Footage<small>Upload and process</small></span></a></aside>

          <div className="workspace-content"><div className="setup-grid">
            <form id="step-1" onSubmit={createOrganisation} className="setup-card"><div className="setup-card__head"><span>01</span><div><small>Foundation</small><h3>Organisation</h3></div></div><p>Create the club, school or programme responsible for this analysis.</p><input name="name" required minLength={2} placeholder="e.g. ACT Brumbies" className={fieldClass}/><button type="submit" disabled={busy} className={buttonClass}>Create organisation</button></form>

            <form id="step-2" onSubmit={createTeam} className="setup-card"><div className="setup-card__head"><span>02</span><div><small>Squads</small><h3>Teams</h3></div></div><p>Select the organisation and add the squads involved.</p><select className={fieldClass} value={selectedOrganisationId ?? ""} onChange={(event) => setSelectedOrganisationId(event.target.value ? Number(event.target.value) : null)}><option value="">Select organisation</option>{organisations.map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}</select>{selectedOrganisation && <button type="button" disabled={busy} onClick={() => void deleteSelectedOrganisation()} className="button button--danger">Delete selected organisation</button>}<div className="field-pair"><input name="name" required minLength={2} placeholder="Team name" className={fieldClass}/><input name="age_group" placeholder="Age group" className={fieldClass}/></div><button type="submit" disabled={busy || !selectedOrganisationId} className={buttonClass}>Add team</button>{filteredTeams.length > 0 && <div className="management-list">{filteredTeams.map((team) => <div key={team.id} className="management-row"><div><strong>{team.name}</strong><small>{team.age_group || "Age group not set"}</small></div><button type="button" disabled={busy} onClick={() => void deleteTeamRecord(team)} className="button button--danger button--compact">Delete</button></div>)}</div>}</form>

            <form id="step-3" onSubmit={createMatch} className="setup-card setup-card--wide"><div className="setup-card__head"><span>03</span><div><small>Fixture</small><h3>Create match</h3></div></div><p>Add match context before attaching footage.</p><div className="match-form-grid"><select name="home_team_id" required className={fieldClass}><option value="">Home team</option>{filteredTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select><select name="away_team_id" required className={fieldClass}><option value="">Away team</option>{filteredTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select><input name="match_date" type="date" required className={fieldClass}/><input name="competition" placeholder="Competition" className={fieldClass}/><input name="venue" placeholder="Venue" className={`${fieldClass} match-form-grid__wide`}/></div><button type="submit" disabled={busy || filteredTeams.length < 2} className={buttonClass}>Create match</button></form>
          </div>

          <section id="step-4" className="footage-section"><div className="footage-section__head"><div><span className="eyebrow eyebrow--dark">Step 04 · Footage</span><h3>Matches ready for analysis</h3><p>Upload a short clip, monitor processing and continue into the analyst tools.</p></div><Link href="/catalog" className="button button--secondary">Programme manager</Link></div>
            {!matches.length && <div className="empty-state"><span>◌</span><strong>No matches yet</strong><p>Complete the setup above to create your first fixture.</p></div>}
            <div className="match-list">{matches.map((match) => { const job = jobs.find((item) => item.match_id === match.id); const progress = uploadProgress[match.id]; return <article key={match.id} className="match-card"><div className="match-card__content"><div className="match-meta"><span>{match.match_date}</span><span>{match.competition || "Competition not set"}</span></div><h4>{teamName(match.home_team_id)} <em>vs</em> {teamName(match.away_team_id)}</h4><p>{match.venue || "Venue not set"}</p>{job && <div className="job-progress"><div><span>{job.status}</span><strong>{job.progress_percent}%</strong></div><div className="progress-track"><i style={{ width: `${job.progress_percent}%` }}/></div><small>{job.message}</small></div>}<div className="match-actions"><Link href="/coding" className="button button--secondary">Open coding</Link><Link href="/timeline" className="button button--secondary">View timeline</Link><button type="button" disabled={busy} onClick={() => void deleteMatchRecord(match)} className="button button--danger">Delete match</button></div></div><form onSubmit={(event) => uploadAndAnalyse(event, match.id)} className="upload-card"><span className="upload-card__icon">↑</span><strong>Upload match footage</strong><p>Full-match uploads use persistent R2 storage.</p><input name="video" type="file" accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/x-m4v" required/>{progress && <div className="job-progress"><div><span>{progress.message}</span><strong>{progress.percent}%</strong></div><div className="progress-track"><i style={{ width: `${progress.percent}%` }}/></div></div>}<button type="submit" disabled={busy} className={buttonClass}>{busy && progress ? "Uploading…" : "Upload and start analysis"}</button></form></article>; })}</div>
          </section></div></div></div></section>

      <section className="tools-section"><div className="site-container"><div className="section-heading section-heading--center"><span className="eyebrow">Connected analysis tools</span><h2>Everything stays linked to the match.</h2></div><div className="tool-grid">{[["Coding","Tag rugby events quickly and consistently.","/coding"],["Timeline","Review every coded moment chronologically.","/timeline"],["Suggestions","Compare automated candidates with analyst judgement.","/suggestions"],["Intelligence","Turn coded evidence into a coaching report.","/intelligence"]].map(([title,text,href]) => <Link href={href} key={title} className="tool-card"><span>↗</span><h3>{title}</h3><p>{text}</p></Link>)}</div></div></section>

      <footer className="site-footer"><div className="site-container site-footer__grid"><div><strong>Rugby Video Analysis</strong><p>Professional match coding and performance intelligence.</p></div><div><Link href="/coding">Coding</Link><Link href="/timeline">Timeline</Link><Link href="/intelligence">Intelligence</Link><Link href="/system">System</Link></div></div></footer>
    </main>
  );
}
