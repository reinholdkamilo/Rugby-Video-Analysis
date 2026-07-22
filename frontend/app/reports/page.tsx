"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EventTeam, EventType, Match, Team, TimelineEvent, VideoAsset, api } from "@/lib/api";
import { CATEGORY_LABELS, EventCategory, countBySemanticLabel, semanticCategory, semanticEventLabel, semanticEventType } from "@/lib/rugby-events";

type ReviewStatus = "unreviewed" | "confirmed" | "flagged";
type EventSource = "manual" | "auto" | "vision" | "imported";
type ReviewMeta = { status: ReviewStatus; source: EventSource; confidence: number };

const REVIEW_STORAGE_KEY = "rugby-video-analysis:coding-review:v1";

const REPORT_SECTIONS = [
  "Match overview",
  "Team comparison",
  "Event mix",
  "Set piece",
  "Discipline",
  "Territory and zones",
  "Key moments",
  "Clip queue",
] as const;

type ReportSection = (typeof REPORT_SECTIONS)[number];

const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-emerald-500 [color-scheme:light]";

function formatTime(seconds: number) {
  const value = Math.max(0, seconds || 0);
  const minutes = Math.floor(value / 60);
  const remaining = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function loadReviewMeta() {
  if (typeof window === "undefined") return {};
  const saved = window.localStorage.getItem(REVIEW_STORAGE_KEY);
  if (!saved) return {};
  try {
    return JSON.parse(saved) as Record<number, ReviewMeta>;
  } catch {
    return {};
  }
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

function isReportActiveEvent(event: TimelineEvent) {
  return event.trust_status !== "rejected" && event.trust_status !== "stale";
}

export default function ReportsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);
  const [reviewMeta, setReviewMeta] = useState<Record<number, ReviewMeta>>({});
  const [reviewedOnly, setReviewedOnly] = useState(false);
  const [clipQueueOnly, setClipQueueOnly] = useState(false);
  const [includeInferred, setIncludeInferred] = useState(true);
  const [selectedCategories, setSelectedCategories] = useState<EventCategory[]>(["attack", "defence", "set_piece", "discipline", "transition", "kicking", "possession", "core"]);
  const [selectedSections, setSelectedSections] = useState<ReportSection[]>([...REPORT_SECTIONS]);
  const [notice, setNotice] = useState("Select a match to build a report.");
  const [loading, setLoading] = useState(true);

  const teamName = useCallback((teamId: number) => teams.find((team) => team.id === teamId)?.name ?? `Team ${teamId}`, [teams]);

  const selectedMatch = useMemo(() => matches.find((match) => match.id === selectedMatchId) ?? null, [matches, selectedMatchId]);
  const selectedVideo = useMemo(() => videos.find((video) => video.id === selectedVideoId) ?? null, [videos, selectedVideoId]);
  const homeName = selectedMatch ? teamName(selectedMatch.home_team_id) : "Home";
  const awayName = selectedMatch ? teamName(selectedMatch.away_team_id) : "Away";

  const loadBaseData = useCallback(async () => {
    setLoading(true);
    try {
      const [teamData, matchData] = await Promise.all([api.teams.list(), api.matches.list()]);
      setTeams(teamData);
      setMatches(matchData);
      setSelectedMatchId((current) => current ?? matchData[0]?.id ?? null);
      setNotice(matchData.length ? "Report builder ready." : "Create and upload a match before building a report.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load report data.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMatchData = useCallback(async (matchId: number) => {
    setLoading(true);
    try {
      const videoData = await api.matches.videos(matchId);
      const nextVideoId = videoData[0]?.id ?? null;
      const chosenVideoId = selectedVideoId && videoData.some((video) => video.id === selectedVideoId) ? selectedVideoId : nextVideoId;
      const eventData = await api.timeline.list(matchId, chosenVideoId ?? undefined);
      setVideos(videoData);
      setSelectedVideoId(chosenVideoId);
      setEvents(eventData.filter(isReportActiveEvent));
      setNotice(eventData.length ? "Report preview updated from coded events." : "This match has no coded timeline events yet.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load match report data.");
    } finally {
      setLoading(false);
    }
  }, [selectedVideoId]);

  useEffect(() => {
    setReviewMeta(loadReviewMeta());
    void loadBaseData();
  }, [loadBaseData]);

  useEffect(() => {
    if (!selectedMatchId) return;
    void loadMatchData(selectedMatchId);
  }, [loadMatchData, selectedMatchId]);

  useEffect(() => {
    if (!selectedMatchId || !selectedVideoId) return;
    void api.timeline.list(selectedMatchId, selectedVideoId).then((items) => setEvents(items.filter(isReportActiveEvent))).catch((error) => {
      setNotice(error instanceof Error ? error.message : "Unable to reload selected video events.");
    });
  }, [selectedMatchId, selectedVideoId]);

  const reportEvents = useMemo(() => {
    return events.filter((event) => {
      const review = reviewMeta[event.id];
      const category = semanticCategory(event);
      const inferred = event.event_source === "inferred" || event.event_source === "linked_logic";
      if (!includeInferred && inferred) return false;
      if (reviewedOnly && review?.status !== "confirmed") return false;
      if (clipQueueOnly && !event.clip_requested) return false;
      if (!selectedCategories.includes(category)) return false;
      return true;
    });
  }, [clipQueueOnly, events, includeInferred, reviewedOnly, reviewMeta, selectedCategories]);

  const teamCounts = useMemo(() => countBy(reportEvents, (event) => event.team), [reportEvents]);
  const categoryCounts = useMemo(() => countBy(reportEvents, semanticCategory), [reportEvents]);
  const eventTypeCounts = useMemo(() => countBySemanticLabel(reportEvents), [reportEvents]);
  const zoneCounts = useMemo(() => countBy(reportEvents.filter((event) => event.field_zone), (event) => event.field_zone ?? "Unknown"), [reportEvents]);
  const clipEvents = useMemo(() => reportEvents.filter((event) => event.clip_requested), [reportEvents]);
  const keyMoments = useMemo(() => {
    const priority = new Set<EventType>(["try", "penalty", "card", "turnover", "kick", "lineout", "scrum"]);
    return reportEvents
      .filter((event) => priority.has(semanticEventType(event) as EventType) || event.clip_requested || event.notes || event.phase_number)
      .sort((a, b) => a.start_seconds - b.start_seconds)
      .slice(0, 18);
  }, [reportEvents]);

  const setPieceEvents = reportEvents.filter((event) => ["scrum", "lineout", "maul"].includes(semanticEventType(event)));
  const disciplineEvents = reportEvents.filter((event) => ["penalty", "card"].includes(semanticEventType(event)));
  const reviewedCount = reportEvents.filter((event) => reviewMeta[event.id]?.status === "confirmed").length;
  const reportReadiness = reportEvents.length ? Math.round((reviewedCount / reportEvents.length) * 100) : 0;

  function toggleCategory(category: EventCategory) {
    setSelectedCategories((current) => current.includes(category) ? current.filter((item) => item !== category) : [...current, category]);
  }

  function toggleSection(section: ReportSection) {
    setSelectedSections((current) => current.includes(section) ? current.filter((item) => item !== section) : [...current, section]);
  }

  function sectionEnabled(section: ReportSection) {
    return selectedSections.includes(section);
  }

  const printReportHref = `/reports/print${selectedMatchId ? `?match_id=${selectedMatchId}${selectedVideoId ? `&video_id=${selectedVideoId}` : ""}` : ""}`;

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="bg-slate-950 text-white print:hidden">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-end justify-between gap-6 px-6 py-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-400">Report builder</p>
            <h1 className="mt-1 text-3xl font-bold">Match Report</h1>
          </div>
          <nav className="flex gap-3 text-sm">
            <Link href="/upload" className="rounded-lg border border-slate-700 px-3 py-2">Upload Match</Link>
            <Link href="/coding" className="rounded-lg border border-slate-700 px-3 py-2">Coding</Link>
            <Link href={printReportHref} className="rounded-lg bg-emerald-400 px-4 py-2 font-bold text-slate-950">Open export report</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1600px] gap-5 px-6 py-6 lg:grid-cols-[360px_1fr] print:block print:px-0 print:py-0">
        <aside className="space-y-4 print:hidden">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-bold">Report setup</h2>
            <div className="mt-4 grid gap-3">
              <select value={selectedMatchId ?? ""} onChange={(event) => setSelectedMatchId(event.target.value ? Number(event.target.value) : null)} className={inputClass} style={{ color: "#13221f" }}>
                <option value="">Select match</option>
                {matches.map((match) => <option key={match.id} value={match.id}>{teamName(match.home_team_id)} vs {teamName(match.away_team_id)} - {match.match_date}</option>)}
              </select>
              <select value={selectedVideoId ?? ""} onChange={(event) => setSelectedVideoId(event.target.value ? Number(event.target.value) : null)} className={inputClass} style={{ color: "#13221f" }}>
                <option value="">All selected match video</option>
                {videos.map((video) => <option key={video.id} value={video.id}>{video.original_filename}</option>)}
              </select>
              <label className="report-control-label flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900" style={{ color: "#13221f" }}>
                <input type="checkbox" checked={reviewedOnly} onChange={(event) => setReviewedOnly(event.target.checked)} className="h-4 w-4 accent-emerald-600" />
                <span style={{ color: "#13221f" }}>Reviewed events only</span>
              </label>
              <label className="report-control-label flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900" style={{ color: "#13221f" }}>
                <input type="checkbox" checked={clipQueueOnly} onChange={(event) => setClipQueueOnly(event.target.checked)} className="h-4 w-4 accent-emerald-600" />
                <span style={{ color: "#13221f" }}>Clip queue only</span>
              </label>
              <label className="report-control-label flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900" style={{ color: "#13221f" }}>
                <input type="checkbox" checked={includeInferred} onChange={(event) => setIncludeInferred(event.target.checked)} className="h-4 w-4 accent-emerald-600" />
                <span style={{ color: "#13221f" }}>Include inferred events</span>
              </label>
            </div>
            <p className="mt-4 text-sm text-slate-500">{loading ? "Loading report data..." : notice}</p>
            <Link href={printReportHref} className="mt-4 block rounded-lg bg-slate-950 px-4 py-3 text-center text-sm font-bold text-white">
              Open clean print export
            </Link>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-bold">Include categories</h2>
            <div className="mt-3 grid gap-2">
              {(Object.keys(CATEGORY_LABELS) as EventCategory[]).map((category) => (
                <label key={category} className="report-control-label flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900" style={{ color: "#13221f" }}>
                  <span style={{ color: "#13221f" }}>{CATEGORY_LABELS[category]}</span>
                  <input type="checkbox" checked={selectedCategories.includes(category)} onChange={() => toggleCategory(category)} className="h-4 w-4 accent-emerald-600" />
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-bold">Report sections</h2>
            <div className="mt-3 grid gap-2">
              {REPORT_SECTIONS.map((section) => (
                <label key={section} className="report-control-label flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900" style={{ color: "#13221f" }}>
                  <span style={{ color: "#13221f" }}>{section}</span>
                  <input type="checkbox" checked={selectedSections.includes(section)} onChange={() => toggleSection(section)} className="h-4 w-4 accent-emerald-600" />
                </label>
              ))}
            </div>
          </div>
        </aside>

        <article className="rounded-xl border border-slate-200 bg-white shadow-sm print:rounded-none print:border-0 print:shadow-none">
          <section className="border-b border-slate-200 bg-slate-950 p-8 text-white print:bg-white print:text-slate-950">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-400">Rugby Video Analysis</p>
            <h2 className="mt-3 text-4xl font-bold">{selectedMatch ? `${homeName} vs ${awayName}` : "Match Report Preview"}</h2>
            <div className="mt-6 grid gap-3 text-sm md:grid-cols-4">
              <div><p className="text-slate-400 print:text-slate-500">Date</p><p className="font-bold">{selectedMatch?.match_date ?? "Not selected"}</p></div>
              <div><p className="text-slate-400 print:text-slate-500">Competition</p><p className="font-bold">{selectedMatch?.competition ?? "Not set"}</p></div>
              <div><p className="text-slate-400 print:text-slate-500">Venue</p><p className="font-bold">{selectedMatch?.venue ?? "Not set"}</p></div>
              <div><p className="text-slate-400 print:text-slate-500">Video</p><p className="truncate font-bold">{selectedVideo?.original_filename ?? "Not selected"}</p></div>
            </div>
          </section>

          <section className="grid gap-4 border-b border-slate-200 p-6 md:grid-cols-4">
            <div className="rounded-lg bg-slate-100 p-4"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Report events</p><p className="mt-2 text-3xl font-bold">{reportEvents.length}</p></div>
            <div className="rounded-lg bg-slate-100 p-4"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Reviewed</p><p className="mt-2 text-3xl font-bold">{reportReadiness}%</p></div>
            <div className="rounded-lg bg-slate-100 p-4"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Clip queue</p><p className="mt-2 text-3xl font-bold">{clipEvents.length}</p></div>
            <div className="rounded-lg bg-slate-100 p-4"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Field zones</p><p className="mt-2 text-3xl font-bold">{Object.keys(zoneCounts).length}</p></div>
          </section>

          <div className="grid gap-6 p-6">
            {sectionEnabled("Match overview") && (
              <section>
                <h3 className="text-xl font-bold">Match Overview</h3>
                <p className="mt-2 text-sm text-slate-600">This report is generated from coded timeline events, review metadata and clip queue selections. Use the Coding tab to refine uncertain events before final export.</p>
              </section>
            )}

            {sectionEnabled("Team comparison") && (
              <section>
                <h3 className="text-xl font-bold">Team Comparison</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  {(["home", "away", "neutral"] as EventTeam[]).map((team) => (
                    <div key={team} className="rounded-lg border border-slate-200 p-4">
                      <p className="text-sm text-slate-500">{teamLabel(team, homeName, awayName)}</p>
                      <p className="mt-2 text-2xl font-bold">{teamCounts[team] ?? 0}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {sectionEnabled("Event mix") && (
              <section>
                <h3 className="text-xl font-bold">Event Mix</h3>
                <div className="mt-3 grid gap-4 lg:grid-cols-2">
                  <ReportTable title="By category" rows={sortedEntries(categoryCounts).map(([key, value]) => [CATEGORY_LABELS[key as EventCategory] ?? key, value])} />
                  <ReportTable title="Top event labels" rows={sortedEntries(eventTypeCounts).slice(0, 10)} />
                </div>
              </section>
            )}

            {sectionEnabled("Set piece") && (
              <section>
                <h3 className="text-xl font-bold">Set Piece</h3>
                <ReportTable title="Scrum, lineout and maul events" rows={sortedEntries(countBy(setPieceEvents, semanticEventLabel))} empty="No set-piece events in the current report filter." />
              </section>
            )}

            {sectionEnabled("Discipline") && (
              <section>
                <h3 className="text-xl font-bold">Discipline</h3>
                <ReportTable title="Penalties and cards" rows={sortedEntries(countBy(disciplineEvents, semanticEventLabel))} empty="No discipline events in the current report filter." />
              </section>
            )}

            {sectionEnabled("Territory and zones") && (
              <section>
                <h3 className="text-xl font-bold">Territory and Zones</h3>
                <ReportTable title="Field zone breakdown" rows={sortedEntries(zoneCounts)} empty="Add field zones in Coding to populate this table." />
              </section>
            )}

            {sectionEnabled("Key moments") && (
              <section>
                <h3 className="text-xl font-bold">Key Moments</h3>
                <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-100 text-xs uppercase tracking-[0.14em] text-slate-500"><tr><th className="p-3">Time</th><th className="p-3">Team</th><th className="p-3">Event</th><th className="p-3">Detail</th></tr></thead>
                    <tbody>
                      {keyMoments.map((event) => <tr key={event.id} className="border-t border-slate-200"><td className="p-3 font-mono">{formatTime(event.start_seconds)}</td><td className="p-3">{teamLabel(event.team, homeName, awayName)}</td><td className="p-3 capitalize">{event.event_type}</td><td className="p-3">{event.outcome || event.field_zone || event.notes || "Review in Coding"}</td></tr>)}
                      {!keyMoments.length && <tr><td colSpan={4} className="p-4 text-slate-500">No key moments in the current report filter.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {sectionEnabled("Clip queue") && (
              <section>
                <h3 className="text-xl font-bold">Clip Queue</h3>
                <div className="mt-3 grid gap-2">
                  {clipEvents.map((event) => <div key={event.id} className="grid grid-cols-[80px_1fr_auto] items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm"><span className="font-mono">{formatTime(event.start_seconds)}</span><span>{event.outcome || event.event_type}</span><span className="rounded bg-slate-100 px-2 py-1 text-xs font-bold">{teamLabel(event.team, homeName, awayName)}</span></div>)}
                  {!clipEvents.length && <p className="rounded-lg border border-slate-200 p-4 text-sm text-slate-500">No events are currently marked for clips.</p>}
                </div>
              </section>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}

function ReportTable({ title, rows, empty = "No data available." }: { title: string; rows: [string, number][]; empty?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="bg-slate-100 px-4 py-3 font-bold">{title}</div>
      <table className="w-full text-left text-sm">
        <tbody>
          {rows.map(([label, value]) => <tr key={label} className="border-t border-slate-200"><td className="p-3">{label}</td><td className="p-3 text-right font-bold">{value}</td></tr>)}
          {!rows.length && <tr><td className="p-3 text-slate-500">{empty}</td><td /></tr>}
        </tbody>
      </table>
    </div>
  );
}
