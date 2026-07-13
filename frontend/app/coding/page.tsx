"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EventTeam, EventType, Match, Team, TimelineEvent, VideoAsset } from "@/lib/api";
import { codingApi, sourceVideoUrl } from "@/lib/coding-api";

const EVENT_TYPES: EventType[] = [
  "kickoff", "scrum", "lineout", "carry", "tackle", "ruck", "maul", "pass",
  "kick", "turnover", "penalty", "try", "conversion", "card", "stoppage", "custom",
];

const QUICK_TAGS: { key: string; label: string; type: EventType; duration: number }[] = [
  { key: "1", label: "Carry", type: "carry", duration: 6 },
  { key: "2", label: "Tackle", type: "tackle", duration: 5 },
  { key: "3", label: "Ruck", type: "ruck", duration: 6 },
  { key: "4", label: "Pass", type: "pass", duration: 4 },
  { key: "5", label: "Kick", type: "kick", duration: 8 },
  { key: "6", label: "Lineout", type: "lineout", duration: 18 },
  { key: "7", label: "Scrum", type: "scrum", duration: 22 },
  { key: "8", label: "Penalty", type: "penalty", duration: 8 },
  { key: "9", label: "Try", type: "try", duration: 12 },
];

const inputClass = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400";

function formatTime(seconds: number) {
  const value = Math.max(0, seconds || 0);
  const minutes = Math.floor(value / 60);
  const remaining = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

export default function CodingWorkspace() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<EventTeam>("home");
  const [currentTime, setCurrentTime] = useState(0);
  const [notice, setNotice] = useState("Loading coding workspace...");
  const [busy, setBusy] = useState(false);

  const loadWorkspace = useCallback(async () => {
    try {
      const [matchData, teamData] = await Promise.all([codingApi.matches(), codingApi.teams()]);
      setMatches(matchData);
      setTeams(teamData);
      setSelectedMatchId((current) => current ?? matchData[0]?.id ?? null);
      setNotice(matchData.length ? "Select a match and source video to begin coding." : "Create and upload a match before coding.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load workspace");
    }
  }, []);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  useEffect(() => {
    if (!selectedMatchId) {
      setVideos([]);
      setEvents([]);
      setSelectedVideoId(null);
      return;
    }
    void (async () => {
      try {
        const videoData = await codingApi.videos(selectedMatchId);
        setVideos(videoData);
        const nextVideoId = videoData[0]?.id ?? null;
        setSelectedVideoId(nextVideoId);
        setEvents(nextVideoId ? await codingApi.events(selectedMatchId, nextVideoId) : []);
        setNotice(nextVideoId ? "Coding workspace ready." : "This match has no uploaded footage yet.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Unable to load match footage");
      }
    })();
  }, [selectedMatchId]);

  useEffect(() => {
    if (!selectedMatchId || !selectedVideoId) return;
    void codingApi.events(selectedMatchId, selectedVideoId).then(setEvents).catch((error) => {
      setNotice(error instanceof Error ? error.message : "Unable to load timeline events");
    });
  }, [selectedMatchId, selectedVideoId]);

  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? null;
  const homeTeam = teams.find((team) => team.id === selectedMatch?.home_team_id);
  const awayTeam = teams.find((team) => team.id === selectedMatch?.away_team_id);
  const selectedVideo = videos.find((video) => video.id === selectedVideoId) ?? null;

  const eventCounts = useMemo(() => {
    return events.reduce<Record<string, number>>((counts, event) => {
      counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
      return counts;
    }, {});
  }, [events]);

  const createEvent = useCallback(async (type: EventType, duration = 8, extras?: { player?: string; notes?: string; outcome?: string }) => {
    if (!selectedMatchId || !selectedVideoId) return;
    const start = Math.max(0, videoRef.current?.currentTime ?? currentTime);
    const end = Math.min(videoRef.current?.duration || start + duration, start + duration);
    setBusy(true);
    try {
      const created = await codingApi.createEvent({
        match_id: selectedMatchId,
        video_asset_id: selectedVideoId,
        event_type: type,
        team: selectedTeam,
        start_seconds: Number(start.toFixed(2)),
        end_seconds: Number(Math.max(start + 0.5, end).toFixed(2)),
        player_name: extras?.player || null,
        outcome: extras?.outcome || null,
        notes: extras?.notes || null,
        phase_number: null,
        field_zone: null,
        clip_requested: false,
      });
      setEvents((current) => [...current, created].sort((a, b) => a.start_seconds - b.start_seconds));
      setNotice(`${type} coded at ${formatTime(start)} for ${selectedTeam}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to create event");
    } finally {
      setBusy(false);
    }
  }, [currentTime, selectedMatchId, selectedTeam, selectedVideoId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT") return;
      const video = videoRef.current;
      if (!video) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (video.paused) void video.play(); else video.pause();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - 5);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        video.currentTime = Math.min(video.duration || video.currentTime + 5, video.currentTime + 5);
      } else {
        const tag = QUICK_TAGS.find((item) => item.key === event.key);
        if (tag) {
          event.preventDefault();
          void createEvent(tag.type, tag.duration);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createEvent]);

  async function submitCustomEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await createEvent(String(form.get("event_type")) as EventType, Number(form.get("duration") || 8), {
      player: String(form.get("player_name") || "").trim(),
      outcome: String(form.get("outcome") || "").trim(),
      notes: String(form.get("notes") || "").trim(),
    });
    event.currentTarget.reset();
  }

  function seekTo(seconds: number) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = seconds;
    void videoRef.current.play();
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-950/95">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-400">Professional coding interface</p>
            <h1 className="mt-1 text-2xl font-bold">Match Coding Workspace</h1>
          </div>
          <nav className="flex gap-2 text-sm">
            <Link href="/" className="rounded-lg border border-slate-700 px-3 py-2">Workspace</Link>
            <Link href="/catalog" className="rounded-lg border border-slate-700 px-3 py-2">Programme data</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-5 py-5">
        <div className="mb-5 grid gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 lg:grid-cols-[1fr_1fr_auto]">
          <select className={inputClass} value={selectedMatchId ?? ""} onChange={(event) => setSelectedMatchId(event.target.value ? Number(event.target.value) : null)}>
            <option value="">Select match</option>
            {matches.map((match) => <option key={match.id} value={match.id}>{match.match_date} · {teams.find((team) => team.id === match.home_team_id)?.name ?? "Home"} vs {teams.find((team) => team.id === match.away_team_id)?.name ?? "Away"}</option>)}
          </select>
          <select className={inputClass} value={selectedVideoId ?? ""} onChange={(event) => setSelectedVideoId(event.target.value ? Number(event.target.value) : null)} disabled={!videos.length}>
            <option value="">Select source video</option>
            {videos.map((video) => <option key={video.id} value={video.id}>{video.original_filename}</option>)}
          </select>
          <div className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300">{formatTime(currentTime)} · {events.length} events</div>
        </div>

        <div className="mb-5 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-300">{notice}</div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(360px,1fr)]">
          <section className="space-y-5">
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-black">
              {selectedVideo ? (
                <video
                  key={selectedVideo.id}
                  ref={videoRef}
                  src={sourceVideoUrl(selectedVideo.id)}
                  controls
                  playsInline
                  className="aspect-video w-full bg-black"
                  onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                  onError={() => setNotice("Source video is unavailable. Free Render storage is temporary and may have been cleared after sleep or redeploy.")}
                />
              ) : <div className="flex aspect-video items-center justify-center text-slate-500">Select a match with uploaded footage.</div>}
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="font-bold">Quick coding</h2><p className="text-xs text-slate-500">Space play/pause · arrows ±5 seconds · number keys create tags</p></div>
                <div className="flex rounded-lg border border-slate-700 p-1 text-sm">
                  {(["home", "away", "neutral"] as EventTeam[]).map((team) => <button key={team} type="button" onClick={() => setSelectedTeam(team)} className={`rounded-md px-3 py-1.5 capitalize ${selectedTeam === team ? "bg-emerald-400 font-bold text-slate-950" : "text-slate-300"}`}>{team === "home" ? homeTeam?.name ?? "Home" : team === "away" ? awayTeam?.name ?? "Away" : "Neutral"}</button>)}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 md:grid-cols-5 lg:grid-cols-9">
                {QUICK_TAGS.map((tag) => <button key={tag.type} type="button" disabled={busy || !selectedVideoId} onClick={() => void createEvent(tag.type, tag.duration)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-3 text-sm hover:border-emerald-400 disabled:opacity-40"><span className="block text-xs text-slate-500">{tag.key}</span>{tag.label}</button>)}
              </div>
            </div>

            <form onSubmit={submitCustomEvent} className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 md:grid-cols-2 lg:grid-cols-4">
              <select name="event_type" className={inputClass} defaultValue="custom">{EVENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select>
              <input name="player_name" placeholder="Player" className={inputClass} />
              <input name="outcome" placeholder="Outcome" className={inputClass} />
              <input name="duration" type="number" min="1" max="300" defaultValue="8" className={inputClass} />
              <textarea name="notes" placeholder="Analyst notes" className={`${inputClass} md:col-span-2 lg:col-span-3`} />
              <button type="submit" disabled={busy || !selectedVideoId} className="rounded-lg bg-emerald-400 px-4 py-2 font-bold text-slate-950 disabled:opacity-40">Add event at {formatTime(currentTime)}</button>
            </form>
          </section>

          <aside className="space-y-5">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="font-bold">Live event summary</h2>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {Object.entries(eventCounts).sort((a, b) => b[1] - a[1]).slice(0, 9).map(([type, count]) => <div key={type} className="rounded-lg bg-slate-950 p-3"><p className="text-xs capitalize text-slate-500">{type}</p><p className="mt-1 text-xl font-bold">{count}</p></div>)}
                {!events.length && <p className="col-span-3 text-sm text-slate-500">No events coded yet.</p>}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Timeline</h2><span className="text-xs text-slate-500">Chronological</span></div>
              <div className="max-h-[680px] space-y-2 overflow-y-auto pr-1">
                {events.map((item) => <button key={item.id} type="button" onClick={() => seekTo(item.start_seconds)} className="w-full rounded-lg border border-slate-800 bg-slate-950 p-3 text-left hover:border-emerald-400"><div className="flex items-center justify-between gap-3"><span className="font-mono text-sm text-emerald-400">{formatTime(item.start_seconds)}</span><span className="rounded bg-slate-800 px-2 py-1 text-xs capitalize">{item.team}</span></div><p className="mt-2 font-semibold capitalize">{item.event_type}</p><p className="mt-1 truncate text-xs text-slate-500">{item.player_name || item.outcome || item.notes || `${Math.round(item.end_seconds - item.start_seconds)} second window`}</p></button>)}
                {!events.length && <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">Play the video and use the quick-tag buttons to build the timeline.</div>}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
