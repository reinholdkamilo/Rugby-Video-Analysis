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
    <main className="video-analysis-workspace">
      <div className="video-analysis-shell">
        <section className="video-analysis-main">
          <div className="video-analysis-topbar">
            <Link href="/" className="video-analysis-exit">
              <span>‹</span>
              Exit
            </Link>
            <button type="button" className="video-analysis-collapse">›</button>
          </div>

          <div className="video-analysis-left-stack">
            <div className="video-analysis-stage">
              <div className="video-analysis-player-frame">
                {selectedVideo ? (
                  <video
                    ref={videoRef}
                    src={sourceVideoUrl(selectedVideo.id)}
                    playsInline
                    className="video-analysis-video"
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                    onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
                  />
                ) : (
                  <div className="video-analysis-empty-player">
                    Select a match with uploaded footage.
                  </div>
                )}
              </div>
            </div>

            <div className="video-analysis-controls">
              <div className="video-analysis-controls-inner">
                {PLAYBACK_CONTROLS.map((control) => (
                  <button
                    key={control.label}
                    type="button"
                    onClick={() => {
                      if (control.command === "play_pause") togglePlay();
                      else seek(control.delta ?? 0);
                    }}
                    className="video-analysis-control-button"
                  >
                    {control.label}
                  </button>
                ))}
                <span className="video-analysis-time">{formatTime(currentTime)} / {formatTime(timelineDuration)}</span>
                <span className="video-analysis-notice">{notice}</span>
                <span className="video-analysis-tool">⚙</span>
                <span className="video-analysis-tool">⛶</span>
              </div>
            </div>

            <div className="video-analysis-timeline">
              <div className="video-analysis-timeline-scroll">
                <div className="video-analysis-timeline-board">
                  <div className="video-analysis-time-row">
                    <div className="video-analysis-track-head" />
                    <div className="video-analysis-ruler">
                      {[0, 0.33, 0.66, 1].map((tick) => (
                        <span key={tick} style={{ left: `${tick * 100}%` }}>{formatTime(timelineDuration * tick)}</span>
                      ))}
                    </div>
                  </div>
                  <div className="video-analysis-playhead" style={{ left: `calc(200px + ${Math.min(100, Math.max(0, currentTime / timelineDuration * 100))}%)` }} />
                  {trackRows.map((row) => (
                    <div key={row.track} className="video-analysis-track-row">
                      <div className="video-analysis-track-label">{row.track}</div>
                      <div className="video-analysis-track-lane">
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
                              className="video-analysis-timeline-clip"
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

        <aside className="video-analysis-tags">
          <div className="video-analysis-title">
            {fixtureTitle}
          </div>

          <div className="video-analysis-tabbar">
            <button type="button">Your Clips</button>
            <button type="button" className="is-active">Tags</button>
          </div>

          <div className="video-analysis-search">
            <label>
              Search
              <div>
                What are you looking for?
                <span>⌄</span>
              </div>
            </label>
          </div>

          <div className="video-analysis-tag-list">
            {TAG_GROUPS.map((group) => (
              <button key={group} type="button" className="video-analysis-tag-button">
                {group}
                <span>⌄</span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}
