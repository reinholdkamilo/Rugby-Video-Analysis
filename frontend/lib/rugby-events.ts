import { EventTeam, EventType, TimelineEvent } from "@/lib/api";

export type EventCategory =
  | "attack"
  | "defence"
  | "set_piece"
  | "breakdown_ruck"
  | "kicking"
  | "discipline"
  | "scoring"
  | "transition_turnover"
  | "restart"
  | "error"
  | "zone_territory"
  | "set_tackle_count"
  | "disposal"
  | "contest"
  | "pressure"
  | "territory"
  | "stoppage"
  | "other"
  | "core"
  | "transition"
  | "possession";
export type SemanticEventType = EventType | "line_break";
export type TeamAssignmentBehaviour = "home_away" | "selected" | "neutral_allowed";
export type SportType = "rugby_union" | "rugby_league" | "afl";

export type RugbyTaxonomyItem = {
  id: string;
  displayName: string;
  category: EventCategory;
  defaultEventType: EventType;
  defaultOutcome: string;
  teamAssignment: TeamAssignmentBehaviour;
  affectsScore: boolean;
  scorePoints: number;
  createsEvidence: boolean;
  inferable: boolean;
  appearsInReports: boolean;
};

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  attack: "Attack",
  defence: "Defence",
  set_piece: "Set piece",
  breakdown_ruck: "Breakdown / Ruck",
  kicking: "Kicking",
  discipline: "Discipline",
  scoring: "Scoring",
  transition_turnover: "Transition / Turnover",
  restart: "Restart",
  error: "Error",
  zone_territory: "Zone / Territory",
  set_tackle_count: "Set / Tackle Count",
  disposal: "Disposal",
  contest: "Contest",
  pressure: "Pressure",
  territory: "Territory",
  stoppage: "Stoppage",
  other: "Other",
  core: "Core",
  transition: "Transition",
  possession: "Possession",
};

export const EVENT_CATEGORY_BY_TYPE: Record<EventType, EventCategory> = {
  kickoff: "restart",
  scrum: "set_piece",
  lineout: "set_piece",
  carry: "attack",
  tackle: "defence",
  ruck: "breakdown_ruck",
  maul: "set_piece",
  pass: "attack",
  kick: "kicking",
  turnover: "transition_turnover",
  penalty: "discipline",
  try: "scoring",
  conversion: "scoring",
  card: "discipline",
  stoppage: "other",
  custom: "other",
};

