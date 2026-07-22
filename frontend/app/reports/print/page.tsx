"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { EventTeam, EventType, Match, Team, TimelineEvent, VideoAsset, api } from "@/lib/api";
import {
  CATEGORY_LABELS,
  EventCategory,
  SemanticEventType,
  countBySemanticLabel,
  eventsFor as semanticEventsFor,
  isConversionEvent,
  isDropGoalEvent,
  isLineBreakEvent,
  isMadeTackleEvent,
  isMissedTackleEvent,
  isPenaltyGoalEvent,
  isTryEvent,
  semanticCategory,
  semanticEventLabel,
  semanticEventType,
  semanticScoringPoints,
  semanticTypeCount,
  semanticTypesCount,
  sportRulePack,
} from "@/lib/rugby-events";

type ReportTone = "home" | "away" | "neutral";

const ATTACK_TYPES: SemanticEventType[] = ["carry", "pass", "try", "line_break"];
const SET_PIECE_TYPES: SemanticEventType[] = ["scrum", "lineout", "maul"];
const KICKING_TYPES: SemanticEventType[] = ["kick", "kickoff", "conversion"];
const BREAKDOWN_TYPES: SemanticEventType[] = ["ruck", "turnover"];
const DISCIPLINE_TYPES: SemanticEventType[] = ["penalty", "card"];

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

function isReportActiveEvent(event: TimelineEvent) {
  return event.trust_status !== "rejected" && event.trust_status !== "stale";
}

function eventsFor(events: TimelineEvent[], team: EventTeam, types?: SemanticEventType[]) {
  return semanticEventsFor(events, team, types);
}

function typeCount(events: TimelineEvent[], team: EventTeam, types: SemanticEventType[]) {
  return semanticTypesCount(events, team, types);
}

function eventTypeCount(events: TimelineEvent[], team: EventTeam, type: SemanticEventType) {
  return semanticTypeCount(events, team, type);
}

function countText(events: TimelineEvent[], team: EventTeam, pattern: RegExp) {
  return eventsFor(events, team).filter((event) => pattern.test(`${event.event_type} ${event.outcome ?? ""} ${event.notes ?? ""} ${event.field_zone ?? ""}`)).length;
}

function percent(value: number, total: number) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
}

function scoreFor(events: TimelineEvent[], team: EventTeam) {
  return eventsFor(events, team).reduce((total, event) => total + scoringPoints(event), 0);
}

function scoringPoints(event: TimelineEvent) {
  return semanticScoringPoints(event);
}

function isTry(event: TimelineEvent) {
  return isTryEvent(event);
}

function isConversion(event: TimelineEvent) {
  return isConversionEvent(event);
}

function isPenaltyGoal(event: TimelineEvent) {
  return isPenaltyGoalEvent(event);
}

function isDropGoal(event: TimelineEvent) {
  return isDropGoalEvent(event);
}

function zoneCount(events: TimelineEvent[], team: EventTeam, pattern: RegExp) {
  return eventsFor(events, team).filter((event) => pattern.test(event.field_zone ?? "")).length;
}

function teamShare(events: TimelineEvent[], team: EventTeam) {
  const home = eventsFor(events, "home").length;
  const away = eventsFor(events, "away").length;
  return percent(eventsFor(events, team).length, home + away);
}

function opposition(team: EventTeam): EventTeam {
  if (team === "home") return "away";
  if (team === "away") return "home";
  return "neutral";
}

function impliedCarryCount(events: TimelineEvent[], team: EventTeam) {
  return eventsFor(events, opposition(team)).filter(isMadeTackleEvent).length;
}

function attackingActions(events: TimelineEvent[], team: EventTeam) {
  return typeCount(events, team, ATTACK_TYPES) + impliedCarryCount(events, team);
}

function metricRows(events: TimelineEvent[], homeName: string, awayName: string, sportType?: string) {
  const sport = sportRulePack(sportType);
  const rows = sportType === "rugby_league" ? [
    ["Carries / hit ups", eventTypeCount(events, "home", "carry"), eventTypeCount(events, "away", "carry")],
    ["Carries implied from tackles", impliedCarryCount(events, "home"), impliedCarryCount(events, "away")],
    ["Tackles made", eventTypeCount(events, "home", "tackle"), eventTypeCount(events, "away", "tackle")],
    ["Passes / offloads", eventTypeCount(events, "home", "pass"), eventTypeCount(events, "away", "pass")],
    ["Kicks", typeCount(events, "home", KICKING_TYPES), typeCount(events, "away", KICKING_TYPES)],
    ["Line breaks", eventsFor(events, "home").filter(isLineBreakEvent).length, eventsFor(events, "away").filter(isLineBreakEvent).length],
    ["Turnovers conceded", eventTypeCount(events, "home", "turnover"), eventTypeCount(events, "away", "turnover")],
    ["Penalties / six-again", eventTypeCount(events, "home", "penalty"), eventTypeCount(events, "away", "penalty")],
    ["Scrums", eventTypeCount(events, "home", "scrum"), eventTypeCount(events, "away", "scrum")],
  ] : sportType === "afl" ? [
    ["Disposals", typeCount(events, "home", ["kick", "pass", "carry"]), typeCount(events, "away", ["kick", "pass", "carry"])],
    ["Kicks", eventTypeCount(events, "home", "kick"), eventTypeCount(events, "away", "kick")],
    ["Handballs", countText(events, "home", /handball/i), countText(events, "away", /handball/i)],
    ["Marks", countText(events, "home", /mark/i), countText(events, "away", /mark/i)],
    ["Tackles", eventTypeCount(events, "home", "tackle"), eventTypeCount(events, "away", "tackle")],
    ["Inside 50s", countText(events, "home", /inside 50/i), countText(events, "away", /inside 50/i)],
    ["Clearances", countText(events, "home", /clearance/i), countText(events, "away", /clearance/i)],
    ["Turnovers conceded", eventTypeCount(events, "home", "turnover"), eventTypeCount(events, "away", "turnover")],
    ["Stoppages", eventTypeCount(events, "home", "stoppage"), eventTypeCount(events, "away", "stoppage")],
  ] : [
    ["Carries coded", eventTypeCount(events, "home", "carry"), eventTypeCount(events, "away", "carry")],
    ["Carries implied from tackles", impliedCarryCount(events, "home"), impliedCarryCount(events, "away")],
    ["Passes", eventTypeCount(events, "home", "pass"), eventTypeCount(events, "away", "pass")],
    ["Kicks", typeCount(events, "home", KICKING_TYPES), typeCount(events, "away", KICKING_TYPES)],
    ["Linebreaks", eventsFor(events, "home").filter(isLineBreakEvent).length, eventsFor(events, "away").filter(isLineBreakEvent).length],
    ["Turnovers conceded", eventTypeCount(events, "home", "turnover"), eventTypeCount(events, "away", "turnover")],
    ["Tackles made", eventTypeCount(events, "home", "tackle"), eventTypeCount(events, "away", "tackle")],
    ["Penalties conceded", eventTypeCount(events, "home", "penalty"), eventTypeCount(events, "away", "penalty")],
    ["Rucks", eventTypeCount(events, "home", "ruck"), eventTypeCount(events, "away", "ruck")],
    ["Scrums", eventTypeCount(events, "home", "scrum"), eventTypeCount(events, "away", "scrum")],
    ["Lineouts", eventTypeCount(events, "home", "lineout"), eventTypeCount(events, "away", "lineout")],
  ];
  return rows.map(([label, home, away]) => ({ label: String(label), home: Number(home), away: Number(away), homeName, awayName, sportName: sport.displayName }));
}

