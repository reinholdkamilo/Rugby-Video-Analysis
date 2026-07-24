"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Match, Team, TimelineEvent, VideoAsset, api } from "@/lib/api";
import { sourceVideoUrl } from "@/lib/coding-api";

const TAG_GROUPS = [
  "Sportscode Codes",
  "Fixture Name",
  "Half",
  "Possession Completion Exit",
  "Exit Type",
  "Zone",
  "XCoord",
  "YCoord",
  "Unit",
  "Shirt Number",
  "Carry Type",
  "Carry Detail",
  "Carry Presentation",
  "Possession Number",
  "Possession Completion",
  "Attack Breakdown",
  "Kick Type",
];

const TRACKS = [
  "Ball In Play",
  "Brumbies Possession",
  "Brumbies Counter Attack",
  "Brumbies Turnover Attack",
  "Brumbies Kicks in Play",
  "Brumbies Lineout",
  "Brumbies Lineout Attack",
  "Brumbies Maul",
  "Brumbies Quick Lineout",
  "Brumbies Scrum",
  "Brumbies Scrum Attack",
  "Brumbies Restart",
  "Brumbies Restart Attack",
  "Brumbies Tap Attack",
];

const PLAYBACK_CONTROLS: Array<{ label: string; delta?: number; command?: "play_pause" }> = [
  { label: "|‹", delta: -600 },
  { label: "‹‹", delta: -60 },
  { label: "‹", delta: -5 },
  { label: "↺", delta: -5 },
  { label: "▶", command: "play_pause" },
  { label: "↻", delta: 5 },
  { label: "›", delta: 5 },
  { label: "››", delta: 60 },
  { label: "›|", delta: 600 },
];

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function eventLabel(event: TimelineEvent) {
  return event.outcome || event.event_type;
}

function trackForEvent(event: TimelineEvent) {
  const label = eventLabel(event).toLowerCase();
  if (event.event_type === "kick" || label.includes("kick") || label.includes("exit")) return "Brumbies Kicks in Play";
  if (event.event_type === "lineout" || label.includes("lineout")) return "Brumbies Lineout";
  if (event.event_type === "maul" || label.includes("maul")) return "Brumbies Maul";
  if (event.event_type === "scrum" || label.includes("scrum")) return "Brumbies Scrum";
  if (event.event_type === "kickoff" || label.includes("restart")) return "Brumbies Restart";
  if (event.event_type === "turnover" || label.includes("turnover")) return "Brumbies Turnover Attack";
  if (event.event_type === "carry" || event.event_type === "pass" || event.event_type === "ruck") return "Brumbies Possession";
  return "Ball In Play";
}