export const REPORT_DRIVEN_RUGBY_TAXONOMY: RugbyTaxonomyItem[] = [
  { id: "carry", displayName: "Carry", category: "attack", defaultEventType: "carry", defaultOutcome: "carry", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "dominant_carry", displayName: "Dominant Carry", category: "attack", defaultEventType: "carry", defaultOutcome: "dominant carry", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "tackle", displayName: "Tackle", category: "defence", defaultEventType: "tackle", defaultOutcome: "tackle made", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "dominant_tackle", displayName: "Dominant Tackle", category: "defence", defaultEventType: "tackle", defaultOutcome: "dominant tackle", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "missed_tackle", displayName: "Missed Tackle", category: "defence", defaultEventType: "tackle", defaultOutcome: "missed tackle", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "line_break", displayName: "Line Break", category: "attack", defaultEventType: "carry", defaultOutcome: "line break", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "pass", displayName: "Pass", category: "attack", defaultEventType: "pass", defaultOutcome: "pass", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "kick", displayName: "Kick", category: "kicking", defaultEventType: "kick", defaultOutcome: "kick", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "ruck", displayName: "Ruck", category: "breakdown_ruck", defaultEventType: "ruck", defaultOutcome: "ruck", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "ruck_retained", displayName: "Ruck Retained", category: "breakdown_ruck", defaultEventType: "ruck", defaultOutcome: "ruck retained", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "ruck_lost", displayName: "Ruck Lost", category: "breakdown_ruck", defaultEventType: "ruck", defaultOutcome: "ruck lost", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "maul", displayName: "Maul", category: "set_piece", defaultEventType: "maul", defaultOutcome: "maul", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "maul_won", displayName: "Maul Won", category: "set_piece", defaultEventType: "maul", defaultOutcome: "maul won", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "maul_lost", displayName: "Maul Lost", category: "set_piece", defaultEventType: "maul", defaultOutcome: "maul lost", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "scrum", displayName: "Scrum", category: "set_piece", defaultEventType: "scrum", defaultOutcome: "scrum", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "scrum_won", displayName: "Scrum Won", category: "set_piece", defaultEventType: "scrum", defaultOutcome: "scrum won", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "scrum_lost", displayName: "Scrum Lost", category: "set_piece", defaultEventType: "scrum", defaultOutcome: "scrum lost", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "lineout", displayName: "Lineout", category: "set_piece", defaultEventType: "lineout", defaultOutcome: "lineout", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "lineout_won", displayName: "Lineout Won", category: "set_piece", defaultEventType: "lineout", defaultOutcome: "lineout won", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "lineout_lost", displayName: "Lineout Lost", category: "set_piece", defaultEventType: "lineout", defaultOutcome: "lineout lost", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "restart", displayName: "Restart", category: "restart", defaultEventType: "kickoff", defaultOutcome: "restart", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "restart_receipt", displayName: "Restart Receipt", category: "restart", defaultEventType: "kickoff", defaultOutcome: "restart receipt", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "exit", displayName: "Exit", category: "zone_territory", defaultEventType: "kick", defaultOutcome: "exit", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "zone_entry", displayName: "Zone Entry", category: "zone_territory", defaultEventType: "custom", defaultOutcome: "zone entry", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "turnover_won", displayName: "Turnover Won", category: "transition_turnover", defaultEventType: "turnover", defaultOutcome: "turnover won", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "turnover_conceded", displayName: "Turnover Conceded", category: "transition_turnover", defaultEventType: "turnover", defaultOutcome: "turnover conceded", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "penalty_won", displayName: "Penalty Won", category: "discipline", defaultEventType: "penalty", defaultOutcome: "penalty won", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "penalty_conceded", displayName: "Penalty Conceded", category: "discipline", defaultEventType: "penalty", defaultOutcome: "penalty conceded", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "penalty_type", displayName: "Penalty Type", category: "discipline", defaultEventType: "penalty", defaultOutcome: "penalty type", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "knock_on", displayName: "Knock On", category: "error", defaultEventType: "custom", defaultOutcome: "knock on", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "forward_pass", displayName: "Forward Pass", category: "error", defaultEventType: "pass", defaultOutcome: "forward pass", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "handling_error", displayName: "Handling Error", category: "error", defaultEventType: "custom", defaultOutcome: "handling error", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "try", displayName: "Try", category: "scoring", defaultEventType: "try", defaultOutcome: "try", teamAssignment: "home_away", affectsScore: true, scorePoints: 5, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "conversion", displayName: "Conversion", category: "scoring", defaultEventType: "conversion", defaultOutcome: "conversion", teamAssignment: "home_away", affectsScore: true, scorePoints: 2, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "penalty_goal", displayName: "Penalty Goal", category: "scoring", defaultEventType: "penalty", defaultOutcome: "penalty goal", teamAssignment: "home_away", affectsScore: true, scorePoints: 3, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "drop_goal", displayName: "Drop Goal", category: "scoring", defaultEventType: "kick", defaultOutcome: "drop goal", teamAssignment: "home_away", affectsScore: true, scorePoints: 3, createsEvidence: true, inferable: true, appearsInReports: true },
  { id: "card", displayName: "Card", category: "discipline", defaultEventType: "card", defaultOutcome: "card", teamAssignment: "home_away", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: false, appearsInReports: true },
  { id: "stoppage", displayName: "Stoppage", category: "other", defaultEventType: "stoppage", defaultOutcome: "stoppage", teamAssignment: "neutral_allowed", affectsScore: false, scorePoints: 0, createsEvidence: true, inferable: false, appearsInReports: true },
];