function teamSummaryRows(events: TimelineEvent[], team: EventTeam, limit = 4): [string, number][] {
  const rows = sortedEntries(
    countBy(
      eventsFor(events, team).filter((event) => !isTry(event) && !isConversion(event) && !isPenaltyGoal(event) && !isDropGoal(event)),
      semanticEventLabel,
    ),
  ).slice(0, limit);
  return rows.length ? rows : [["No non-scoring events", 0] as [string, number]];
}

function scoringRowsFor(events: TimelineEvent[], team: EventTeam): [string, number][] {
  return [
    ["Tries", eventsFor(events, team).filter(isTry).length],
    ["Conversions", eventsFor(events, team).filter(isConversion).length],
    ["Penalty goals", eventsFor(events, team).filter(isPenaltyGoal).length],
    ["Drop goals", eventsFor(events, team).filter(isDropGoal).length],
  ];
}

function typeRows(events: TimelineEvent[], team: EventTeam, types: SemanticEventType[], title: string, limit = 4) {
  const rows = sortedEntries(countBy(eventsFor(events, team, types), semanticEventLabel)).slice(0, limit);
  return { title, rows: rows.length ? rows : [["No coded events", 0] as [string, number]] };
}

function madeTackleCount(events: TimelineEvent[], team: EventTeam) {
  return eventsFor(events, team).filter(isMadeTackleEvent).length;
}

