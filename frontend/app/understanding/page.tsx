"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Match, RugbyUnderstandingObservation, Team, VideoAsset, api, visionFrameUrl } from "@/lib/api";

export default function UnderstandingPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [observations, setObservations] = useState<RugbyUnderstandingObservation[]>([]);
  const [matchId, setMatchId] = useState<number | null>(null);
  const [videoId, setVideoId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Run Stage 5 vision analysis first, then start rugby understanding.");

  useEffect(() => {
    void Promise.all([api.matches.list(), api.teams.list()]).then(([matchData, teamData]) => {
      setMatches(matchData);
      setTeams(teamData);
      setMatchId(matchData[0]?.id ?? null);
    }).catch((error) => setNotice(error instanceof Error ? error.message : "Unable to load matches"));
  }, []);

  useEffect(() => {
    if (!matchId) return;
    void api.matches.videos(matchId).then((items) => {
      setVideos(items);
      setVideoId(items[0]?.id ?? null);
    });
  }, [matchId]);

  useEffect(() => {
    if (!videoId) return;
    void api.understanding.list(videoId).then(setObservations).catch(() => setObservations([]));
  }, [videoId]);

  const selectedMatch = useMemo(() => matches.find((match) => match.id === matchId), [matches, matchId]);
  const teamName = (id?: number) => teams.find((team) => team.id === id)?.name ?? `Team ${id ?? ""}`;
  const averagePlayers = observations.length ? observations.reduce((sum, item) => sum + item.estimated_players, 0) / observations.length : 0;
  const activeFrames = observations.filter((item) => item.activity_level >= 0.08).length;
  const colourPairs = Array.from(new Set(observations.map((item) => `${item.dominant_team_colour_1 ?? "?"} / ${item.dominant_team_colour_2 ?? "?"}`))).slice(0, 4);

  async function runUnderstanding() {
    if (!videoId) return;
    setBusy(true);
    setNotice("Analysing player regions, team colours, field view and activity patterns…");
    try {
      const items = await api.understanding.run(videoId);
      setObservations(items);
      setNotice(`${items.length} rugby-understanding observations created.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Rugby understanding failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div><p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-400">Stage 6</p><h1 className="mt-1 text-2xl font-bold">Rugby Understanding</h1></div>
          <div className="flex gap-3 text-sm"><Link href="/" className="rounded-lg border border-slate-700 px-3 py-2">Dashboard</Link><Link href="/vision" className="rounded-lg border border-slate-700 px-3 py-2">Vision</Link></div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-300">{notice}</div>
        <section className="mt-6 grid gap-4 rounded-xl border border-slate-800 bg-slate-900 p-5 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="text-sm text-slate-400">Match<select value={matchId ?? ""} onChange={(event) => setMatchId(Number(event.target.value) || null)} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"><option value="">Select match</option>{matches.map((match) => <option key={match.id} value={match.id}>{teamName(match.home_team_id)} vs {teamName(match.away_team_id)}</option>)}</select></label>
          <label className="text-sm text-slate-400">Video<select value={videoId ?? ""} onChange={(event) => setVideoId(Number(event.target.value) || null)} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"><option value="">Select video</option>{videos.map((video) => <option key={video.id} value={video.id}>{video.original_filename}</option>)}</select></label>
          <button type="button" disabled={busy || !videoId} onClick={() => void runUnderstanding()} className="rounded-lg bg-emerald-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">{busy ? "Analysing…" : "Run rugby understanding"}</button>
        </section>

        {selectedMatch && <p className="mt-4 text-sm text-slate-500">{teamName(selectedMatch.home_team_id)} vs {teamName(selectedMatch.away_team_id)}</p>}

        <section className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-sm text-slate-500">Frames understood</p><p className="mt-1 text-2xl font-bold">{observations.length}</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-sm text-slate-500">Estimated players/frame</p><p className="mt-1 text-2xl font-bold">{averagePlayers.toFixed(1)}</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-sm text-slate-500">High-activity frames</p><p className="mt-1 text-2xl font-bold">{activeFrames}</p></div>
        </section>

        {colourPairs.length > 0 && <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">Detected colour pairs: {colourPairs.join(", ")}</div>}

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {observations.map((item) => (
            <article key={item.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              <img src={visionFrameUrl(item)} alt={`Frame at ${item.timestamp_seconds} seconds`} className="aspect-video w-full object-cover" />
              <div className="p-4 text-sm text-slate-400"><p className="font-bold text-white">{item.timestamp_seconds.toFixed(1)} seconds</p><p className="mt-2">Players: {item.estimated_players} · zone: {item.field_zone}</p><p>Activity: {(item.activity_level * 100).toFixed(1)}% · side candidate: {item.possession_side_candidate}</p><p>Confidence: {(item.confidence * 100).toFixed(0)}%</p></div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
