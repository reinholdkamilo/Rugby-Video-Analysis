import { EventTeam, EventType, TimelineEvent } from "@/lib/api";

export type EventCategory = "core" | "attack" | "defence" | "set_piece" | "discipline" | "transition" | "kicking" | "possession";
export type SemanticEventType = EventType | "line_break";

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  core: "Core",
  attack: "Attack",
  defence: "Defence",
  set_piece: "Set piece",
  discipline: "Discipline",
  transition: "Transition",
  kicking: "Kicking",
  possession: "Possession",
};

export const EVENT_CATEGORY_BY_TYPE: Record<EventType, EventCategory> = {
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

export const EVENT_TYPES: EventType[] = [
  "kickoff", "scrum", "lineout", "carry", "tackle", "ruck", "maul", "pass",
  "kick", "turnover", "penalty", "try", "conversion", "card", "stoppage", "custom",
];

export function normaliseRugbyText(value?: string | null) {
  return (value ?? "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
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
  const semanticType = semanticEventType(event);
  if (semanticType === "line_break") return "attack";
  return EVENT_CATEGORY_BY_TYPE[semanticType] ?? "core";
}

export function semanticEventLabel(event: Pick<TimelineEvent, "event_type" | "outcome" | "notes" | "field_zone">) {
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
