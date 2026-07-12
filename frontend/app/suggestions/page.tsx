"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import {
  AutomaticSuggestion,
  EventTeam,
  EventType,
  Match,
  Team,
  VideoAsset,
  api,
} from "@/lib/api";

const EVENT_TYPES: EventType[] = [
  "kickoff", "scrum", "lineout", "carry", "tackle", "ruck", "maul", "pass",
  "kick", "turnover", "penalty", "try", "conversion", "card", "stoppage", "custom",
];
const TEAMS: EventTeam[] = ["home", "away", "neutral"];
const fieldClass = "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white";
const actionClass = "rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round((seconds % 60) * 10) / 10;
  return `${minutes}:${String(remaining).padStart(4, "0")}`;
}

export default function SuggestionsPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [suggestions, setSuggestions] = useState<AutomaticSuggestion[]>([]);
  const [matchId, setMatchId] = useState<number | null>(null);
  const [videoId, setVideoId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Select a match and processed video to begin automatic detection.");

  useEffect(() => {
    void Promise.all([api.matches.list(), api.teams.list()]).then(([matchData, teamData]) => {
      setMatches(matchData);
      setTeams(teamData);
      if (matchData[0]) setMatchId(matchData[0].id);
    }).catch((error) => setNotice(error instanceof Error ? error.message : "Unable to load matches"));
  }, []);

  useEffect(() => {
    if (!matchId) {
      setVideos([]);
      setVideoId(null);
      return;
    }
    void api.matches.videos(matchId).then((items) => {
      setVideos(items);
      setVideoId(items[0]?.id ?? null);
    }).catch((error) => setNotice(error instanceof Error ? error.message : "Unable to load videos"));
  }, [matchId]);

  useEffect(() => {
    if (!videoId) {
      setSuggestions([]);
      return;
    }
    void refreshSuggestions(videoId);
  }, [videoId]);

  const selectedMatch = useMemo(() => matches.find((item) => item.id === matchId), [matches, matchId]);
  const teamName = (id?: number) => teams.find((team) => team.id === id)?.name ?? `Team ${id ?? ""}`;
  const pendingCount = suggestions.filter((item) => item.status === "pending").length;
  const acceptedCount = suggestions.filter((item) => item.status === "accepted").length;
  const rejectedCount = suggestions.filter((item) => item.status === "rejected").length;

  async function refreshSuggestions(targetVideoId = videoId) {
    if (!targetVideoId) return;
    try {
      setSuggestions(await api.suggestions.list(targetVideoId));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load suggestions");
    }
  }

  async function detect() {
    if (!videoId) return;
    setBusy(true);
    setNotice("Analysing visual transitions. Keep this page open; longer videos can take several minutes.");
    try {
      const detected = await api.suggestions.detect(videoId);
      setSuggestions(detected);
      setNotice(`${detected.length} automatic suggestions created. Review each item before accepting it.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Automatic detection failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateSuggestion(id: number, payload: Partial<AutomaticSuggestion>) {
    setBusy(true);
    try {
      const updated = await api.suggestions.update(id, payload);
      setSuggestions((current) => current.map((item) => item.id === id ? updated : item));
      setNotice("Suggestion updated.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update suggestion");
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: number, decision: "accept" | "reject") {
    setBusy(true);
    try {
      const updated = decision === "accept" ? await api.suggestions.accept(id) : await api.suggestions.reject(id);
      setSuggestions((current) => current.map((item) => item.id === id ? updated : item));
      setNotice(decision === "accept" ? "Suggestion added to the timeline and clip library." : "Suggestion rejected.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to review suggestion");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-400">Stage 4</p>
            <h1 className="mt-1 text-2xl font-bold">Automatic Event Review</h1>
          </div>
          <div className="flex gap-3 text-sm">
            <Link href="/" className="rounded-lg border border-slate-700 px-3 py-2">Dashboard</Link>
            <Link href="/timeline" className="rounded-lg border border-slate-700 px-3 py-2">Timeline</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-300">{notice}</div>

        <section className="mt-6 grid gap-4 rounded-xl border border-slate-800 bg-slate-900 p-5 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="text-sm text-slate-400">Match
            <select value={matchId ?? ""} onChange={(event) => setMatchId(event.target.value ? Number(event.target.value) : null)} className={`${fieldClass} mt-2 block w-full`}>
              <option value="">Select match</option>
              {matches.map((match) => <option key={match.id} value={match.id}>{teamName(match.home_team_id)} vs {teamName(match.away_team_id)} · {match.match_date}</option>)}
            </select>
          </label>
          <label className="text-sm text-slate-400">Processed video
            <select value={videoId ?? ""} onChange={(event) => setVideoId(event.target.value ? Number(event.target.value) : null)} className={`${fieldClass} mt-2 block w-full`}>
              <option value="">Select video</option>
              {videos.map((video) => <option key={video.id} value={video.id}>{video.original_filename}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void detect()} disabled={busy || !videoId} className={`${actionClass} bg-emerald-400 text-slate-950`}>
            {busy ? "Analysing…" : "Run automatic detection"}
          </button>
        </section>

        {selectedMatch && <p className="mt-4 text-sm text-slate-500">{teamName(selectedMatch.home_team_id)} vs {teamName(selectedMatch.away_team_id)}</p>}

        <section className="mt-6 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-sm text-slate-500">Pending</p><p className="mt-1 text-2xl font-bold">{pendingCount}</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-sm text-slate-500">Accepted</p><p className="mt-1 text-2xl font-bold text-emerald-400">{acceptedCount}</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-sm text-slate-500">Rejected</p><p className="mt-1 text-2xl font-bold text-rose-400">{rejectedCount}</p></div>
        </section>

        <section className="mt-6 space-y-4">
          {!suggestions.length && <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center text-slate-500">No suggestions yet. Run automatic detection on a processed video.</div>}
          {suggestions.map((suggestion) => (
            <SuggestionCard key={suggestion.id} suggestion={suggestion} busy={busy} onUpdate={updateSuggestion} onDecision={decide} />
          ))}
        </section>
      </div>
    </main>
  );
}

function SuggestionCard({ suggestion, busy, onUpdate, onDecision }: {
  suggestion: AutomaticSuggestion;
  busy: boolean;
  onUpdate: (id: number, payload: Partial<AutomaticSuggestion>) => Promise<void>;
  onDecision: (id: number, decision: "accept" | "reject") => Promise<void>;
}) {
  const [eventType, setEventType] = useState<EventType>(suggestion.event_type);
  const [team, setTeam] = useState<EventTeam>(suggestion.team);
  const [start, setStart] = useState(String(suggestion.start_seconds));
  const [end, setEnd] = useState(String(suggestion.end_seconds));
  const pending = suggestion.status === "pending";

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-bold">{suggestion.label}</h2>
            <span className="rounded-full bg-slate-800 px-2 py-1 text-xs uppercase text-slate-300">{suggestion.status}</span>
          </div>
          <p className="mt-2 text-sm text-slate-400">{formatTime(suggestion.start_seconds)}–{formatTime(suggestion.end_seconds)} · {Math.round(suggestion.confidence * 100)}% confidence</p>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">{suggestion.reason}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <select value={eventType} disabled={!pending || busy} onChange={(event) => setEventType(event.target.value as EventType)} className={fieldClass}>
          {EVENT_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={team} disabled={!pending || busy} onChange={(event) => setTeam(event.target.value as EventTeam)} className={fieldClass}>
          {TEAMS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <input value={start} disabled={!pending || busy} onChange={(event) => setStart(event.target.value)} type="number" min="0" step="0.1" className={fieldClass} aria-label="Start seconds" />
        <input value={end} disabled={!pending || busy} onChange={(event) => setEnd(event.target.value)} type="number" min="0.1" step="0.1" className={fieldClass} aria-label="End seconds" />
      </div>

      {pending && <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={() => void onUpdate(suggestion.id, { event_type: eventType, team, start_seconds: Number(start), end_seconds: Number(end) })} className={`${actionClass} border border-slate-700`}>Save correction</button>
        <button type="button" disabled={busy} onClick={() => void onDecision(suggestion.id, "accept")} className={`${actionClass} bg-emerald-400 text-slate-950`}>Accept and create clip</button>
        <button type="button" disabled={busy} onClick={() => void onDecision(suggestion.id, "reject")} className={`${actionClass} bg-rose-500 text-white`}>Reject</button>
      </div>}
    </article>
  );
}
