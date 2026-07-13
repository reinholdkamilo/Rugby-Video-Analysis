"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Match, Team, VideoAsset, api, apiUrl } from "@/lib/api";

type IntelligenceMoment = {
  timestamp_seconds: number;
  match_state: string;
  side_candidate: string;
  field_zone: string;
  estimated_players: number;
  activity_level: number;
  confidence: number;
};

type IntelligenceSequence = {
  start_seconds: number;
  end_seconds: number;
  match_state: string;
  side_candidate: string;
  sample_count: number;
  average_activity: number;
  confidence: number;
};

type IntelligenceReport = {
  video_asset_id: number;
  match_id: number;
  sample_count: number;
  average_players: number;
  average_activity: number;
  high_activity_samples: number;
  state_counts: Record<string, number>;
  side_counts: Record<string, number>;
  field_zone_counts: Record<string, number>;
  stabilised_colour_candidates: string[];
  moments: IntelligenceMoment[];
  sequences: IntelligenceSequence[];
  limitations: string[];
};

const formatState = (value: string) => value.replaceAll("_", " ");
const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

export default function IntelligencePage() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [matchId, setMatchId] = useState<number | null>(null);
  const [videoId, setVideoId] = useState<number | null>(null);
  const [report, setReport] = useState<IntelligenceReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Run Stage 6 rugby understanding first, then generate the intelligence report.");

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
      setReport(null);
    });
  }, [matchId]);

  const selectedMatch = useMemo(() => matches.find((match) => match.id === matchId), [matches, matchId]);
  const teamName = (id?: number) => teams.find((team) => team.id === id)?.name ?? `Team ${id ?? ""}`;

  async function generateReport() {
    if (!videoId) return;
    setBusy(true);
    setNotice("Grouping match states, activity, field views and side candidates into sequences…");
    try {
      const response = await fetch(`${apiUrl}/api/intelligence/report/${videoId}`);
      const body = await response.json().catch(() => null) as IntelligenceReport | { detail?: string } | null;
      if (!response.ok) throw new Error(body && "detail" in body ? body.detail : `Request failed with status ${response.status}`);
      setReport(body as IntelligenceReport);
      setNotice("Stage 7 rugby intelligence report created.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Intelligence report failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div><p className="text-xs font-bold uppercase tracking-[0.22em] text-emerald-400">Stage 7</p><h1 className="mt-1 text-2xl font-bold">Rugby Intelligence Engine</h1></div>
          <div className="flex gap-3 text-sm"><Link href="/" className="rounded-lg border border-slate-700 px-3 py-2">Dashboard</Link><Link href="/understanding" className="rounded-lg border border-slate-700 px-3 py-2">Understanding</Link></div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-300">{notice}</div>
        <section className="mt-6 grid gap-4 rounded-xl border border-slate-800 bg-slate-900 p-5 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="text-sm text-slate-400">Match<select value={matchId ?? ""} onChange={(event) => setMatchId(Number(event.target.value) || null)} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"><option value="">Select match</option>{matches.map((match) => <option key={match.id} value={match.id}>{teamName(match.home_team_id)} vs {teamName(match.away_team_id)}</option>)}</select></label>
          <label className="text-sm text-slate-400">Video<select value={videoId ?? ""} onChange={(event) => { setVideoId(Number(event.target.value) || null); setReport(null); }} className="mt-2 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"><option value="">Select video</option>{videos.map((video) => <option key={video.id} value={video.id}>{video.original_filename}</option>)}</select></label>
          <button type="button" disabled={busy || !videoId} onClick={() => void generateReport()} className="rounded-lg bg-emerald-400 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50">{busy ? "Analysing…" : "Generate intelligence report"}</button>
        </section>

        {selectedMatch && <p className="mt-4 text-sm text-slate-500">{teamName(selectedMatch.home_team_id)} vs {teamName(selectedMatch.away_team_id)}</p>}

        {report && <>
          <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-sm text-slate-500">Samples analysed</p><p className="mt-1 text-2xl font-bold">{report.sample_count}</p></div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-sm text-slate-500">Players/sample</p><p className="mt-1 text-2xl font-bold">{report.average_players.toFixed(1)}</p></div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-sm text-slate-500">High activity</p><p className="mt-1 text-2xl font-bold">{report.high_activity_samples}</p></div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-sm text-slate-500">Sequences</p><p className="mt-1 text-2xl font-bold">{report.sequences.length}</p></div>
          </section>

          <section className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-lg font-bold">Match-state candidates</h2><div className="mt-4 space-y-3">{Object.entries(report.state_counts).sort((a, b) => b[1] - a[1]).map(([state, count]) => <div key={state} className="flex justify-between border-b border-slate-800 pb-2 text-sm"><span className="capitalize text-slate-300">{formatState(state)}</span><span className="font-bold">{count}</span></div>)}</div></div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-lg font-bold">Stabilised colour candidates</h2><div className="mt-4 flex flex-wrap gap-3">{report.stabilised_colour_candidates.map((colour) => <div key={colour} className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm"><span className="h-5 w-5 rounded-full border border-white/20" style={{ backgroundColor: colour }} /><span>{colour}</span></div>)}</div><p className="mt-4 text-xs text-slate-500">These require analyst confirmation before assignment to home and away teams.</p></div>
          </section>

          <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-lg font-bold">Detected sequences</h2><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="text-slate-500"><tr><th className="pb-3">Time</th><th>State</th><th>Side</th><th>Samples</th><th>Activity</th><th>Confidence</th></tr></thead><tbody>{report.sequences.map((sequence, index) => <tr key={`${sequence.start_seconds}-${index}`} className="border-t border-slate-800"><td className="py-3">{formatTime(sequence.start_seconds)}–{formatTime(sequence.end_seconds)}</td><td className="capitalize">{formatState(sequence.match_state)}</td><td className="capitalize">{sequence.side_candidate}</td><td>{sequence.sample_count}</td><td>{(sequence.average_activity * 100).toFixed(1)}%</td><td>{(sequence.confidence * 100).toFixed(0)}%</td></tr>)}</tbody></table></div></section>

          <section className="mt-6 rounded-xl border border-amber-700/50 bg-amber-950/20 p-5"><h2 className="font-bold text-amber-300">Current model limits</h2><ul className="mt-3 space-y-2 text-sm text-amber-100/80">{report.limitations.map((item) => <li key={item}>• {item}</li>)}</ul></section>
        </>}
      </div>
    </main>
  );
}