export const RUGBY_LEAGUE_TAXONOMY: RugbyTaxonomyItem[] = [
  ["carry_hit_up", "Carry / Hit Up", "attack", "carry", "hit up"],
  ["tackle", "Tackle", "defence", "tackle", "tackle"],
  ["missed_tackle", "Missed Tackle", "defence", "tackle", "missed tackle"],
  ["tackle_break", "Tackle Break", "attack", "carry", "tackle break"],
  ["line_break", "Line Break", "attack", "carry", "line break"],
  ["offload", "Offload", "attack", "pass", "offload"],
  ["pass", "Pass", "attack", "pass", "pass"],
  ["play_the_ball", "Play The Ball", "set_tackle_count", "custom", "play the ball"],
  ["marker_defence", "Marker Defence", "defence", "tackle", "marker defence"],
  ["dummy_half_run", "Dummy Half Run", "attack", "carry", "dummy half run"],
  ["kick", "Kick", "kicking", "kick", "kick"],
  ["kick_chase", "Kick Chase", "kicking", "kick", "kick chase"],
  ["kick_return", "Kick Return", "transition_turnover", "carry", "kick return"],
  ["set_start", "Set Start", "set_tackle_count", "custom", "set start"],
  ["set_end", "Set End", "set_tackle_count", "custom", "set end"],
  ["tackle_1", "Tackle 1", "set_tackle_count", "tackle", "tackle 1"],
  ["tackle_2", "Tackle 2", "set_tackle_count", "tackle", "tackle 2"],
  ["tackle_3", "Tackle 3", "set_tackle_count", "tackle", "tackle 3"],
  ["tackle_4", "Tackle 4", "set_tackle_count", "tackle", "tackle 4"],
  ["tackle_5", "Tackle 5", "set_tackle_count", "tackle", "tackle 5"],
  ["last_tackle", "Last Tackle", "set_tackle_count", "tackle", "last tackle"],
  ["six_again", "Six Again", "discipline", "penalty", "six again"],
  ["penalty_won", "Penalty Won", "discipline", "penalty", "penalty won"],
  ["penalty_conceded", "Penalty Conceded", "discipline", "penalty", "penalty conceded"],
  ["error", "Error", "error", "custom", "error"],
  ["knock_on", "Knock On", "error", "custom", "knock on"],
  ["forward_pass", "Forward Pass", "error", "pass", "forward pass"],
  ["scrum", "Scrum", "set_piece", "scrum", "scrum"],
  ["try", "Try", "scoring", "try", "try", true, 4],
  ["conversion", "Conversion", "scoring", "conversion", "conversion", true, 2],
  ["penalty_goal", "Penalty Goal", "scoring", "penalty", "penalty goal", true, 2],
  ["field_goal", "Field Goal", "scoring", "kick", "field goal", true, 1],
  ["goal_line_dropout", "Goal Line Dropout", "restart", "kickoff", "goal line dropout"],
  ["restart_20m", "20m Restart", "restart", "kickoff", "20m restart"],
  ["forty_twenty", "40/20", "kicking", "kick", "40/20"],
  ["captains_challenge", "Captain's Challenge", "other", "custom", "captain's challenge"],
].map(([id, displayName, category, defaultEventType, defaultOutcome, affectsScore = false, scorePoints = 0]) => ({
  id, displayName, category, defaultEventType, defaultOutcome, teamAssignment: "home_away", affectsScore, scorePoints, createsEvidence: true, inferable: true, appearsInReports: true,
} as RugbyTaxonomyItem));

export const AFL_TAXONOMY: RugbyTaxonomyItem[] = [
  ["kick", "Kick", "disposal", "kick", "kick"],
  ["handball", "Handball", "disposal", "pass", "handball"],
  ["mark", "Mark", "possession", "custom", "mark"],
  ["contested_mark", "Contested Mark", "contest", "custom", "contested mark"],
  ["intercept_mark", "Intercept Mark", "defence", "custom", "intercept mark"],
  ["spoil", "Spoil", "defence", "custom", "spoil"],
  ["tackle", "Tackle", "defence", "tackle", "tackle"],
  ["missed_tackle", "Missed Tackle", "defence", "tackle", "missed tackle"],
  ["pressure_act", "Pressure Act", "pressure", "custom", "pressure act"],
  ["clearance", "Clearance", "stoppage", "turnover", "clearance"],
  ["centre_clearance", "Centre Clearance", "stoppage", "turnover", "centre clearance"],
  ["stoppage_clearance", "Stoppage Clearance", "stoppage", "turnover", "stoppage clearance"],
  ["inside_50", "Inside 50", "territory", "kick", "inside 50"],
  ["rebound_50", "Rebound 50", "territory", "kick", "rebound 50"],
  ["contested_possession", "Contested Possession", "possession", "carry", "contested possession"],
  ["uncontested_possession", "Uncontested Possession", "possession", "carry", "uncontested possession"],
  ["ground_ball_get", "Ground Ball Get", "contest", "carry", "ground ball get"],
  ["turnover_won", "Turnover Won", "transition_turnover", "turnover", "turnover won"],
  ["turnover_conceded", "Turnover Conceded", "transition_turnover", "turnover", "turnover conceded"],
  ["free_kick_for", "Free Kick For", "discipline", "penalty", "free kick for"],
  ["free_kick_against", "Free Kick Against", "discipline", "penalty", "free kick against"],
  ["goal", "Goal", "scoring", "try", "goal", true, 6],
  ["behind", "Behind", "scoring", "custom", "behind", true, 1],
  ["score_involvement", "Score Involvement", "scoring", "custom", "score involvement"],
  ["shot_at_goal", "Shot At Goal", "scoring", "kick", "shot at goal"],
  ["kick_in", "Kick In", "restart", "kickoff", "kick in"],
  ["ball_up", "Ball Up", "stoppage", "custom", "ball up"],
  ["throw_in", "Throw In", "stoppage", "lineout", "throw in"],
  ["stoppage", "Stoppage", "stoppage", "stoppage", "stoppage"],
].map(([id, displayName, category, defaultEventType, defaultOutcome, affectsScore = false, scorePoints = 0]) => ({
  id, displayName, category, defaultEventType, defaultOutcome, teamAssignment: "home_away", affectsScore, scorePoints, createsEvidence: true, inferable: true, appearsInReports: true,
} as RugbyTaxonomyItem));

