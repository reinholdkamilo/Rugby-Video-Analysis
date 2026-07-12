"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Match, Team, VideoAsset, VisionObservation, api, visionFrameUrl } from "@/lib/api";

export default function VisionPage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [observations, setObservations] = useState<VisionObservation[]>([]);
  const [matchId, setMatchId] = useState<number | null>(null);
  const [videoId, setVideoId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Select a processed video and run the first rugby-vision pass.");

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
    if (!videoId) { setObservations([]); return; }
    void api.vision.list(videoId).then(setObservations).catch(() => setObservations([]));
  }, [videoId]);

  const selectedMatch = useMemo(() => matches.find((item) => item.id === matchId), [matches, matchId]);
  const teamName = (id?: number) => teams.find((team) => team.id === id)?.name ?? `Team ${id ?? ""}`;
  const fieldFrames = observations.filter((item) => item.field_visible).length;
  const scoreboardFrames = observations.filter((item) => item.scoreboard_confidence >= 0.22).length;
  const averageMotion = observations.length ? observations.reduce((sum, item) => sum + item.motion_score, 0) / observations.length : 0;

  async function runVision() {
    if (!videoId) return;
    setBusy(true);
    setNotice("Sampling frames and measuring field, motion and scoreboard evidence…");
    try {
      const data = await api.vision.run(videoId, 2);
      setObservations(data);
      setNotice(`${data.length} frames analysed. Review the visual evidence below.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Vision analysis failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div><p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-400">Stage 5</p><h1 className="mt-1 text-2xl font-bold">Rugby Vision Review</h1></div>
          <nav className="flex gap-3 text-sm"><Link href="/" className="rounded-lg border border-slate-700 px-3 py-2">Dashboard</Link><Link href="/suggestions" className="rounded-lg border border-slate-700 px-3 py-2">Event Review</Link></nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-300">{notice}</div>
        <section className="mt-6 grid gap-4 rounded-xl border border-slate-800 bg-slate-900 p-5 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="text-sm text-slate-400">Match<select value={matchId ?? ""} onChange={(event) => setMatchId(event.target.value ? Number(event.target.value) : null)} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"><option value="">Select match</option>{matches.map((match) => <option key={match.id} value={match.id}>{teamName(match.home_team_id)} vs {teamName(match.away_team_id)}</option>)}</select></label>
          <label className="text-sm text-slate-400">Video<select value={videoId ?? ""} onChange={(event) => setVideoId(event.target.value ? Number(event.target.value) : null)} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"><option value="">Select video</option>{videos.map((video) => <option key={video.id} value={video.id}>{video.original_filename}</option>)}</select></label>
          <button type="button" onClick={() => void runVision()} disabled={busy || !videoId} className="rounded-lg bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950 disabled:opacity-50">{busy ? "Analysing…" : "Run vision analysis"}</button>
        </section>

        {selectedMatch && <p className="mt-4 text-sm text-slate-500">{teamName(selectedMatch.home_team_id)} vs {teamName(selectedMatch.away_team_id)}</p>}
        <section className="mt-6 grid gap-3 sm:grid-cols-3">
          <Metric label="Frames sampled" value={observations.length} />
          <Metric label="Field visible" value={`${fieldFrames}/${observations.length || 0}`} />
          <Metric label="Scoreboard candidates" value={scoreboardFrames} />
        </section>
        <p className="mt-3 text-xs text-slate-500">Average motion score: {(averageMotion * 100).toFixed(1)}%</p>

        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {observations.map((observation) => (
            <article key={observation.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              <img src={visionFrameUrl(observation)} alt={`Sampled match frame at ${observation.timestamp_seconds} seconds`} className="aspect-video w-full object-cover" />
              <div className="p-4 text-sm"><p className="font-bold">{observation.timestamp_seconds.toFixed(1)} seconds</p><p className="mt-2 text-slate-400">Field green: {(observation.field_green_ratio * 100).toFixed(1)}% · {observation.field_visible ? "field visible" : "field uncertain"}</p><p className="mt-1 text-slate-400">Motion: {(observation.motion_score * 100).toFixed(1)}% · brightness {(observation.brightness * 100).toFixed(1)}%</p><p className="mt-1 text-slate-400">Scoreboard confidence: {(observation.scoreboard_confidence * 100).toFixed(0)}%</p></div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>;
}