export default function VideoAnalysisPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [notice, setNotice] = useState("Loading video analysis workspace...");

  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? null;
  const selectedVideo = videos.find((video) => video.id === selectedVideoId) ?? null;
  const homeTeam = teams.find((team) => team.id === selectedMatch?.home_team_id);
  const awayTeam = teams.find((team) => team.id === selectedMatch?.away_team_id);
  const fixtureTitle = selectedMatch
    ? `${homeTeam?.name ?? "Home"} vs ${awayTeam?.name ?? "Away"}`
    : "260605 SRP17 QF Hurricanes 66-12 Brumbies";
  const timelineDuration = Math.max(duration, events.reduce((max, event) => Math.max(max, event.end_seconds), 0), 90 * 60 + 43);

  const trackRows = useMemo(() => TRACKS.map((track) => ({
    track,
    events: events.filter((event) => trackForEvent(event) === track),
  })), [events]);

  const loadWorkspace = useCallback(async () => {
    try {
      const [matchData, teamData, videoData] = await Promise.all([
        api.matches.list(),
        api.teams.list(),
        api.library.items({ item_type: "game", limit: 100 }),
      ]);
      setMatches(matchData);
      setTeams(teamData);
      const videoAssets: VideoAsset[] = videoData
        .filter((item) => item.match_id && item.video_asset_id)
        .map((item) => ({
          id: item.video_asset_id!,
          match_id: item.match_id!,
          sport_type: item.sport_type ?? "rugby_union",
          original_filename: item.title,
          content_type: null,
          size_bytes: 0,
          created_at: item.created_at ?? "",
        }));
      const nextMatch = matchData.find((match) => videoAssets.some((video) => video.match_id === match.id)) ?? matchData[0] ?? null;
      setSelectedMatchId(nextMatch?.id ?? null);
      const matchVideos = nextMatch ? videoAssets.filter((video) => video.match_id === nextMatch.id) : [];
      setVideos(matchVideos);
      const nextVideo = matchVideos[0] ?? null;
      setSelectedVideoId(nextVideo?.id ?? null);
      setEvents(nextMatch ? await api.timeline.list(nextMatch.id, nextVideo?.id) : []);
      setNotice(nextVideo ? "Video analysis workspace ready." : "Select a match with uploaded video.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load video analysis workspace.");
    }
  }, []);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);

  useEffect(() => {
    if (!selectedMatchId) {
      setVideos([]);
      setEvents([]);
      return;
    }
    void (async () => {
      try {
        const matchVideos = await api.matches.videos(selectedMatchId);
        setVideos(matchVideos);
        const nextVideoId = matchVideos.some((video) => video.id === selectedVideoId)
          ? selectedVideoId
          : matchVideos[0]?.id ?? null;
        setSelectedVideoId(nextVideoId);
        setEvents(await api.timeline.list(selectedMatchId, nextVideoId ?? undefined));
        setNotice(nextVideoId ? "Video analysis workspace ready." : "This match has no uploaded video.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Unable to load match video.");
      }
    })();
  }, [selectedMatchId, selectedVideoId]);

  function seek(delta: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(0, video.currentTime + delta), video.duration || video.currentTime + delta);
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#0f1318] text-[#d8e0e7]">
      <div className="grid h-screen grid-cols-[minmax(0,1fr)_480px]">
        <section className="flex min-w-0 flex-col border-r border-[#2a333c] bg-[#11161c]">
          <div className="flex h-14 items-center justify-between border-b border-[#26313a] bg-[#182027] px-5">
            <Link href="/" className="flex items-center gap-2 text-sm font-bold text-[#b8c3ce]">
              <span className="text-2xl leading-none">‹</span>
              Exit
            </Link>
            <button type="button" className="grid h-8 w-8 place-items-center border border-[#46515b] text-2xl leading-none text-[#b8c3ce]">›</button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="grid min-h-0 flex-1 place-items-center bg-[#101419] px-24 py-6">
              <div className="aspect-video w-full max-w-[1360px] overflow-hidden bg-black shadow-2xl">
                {selectedVideo ? (
                  <video
                    ref={videoRef}
                    src={sourceVideoUrl(selectedVideo.id)}
                    playsInline
                    className="h-full w-full bg-black object-contain"
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                    onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
                  />
                ) : (
                  <div className="grid h-full place-items-center bg-[radial-gradient(circle_at_50%_20%,#303a31,#12161b_58%,#080a0d)] text-sm font-bold text-[#8793a0]">
                    Select a match with uploaded footage.
                  </div>
                )}
              </div>
            </div>

            <div className="h-12 border-y border-[#2b343d] bg-[#192128] px-3">
              <div className="flex h-full items-center gap-3 text-[#c7d0d9]">
                {PLAYBACK_CONTROLS.map((control) => (
                  <button
                    key={control.label}
                    type="button"
                    onClick={() => {
                      if (control.command === "play_pause") togglePlay();
                      else seek(control.delta ?? 0);
                    }}
                    className="text-xl font-black leading-none hover:text-white"
                  >
                    {control.label}
                  </button>
                ))}
                <span className="ml-4 text-sm font-semibold">{formatTime(currentTime)} / {formatTime(timelineDuration)}</span>
                <span className="ml-auto text-sm text-[#7d8994]">{notice}</span>
                <span className="text-lg">⚙</span>
                <span className="text-lg">⛶</span>
              </div>
            </div>

            <div className="h-[330px] bg-[#151b20]">
              <div className="relative h-full overflow-x-auto overflow-y-hidden border-t border-[#222b33]">
                <div className="relative min-w-[1500px]">
                  <div className="grid grid-cols-[200px_1fr] border-b border-[#29323a]">
                    <div className="h-10 bg-[#161d23]" />
                    <div className="relative h-10 bg-[#12181d] text-xs text-[#697784]">
                      {[0, 0.33, 0.66, 1].map((tick) => (
                        <span key={tick} className="absolute top-5 -translate-x-1/2" style={{ left: `${tick * 100}%` }}>{formatTime(timelineDuration * tick)}</span>
                      ))}
                    </div>
                  </div>
                  <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-[#a6acb2]" style={{ left: `calc(200px + ${Math.min(100, Math.max(0, currentTime / timelineDuration * 100))}%)` }} />
                  {trackRows.map((row) => (
                    <div key={row.track} className="grid grid-cols-[200px_1fr] border-b border-[#273039]">
                      <div className="h-6 bg-[#1a2229] px-2 text-xs font-black leading-6 text-[#b9c3cc]">{row.track}</div>
                      <div className="relative h-6 bg-[#151c22]">
                        {row.events.map((event) => {
                          const left = Math.min(98, Math.max(0, event.start_seconds / timelineDuration * 100));
                          const width = Math.max(2, Math.min(100 - left, (event.end_seconds - event.start_seconds) / timelineDuration * 100));
                          return (
                            <button
                              key={event.id}
                              type="button"
                              onClick={() => {
                                if (videoRef.current) videoRef.current.currentTime = event.start_seconds;
                              }}
                              className="absolute top-0.5 h-5 overflow-hidden rounded-sm bg-[#25364a] px-1 text-left text-[10px] font-semibold text-[#dce7f4]"
                              style={{ left: `${left}%`, width: `${width}%` }}
                            >
                              Fixture Name ▶ {eventLabel(event)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col bg-[#192026]">
          <div className="flex h-[76px] items-center bg-[#303a44] px-5 text-base font-black text-white">
            {fixtureTitle}
          </div>

          <div className="grid grid-cols-2 border-b border-[#2b343d] bg-[#192026]">
            <button type="button" className="h-[72px] border-b-4 border-transparent text-sm font-black text-[#657487]">Your Clips</button>
            <button type="button" className="h-[72px] border-b-4 border-[#586779] text-sm font-black text-white">Tags</button>
          </div>

          <div className="border-b border-[#29323a] p-5">
            <label className="grid gap-2 text-base text-[#d7dee6]">
              Search
              <div className="flex h-10 items-center justify-between rounded border border-[#56616d] px-3 text-sm text-[#77818d]">
                What are you looking for?
                <span className="text-2xl leading-none">⌄</span>
              </div>
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5">
            {TAG_GROUPS.map((group) => (
              <button key={group} type="button" className="flex w-full items-center justify-between border-b border-[#404b55] py-4 text-left text-lg font-black text-[#c1cbd5]">
                {group}
                <span className="text-2xl leading-none text-[#b1bbc5]">⌄</span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}