export const SPORT_RULE_PACKS: Record<SportType, { displayName: string; taxonomyId: string; inferenceRuleSetId: string; reportTemplateId: string; taxonomy: RugbyTaxonomyItem[] }> = {
  rugby_union: { displayName: "Rugby Union", taxonomyId: "rugby_union_taxonomy_v1", inferenceRuleSetId: "rugby_union_inference_v1", reportTemplateId: "rugby_union_report_v1", taxonomy: REPORT_DRIVEN_RUGBY_TAXONOMY },
  rugby_league: { displayName: "Rugby League", taxonomyId: "rugby_league_taxonomy_v1", inferenceRuleSetId: "rugby_league_inference_stub_v1", reportTemplateId: "rugby_league_report_v1", taxonomy: RUGBY_LEAGUE_TAXONOMY },
  afl: { displayName: "AFL", taxonomyId: "afl_taxonomy_v1", inferenceRuleSetId: "afl_inference_stub_v1", reportTemplateId: "afl_report_v1", taxonomy: AFL_TAXONOMY },
};

export function normaliseSportType(value?: string | null): SportType {
  return value === "rugby_league" || value === "afl" ? value : "rugby_union";
}

export function sportRulePack(value?: string | null) {
  return SPORT_RULE_PACKS[normaliseSportType(value)];
}

export const EVENT_TYPES: EventType[] = [
  "kickoff", "scrum", "lineout", "carry", "tackle", "ruck", "maul", "pass",
  "kick", "turnover", "penalty", "try", "conversion", "card", "stoppage", "custom",
];

