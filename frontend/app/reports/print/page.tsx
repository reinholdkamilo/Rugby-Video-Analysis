"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EventTeam, EventType, Match, Team, TimelineEvent, VideoAsset, api } from "@/lib/api";

type EventCategory = "core" | "attack" | "defence" | "set_piece" | "discipline" | "transition" | "kicking" | "possession";

const EVENT_CATEGORY_BY_TYPE: Record<EventType, EventCategory> = {
  kickoff: "kicking",
  scrum: "set_piece",
  lineout: "set_piece",
  carry: "attack",
  tackle: "defence",
  ruck: "possession",
  maul: "set_piece",
  pass: "attack",
  kick: "kicking",
  turnover: "transition",
  penalty: "discipline",
  try: "attack",
  conversion: "kicking",
  card: "discipline",
  stoppage: "core",
  custom: "core",
};

const CATEGORY_LABELS: Record<EventCategory, string> = {
  core: "Core",
  attack: "Attack",
  defence: "Defence",
  set_piece: "Set piece",
  discipline: "Discipline",
  transition: "Transition",
  kicking: "Kicking",
  possession: "Possession",
};

const SCORE_VALUES: Partial<Record<EventType, number>> = {
  try: 5,
  conversion: 2,
  penalty: 3,
};

function formatTime(seconds: number) {
  const value = Math.max(0, seconds || 0);
  const minutes = Math.floor(value / 60);
  const remaining = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function countBy<T extends string>(items: TimelineEvent[], getKey: (item: TimelineEvent) => T) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = getKey(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function sortedEntries(counts: Record<string, number>) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function teamLabel(team: EventTeam, homeName: string, awayName: string) {
  if (team === "home") return homeName;
  if (team === "away") return awayName;
  return "Neutral";
}

function teamPercent(teamCounts: Record<string, number>, team: EventTeam) {
  const total = Math.max(1, (teamCounts.home ?? 0) + (teamCounts.away ?? 0));
  return Math.round(((teamCounts[team] ?? 0) / total) * 100);
}

function scoreFor(events: TimelineEvent[], team: EventTeam) {
  return events
    .filter((event) => event.team === team)
    .reduce((total, event) => total + (SCORE_VALUES[event.event_type] ?? 0), 0);
}

function topRows(events: TimelineEvent[], team: EventTeam, fallback = "No coded events") {
  const rows = sortedEntries(countBy(events.filter((event) => event.team === team), (event) => event.event_type)).slice(0, 7);
  return rows.length ? rows : [[fallback, 0] as [string, number]];
}

export default function PrintableReportPage() {
  const [requestedMatchId, setRequestedMatchId] = useState<number | null>(null);
  const [requestedVideoId, setRequestedVideoId] = useState<number | null>(null);

  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(requestedMatchId);
  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(requestedVideoId);
  const [notice, setNotice] = useState("Loading printable report...");

  const teamName = useCallback((teamId: number) => teams.find((team) => team.id === teamId)?.name ?? `Team ${teamId}`, [teams]);
  const selectedMatch = useMemo(() => matches.find((match) => match.id === selectedMatchId) ?? null, [matches, selectedMatchId]);
  const selectedVideo = useMemo(() => videos.find((video) => video.id === selectedVideoId) ?? null, [videos, selectedVideoId]);
  const homeName = selectedMatch ? teamName(selectedMatch.home_team_id) : "Home";
  const awayName = selectedMatch ? teamName(selectedMatch.away_team_id) : "Away";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRequestedMatchId(Number(params.get("match_id") ?? 0) || null);
    setRequestedVideoId(Number(params.get("video_id") ?? 0) || null);
  }, []);

  useEffect(() => {
    async function loadBaseData() {
      try {
        const [teamData, matchData] = await Promise.all([api.teams.list(), api.matches.list()]);
        setTeams(teamData);
        setMatches(matchData);
        const nextMatchId = requestedMatchId && matchData.some((match) => match.id === requestedMatchId) ? requestedMatchId : matchData[0]?.id ?? null;
        setSelectedMatchId(nextMatchId);
        setNotice(nextMatchId ? "Printable report ready." : "Create a match before exporting a report.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Unable to load printable report data.");
      }
    }
    void loadBaseData();
  }, [requestedMatchId]);

  useEffect(() => {
    if (!selectedMatchId) return;
    const matchId = selectedMatchId;
    async function loadMatchData() {
      try {
        const videoData = await api.matches.videos(matchId);
        const nextVideoId = requestedVideoId && videoData.some((video) => video.id === requestedVideoId) ? requestedVideoId : videoData[0]?.id ?? null;
        const eventData = await api.timeline.list(matchId, nextVideoId ?? undefined);
        setVideos(videoData);
        setSelectedVideoId(nextVideoId);
        setEvents(eventData);
        setNotice(eventData.length ? "Printable report ready." : "No coded events yet. The report will print with empty tables.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Unable to load match report data.");
      }
    }
    void loadMatchData();
  }, [requestedVideoId, selectedMatchId]);

  const teamCounts = useMemo(() => countBy(events, (event) => event.team), [events]);
  const categoryCounts = useMemo(() => countBy(events, (event) => EVENT_CATEGORY_BY_TYPE[event.event_type]), [events]);
  const eventTypeCounts = useMemo(() => countBy(events, (event) => event.event_type), [events]);
  const outcomeCounts = useMemo(() => countBy(events.filter((event) => event.outcome), (event) => event.outcome ?? "Outcome not set"), [events]);
  const zoneCounts = useMemo(() => countBy(events.filter((event) => event.field_zone), (event) => event.field_zone ?? "Unknown"), [events]);
  const homeScore = useMemo(() => scoreFor(events, "home"), [events]);
  const awayScore = useMemo(() => scoreFor(events, "away"), [events]);
  const setPieceEvents = useMemo(() => events.filter((event) => ["scrum", "lineout", "maul"].includes(event.event_type)), [events]);
  const disciplineEvents = useMemo(() => events.filter((event) => ["penalty", "card"].includes(event.event_type)), [events]);
  const clipEvents = useMemo(() => events.filter((event) => event.clip_requested), [events]);
  const keyMoments = useMemo(() => {
    const priority = new Set<EventType>(["try", "penalty", "card", "turnover", "kick", "lineout", "scrum"]);
    return events
      .filter((event) => priority.has(event.event_type) || event.clip_requested || event.notes || event.phase_number)
      .sort((a, b) => a.start_seconds - b.start_seconds)
      .slice(0, 22);
  }, [events]);

  return (
    <main className="print-report-shell min-h-screen bg-[#e7ece8] text-[#16231f]">
      <div className="print-toolbar print:hidden">
        <Link href="/reports" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Back to builder</Link>
        <button type="button" onClick={() => window.print()} className="rounded-lg bg-[#f4b321] px-4 py-2 text-sm font-black text-[#16231f]">Print / save PDF</button>
      </div>

      <article className="mx-auto grid w-full max-w-[1120px] gap-5 px-4 py-5 print:max-w-none print:gap-0 print:p-0">
        <ReportPage className="cover-page bg-[#102f2b] text-white">
          <div className="flex h-full flex-col justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.28em] text-[#f4b321]">Rugby Video Analysis</p>
              <h1 className="mt-8 max-w-[760px] text-7xl font-black leading-[0.92] text-white">Match Report</h1>
              <div className="mt-10 grid grid-cols-[1fr_auto_1fr] items-center gap-8 border-y border-white/20 py-9">
                <TeamScore name={homeName} score={homeScore} align="left" />
                <span className="text-4xl font-black text-[#f4b321]">v</span>
                <TeamScore name={awayName} score={awayScore} align="right" />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4 text-sm">
              <CoverFact label="Date" value={selectedMatch?.match_date ?? "Not selected"} />
              <CoverFact label="Competition" value={selectedMatch?.competition ?? "Not set"} />
              <CoverFact label="Venue" value={selectedMatch?.venue ?? "Not set"} />
              <CoverFact label="Video" value={selectedVideo?.original_filename ?? "Not selected"} />
            </div>
          </div>
        </ReportPage>

        <ReportPage>
          <PageHeader title="Match Dashboard" match={`${homeName} vs ${awayName}`} />
          <div className="grid grid-cols-[1.15fr_.85fr] gap-5">
            <section>
              <h2 className="report-section-title">Score and Event Share</h2>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <StatTile label={homeName} value={homeScore} sub={`${teamCounts.home ?? 0} coded events`} tone="home" />
                <StatTile label={awayName} value={awayScore} sub={`${teamCounts.away ?? 0} coded events`} tone="away" />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4">
                <Donut title={homeName} value={teamPercent(teamCounts, "home")} />
                <Donut title={awayName} value={teamPercent(teamCounts, "away")} />
              </div>
            </section>
            <section>
              <h2 className="report-section-title">Match Details</h2>
              <ReportTable rows={[
                ["Date", selectedMatch?.match_date ?? "Not selected"],
                ["Competition", selectedMatch?.competition ?? "Not set"],
                ["Venue", selectedMatch?.venue ?? "Not set"],
                ["Report events", String(events.length)],
                ["Clip queue", String(clipEvents.length)],
              ]} />
            </section>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-5">
            <CompactBars title={`${homeName} top events`} rows={topRows(events, "home")} />
            <CompactBars title={`${awayName} top events`} rows={topRows(events, "away")} />
          </div>
        </ReportPage>

        <ReportPage>
          <PageHeader title="Event Mix" match={`${homeName} vs ${awayName}`} />
          <div className="grid grid-cols-2 gap-5">
            <CompactBars title="By category" rows={sortedEntries(categoryCounts).map(([key, value]) => [CATEGORY_LABELS[key as EventCategory] ?? key, value])} />
            <CompactBars title="By rugby event" rows={sortedEntries(eventTypeCounts).slice(0, 12)} />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-5">
            <ReportMatrix title="Home breakdown" rows={events.filter((event) => event.team === "home")} homeName={homeName} awayName={awayName} />
            <ReportMatrix title="Away breakdown" rows={events.filter((event) => event.team === "away")} homeName={homeName} awayName={awayName} />
          </div>
        </ReportPage>

        <ReportPage>
          <PageHeader title="Set Piece, Restart and Territory" match={`${homeName} vs ${awayName}`} />
          <div className="grid grid-cols-2 gap-5">
            <CompactBars title="Scrum, lineout and maul" rows={sortedEntries(countBy(setPieceEvents, (event) => `${teamLabel(event.team, homeName, awayName)} ${event.event_type}`)).slice(0, 12)} empty="No set-piece events coded yet." />
            <CompactBars title="Kicking and restart events" rows={sortedEntries(countBy(events.filter((event) => ["kickoff", "kick", "conversion"].includes(event.event_type)), (event) => `${teamLabel(event.team, homeName, awayName)} ${event.event_type}`)).slice(0, 12)} empty="No restart/kicking events coded yet." />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-5">
            <CompactBars title="Field zones" rows={sortedEntries(zoneCounts).slice(0, 12)} empty="No zones coded yet." />
            <CompactBars title="Outcomes" rows={sortedEntries(outcomeCounts).slice(0, 12)} empty="No outcomes coded yet." />
          </div>
        </ReportPage>

        <ReportPage>
          <PageHeader title="Discipline and Key Moments" match={`${homeName} vs ${awayName}`} />
          <div className="grid grid-cols-[.85fr_1.15fr] gap-5">
            <CompactBars title="Penalties and cards" rows={sortedEntries(countBy(disciplineEvents, (event) => `${teamLabel(event.team, homeName, awayName)} ${event.outcome || event.event_type}`)).slice(0, 12)} empty="No discipline events coded yet." />
            <TimelineTable events={keyMoments} homeName={homeName} awayName={awayName} />
          </div>
        </ReportPage>

        <ReportPage>
          <PageHeader title="Clip Queue and Analyst Notes" match={`${homeName} vs ${awayName}`} />
          <TimelineTable events={clipEvents.length ? clipEvents : events.slice(0, 16)} homeName={homeName} awayName={awayName} empty="No clip requests yet. Use Coding to mark report clips." />
          <div className="mt-6 rounded-xl border border-[#d9e2dc] bg-[#f7f9f7] p-5 text-sm text-[#5d6d67]">
            <p className="font-bold text-[#16231f]">Report generation note</p>
            <p className="mt-2">This print export is built from coded timeline events, field zones, outcomes and clip requests. Add more verified codes and richer outcomes to increase report density.</p>
            <p className="mt-2 print:hidden">{notice}</p>
          </div>
        </ReportPage>
      </article>

      <style jsx global>{`
        @page {
          size: A4;
          margin: 0;
        }

        .print-toolbar {
          position: sticky;
          top: 0;
          z-index: 30;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          border-bottom: 1px solid #d7e0db;
          background: rgba(247, 249, 247, 0.92);
          padding: 12px 18px;
          backdrop-filter: blur(12px);
        }

        .report-page {
          min-height: 297mm;
          overflow: hidden;
          border: 1px solid #d9e2dc;
          background: white;
          box-shadow: 0 16px 42px rgba(13, 34, 30, 0.12);
        }

        .report-section-title {
          color: #102f2b;
          font-size: 0.84rem;
          font-weight: 950;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .cover-page h1,
        .print-report-shell h1,
        .print-report-shell h2,
        .print-report-shell h3 {
          letter-spacing: 0;
        }

        @media print {
          html,
          body {
            background: white !important;
          }

          .product-strip,
          .site-nav,
          .design-studio-toggle,
          .design-studio-panel,
          .print-toolbar,
          .print\\:hidden {
            display: none !important;
          }

          main.print-report-shell {
            min-height: 0;
            background: white !important;
          }

          .report-page {
            width: 210mm;
            min-height: 297mm;
            height: 297mm;
            break-after: page;
            border: 0;
            border-radius: 0 !important;
            box-shadow: none;
          }

          .report-page:last-child {
            break-after: auto;
          }
        }
      `}</style>
    </main>
  );
}

