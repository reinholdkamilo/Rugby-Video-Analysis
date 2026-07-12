"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  EventTeam,
  EventType,
  Match,
  Team,
  TimelineEvent,
  VideoAsset,
  api,
  clipUrl,
} from "@/lib/api";

const eventTypes: EventType[] = [
  "kickoff", "scrum", "lineout", "carry", "tackle", "ruck", "maul", "pass",
  "kick", "turnover", "penalty", "try", "conversion", "card", "stoppage", "custom",
];
const fieldClass = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400";

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

export default function TimelinePage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);
  const [filter, setFilter] = useState<EventType | "all">("all");
  const [notice, setNotice] = useState("Loading analyst workspace...");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.matches.list(), api.teams.list()])
      .then(([matchData, teamData]) => {
        setMatches(matchData);
        setTeams(teamData);
        setSelectedMatchId(matchData[0]?.id ?? null);
        setNotice(matchData.length ? "Select a video and begin tagging." : "Create and process a match first.");
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "Unable to load matches."));
  }, []);

  useEffect(() => {
    if (!selectedMatchId) {
      setVideos([]);
      setEvents([]);
      return;
    }
    Promise.all([api.matches.videos(selectedMatchId), api.timeline.list(selectedMatchId)])
      .then(([videoData, eventData]) => {
        setVideos(videoData);
        setEvents(eventData);
        setSelectedVideoId((current) => current && videoData.some((video) => video.id === current) ? current : videoData[0]?.id ?? null);
      })
      .catch((error) => setNotice(error instanceof Error ? error.message : "Unable to load timeline."));
  }, [selectedMatchId]);

  const selectedMatch = matches.find((match) => match.id === selectedMatchId);
  const teamName = (id: number | undefined) => teams.find((team) => team.id === id)?.name ?? "Team";
  const visibleEvents = useMemo(
    () => events.filter((event) => (!selectedVideoId || event.video_asset_id === selectedVideoId) && (filter === "all" || event.event_type === filter)),
    [events, selectedVideoId, filter],
  );

  async function createEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMatchId || !selectedVideoId) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      const created = await api.timeline.create({
        match_id: selectedMatchId,
        video_asset_id: selectedVideoId,
        event_type: String(form.get("event_type")) as EventType,
        team: String(form.get("team")) as EventTeam,
        start_seconds: Number(form.get("start_seconds")),
        end_seconds: Number(form.get("end_seconds")),
        player_name: String(form.get("player_name") || "") || null,
        outcome: String(form.get("outcome") || "") || null,
        notes: String(form.get("notes") || "") || null,
        phase_number: form.get("phase_number") ? Number(form.get("phase_number")) : null,
        field_zone: String(form.get("field_zone") || "") || null,
        clip_requested: form.get("clip_requested") === "on",
      });
      setEvents((current) => [...current, created].sort((a, b) => a.start_seconds - b.start_seconds));
      formElement.reset();
      setNotice(created.clip ? "Event tagged and clip exported." : "Event tagged. Clip was not generated.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to create event.");
    } finally {
      setBusy(false);
    }
  }

  async function regenerateClip(item: TimelineEvent) {
    setBusy(true);
    try {
      const clip = await api.timeline.regenerateClip(item.id);
      setEvents((current) => current.map((event) => event.id === item.id ? { ...event, clip } : event));
      setNotice("Clip regenerated successfully.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to generate clip.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-400">Rugby analysis</p>
            <h1 className="mt-1 text-2xl font-bold">Timeline Tagging Workspace</h1>
          </div>
          <a href="/" className="rounded-lg border border-slate-700 px-4 py-2 text-sm">Back to dashboard</a>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900 px-5 py-4 text-sm text-slate-300">{notice}</div>

        <section className="grid gap-6 lg:grid-cols-[380px_1fr]">
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="text-lg font-bold">Match and footage</h2>
              <select className={`${fieldClass} mt-4`} value={selectedMatchId ?? ""} onChange={(e) => setSelectedMatchId(Number(e.target.value))}>
                <option value="">Select match</option>
                {matches.map((match) => <option key={match.id} value={match.id}>{teamName(match.home_team_id)} vs {teamName(match.away_team_id)} · {match.match_date}</option>)}
              </select>
              <select className={`${fieldClass} mt-3`} value={selectedVideoId ?? ""} onChange={(e) => setSelectedVideoId(Number(e.target.value))}>
                <option value="">Select video</option>
                {videos.map((video) => <option key={video.id} value={video.id}>{video.original_filename}</option>)}
              </select>
              {selectedMatch && <p className="mt-4 text-sm text-slate-400">{selectedMatch.competition || "Competition not set"} · {selectedMatch.venue || "Venue not set"}</p>}
            </div>

            <form onSubmit={createEvent} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="text-lg font-bold">Tag an event</h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <select name="event_type" required className={fieldClass}>{eventTypes.map((type) => <option key={type} value={type}>{type.replace("_", " ")}</option>)}</select>
                <select name="team" className={fieldClass}><option value="home">Home</option><option value="away">Away</option><option value="neutral">Neutral</option></select>
                <input name="start_seconds" type="number" min="0" step="0.1" required placeholder="Start seconds" className={fieldClass} />
                <input name="end_seconds" type="number" min="0.1" step="0.1" required placeholder="End seconds" className={fieldClass} />
                <input name="player_name" placeholder="Player" className={fieldClass} />
                <input name="outcome" placeholder="Outcome" className={fieldClass} />
                <input name="phase_number" type="number" min="1" placeholder="Phase" className={fieldClass} />
                <input name="field_zone" placeholder="Field zone" className={fieldClass} />
              </div>
              <textarea name="notes" rows={3} placeholder="Analyst notes" className={`${fieldClass} mt-3`} />
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-300"><input name="clip_requested" type="checkbox" defaultChecked /> Export video clip automatically</label>
              <button disabled={busy || !selectedVideoId} className="mt-4 w-full rounded-lg bg-emerald-400 px-4 py-3 font-bold text-slate-950 disabled:opacity-50">Save event</button>
            </form>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Tagged moments</p><h2 className="mt-1 text-2xl font-bold">Match timeline</h2></div>
              <select value={filter} onChange={(e) => setFilter(e.target.value as EventType | "all")} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="all">All events</option>{eventTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select>
            </div>

            <div className="mt-6 space-y-3">
              {visibleEvents.length === 0 && <div className="rounded-lg border border-dashed border-slate-700 p-10 text-center text-slate-500">No events tagged for this footage.</div>}
              {visibleEvents.map((item) => (
                <article key={item.id} className="rounded-lg border border-slate-800 bg-slate-950 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-3"><span className="rounded bg-emerald-400/15 px-2 py-1 text-xs font-bold uppercase text-emerald-400">{item.event_type}</span><span className="text-sm font-semibold">{formatTime(item.start_seconds)}–{formatTime(item.end_seconds)}</span><span className="text-xs uppercase text-slate-500">{item.team}</span></div>
                      <p className="mt-3 text-sm text-slate-300">{item.player_name || "No player"}{item.outcome ? ` · ${item.outcome}` : ""}{item.phase_number ? ` · Phase ${item.phase_number}` : ""}</p>
                      {item.notes && <p className="mt-2 text-sm text-slate-500">{item.notes}</p>}
                    </div>
                    <div className="flex gap-2">
                      {item.clip ? <a href={clipUrl(item.clip)} target="_blank" rel="noreferrer" className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-950">Open clip</a> : <button disabled={busy} onClick={() => void regenerateClip(item)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm">Generate clip</button>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