export function normaliseRugbyText(value?: string | null) {
  return (value ?? "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function taxonomyItemForLabel(label?: string | null) {
  const text = normaliseRugbyText(label);
  if (!text) return undefined;
  return REPORT_DRIVEN_RUGBY_TAXONOMY.find((item) => (
    text === normaliseRugbyText(item.id) ||
    text === normaliseRugbyText(item.displayName) ||
    text === normaliseRugbyText(item.defaultOutcome)
  ));
}

export function taxonomyItemForEvent(event: Pick<TimelineEvent, "event_type" | "outcome" | "notes" | "field_zone">) {
  const text = eventSearchText(event);
  const exact = taxonomyItemForLabel(event.outcome) ?? taxonomyItemForLabel(event.notes);
  if (exact) return exact;
  return REPORT_DRIVEN_RUGBY_TAXONOMY.find((item) => {
    if (event.event_type !== item.defaultEventType) return false;
    return hasAny(text, [normaliseRugbyText(item.displayName), normaliseRugbyText(item.defaultOutcome), normaliseRugbyText(item.id)]);
  });
}

function eventSearchText(event: Pick<TimelineEvent, "event_type" | "outcome" | "notes" | "field_zone">) {
  return normaliseRugbyText(`${event.event_type} ${event.outcome ?? ""} ${event.notes ?? ""} ${event.field_zone ?? ""}`);
}

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

export function inferEventTypeFromLabel(label?: string | null, fallback: EventType = "custom"): EventType {
  const text = normaliseRugbyText(label);
  if (!text) return fallback;
  const taxonomyItem = taxonomyItemForLabel(text);
  if (taxonomyItem) return taxonomyItem.defaultEventType;
  if (hasAny(text, ["conversion"])) return "conversion";
  if (hasAny(text, ["penalty goal", "pen goal", "penalty kick", "penalty"])) return "penalty";
  if (hasAny(text, ["drop goal"])) return "kick";
  if (/\btry\b/.test(text)) return "try";
  if (hasAny(text, ["missed tackle", "tackle miss", "dominant tackle", "tackle"])) return "tackle";
  if (hasAny(text, ["line break", "linebreak", "dominant carry", "carry", "run"])) return "carry";
  if (hasAny(text, ["pass", "forward pass"])) return "pass";
  if (hasAny(text, ["restart", "kickoff", "kick off", "drop out", "dropout"])) return "kickoff";
  if (hasAny(text, ["box kick", "kick", "exit"])) return "kick";
  if (hasAny(text, ["jackal", "ruck", "breakdown", "cleanout"])) return "ruck";
  if (hasAny(text, ["scrum"])) return "scrum";
  if (hasAny(text, ["lineout", "line out"])) return "lineout";
  if (hasAny(text, ["maul"])) return "maul";
  if (hasAny(text, ["turnover", "steal"])) return "turnover";
  if (hasAny(text, ["card", "yellow", "red card"])) return "card";
  if (hasAny(text, ["stoppage", "injury", "water break"])) return "stoppage";
  return fallback;
}

export function semanticEventType(event: Pick<TimelineEvent, "event_type" | "outcome" | "notes" | "field_zone">): SemanticEventType {
  const text = eventSearchText(event);
  if (hasAny(text, ["line break", "linebreak"])) return "line_break";
  if (event.event_type !== "custom") return event.event_type;
  return inferEventTypeFromLabel(text, "custom");
}

export function semanticCategory(event: Pick<TimelineEvent, "event_type" | "outcome" | "notes" | "field_zone">): EventCategory {
  const taxonomyItem = taxonomyItemForEvent(event);
  if (taxonomyItem) return taxonomyItem.category;
  const semanticType = semanticEventType(event);
  if (semanticType === "line_break") return "attack";
  return EVENT_CATEGORY_BY_TYPE[semanticType] ?? "core";
}

export function semanticEventLabel(event: Pick<TimelineEvent, "event_type" | "outcome" | "notes" | "field_zone">) {
  const taxonomyItem = taxonomyItemForEvent(event);
  if (taxonomyItem) return taxonomyItem.displayName;
  const label = normaliseRugbyText(event.outcome) || normaliseRugbyText(event.event_type);
  return label.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function eventsFor(events: TimelineEvent[], team: EventTeam, types?: SemanticEventType[]) {
  return events.filter((event) => event.team === team && (!types || types.includes(semanticEventType(event))));
}

export function semanticTypeCount(events: TimelineEvent[], team: EventTeam, type: SemanticEventType) {
  return eventsFor(events, team).filter((event) => semanticEventType(event) === type).length;
}

export function semanticTypesCount(events: TimelineEvent[], team: EventTeam, types: SemanticEventType[]) {
  return eventsFor(events, team).filter((event) => types.includes(semanticEventType(event))).length;
}

export function isTryEvent(event: TimelineEvent) {
  return semanticEventType(event) === "try";
}

export function isConversionEvent(event: TimelineEvent) {
  return semanticEventType(event) === "conversion";
}

export function isPenaltyGoalEvent(event: TimelineEvent) {
  const text = eventSearchText(event);
  return semanticEventType(event) === "penalty" && hasAny(text, ["goal", "penalty goal", "penalty kick goal"]);
}

export function isDropGoalEvent(event: TimelineEvent) {
  return hasAny(eventSearchText(event), ["drop goal"]);
}

export function isLineBreakEvent(event: TimelineEvent) {
  return semanticEventType(event) === "line_break";
}

export function isMissedTackleEvent(event: TimelineEvent) {
  return semanticEventType(event) === "tackle" && hasAny(eventSearchText(event), ["miss", "missed"]);
}

export function isMadeTackleEvent(event: TimelineEvent) {
  return semanticEventType(event) === "tackle" && !isMissedTackleEvent(event);
}

export function semanticScoringPoints(event: TimelineEvent) {
  const taxonomyItem = taxonomyItemForEvent(event);
  if (taxonomyItem?.affectsScore) return taxonomyItem.scorePoints;
  if (isTryEvent(event)) return 5;
  if (isConversionEvent(event)) return 2;
  if (isPenaltyGoalEvent(event) || isDropGoalEvent(event)) return 3;
  return 0;
}

export function countBySemanticLabel(events: TimelineEvent[]) {
  return events.reduce<Record<string, number>>((counts, event) => {
    const key = semanticEventLabel(event);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}