function ReportPage({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`report-page p-10 ${className}`}>{children}</section>;
}

function PageHeader({ title, match }: { title: string; match: string }) {
  return (
    <header className="mb-6 flex items-start justify-between border-b border-[#d9e2dc] pb-4">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-[#f4b321]">Rugby Video Analysis</p>
        <h2 className="mt-1 text-3xl font-black text-[#102f2b]">{title}</h2>
      </div>
      <p className="max-w-[320px] text-right text-sm font-bold text-[#60706a]">{match}</p>
    </header>
  );
}

function TeamScore({ name, score, align }: { name: string; score: number; align: "left" | "right" }) {
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <p className="text-3xl font-black text-white">{name}</p>
      <p className="mt-3 text-7xl font-black text-[#f4b321]">{score}</p>
    </div>
  );
}

function CoverFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-white/20 pt-3">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/55">{label}</p>
      <p className="mt-2 truncate text-sm font-bold text-white">{value}</p>
    </div>
  );
}

function StatTile({ label, value, sub, tone }: { label: string; value: number; sub: string; tone: "home" | "away" }) {
  return (
    <div className={`rounded-xl p-5 ${tone === "home" ? "bg-[#102f2b] text-white" : "bg-[#f4b321] text-[#102f2b]"}`}>
      <p className="text-sm font-black">{label}</p>
      <p className="mt-3 text-5xl font-black">{value}</p>
      <p className="mt-2 text-xs font-bold opacity-75">{sub}</p>
    </div>
  );
}