function missedTackleCount(events: TimelineEvent[], team: EventTeam) {
  return eventsFor(events, team).filter(isMissedTackleEvent).length;
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
  const homeName = selectedMatch ? teamName(selectedMatch.home_team_id) : "Home Team";
  const awayName = selectedMatch ? teamName(selectedMatch.away_team_id) : "Away Team";
  const reportRulePack = sportRulePack(selectedMatch?.sport_type);

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
        setEvents(eventData.filter(isReportActiveEvent));
        setNotice(eventData.length ? "Printable report ready." : "No coded events yet. The report will print with empty tables.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Unable to load match report data.");
      }
    }
    void loadMatchData();
  }, [requestedVideoId, selectedMatchId]);

  const homeScore = useMemo(() => scoreFor(events, "home"), [events]);
  const awayScore = useMemo(() => scoreFor(events, "away"), [events]);
  const dashboardRows = useMemo(() => metricRows(events, homeName, awayName, selectedMatch?.sport_type), [awayName, events, homeName, selectedMatch?.sport_type]);
  const categoryRows = useMemo(() => sortedEntries(countBy(events, semanticCategory)), [events]);
  const zoneRows = useMemo(() => sortedEntries(countBy(events.filter((event) => event.field_zone), (event) => event.field_zone ?? "Unknown")), [events]);
  const outcomeRows = useMemo(() => sortedEntries(countBySemanticLabel(events)), [events]);
  const clipEvents = useMemo(() => events.filter((event) => event.clip_requested), [events]);
  const inferredEventCount = useMemo(() => events.filter((event) => event.event_source === "inferred" || event.event_source === "linked_logic").length, [events]);
  const keyMoments = useMemo(() => {
    const priority = new Set<EventType>(["try", "penalty", "card", "turnover", "kick", "lineout", "scrum"]);
    return events
      .filter((event) => priority.has(semanticEventType(event) as EventType) || event.clip_requested || event.notes || event.phase_number)
      .sort((a, b) => a.start_seconds - b.start_seconds)
      .slice(0, 20);
  }, [events]);

  const homeAttack = attackingActions(events, "home");
  const awayAttack = attackingActions(events, "away");
  const homeDefence = madeTackleCount(events, "home") + missedTackleCount(events, "home");
  const awayDefence = madeTackleCount(events, "away") + missedTackleCount(events, "away");
  const homeBreakdown = typeCount(events, "home", BREAKDOWN_TYPES);
  const awayBreakdown = typeCount(events, "away", BREAKDOWN_TYPES);
  const homeKicking = typeCount(events, "home", KICKING_TYPES);
  const awayKicking = typeCount(events, "away", KICKING_TYPES);
  const homeSetPiece = typeCount(events, "home", SET_PIECE_TYPES);
  const awaySetPiece = typeCount(events, "away", SET_PIECE_TYPES);
  const homeDiscipline = typeCount(events, "home", DISCIPLINE_TYPES);
  const awayDiscipline = typeCount(events, "away", DISCIPLINE_TYPES);

  return (
    <main className="opta-report-shell">
      <div className="print-toolbar print:hidden">
        <Link href="/reports" className="toolbar-link">Back to builder</Link>
        <button type="button" onClick={() => window.print()} className="toolbar-button">Print / save PDF</button>
      </div>

      <article className="report-document">
        <ReportPage className="cover-page">
          <div className="brand-sash" />
          <div className="cover-title">
            <BrandLockup />
            <h1>Match Report</h1>
            <p>{selectedMatch?.competition ?? "Competition Name"}</p>
            <p>{selectedMatch?.match_date ?? "Day, DD/MM/YYYY"}</p>
            <p>{selectedMatch?.venue ?? "Venue"}</p>
            <p>{reportRulePack.displayName} · {reportRulePack.reportTemplateId}</p>
          </div>
          <div className="cover-scoreboard">
            <CoverTeam name={homeName} score={homeScore} tone="home" />
            <CoverTeam name={awayName} score={awayScore} tone="away" />
          </div>
        </ReportPage>

        <ReportPage>
          <MatchHeader title={`${homeName} vs ${awayName}`} subtitle={selectedMatch?.match_date ?? "DD/MM/YYYY"} />
          <FixtureStrip match={selectedMatch} video={selectedVideo} />
          <ScoreBlock homeName={homeName} awayName={awayName} homeScore={homeScore} awayScore={awayScore} events={events} />
          <SectionBar left={homeName} center="Possession and Territory" right={awayName} />
          <div className="dashboard-donuts">
            <DonutMetric label="Possession %" value={teamShare(events, "home")} tone="home" />
            <DonutMetric label="Territory %" value={percent(zoneCount(events, "home", /50|22|attacking|opposition/i), eventsFor(events, "home").length)} tone="home" />
            <DonutMetric label="Attacking Actions" value={homeAttack} tone="home" variant="number" />
            <DonutMetric label="Ball in Play Events" value={events.length} tone="neutral" variant="number" />
            <DonutMetric label="Possession %" value={teamShare(events, "away")} tone="away" />
            <DonutMetric label="Territory %" value={percent(zoneCount(events, "away", /50|22|attacking|opposition/i), eventsFor(events, "away").length)} tone="away" />
            <DonutMetric label="Attacking Actions" value={awayAttack} tone="away" variant="number" />
          </div>
          <SectionBar left={homeName} center="Snapshot" right={awayName} />
          <div className="snapshot-grid">
            <RosterColumn teamName={homeName} rows={[...scoringRowsFor(events, "home"), ...teamSummaryRows(events, "home", 4)].slice(0, 8)} tone="home" />
            <ComparisonSnapshot rows={dashboardRows} />
            <RosterColumn teamName={awayName} rows={[...scoringRowsFor(events, "away"), ...teamSummaryRows(events, "away", 4)].slice(0, 8)} tone="away" />
          </div>
        </ReportPage>

        <ReportPage>
          <TemplatePageTitle letter="A" title="Attack & Defence" match={`${homeName} v ${awayName}`} date={selectedMatch?.match_date ?? "DD/MM/YYYY"} />
          <DualTeamSection title="Attack" homeName={homeName} awayName={awayName}>
            <DonutRow>
              <DonutMetric label="Carries Over Gainline %" value={percent(countText(events, "home", /gainline|dominant|line ?break/i), Math.max(1, eventTypeCount(events, "home", "carry")))} tone="home" />
              <DonutMetric label="Carries On Gainline %" value={percent(countText(events, "home", /neutral|gainline/i), Math.max(1, eventTypeCount(events, "home", "carry")))} tone="home" />
              <DonutMetric label="Carry Efficiency %" value={percent(eventTypeCount(events, "home", "carry") + eventTypeCount(events, "home", "try"), Math.max(1, homeAttack))} tone="home" />
              <DonutMetric label="Carries Over Gainline %" value={percent(countText(events, "away", /gainline|dominant|line ?break/i), Math.max(1, eventTypeCount(events, "away", "carry")))} tone="away" />
              <DonutMetric label="Carries On Gainline %" value={percent(countText(events, "away", /neutral|gainline/i), Math.max(1, eventTypeCount(events, "away", "carry")))} tone="away" />
              <DonutMetric label="Carry Efficiency %" value={percent(eventTypeCount(events, "away", "carry") + eventTypeCount(events, "away", "try"), Math.max(1, awayAttack))} tone="away" />
            </DonutRow>
            <TeamTables left={[typeRows(events, "home", ["try"], "Tries Scored"), typeRows(events, "home", ["carry"], "Ball Carries"), typeRows(events, "home", ["pass"], "Passes")]} right={[typeRows(events, "away", ["try"], "Tries Scored"), typeRows(events, "away", ["carry"], "Ball Carries"), typeRows(events, "away", ["pass"], "Passes")]} />
          </DualTeamSection>
          <DualTeamSection title="Defence" homeName={homeName} awayName={awayName}>
            <DonutRow>
              <DonutMetric label="Opp Carries Over Gainline %" value={percent(countText(events, "away", /gainline|dominant|line ?break/i), Math.max(1, eventTypeCount(events, "away", "carry")))} tone="home" />
              <DonutMetric label="Made Tackle %" value={percent(madeTackleCount(events, "home"), Math.max(1, homeDefence))} tone="home" />
              <DonutMetric label="Opp Carries Over Gainline %" value={percent(countText(events, "home", /gainline|dominant|line ?break/i), Math.max(1, eventTypeCount(events, "home", "carry")))} tone="away" />
              <DonutMetric label="Made Tackle %" value={percent(madeTackleCount(events, "away"), Math.max(1, awayDefence))} tone="away" />
            </DonutRow>
            <TeamTables left={[{ title: "Tackles Made", rows: [["Made", madeTackleCount(events, "home")]] }, { title: "Tackles Missed", rows: [["Missed", missedTackleCount(events, "home")]] }, { title: "Turnovers Won", rows: [["Turnover", eventTypeCount(events, "home", "turnover")]] }]} right={[{ title: "Tackles Made", rows: [["Made", madeTackleCount(events, "away")]] }, { title: "Tackles Missed", rows: [["Missed", missedTackleCount(events, "away")]] }, { title: "Turnovers Won", rows: [["Turnover", eventTypeCount(events, "away", "turnover")]] }]} />
          </DualTeamSection>
        </ReportPage>

        <ReportPage>
          <TemplatePageTitle letter="B" title="Breakdown, Kicking & Exits" match={`${homeName} v ${awayName}`} date={selectedMatch?.match_date ?? "DD/MM/YYYY"} />
          <DualTeamSection title="Breakdown" homeName={homeName} awayName={awayName}>
            <DonutRow>
              <DonutMetric label="% Ruck/Maul Retention" value={percent(homeBreakdown - eventTypeCount(events, "home", "turnover"), Math.max(1, homeBreakdown))} tone="home" />
              <DonutMetric label="Breakdown Steals" value={eventTypeCount(events, "home", "turnover")} tone="home" variant="number" />
              <DonutMetric label="% Ruck/Maul Retention" value={percent(awayBreakdown - eventTypeCount(events, "away", "turnover"), Math.max(1, awayBreakdown))} tone="away" />
              <DonutMetric label="Breakdown Steals" value={eventTypeCount(events, "away", "turnover")} tone="away" variant="number" />
            </DonutRow>
            <RuckSpeedGrid homeName={homeName} awayName={awayName} events={events} />
            <TeamTables left={[typeRows(events, "home", BREAKDOWN_TYPES, "Own Ruck Arrivals"), typeRows(events, "home", ["maul"], "Mauls"), typeRows(events, "home", ["turnover"], "Cleanouts / Steals")]} right={[typeRows(events, "away", BREAKDOWN_TYPES, "Own Ruck Arrivals"), typeRows(events, "away", ["maul"], "Mauls"), typeRows(events, "away", ["turnover"], "Cleanouts / Steals")]} />
          </DualTeamSection>
          <DualTeamSection title="Kicking & Exits" homeName={homeName} awayName={awayName}>
            <TeamTables left={[typeRows(events, "home", KICKING_TYPES, "Kicks In Play"), { title: "22m Exit %", rows: [["Carrying 22m Exit", percent(zoneCount(events, "home", /22/i), Math.max(1, eventsFor(events, "home").length))], ["Kicking 22m Exit", percent(countText(events, "home", /exit|clear/i), Math.max(1, homeKicking))]] }]} right={[typeRows(events, "away", KICKING_TYPES, "Kicks In Play"), { title: "22m Exit %", rows: [["Carrying 22m Exit", percent(zoneCount(events, "away", /22/i), Math.max(1, eventsFor(events, "away").length))], ["Kicking 22m Exit", percent(countText(events, "away", /exit|clear/i), Math.max(1, awayKicking))]] }]} />
          </DualTeamSection>
        </ReportPage>

        <ReportPage>
          <TemplatePageTitle letter="C" title="Set Piece" match={`${homeName} v ${awayName}`} date={selectedMatch?.match_date ?? "DD/MM/YYYY"} />
          <TwoColumnReport
            homeName={homeName}
            awayName={awayName}
            left={[
              typeRows(events, "home", ["scrum"], "Scrums"),
              typeRows(events, "home", ["lineout"], "Lineouts"),
              typeRows(events, "home", ["maul"], "Mauls"),
              { title: "Set Piece Won %", rows: [["Scrum Won %", percent(countText(events, "home", /won|win|success/i), Math.max(1, homeSetPiece))], ["Lineout Won %", percent(countText(events, "home", /lineout.*won|won.*lineout|success/i), Math.max(1, eventTypeCount(events, "home", "lineout")))] ] },
            ]}
            right={[
              typeRows(events, "away", ["scrum"], "Scrums"),
              typeRows(events, "away", ["lineout"], "Lineouts"),
              typeRows(events, "away", ["maul"], "Mauls"),
              { title: "Set Piece Won %", rows: [["Scrum Won %", percent(countText(events, "away", /won|win|success/i), Math.max(1, awaySetPiece))], ["Lineout Won %", percent(countText(events, "away", /lineout.*won|won.*lineout|success/i), Math.max(1, eventTypeCount(events, "away", "lineout")))] ] },
            ]}
          />
        </ReportPage>

        <ReportPage>
          <TemplatePageTitle letter="D" title="Possessions & Field Position" match={`${homeName} v ${awayName}`} date={selectedMatch?.match_date ?? "DD/MM/YYYY"} />
          <div className="possession-grid">
            <DonutMetric label={`${homeName} possession share`} value={teamShare(events, "home")} tone="home" />
            <DonutMetric label={`${awayName} possession share`} value={teamShare(events, "away")} tone="away" />
            <DonutMetric label="Neutral / stoppage events" value={eventsFor(events, "neutral").length} tone="neutral" variant="number" />
          </div>
          <SectionBar left={homeName} center="Field Zone Breakdown" right={awayName} />
          <div className="three-column-content">
            <StatList title={`${homeName} zones`} rows={sortedEntries(countBy(eventsFor(events, "home").filter((event) => event.field_zone), (event) => event.field_zone ?? "Unknown")).slice(0, 12)} tone="home" />
            <StatList title="All zones" rows={zoneRows.slice(0, 16)} tone="neutral" />
            <StatList title={`${awayName} zones`} rows={sortedEntries(countBy(eventsFor(events, "away").filter((event) => event.field_zone), (event) => event.field_zone ?? "Unknown")).slice(0, 12)} tone="away" />
          </div>
        </ReportPage>

        <ReportPage>
          <TemplatePageTitle letter="E" title="Restarts & Transitions" match={`${homeName} v ${awayName}`} date={selectedMatch?.match_date ?? "DD/MM/YYYY"} />
          <TwoColumnReport
            homeName={homeName}
            awayName={awayName}
            left={[
              typeRows(events, "home", ["kickoff"], "Kickoffs / Restarts"),
              typeRows(events, "home", ["turnover"], "Turnovers"),
              { title: "Transition Actions", rows: sortedEntries(countBy(eventsFor(events, "home").filter((event) => semanticCategory(event) === "transition"), semanticEventLabel)).slice(0, 6) },
            ]}
            right={[
              typeRows(events, "away", ["kickoff"], "Kickoffs / Restarts"),
              typeRows(events, "away", ["turnover"], "Turnovers"),
              { title: "Transition Actions", rows: sortedEntries(countBy(eventsFor(events, "away").filter((event) => semanticCategory(event) === "transition"), semanticEventLabel)).slice(0, 6) },
            ]}
          />
          <TimelineTable events={keyMoments} homeName={homeName} awayName={awayName} title="Transition Timeline" />
        </ReportPage>

        <ReportPage>
          <TemplatePageTitle letter="F" title="Play Styles" match={`${homeName} v ${awayName}`} date={selectedMatch?.match_date ?? "DD/MM/YYYY"} />
          <SectionBar left={homeName} center="Action Profile" right={awayName} />
          <ComparisonSnapshot rows={dashboardRows} tall />
          <div className="two-column-content">
            <StatList title="Event Mix" rows={categoryRows.map(([key, value]) => [CATEGORY_LABELS[key as EventCategory] ?? key, value])} tone="neutral" />
            <StatList title="Outcome Mix" rows={outcomeRows.slice(0, 14)} tone="neutral" />
          </div>
        </ReportPage>

        <ReportPage>
          <TemplatePageTitle letter="G" title="Infringements & Discipline" match={`${homeName} v ${awayName}`} date={selectedMatch?.match_date ?? "DD/MM/YYYY"} />
          <DualTeamSection title="Infringements" homeName={homeName} awayName={awayName}>
            <DonutRow>
              <DonutMetric label="Penalty Share" value={percent(homeDiscipline, homeDiscipline + awayDiscipline)} tone="home" />
              <DonutMetric label="Cards" value={eventTypeCount(events, "home", "card")} tone="home" variant="number" />
              <DonutMetric label="Penalty Share" value={percent(awayDiscipline, homeDiscipline + awayDiscipline)} tone="away" />
              <DonutMetric label="Cards" value={eventTypeCount(events, "away", "card")} tone="away" variant="number" />
            </DonutRow>
            <TeamTables left={[typeRows(events, "home", DISCIPLINE_TYPES, "Penalties / Cards"), typeRows(events, "home", ["penalty"], "Penalty Types")]} right={[typeRows(events, "away", DISCIPLINE_TYPES, "Penalties / Cards"), typeRows(events, "away", ["penalty"], "Penalty Types")]} />
          </DualTeamSection>
          <TimelineTable events={events.filter((event) => DISCIPLINE_TYPES.includes(semanticEventType(event))).slice(0, 18)} homeName={homeName} awayName={awayName} title="Discipline Timeline" />
        </ReportPage>

        <ReportPage>
          <TemplatePageTitle letter="H" title="Clip Queue & Key Moments" match={`${homeName} v ${awayName}`} date={selectedMatch?.match_date ?? "DD/MM/YYYY"} />
          <TimelineTable events={clipEvents.length ? clipEvents : keyMoments} homeName={homeName} awayName={awayName} title="Clip Queue" empty="No clip requests yet. Use Coding to mark report clips." />
          <div className="report-note">
            <strong>Analyst note</strong>
            <span>This template is generated from coded timeline events, zones, outcomes and clip requests. As the coding model improves, these tables will automatically become richer.</span>
            {inferredEventCount ? <span>{inferredEventCount} high-confidence inferred event{inferredEventCount === 1 ? "" : "s"} included for analyst review.</span> : null}
            <span className="print-hidden">{notice}</span>
          </div>
        </ReportPage>
      </article>

      <style jsx global>{`
        @page { size: A4; margin: 0; }

        .opta-report-shell {
          min-height: 100vh;
          background: #e7e7e7;
          color: #202020;
          font-family: Arial, Helvetica, sans-serif;
          letter-spacing: 0;
        }

        .print-toolbar {
          position: sticky;
          top: 0;
          z-index: 30;
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          border-bottom: 1px solid #d3d3d3;
          background: rgba(255,255,255,.94);
          padding: 12px 18px;
        }

        .toolbar-link,
        .toolbar-button {
          min-height: 38px;
          border-radius: 6px;
          padding: 9px 13px;
          font-size: 13px;
          font-weight: 800;
        }

        .toolbar-link { border: 1px solid #bbb; }
        .toolbar-button { border: 0; background: #ff9f17; color: #151515; }

        .report-document {
          display: grid;
          width: min(100%, 1080px);
          margin: 0 auto;
          gap: 18px;
          padding: 18px;
        }

        .report-page {
          position: relative;
          min-height: 297mm;
          overflow: hidden;
          border: 1px solid #d8d8d8;
          background: #fff;
          padding: 18px 22px;
          box-shadow: 0 16px 40px rgba(0,0,0,.12);
        }

        .cover-page {
          display: grid;
          align-content: end;
          padding: 0;
        }

        .brand-sash {
          position: absolute;
          left: -72mm;
          top: -20mm;
          width: 118mm;
          height: 340mm;
          transform: skewX(-14deg);
          background: linear-gradient(170deg, #c0008a 0%, #fa3b25 45%, #ff9616 100%);
        }

        .brand-sash::before,
        .brand-sash::after {
          content: "";
          position: absolute;
          width: 20mm;
          height: 70mm;
          background: rgba(255,255,255,.12);
        }

        .brand-sash::before { left: 26mm; top: 14mm; }
        .brand-sash::after { right: 13mm; bottom: 86mm; }

        .cover-title {
          position: absolute;
          right: 26mm;
          top: 116mm;
          text-align: right;
        }

        .brand-lockup {
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 12px;
          color: #222;
        }

        .brand-mark {
          display: grid;
          grid-template-columns: repeat(3, 12px);
          gap: 4px;
          transform: skewX(-12deg);
        }

        .brand-mark span {
          display: block;
          width: 12px;
          height: 50px;
          border-radius: 3px;
        }

        .brand-mark span:nth-child(1) { background: #c0008a; }
        .brand-mark span:nth-child(2) { background: #f03024; }
        .brand-mark span:nth-child(3) { background: #ff9f17; }

        .brand-lockup strong {
          display: block;
          font-size: 34px;
          line-height: .9;
          text-transform: uppercase;
        }

        .brand-lockup small {
          display: block;
          margin-top: 4px;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: .12em;
          text-transform: uppercase;
        }

        .cover-title h1 {
          margin-top: 18px;
          color: #222;
          font-size: 42px;
          font-weight: 400;
        }

        .cover-title p {
          color: #222;
          font-size: 22px;
          line-height: 1.45;
        }

        .cover-scoreboard {
          position: absolute;
          left: 70mm;
          right: 32mm;
          bottom: 28mm;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 64px;
        }

        .cover-team {
          display: grid;
          justify-items: center;
          gap: 16px;
          text-align: center;
        }

        .team-crest {
          display: grid;
          width: 38mm;
          height: 38mm;
          place-items: center;
          border-radius: 2px;
          background: linear-gradient(#c8f0ff 0 55%, #9ac400 56% 100%);
          color: #fff;
          font-size: 38px;
          font-weight: 950;
        }

        .cover-team strong {
          display: block;
          font-size: 23px;
          font-style: italic;
          line-height: 1.15;
        }

        .cover-team span {
          display: block;
          font-size: 20px;
          font-weight: 900;
        }

        .match-header {
          display: grid;
          grid-template-columns: 165px 1fr;
          align-items: center;
          height: 58px;
          background: #3f3f3f;
          color: white;
        }

        .match-header .team-crest {
          width: 160px;
          height: 52px;
          border-radius: 0;
          font-size: 22px;
        }

        .match-header__text {
          padding-right: 26px;
          text-align: right;
        }

        .match-header h2 {
          color: white;
          font-size: 28px;
          font-weight: 400;
          line-height: 1.05;
        }

        .match-header p {
          color: white;
          font-size: 18px;
          line-height: 1.1;
        }

        .fixture-strip {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          margin-top: 24px;
          background: #dedede;
          color: #202020;
          font-size: 15px;
        }

        .fixture-strip div {
          display: grid;
          grid-template-columns: 34px 1fr;
          gap: 10px;
          align-items: center;
          padding: 7px 18px;
        }

        .fixture-icon {
          font-size: 20px;
          text-align: center;
        }

        .score-block {
          display: grid;
          grid-template-columns: 1fr 150px 1fr;
          align-items: center;
          background: #dedede;
          text-align: center;
        }

        .score-block h3 {
          font-size: 20px;
          font-weight: 500;
        }

        .score-block strong {
          color: #000;
          font-size: 48px;
          font-weight: 400;
        }

        .scorer-rows {
          display: grid;
          grid-template-columns: 1fr 150px 1fr;
          border-bottom: 1px solid #aaa;
          color: #303030;
          text-align: center;
        }

        .scorer-rows div {
          min-height: 36px;
          padding: 8px;
          border-top: 1px solid #aaa;
          font-size: 15px;
        }

        .scorer-rows .label {
          color: #303030;
          font-weight: 500;
        }

        .section-bar {
          display: grid;
          grid-template-columns: 1fr 1.4fr 1fr;
          align-items: center;
          margin-top: 18px;
          background: #747474;
          color: white;
          font-size: 16px;
          line-height: 1;
          text-align: center;
          text-transform: uppercase;
        }

        .section-bar span {
          padding: 8px 10px;
        }

        .dashboard-donuts {
          display: grid;
          grid-template-columns: repeat(7, 1fr);
          gap: 12px;
          align-items: start;
          padding: 16px 0;
        }

        .donut-metric {
          display: grid;
          justify-items: center;
          gap: 7px;
          min-width: 0;
          text-align: center;
        }

        .donut-ring {
          display: grid;
          width: 76px;
          height: 76px;
          place-items: center;
          border-radius: 50%;
        }

        .donut-ring span {
          display: grid;
          width: 48px;
          height: 48px;
          place-items: center;
          border-radius: 50%;
          background: white;
          color: #000;
          font-size: 17px;
          font-style: italic;
          font-weight: 950;
        }

        .donut-metric p {
          color: #303030;
          font-size: 13px;
          line-height: 1.1;
        }

        .tone-home { --tone: #ff4a20; }
        .tone-away { --tone: #d1078d; }
        .tone-neutral { --tone: #747474; }

        .snapshot-grid {
          display: grid;
          grid-template-columns: 240px 1fr 240px;
          gap: 20px;
          margin-top: 18px;
        }

        .template-heading {
          display: grid;
          grid-template-columns: 86px 1fr;
          align-items: center;
          margin: -2px 0 16px;
        }

        .template-heading__top {
          grid-column: 1 / -1;
          display: grid;
          grid-template-columns: 170px 1fr;
          align-items: center;
          height: 58px;
          margin: -18px -22px 16px;
          background: #3f3f3f;
          color: white;
        }

        .template-heading__top .brand-lockup {
          justify-content: flex-start;
          padding-left: 22px;
          color: white;
        }

        .template-heading__top .brand-lockup strong {
          color: white;
          font-size: 22px;
        }

        .template-heading__top .brand-lockup small {
          display: none;
        }

        .template-heading__match {
          padding-right: 24px;
          text-align: right;
        }

        .template-heading__match h2 {
          color: white;
          font-size: 25px;
          font-weight: 400;
        }

        .template-heading__match p {
          color: white;
          font-size: 17px;
        }

        .template-letter {
          display: grid;
          width: 74px;
          height: 74px;
          place-items: center;
          border-radius: 50%;
          background: #ffa313;
          color: white;
          font-size: 58px;
          font-style: italic;
          font-weight: 950;
          line-height: 1;
        }

        .template-heading__title {
          height: 62px;
          background: #aaa;
          padding: 13px 0;
          font-size: 32px;
          font-weight: 400;
        }

        .dual-team {
          margin-top: 14px;
        }

        .team-section-head {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          align-items: center;
          border-bottom: 2px solid #2b2b2b;
          background: #aaa;
          font-size: 16px;
        }

        .team-section-head strong {
          padding: 7px 10px;
          text-align: center;
          text-transform: uppercase;
        }

        .team-section-head span:first-child { text-align: left; }
        .team-section-head span:last-child { text-align: right; }

        .donut-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
          gap: 16px;
          padding: 16px 0;
        }

        .team-tables {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 28px;
        }

        .table-column {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .stat-list {
          overflow: hidden;
          border: 0;
          color: #303030;
          font-size: 13px;
        }

        .stat-list h3 {
          display: grid;
          grid-template-columns: 1fr auto;
          margin: 0;
          background: #707070;
          color: white;
          font-size: 13px;
          font-weight: 500;
          line-height: 1.1;
        }

        .stat-list h3 span {
          padding: 5px 7px;
        }

        .stat-list h3 b {
          display: inline-grid;
          width: 38px;
          place-items: center;
          background: var(--tone);
          border-radius: 999px;
          color: white;
          font-style: italic;
        }

        .stat-row {
          display: grid;
          grid-template-columns: 1fr 38px;
          min-height: 22px;
        }

        .stat-row:nth-child(odd) {
          background: #dedede;
        }

        .stat-row span {
          overflow: hidden;
          padding: 4px 7px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .stat-row strong {
          padding: 4px 7px;
          text-align: right;
        }

        .comparison-snapshot {
          display: grid;
          gap: 11px;
        }

        .comparison-row {
          display: grid;
          grid-template-columns: 1fr 55px 190px 55px 1fr;
          align-items: center;
          gap: 10px;
          font-size: 14px;
        }

        .comparison-row .bar {
          height: 18px;
          background: linear-gradient(90deg, rgba(255,255,255,0), var(--tone));
        }

        .comparison-row .right-bar {
          background: linear-gradient(90deg, var(--tone), rgba(255,255,255,0));
        }

        .comparison-row strong {
          text-align: center;
        }

        .comparison-row span {
          text-align: center;
        }

        .comparison-snapshot.tall {
          padding: 20px 70px;
        }

        .two-column-report,
        .two-column-content {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 28px;
          margin-top: 18px;
        }

        .three-column-content {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 20px;
          margin-top: 18px;
        }

        .possession-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 38px;
          padding: 36px 80px;
        }

        .ruck-speed {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 28px;
          margin: 8px 0 18px;
        }

        .ruck-panel h3 {
          background: #aaa;
          padding: 6px;
          text-align: center;
          text-transform: uppercase;
        }

        .ruck-panel__grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          margin-top: 12px;
        }

        .timeline-table {
          margin-top: 18px;
          overflow: hidden;
        }

        .timeline-table h3 {
          background: #707070;
          color: white;
          padding: 7px 9px;
          font-size: 14px;
          font-weight: 500;
        }

        .timeline-table table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }

        .timeline-table th {
          background: #dedede;
          padding: 6px;
          text-align: left;
          text-transform: uppercase;
        }

        .timeline-table td {
          border-top: 1px solid #d8d8d8;
          padding: 6px;
        }

        .report-note {
          display: grid;
          gap: 8px;
          margin-top: 24px;
          border-left: 7px solid #ff9f17;
          background: #eee;
          padding: 14px 16px;
          font-size: 13px;
        }

        @media print {
          html, body { background: white !important; }
          .product-strip,
          .site-nav,
          .design-studio-toggle,
          .design-studio-panel,
          .print-toolbar,
          .print-hidden,
          .print\\:hidden {
            display: none !important;
          }

          main.opta-report-shell {
            min-height: 0;
            background: white !important;
          }

          .report-document {
            width: auto;
            margin: 0;
            gap: 0;
            padding: 0;
          }

          .report-page {
            width: 210mm;
            min-height: 297mm;
            height: 297mm;
            break-after: page;
            border: 0;
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
  return <section className={`report-page ${className}`}>{children}</section>;
}

function BrandLockup() {
  return (
    <div className="brand-lockup">
      <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
      <span><strong>RVA</strong><small>Performance intelligence</small></span>
    </div>
  );
}

function CoverTeam({ name, score, tone }: { name: string; score: number; tone: ReportTone }) {
  return (
    <div className={`cover-team tone-${tone}`}>
      <span className="team-crest">{name.slice(0, 1).toUpperCase()}</span>
      <strong>{name}</strong>
      <span>({score})</span>
    </div>
  );
}

function MatchHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="match-header">
      <span className="team-crest">RVA</span>
      <div className="match-header__text"><h2>{title}</h2><p>{subtitle}</p></div>
    </header>
  );
}

function FixtureStrip({ match, video }: { match: Match | null; video: VideoAsset | null }) {
  return (
    <div className="fixture-strip">
      <div><span className="fixture-icon">D</span><span>{match?.match_date ?? "Date"}</span></div>
      <div><span className="fixture-icon">V</span><span>{match?.venue ?? "Venue"}</span></div>
      <div><span className="fixture-icon">C</span><span>{match?.competition ?? "Competition"}</span></div>
      <div><span className="fixture-icon">F</span><span>{video?.original_filename ?? "Video file"}</span></div>
    </div>
  );
}

function ScoreBlock({ homeName, awayName, homeScore, awayScore, events }: { homeName: string; awayName: string; homeScore: number; awayScore: number; events: TimelineEvent[] }) {
  const homeScoring = Object.fromEntries(scoringRowsFor(events, "home"));
  const awayScoring = Object.fromEntries(scoringRowsFor(events, "away"));
  const scoringRows = ["Tries", "Conversions", "Penalty goals", "Drop goals"].map((label) => [label, homeScoring[label] ?? 0, awayScoring[label] ?? 0] as const);
  return (
    <>
      <div className="score-block"><h3>{homeName}</h3><strong>{homeScore} - {awayScore}</strong><h3>{awayName}</h3></div>
      <div className="scorer-rows">
        {scoringRows.map(([label, home, away]) => (
          <Fragment key={label}><div>{home || "-"}</div><div className="label">{label}</div><div>{away || "-"}</div></Fragment>
        ))}
      </div>
    </>
  );
}

function SectionBar({ left, center, right }: { left: string; center: string; right: string }) {
  return <div className="section-bar"><span>{left}</span><strong>{center}</strong><span>{right}</span></div>;
}

function TemplatePageTitle({ letter, title, match, date }: { letter: string; title: string; match: string; date: string }) {
  return (
    <header className="template-heading">
      <div className="template-heading__top"><BrandLockup /><div className="template-heading__match"><h2>{match}</h2><p>{date}</p></div></div>
      <span className="template-letter">{letter}</span>
      <h1 className="template-heading__title">{title}</h1>
    </header>
  );
}

function DualTeamSection({ title, homeName, awayName, children }: { title: string; homeName: string; awayName: string; children: React.ReactNode }) {
  return (
    <section className="dual-team">
      <div className="team-section-head"><span>{homeName}</span><strong>{title}</strong><span>{awayName}</span></div>
      {children}
    </section>
  );
}

function DonutRow({ children }: { children: React.ReactNode }) {
  return <div className="donut-row">{children}</div>;
}

function DonutMetric({ label, value, tone, variant = "percent" }: { label: string; value: number; tone: ReportTone; variant?: "percent" | "number" }) {
  const display = variant === "percent" ? `${value}%` : String(value);
  const fill = variant === "percent" ? value : Math.min(100, value * 8);
  return (
    <div className={`donut-metric tone-${tone}`}>
      <div className="donut-ring" style={{ background: `conic-gradient(var(--tone) ${fill}%, #e3e3e3 0)` }}><span>{display}</span></div>
      <p>{label}</p>
    </div>
  );
}

function StatList({ title, rows, tone }: { title: string; rows: [string, number][]; tone: ReportTone }) {
  const visibleRows = rows.length ? rows : [["No coded data", 0] as [string, number]];
  return (
    <section className={`stat-list tone-${tone}`}>
      <h3><span>{title}</span><b>TOT</b></h3>
      {visibleRows.map(([label, value], index) => (
        <div key={`${title}-${label}-${index}`} className="stat-row"><span>{label.replaceAll("_", " ")}</span><strong>{value}</strong></div>
      ))}
    </section>
  );
}

function TeamTables({ left, right }: { left: { title: string; rows: [string, number][] }[]; right: { title: string; rows: [string, number][] }[] }) {
  return (
    <div className="team-tables">
      <div className="table-column">{left.map((section) => <StatList key={section.title} title={section.title} rows={section.rows} tone="home" />)}</div>
      <div className="table-column">{right.map((section) => <StatList key={section.title} title={section.title} rows={section.rows} tone="away" />)}</div>
    </div>
  );
}

function TwoColumnReport({ homeName, awayName, left, right }: { homeName: string; awayName: string; left: { title: string; rows: [string, number][] }[]; right: { title: string; rows: [string, number][] }[] }) {
  return (
    <>
      <SectionBar left={homeName} center="Comparison" right={awayName} />
      <div className="two-column-report">
        <div className="table-column">{left.map((section) => <StatList key={section.title} title={section.title} rows={section.rows} tone="home" />)}</div>
        <div className="table-column">{right.map((section) => <StatList key={section.title} title={section.title} rows={section.rows} tone="away" />)}</div>
      </div>
    </>
  );
}

function RosterColumn({ teamName, rows, tone }: { teamName: string; rows: [string, number][]; tone: ReportTone }) {
  return (
    <div>
      <StatList title={`${teamName} team summary`} rows={rows} tone={tone} />
    </div>
  );
}

function ComparisonSnapshot({ rows, tall = false }: { rows: { label: string; home: number; away: number; homeName: string; awayName: string }[]; tall?: boolean }) {
  return (
    <section className={`comparison-snapshot ${tall ? "tall" : ""}`}>
      {rows.map((row) => {
        const max = Math.max(1, row.home, row.away);
        return (
          <div key={row.label} className="comparison-row">
            <span className="bar tone-home" style={{ width: `${percent(row.home, max)}%`, justifySelf: "end" }} />
            <strong>{row.home}</strong>
            <span>{row.label}</span>
            <strong>{row.away}</strong>
            <span className="bar right-bar tone-away" style={{ width: `${percent(row.away, max)}%` }} />
          </div>
        );
      })}
    </section>
  );
}

function RuckSpeedGrid({ homeName, awayName, events }: { homeName: string; awayName: string; events: TimelineEvent[] }) {
  const homeRucks = eventTypeCount(events, "home", "ruck");
  const awayRucks = eventTypeCount(events, "away", "ruck");
  return (
    <div className="ruck-speed">
      <RuckPanel title={`${homeName} ruck speed`} tone="home" values={[percent(countText(events, "home", /quick|0-3/i), Math.max(1, homeRucks)), percent(countText(events, "home", /3-6|medium/i), Math.max(1, homeRucks)), percent(countText(events, "home", />6|slow/i), Math.max(1, homeRucks))]} />
      <RuckPanel title={`${awayName} ruck speed`} tone="away" values={[percent(countText(events, "away", /quick|0-3/i), Math.max(1, awayRucks)), percent(countText(events, "away", /3-6|medium/i), Math.max(1, awayRucks)), percent(countText(events, "away", />6|slow/i), Math.max(1, awayRucks))]} />
    </div>
  );
}

function RuckPanel({ title, tone, values }: { title: string; tone: ReportTone; values: number[] }) {
  return (
    <section className="ruck-panel">
      <h3>{title}</h3>
      <div className="ruck-panel__grid">
        <DonutMetric label="0-3 Secs" value={values[0]} tone={tone} />
        <DonutMetric label="3-6 Secs" value={values[1]} tone={tone} />
        <DonutMetric label=">6 Secs" value={values[2]} tone={tone} />
      </div>
    </section>
  );
}

function TimelineTable({ events, homeName, awayName, title, empty = "No key moments coded yet." }: { events: TimelineEvent[]; homeName: string; awayName: string; title: string; empty?: string }) {
  return (
    <section className="timeline-table">
      <h3>{title}</h3>
      <table>
        <thead><tr><th>Time</th><th>Team</th><th>Event</th><th>Detail</th><th>Zone</th></tr></thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>{formatTime(event.start_seconds)}</td>
              <td>{teamLabel(event.team, homeName, awayName)}</td>
              <td>{event.event_type}</td>
              <td>{event.outcome || event.notes || "Review in Coding"}</td>
              <td>{event.field_zone || "-"}</td>
            </tr>
          ))}
          {!events.length && <tr><td colSpan={5}>{empty}</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
