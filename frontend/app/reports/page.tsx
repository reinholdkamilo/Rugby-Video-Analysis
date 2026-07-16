"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AutomaticSuggestion,
  Match,
  RugbyUnderstandingObservation,
  Team,
  TimelineEvent,
  VideoAsset,
  VisionObservation,
  api,
} from "@/lib/api";

type ReportSection = {
  title: string;
  description: string;
  source: string;
  ready: boolean;
};

const selectedSections = [
  "Cover and match context",
  "Team sheets and minutes",
  "Team comparison",
  "Attack and defence summary",
  "Set piece",
  "Breakdown and ruck speed",
  "Kicking and exits",
  "Possession launches",
  "Play style",
  "Infringements",
  "Player statistics",
];

export default function ReportsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [suggestions, setSuggestions] = useState<AutomaticSuggestion[]>([]);
  const [vision, setVision] = useState<VisionObservation[]>([]);
  const [understanding, setUnderstanding] = useState<RugbyUnderstandingObservation[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);
  const [notice, setNotice] = useState("Select a match to check report readiness.");
  const [loading, setLoading] = useState(true);

  const teamName = useCallback(
    (teamId: number) => teams.find((team) => team.id === teamId)?.name ?? `Team ${teamId}`,
    [teams],
  );

  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === selectedMatchId) ?? null,
    [matches, selectedMatchId],
  );

  const selectedVideo = useMemo(
    () => videos.find((video) => video.id === selectedVideoId) ?? null,
    [videos, selectedVideoId],
  );

  const loadBaseData = useCallback(async () => {
    setLoading(true);
    try {
      const [teamData, matchData] = await Promise.all([api.teams.list(), api.matches.list()]);
      setTeams(teamData);
      setMatches(matchData);
      setSelectedMatchId((current) => current ?? matchData[0]?.id ?? null);
      setNotice(matchData.length ? "Choose report sections after selecting the video." : "Create and upload a match before building a report.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load report data.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMatchData = useCallback(async (matchId: number) => {
    setLoading(true);
    try {
      const [videoData, eventData, suggestionData] = await Promise.all([
        api.matches.videos(matchId),
        api.timeline.list(matchId),
        api.suggestions.list(),
      ]);
      setVideos(videoData);
      setEvents(eventData);
      setSuggestions(suggestionData.filter((suggestion) => suggestion.match_id === matchId));
      const nextVideoId = videoData[0]?.id ?? null;
      setSelectedVideoId((current) => current && videoData.some((video) => video.id === current) ? current : nextVideoId);
      setNotice(videoData.length ? "Report readiness updated." : "This match has no uploaded video yet.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load match report data.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadVideoData = useCallback(async (videoId: number) => {
    try {
      const [visionData, understandingData] = await Promise.all([
        api.vision.list(videoId).catch(() => []),
        api.understanding.list(videoId).catch(() => []),
      ]);
      setVision(visionData);
      setUnderstanding(understandingData);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load video analysis data.");
    }
  }, []);

  useEffect(() => { void loadBaseData(); }, [loadBaseData]);
  useEffect(() => {
    if (!selectedMatchId) return;
    void loadMatchData(selectedMatchId);
  }, [loadMatchData, selectedMatchId]);
  useEffect(() => {
    setVision([]);
    setUnderstanding([]);
    if (!selectedVideoId) return;
    void loadVideoData(selectedVideoId);
  }, [loadVideoData, selectedVideoId]);

  const reportSections: ReportSection[] = [
    {
      title: "Cover and match context",
      description: "Competition, round, date, teams, venue and final score area.",
      source: "Match setup",
      ready: Boolean(selectedMatch),
    },
    {
      title: "Team sheets and minutes",
      description: "Starting players, reserves, substitutions and minutes played.",
      source: "Programme roster",
      ready: false,
    },
    {
      title: "Team comparison",
      description: "High-level attack, defence, set-piece, breakdown and infringement metrics.",
      source: "Timeline events",
      ready: events.length > 0,
    },
    {
      title: "Attack and defence summary",
      description: "Carries, tackles, line breaks, turnovers, metres and tackle effectiveness.",
      source: "Coded events",
      ready: events.some((event) => ["carry", "tackle", "turnover", "try"].includes(event.event_type)),
    },
    {
      title: "Set piece",
      description: "Scrum and lineout count, outcome, retention, steals and infringement flow.",
      source: "Coded events",
      ready: events.some((event) => ["scrum", "lineout"].includes(event.event_type)),
    },
    {
      title: "Breakdown and ruck speed",
      description: "Ruck count, quick-ball estimate, breakdown steals and ruck arrivals.",
      source: "Timeline plus vision",
      ready: events.some((event) => event.event_type === "ruck") && understanding.length > 0,
    },
    {
      title: "Kicking and exits",
      description: "Kicks in play, exit type, exit success and kick metres.",
      source: "Coded events",
      ready: events.some((event) => event.event_type === "kick"),
    },
    {
      title: "Possession launches",
      description: "Launch source, phase count, 22m entries and conversion outcomes.",
      source: "Timeline events",
      ready: events.some((event) => event.phase_number !== null || event.field_zone !== null),
    },
    {
      title: "Play style",
      description: "Left/right movement, pass/carry/kick profile and receiver involvement.",
      source: "Manual coding plus understanding",
      ready: events.some((event) => ["pass", "carry", "kick"].includes(event.event_type)) && understanding.length > 0,
    },
    {
      title: "Infringements",
      description: "Penalty/free-kick flow by time, team, player and offence type.",
      source: "Timeline events",
      ready: events.some((event) => ["penalty", "card"].includes(event.event_type)),
    },
    {
      title: "Player statistics",
      description: "Per-player attacking, defensive, set-piece, kicking and infringement tables.",
      source: "Player-tagged events",
      ready: events.some((event) => Boolean(event.player_name)),
    },
  ];

  const readyCount = reportSections.filter((section) => section.ready).length;
  const readiness = Math.round((readyCount / reportSections.length) * 100);

  return (
    <main>
      <header className="bg-slate-950">
        <div className="flex items-end justify-between gap-6 p-8">
          <div>
            <p>Report builder</p>
            <h1>Match Report</h1>
          </div>
          <nav className="flex gap-3 text-sm">
            <Link href="/upload" className="rounded-lg border border-slate-700 px-3 py-2">Upload Match</Link>
            <Link href="/coding" className="rounded-lg border border-slate-700 px-3 py-2">Coding</Link>
          </nav>
        </div>
      </header>

      <section>
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Match</label>
            <select
              value={selectedMatchId ?? ""}
              onChange={(event) => setSelectedMatchId(event.target.value ? Number(event.target.value) : null)}
              className="w-full"
            >
              <option value="">Select match</option>
              {matches.map((match) => (
                <option key={match.id} value={match.id}>
                  {teamName(match.home_team_id)} vs {teamName(match.away_team_id)} - {match.match_date}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Video</label>
            <select
              value={selectedVideoId ?? ""}
              onChange={(event) => setSelectedVideoId(event.target.value ? Number(event.target.value) : null)}
              className="w-full"
            >
              <option value="">Select video</option>
              {videos.map((video) => <option key={video.id} value={video.id}>{video.original_filename}</option>)}
            </select>
          </div>
          <div className="min-w-48">
            <span className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Readiness</span>
            <strong className="mt-2 block text-3xl">{readiness}%</strong>
          </div>
        </div>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
          <article>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-400">Report standard</p>
            <h2 className="mt-2">Stats Perform-style match report path</h2>
            <p className="mt-4 text-slate-500">
              The attached 10-page A4 report is the target: match context, team sheets, team comparison,
              set-piece, breakdown, possession launches, play style, infringements and player tables.
              This screen shows whether the selected match has enough structured data to generate each section.
            </p>
            <div className="mt-6 grid gap-3">
              {reportSections.map((section) => (
                <div key={section.title} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-base font-bold">{section.title}</h3>
                      <p className="mt-1 text-sm text-slate-500">{section.description}</p>
                      <p className="mt-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{section.source}</p>
                    </div>
                    <span className={section.ready ? "text-sm font-bold text-emerald-400" : "text-sm font-bold text-rose-400"}>
                      {section.ready ? "Ready" : "Needs data"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <aside className="grid gap-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-400">Selected match</p>
              <h2 className="mt-2 text-xl">
                {selectedMatch ? `${teamName(selectedMatch.home_team_id)} vs ${teamName(selectedMatch.away_team_id)}` : "No match selected"}
              </h2>
              <dl className="mt-4 grid gap-3 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Video</dt><dd>{selectedVideo?.original_filename ?? "Missing"}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Timeline events</dt><dd>{events.length}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Suggestions</dt><dd>{suggestions.length}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Vision frames</dt><dd>{vision.length}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Understanding rows</dt><dd>{understanding.length}</dd></div>
              </dl>
              <p className="mt-4 text-sm text-slate-500">{loading ? "Loading report data..." : notice}</p>
            </div>

            <form>
              <p>Export options</p>
              <h2>Report sections</h2>
              <div className="mt-4 grid gap-2">
                {selectedSections.map((section) => (
                  <label key={section} className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950 p-3 text-sm">
                    <input type="checkbox" defaultChecked />
                    <span>{section}</span>
                  </label>
                ))}
              </div>
              <button type="button" disabled className="mt-4 rounded-lg bg-emerald-400 px-4 py-2 font-bold text-slate-950">
                PDF export coming next
              </button>
            </form>
          </aside>
        </section>
      </section>
    </main>
  );
}