function Donut({ title, value }: { title: string; value: number }) {
  return (
    <div className="grid grid-cols-[90px_1fr] items-center gap-4 rounded-xl border border-[#d9e2dc] p-4">
      <div className="grid h-[86px] w-[86px] place-items-center rounded-full" style={{ background: `conic-gradient(#f4b321 ${value}%, #dce5df 0)` }}>
        <span className="grid h-[58px] w-[58px] place-items-center rounded-full bg-white text-lg font-black">{value}%</span>
      </div>
      <div>
        <p className="font-black text-[#102f2b]">{title}</p>
        <p className="mt-1 text-xs font-bold text-[#60706a]">Share of coded home/away events</p>
      </div>
    </div>
  );
}

function ReportTable({ rows }: { rows: [string, string][] }) {
  return (
    <table className="mt-3 w-full overflow-hidden rounded-xl text-sm">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label} className="border-b border-[#d9e2dc] last:border-b-0">
            <td className="bg-[#f3f6f4] px-3 py-3 font-black text-[#60706a]">{label}</td>
            <td className="px-3 py-3 text-right font-bold text-[#102f2b]">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CompactBars({ title, rows, empty = "No data coded yet." }: { title: string; rows: [string, number][]; empty?: string }) {
  const max = Math.max(1, ...rows.map(([, value]) => value));
  const visibleRows = rows.length ? rows : [[empty, 0] as [string, number]];
  return (
    <section className="rounded-xl border border-[#d9e2dc] p-4">
      <h3 className="report-section-title">{title}</h3>
      <div className="mt-4 grid gap-2">
        {visibleRows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[140px_1fr_36px] items-center gap-3 text-xs">
            <span className="truncate font-bold capitalize text-[#263834]">{label.replaceAll("_", " ")}</span>
            <span className="h-3 overflow-hidden rounded-full bg-[#e8eee9]">
              <span className="block h-full rounded-full bg-[#f4b321]" style={{ width: `${Math.max(0, Math.round((value / max) * 100))}%` }} />
            </span>
            <span className="text-right font-black text-[#102f2b]">{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReportMatrix({ title, rows, homeName, awayName }: { title: string; rows: TimelineEvent[]; homeName: string; awayName: string }) {
  const categoryRows = sortedEntries(countBy(rows, (event) => EVENT_CATEGORY_BY_TYPE[event.event_type]));
  return (
    <section className="rounded-xl border border-[#d9e2dc] p-4">
      <h3 className="report-section-title">{title}</h3>
      <table className="mt-4 w-full text-left text-xs">
        <thead className="bg-[#f3f6f4] uppercase tracking-[0.12em] text-[#60706a]">
          <tr><th className="px-3 py-2">Category</th><th className="px-3 py-2">Events</th><th className="px-3 py-2">Lead Team</th></tr>
        </thead>
        <tbody>
          {categoryRows.map(([category, value]) => (
            <tr key={category} className="border-b border-[#d9e2dc]">
              <td className="px-3 py-2 font-bold">{CATEGORY_LABELS[category as EventCategory] ?? category}</td>
              <td className="px-3 py-2 font-black">{value}</td>
              <td className="px-3 py-2">{rows[0] ? teamLabel(rows[0].team, homeName, awayName) : "None"}</td>
            </tr>
          ))}
          {!categoryRows.length && <tr><td className="px-3 py-3 text-[#60706a]" colSpan={3}>No coded events yet.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}

function TimelineTable({ events, homeName, awayName, empty = "No key moments coded yet." }: { events: TimelineEvent[]; homeName: string; awayName: string; empty?: string }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#d9e2dc]">
      <div className="bg-[#f3f6f4] px-4 py-3">
        <h3 className="report-section-title">Timeline</h3>
      </div>
      <table className="w-full text-left text-xs">
        <thead className="uppercase tracking-[0.12em] text-[#60706a]">
          <tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Team</th><th className="px-3 py-2">Event</th><th className="px-3 py-2">Detail</th></tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-t border-[#d9e2dc]">
              <td className="px-3 py-2 font-mono font-bold">{formatTime(event.start_seconds)}</td>
              <td className="px-3 py-2">{teamLabel(event.team, homeName, awayName)}</td>
              <td className="px-3 py-2 font-bold capitalize">{event.event_type}</td>
              <td className="px-3 py-2">{event.outcome || event.field_zone || event.notes || "Review in Coding"}</td>
            </tr>
          ))}
          {!events.length && <tr><td className="px-3 py-4 text-[#60706a]" colSpan={4}>{empty}</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
