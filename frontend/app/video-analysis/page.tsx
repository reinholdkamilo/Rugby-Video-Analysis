"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import { EventTeam, EventType, Match, Team, TimelineEvent, VideoAsset, api } from "@/lib/api";
import { sourceVideoUrl } from "@/lib/coding-api";
import { CATEGORY_LABELS, EventCategory, SportType, inferEventTypeFromLabel, normaliseSportType, sportRulePack } from "@/lib/rugby-events";

type VideoCommand =
  | "play_pause"
  | "seek_back_5"
  | "seek_forward_5"
  | "seek_back_10"
  | "seek_forward_10"
  | "seek_back_5m"
  | "seek_forward_5m"
  | "seek_back_10m"
  | "seek_forward_10m"
  | "step_back"
  | "step_forward"
  | "speed_down"
  | "speed_up"
  | "speed_quarter"
  | "speed_half"
  | "speed_normal"
  | "speed_double";

type ShortcutBinding = {
  id: string;
  label: string;
  group: "event" | "video" | "zone";
  shortcut: string;
  team?: EventTeam | "selected";
  eventType?: EventType;
  duration?: number;
  category?: EventCategory;
  outcome?: string;
  fieldZone?: string;
  notes?: string;
  custom?: boolean;
  command?: VideoCommand;
  zoneLength?: string;
};

type PanelTab = "clips" | "tags" | "keyboard" | "edit";
type AnalysisTrack = { id: string; label: string; group: "global" | "home" | "away"; team?: EventTeam };
type TimelineDragAction = "move" | "resize-start" | "resize-end";
type TimelineDragState = {
  eventId: number;
  action: TimelineDragAction;
  pointerStartX: number;
  laneWidth: number;
  originalStart: number;
  originalEnd: number;
  draftStart: number;
  draftEnd: number;
};

const QUICK_CODE_CAPTURE_SECONDS = 15;
const SHORTCUT_STORAGE_KEY = "rugby-video-analysis:coding-shortcuts:v2";
const TIMELINE_WINDOW_STORAGE_KEY = "rugby-video-analysis:video-analysis-window:v1";
const TIMELINE_FOLLOW_STORAGE_KEY = "rugby-video-analysis:video-analysis-follow-playhead:v1";
const PLAYBACK_SPEED_STORAGE_KEY = "rugby-video-analysis:video-analysis-playback-speed:v1";
const ZONE_KEYS = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK"];
const DEFAULT_TIMELINE_WINDOW_SECONDS = 10 * 60;
const EVENT_REVIEW_PREROLL_SECONDS = 2;
const PLAYBACK_SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const TIMELINE_WINDOW_OPTIONS = [
  { label: "Full match", seconds: "full" as const },
  { label: "30 min", seconds: 30 * 60 },
  { label: "15 min", seconds: 15 * 60 },
  { label: "10 min", seconds: 10 * 60 },
  { label: "5 min", seconds: 5 * 60 },
  { label: "2 min", seconds: 2 * 60 },
  { label: "1 min", seconds: 60 },
];

const GLOBAL_TRACKS = ["Ball In Play", "Race to Set 1st Phase", "WAR Zone", "Aussie"];
const HOME_TRACKS = [
  "Home Possession",
  "Home Counter Attack",
  "Home Turnover Attack",
  "Home Kicks in Play",
  "Home Lineout",
  "Home Lineout Attack",
  "Home Maul",
  "Home Quick Lineout",
  "Home Scrum",
  "Home Scrum Attack",
  "Home Restart",
  "Home Restart Attack",
  "Home Tap Attack",
  "Home Set Kicks",
  "Home Linebreak",
  "Home Tries",
  "Home Turnover Conceded",
  "Home Penalty Conceded",
  "Home FK Conceded",
  "Home Tackle",
  "Home FTO",
  "Home Ghost Review",
  "Home Exits",
  "Home A Zone Sets",
  "Home A Zone",
  "Home B Zone",
  "Home C Zone",
  "Home D Zone",
];
const AWAY_TRACKS = [
  "Away Possession",
  "Away Counter Attack",
  "Away Turnover Attack",
  "Away Lineout",
  "Away Lineout Attack",
  "Away Quick Lineout",
  "Away Maul",
  "Away Scrum",
  "Away Scrum Attack",
  "Away Restart",
  "Away Restart Attack",
  "Away Tap Attack",
  "Away Kicks in Play",
  "Away Set Kicks",
  "Away Linebreak",
  "Away Tries",
  "Away Turnover Conceded",
  "Away Penalty Conceded",
  "Away FK Conceded",
  "Away A Zone Sets",
  "Away A Zone",
  "Away B Zone",
  "Away C Zone",
  "Away D Zone",
];

const ANALYSIS_TRACKS: AnalysisTrack[] = [
  ...GLOBAL_TRACKS.map((label) => ({ id: label, label, group: "global" as const })),
  ...HOME_TRACKS.map((label) => ({ id: label, label, group: "home" as const, team: "home" as const })),
  ...AWAY_TRACKS.map((label) => ({ id: label, label, group: "away" as const, team: "away" as const })),
];

const PLAYBACK_CONTROLS: Array<{ label: string; delta?: number; command?: "play_pause" }> = [
  { label: "|<", delta: -600 },
  { label: "<<", delta: -60 },
  { label: "<", delta: -5 },
  { label: "5", delta: -5 },
  { label: "Play", command: "play_pause" },
  { label: "5", delta: 5 },
  { label: ">", delta: 5 },
  { label: ">>", delta: 60 },
  { label: ">|", delta: 600 },
];

const FRIENDLY_KEY_CODES: Record<string, string> = {
  " ": "Space",
  space: "Space",
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  "`": "Backquote",
  backquote: "Backquote",
  "-": "Minus",
  minus: "Minus",
  "=": "Equal",
  equal: "Equal",
  "[": "BracketLeft",
  bracketleft: "BracketLeft",
  "]": "BracketRight",
  bracketright: "BracketRight",
  "\\": "Backslash",
  backslash: "Backslash",
  ";": "Semicolon",
  semicolon: "Semicolon",
  "'": "Quote",
  quote: "Quote",
  ",": "Comma",
  comma: "Comma",
  ".": "Period",
  period: "Period",
  "/": "Slash",
  slash: "Slash",
  delete: "Delete",
  backspace: "Backspace",
  enter: "Enter",
  escape: "Escape",
  esc: "Escape",
  tab: "Tab",
};

const MODIFIER_ALIASES: Record<string, string> = {
  alt: "Alt",
  option: "Alt",
  ctrl: "Ctrl",
  control: "Ctrl",
  shift: "Shift",
  meta: "Meta",
  cmd: "Meta",
  command: "Meta",
};

function taxonomyShortcutsForSport(sportType: SportType): ShortcutBinding[] {
  const rulePack = sportRulePack(sportType);
  return rulePack.taxonomy.flatMap((item) => ([
    {
      id: `taxonomy_home_${item.id}`,
      label: item.displayName,
      group: "event" as const,
      shortcut: "Unassigned",
      team: "home" as const,
      eventType: item.defaultEventType,
      duration: QUICK_CODE_CAPTURE_SECONDS,
      category: item.category,
      outcome: item.defaultOutcome,
      notes: `${rulePack.displayName} taxonomy: ${item.displayName}`,
    },
    {
      id: `taxonomy_away_${item.id}`,
      label: item.displayName,
      group: "event" as const,
      shortcut: "Unassigned",
      team: "away" as const,
      eventType: item.defaultEventType,
      duration: QUICK_CODE_CAPTURE_SECONDS,
      category: item.category,
      outcome: item.defaultOutcome,
      notes: `${rulePack.displayName} taxonomy: ${item.displayName}`,
    },
  ]));
}

function buildDefaultShortcuts(sportType: SportType): ShortcutBinding[] {
  return [
    ...taxonomyShortcutsForSport(sportType),
    { id: "zone_own_22", label: "Own 22m", group: "zone", shortcut: ZONE_KEYS[0], fieldZone: "Own 22m", zoneLength: "Inside defensive 22m" },
    { id: "zone_own_half", label: "Own half", group: "zone", shortcut: ZONE_KEYS[1], fieldZone: "Own half", zoneLength: "Outside own 22m to halfway" },
    { id: "zone_outside_50m", label: "Outside 50m", group: "zone", shortcut: ZONE_KEYS[2], fieldZone: "Outside 50m", zoneLength: "Outside 50m/halfway line" },
    { id: "zone_opposition_half", label: "Opposition half", group: "zone", shortcut: ZONE_KEYS[3], fieldZone: "Opposition half", zoneLength: "Outside opposition 50m/halfway into attacking half" },
    { id: "zone_opposition_22", label: "Opposition 22m", group: "zone", shortcut: ZONE_KEYS[4], fieldZone: "Opposition 22m", zoneLength: "Inside attacking 22m" },
    { id: "zone_left_5m", label: "Left 5m channel", group: "zone", shortcut: ZONE_KEYS[5], fieldZone: "Left 5m channel", zoneLength: "Inside 5m from sideline" },
    { id: "zone_right_5m", label: "Right 5m channel", group: "zone", shortcut: ZONE_KEYS[6], fieldZone: "Right 5m channel", zoneLength: "Inside 5m from sideline" },
    { id: "zone_15m_channel", label: "15m channel", group: "zone", shortcut: ZONE_KEYS[7], fieldZone: "15m channel", zoneLength: "Inside 15m line from sideline" },
    { id: "video_play_pause", label: "Play / pause", group: "video", shortcut: "Space", command: "play_pause" },
    { id: "video_back_5", label: "Back 5 seconds", group: "video", shortcut: "ArrowLeft", command: "seek_back_5" },
    { id: "video_forward_5", label: "Forward 5 seconds", group: "video", shortcut: "ArrowRight", command: "seek_forward_5" },
    { id: "video_back_10", label: "Back 10 seconds", group: "video", shortcut: "Shift+ArrowLeft", command: "seek_back_10" },
    { id: "video_forward_10", label: "Forward 10 seconds", group: "video", shortcut: "Shift+ArrowRight", command: "seek_forward_10" },
    { id: "video_back_5m", label: "Back 5 minutes", group: "video", shortcut: "Alt+ArrowLeft", command: "seek_back_5m" },
    { id: "video_forward_5m", label: "Forward 5 minutes", group: "video", shortcut: "Alt+ArrowRight", command: "seek_forward_5m" },
    { id: "video_back_10m", label: "Back 10 minutes", group: "video", shortcut: "Alt+Shift+ArrowLeft", command: "seek_back_10m" },
    { id: "video_forward_10m", label: "Forward 10 minutes", group: "video", shortcut: "Alt+Shift+ArrowRight", command: "seek_forward_10m" },
    { id: "video_step_back", label: "Step back", group: "video", shortcut: "Shift+Comma", command: "step_back" },
    { id: "video_step_forward", label: "Step forward", group: "video", shortcut: "Shift+Period", command: "step_forward" },
    { id: "video_speed_down", label: "Decrease speed", group: "video", shortcut: "Alt+Minus", command: "speed_down" },
    { id: "video_speed_up", label: "Increase speed", group: "video", shortcut: "Alt+Equal", command: "speed_up" },
    { id: "video_speed_quarter", label: "Set speed 0.25x", group: "video", shortcut: "Alt+Digit1", command: "speed_quarter" },
    { id: "video_speed_half", label: "Set speed 0.5x", group: "video", shortcut: "Alt+Digit2", command: "speed_half" },
    { id: "video_speed_normal", label: "Set speed 1x", group: "video", shortcut: "Alt+Digit3", command: "speed_normal" },
    { id: "video_speed_double", label: "Set speed 2x", group: "video", shortcut: "Alt+Digit4", command: "speed_double" },
  ];
}

function shortcutStorageKey(sportType: SportType) {
  return sportType === "rugby_union" ? SHORTCUT_STORAGE_KEY : `${SHORTCUT_STORAGE_KEY}:${sportType}`;
}

function normaliseShortcutKeyPart(rawPart: string) {
  const part = rawPart.trim();
  if (!part) return "";
  const lower = part.toLowerCase();
  if (FRIENDLY_KEY_CODES[lower]) return FRIENDLY_KEY_CODES[lower];
  if (/^key[a-z]$/i.test(part)) return `Key${part.slice(-1).toUpperCase()}`;
  if (/^digit[0-9]$/i.test(part)) return `Digit${part.slice(-1)}`;
  if (/^[a-z]$/i.test(part)) return `Key${part.toUpperCase()}`;
  if (/^[0-9]$/.test(part)) return `Digit${part}`;
  if (/^f([1-9]|1[0-2])$/i.test(part)) return part.toUpperCase();
  return part;
}

function normaliseShortcut(shortcut: string) {
  const trimmed = shortcut.trim();
  if (!trimmed || trimmed.toLowerCase() === "unassigned") return "Unassigned";
  const modifiers: string[] = [];
  let key = "";
  for (const rawPart of trimmed.split("+")) {
    const part = rawPart.trim();
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
      continue;
    }
    key = normaliseShortcutKeyPart(part);
  }
  const orderedModifiers = ["Ctrl", "Alt", "Shift", "Meta"].filter((modifier) => modifiers.includes(modifier));
  return [...orderedModifiers, key].filter(Boolean).join("+") || "Unassigned";
}

function shortcutFromKeyboardEvent(event: KeyboardEvent | ReactKeyboardEvent) {
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  parts.push(event.code);
  return normaliseShortcut(parts.join("+"));
}

function shortcutLabel(shortcut: string) {
  return normaliseShortcut(shortcut)
    .replace("Alt", "Option")
    .replace("Meta", "Command")
    .replace("Ctrl", "Control")
    .replace("Digit", "")
    .replace("Key", "")
    .replace("ArrowLeft", "Left")
    .replace("ArrowRight", "Right")
    .replace("BracketLeft", "[")
    .replace("BracketRight", "]")
    .replace("Backslash", "\\")
    .replace("Backquote", "`")
    .replace("Minus", "-")
    .replace("Equal", "=")
    .replace("Semicolon", ";")
    .replace("Quote", "'")
    .replace("Slash", "/")
    .replace("Comma", ",")
    .replace("Period", ".")
    .replace("Space", "Space");
}

function isModifierOnlyKey(code: string) {
  return ["ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "ControlLeft", "ControlRight", "MetaLeft", "MetaRight"].includes(code);
}

function shortcutEditable(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  return target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT" || target?.isContentEditable;
}

function loadShortcutBindings(sportType: SportType): ShortcutBinding[] {
  if (typeof window === "undefined") return buildDefaultShortcuts(sportType);
  const defaults = buildDefaultShortcuts(sportType);
  const saved = window.localStorage.getItem(shortcutStorageKey(sportType));
  if (!saved) return defaults;
  try {
    const parsed = JSON.parse(saved) as Partial<ShortcutBinding>[];
    const byId = new Map(defaults.map((binding) => [binding.id, binding]));
    const merged = parsed
      .filter((binding): binding is ShortcutBinding => typeof binding.id === "string" && typeof binding.label === "string" && typeof binding.group === "string")
      .map((binding) => ({ ...(byId.get(binding.id) ?? {}), ...binding, shortcut: normaliseShortcut(binding.shortcut ?? "Unassigned") }));
    const mergedIds = new Set(merged.map((binding) => binding.id));
    return [...merged, ...defaults.filter((binding) => !mergedIds.has(binding.id))];
  } catch {
    return defaults;
  }
}

function persistShortcuts(sportType: SportType, shortcuts: ShortcutBinding[]) {
  window.localStorage.setItem(shortcutStorageKey(sportType), JSON.stringify(shortcuts));
}

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

function eventDetails(event: TimelineEvent, track: string) {
  const zone = event.field_zone ? `\nZone: ${event.field_zone}` : "";
  const notes = event.notes ? `\nNotes: ${event.notes}` : "";
  return `${eventLabel(event)}\nTrack: ${track}\nTeam: ${event.team}\nStart: ${formatTime(event.start_seconds)}\nEnd: ${formatTime(event.end_seconds)}${zone}${notes}`;
}

function eventAbbreviation(event: TimelineEvent) {
  const label = eventLabel(event);
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
  return label.slice(0, 3).toUpperCase();
}

function teamPrefix(event: TimelineEvent) {
  if (event.team === "away") return "Away";
  if (event.team === "home") return "Home";
  return "";
}

function zoneTrack(prefix: string, value: string) {
  const label = value.toLowerCase();
  if (label.includes("a zone")) return label.includes("set") ? `${prefix} A Zone Sets` : `${prefix} A Zone`;
  if (label.includes("b zone")) return `${prefix} B Zone`;
  if (label.includes("c zone")) return `${prefix} C Zone`;
  if (label.includes("d zone")) return `${prefix} D Zone`;
  return null;
}

function trackForEvent(event: TimelineEvent) {
  const prefix = teamPrefix(event);
  const label = `${event.event_type} ${eventLabel(event)} ${event.notes ?? ""} ${event.field_zone ?? ""}`.toLowerCase();
  if (!prefix) {
    if (label.includes("race to set")) return "Race to Set 1st Phase";
    if (label.includes("war zone")) return "WAR Zone";
    if (label.includes("aussie")) return "Aussie";
    return "Ball In Play";
  }
  const zone = zoneTrack(prefix, label);
  if (zone) return zone;
  if (label.includes("try")) return `${prefix} Tries`;
  if (label.includes("linebreak") || label.includes("line break")) return `${prefix} Linebreak`;
  if (label.includes("turnover conceded")) return `${prefix} Turnover Conceded`;
  if (label.includes("turnover")) return `${prefix} Turnover Attack`;
  if (label.includes("fk conceded") || label.includes("free kick conceded")) return `${prefix} FK Conceded`;
  if (label.includes("penalty conceded")) return `${prefix} Penalty Conceded`;
  if (event.event_type === "tackle" || label.includes("tackle")) return `${prefix} Tackle`;
  if (label.includes("exit")) return `${prefix} Exits`;
  if (label.includes("set kick")) return `${prefix} Set Kicks`;
  if (event.event_type === "kick" || label.includes("kick")) return `${prefix} Kicks in Play`;
  if (label.includes("lineout attack")) return `${prefix} Lineout Attack`;
  if (label.includes("quick lineout")) return `${prefix} Quick Lineout`;
  if (event.event_type === "lineout" || label.includes("lineout")) return `${prefix} Lineout`;
  if (event.event_type === "maul" || label.includes("maul")) return `${prefix} Maul`;
  if (label.includes("scrum attack")) return `${prefix} Scrum Attack`;
  if (event.event_type === "scrum" || label.includes("scrum")) return `${prefix} Scrum`;
  if (label.includes("restart attack")) return `${prefix} Restart Attack`;
  if (event.event_type === "kickoff" || label.includes("restart")) return `${prefix} Restart`;
  if (label.includes("tap attack")) return `${prefix} Tap Attack`;
  if (label.includes("counter attack")) return `${prefix} Counter Attack`;
  if (label.includes("fto")) return `${prefix} FTO`;
  if (label.includes("ghost review")) return `${prefix} Ghost Review`;
  return `${prefix} Possession`;
}

function mergeTimelineEvents(current: TimelineEvent[], incoming: TimelineEvent[]) {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => a.start_seconds - b.start_seconds || a.id - b.id);
}

function categoryLabel(category?: EventCategory) {
  return (category ? CATEGORY_LABELS[category] ?? category : "Event").replace("_", " ");
}

function zoneValue(binding?: Pick<ShortcutBinding, "label" | "fieldZone" | "zoneLength"> | null) {
  if (!binding) return "";
  const label = binding.fieldZone || binding.label;
  return binding.zoneLength ? `${label} - ${binding.zoneLength}` : label;
}

function loadTimelineWindowDuration() {
  if (typeof window === "undefined") return DEFAULT_TIMELINE_WINDOW_SECONDS;
  const saved = window.localStorage.getItem(TIMELINE_WINDOW_STORAGE_KEY);
  if (saved === "full") return "full" as const;
  const parsed = Number(saved);
  return TIMELINE_WINDOW_OPTIONS.some((option) => option.seconds === parsed) ? parsed : DEFAULT_TIMELINE_WINDOW_SECONDS;
}

function loadFollowPlayhead() {
  if (typeof window === "undefined") return true;
  const saved = window.localStorage.getItem(TIMELINE_FOLLOW_STORAGE_KEY);
  return saved ? saved === "true" : true;
}

function loadPlaybackSpeed() {
  if (typeof window === "undefined") return 1;
  const saved = Number(window.localStorage.getItem(PLAYBACK_SPEED_STORAGE_KEY));
  return PLAYBACK_SPEED_PRESETS.includes(saved) ? saved : 1;
}

function requestedVideoAnalysisSelection() {
  if (typeof window === "undefined") return { matchId: null, videoId: null };
  const params = new URLSearchParams(window.location.search);
  const matchId = Number(params.get("match_id"));
  const videoId = Number(params.get("video_id") ?? params.get("video_asset_id"));
  return {
    matchId: Number.isFinite(matchId) && matchId > 0 ? matchId : null,
    videoId: Number.isFinite(videoId) && videoId > 0 ? videoId : null,
  };
}

function clampWindowStart(start: number, windowSeconds: number, totalSeconds: number) {
  return Math.min(Math.max(0, start), Math.max(0, totalSeconds - windowSeconds));
}

function timelineTicks(start: number, end: number) {
  return [0, 0.25, 0.5, 0.75, 1].map((tick) => {
    const seconds = start + (end - start) * tick;
    return { tick, seconds };
  });
}

function nearestPlaybackSpeed(value: number) {
  return PLAYBACK_SPEED_PRESETS.reduce((nearest, preset) => (
    Math.abs(preset - value) < Math.abs(nearest - value) ? preset : nearest
  ), 1);
}

function clampValue(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundTimelineSeconds(value: number) {
  return Number(Math.max(0, value).toFixed(2));
}

export default function VideoAnalysisPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [notice, setNotice] = useState("Loading video analysis workspace...");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("tags");
  const [tagSearch, setTagSearch] = useState("");
  const [teamContext, setTeamContext] = useState<EventTeam>("home");
  const [activeZone, setActiveZone] = useState<ShortcutBinding | null>(null);
  const [editingShortcutId, setEditingShortcutId] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState<ShortcutBinding[]>(() => buildDefaultShortcuts("rugby_union"));
  const [timelineWindowDuration, setTimelineWindowDuration] = useState<"full" | number>(() => loadTimelineWindowDuration());
  const [timelineWindowStart, setTimelineWindowStart] = useState(0);
  const [followPlayhead, setFollowPlayhead] = useState(() => loadFollowPlayhead());
  const [playbackSpeed, setPlaybackSpeed] = useState(() => loadPlaybackSpeed());
  const [dragState, setDragState] = useState<TimelineDragState | null>(null);

  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? null;
  const selectedVideo = videos.find((video) => video.id === selectedVideoId) ?? null;
  const homeTeam = teams.find((team) => team.id === selectedMatch?.home_team_id);
  const awayTeam = teams.find((team) => team.id === selectedMatch?.away_team_id);
  const activeSport = useMemo(() => normaliseSportType(selectedMatch?.sport_type ?? selectedVideo?.sport_type), [selectedMatch?.sport_type, selectedVideo?.sport_type]);
  const fixtureTitle = selectedMatch
    ? `${homeTeam?.name ?? "Home"} vs ${awayTeam?.name ?? "Away"}`
    : "Video Analysis Workspace";
  const timelineDuration = Math.max(duration, events.reduce((max, event) => Math.max(max, event.end_seconds), 0), 90 * 60 + 43);
  const visibleWindowDuration = timelineWindowDuration === "full" ? timelineDuration : Math.min(timelineWindowDuration, timelineDuration);
  const followWindowStart = timelineWindowDuration === "full" ? 0 : clampWindowStart(currentTime - visibleWindowDuration / 2, visibleWindowDuration, timelineDuration);
  const visibleWindowStart = timelineWindowDuration === "full" ? 0 : followPlayhead ? followWindowStart : clampWindowStart(timelineWindowStart, visibleWindowDuration, timelineDuration);
  const visibleWindowEnd = timelineWindowDuration === "full" ? timelineDuration : Math.min(timelineDuration, visibleWindowStart + visibleWindowDuration);
  const visibleWindowSpan = Math.max(1, visibleWindowEnd - visibleWindowStart);
  const playheadVisible = currentTime >= visibleWindowStart && currentTime <= visibleWindowEnd;
  const timelineWindowLabel = timelineWindowDuration === "full"
    ? "Full match"
    : `${formatTime(visibleWindowStart)}-${formatTime(visibleWindowEnd)}`;
  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedEventId) ?? null, [events, selectedEventId]);

  const eventShortcuts = useMemo(() => shortcuts.filter((binding) => binding.group === "event"), [shortcuts]);
  const filteredTags = useMemo(() => {
    const search = tagSearch.trim().toLowerCase();
    return eventShortcuts
      .filter((binding) => binding.team === teamContext || binding.team === "selected")
      .filter((binding) => !search || `${binding.label} ${binding.outcome ?? ""} ${binding.category ?? ""}`.toLowerCase().includes(search));
  }, [eventShortcuts, tagSearch, teamContext]);
  const clipEvents = useMemo(() => events.filter((event) => event.clip_requested || event.clip), [events]);
  const timelineEvents = useMemo(() => {
    if (!dragState) return events;
    return events.map((event) => event.id === dragState.eventId
      ? { ...event, start_seconds: dragState.draftStart, end_seconds: dragState.draftEnd }
      : event);
  }, [dragState, events]);

  const trackRows = useMemo(() => ANALYSIS_TRACKS.map((track) => ({
    track,
    events: timelineEvents.filter((event) => trackForEvent(event) === track.label && event.end_seconds >= visibleWindowStart && event.start_seconds <= visibleWindowEnd),
  })), [timelineEvents, visibleWindowEnd, visibleWindowStart]);

  useEffect(() => {
    setShortcuts(loadShortcutBindings(activeSport));
  }, [activeSport]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TIMELINE_WINDOW_STORAGE_KEY, String(timelineWindowDuration));
  }, [timelineWindowDuration]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(TIMELINE_FOLLOW_STORAGE_KEY, String(followPlayhead));
  }, [followPlayhead]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, String(playbackSpeed));
    if (videoRef.current && videoRef.current.playbackRate !== playbackSpeed) {
      videoRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  useEffect(() => {
    if (timelineWindowDuration === "full") {
      setTimelineWindowStart(0);
      return;
    }
    setTimelineWindowStart((start) => clampWindowStart(start, visibleWindowDuration, timelineDuration));
  }, [timelineDuration, timelineWindowDuration, visibleWindowDuration]);

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
      const requested = requestedVideoAnalysisSelection();
      const nextMatch = (requested.matchId ? matchData.find((match) => match.id === requested.matchId) : null)
        ?? matchData.find((match) => videoAssets.some((video) => video.match_id === match.id))
        ?? matchData[0]
        ?? null;
      setSelectedMatchId(nextMatch?.id ?? null);
      const matchVideos = nextMatch ? videoAssets.filter((video) => video.match_id === nextMatch.id) : [];
      setVideos(matchVideos);
      const nextVideo = (requested.videoId ? matchVideos.find((video) => video.id === requested.videoId) : null) ?? matchVideos[0] ?? null;
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

  const seek = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(0, video.currentTime + delta), video.duration || video.currentTime + delta);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }, []);

  const runVideoCommand = useCallback((command: VideoCommand) => {
    const video = videoRef.current;
    if (command === "play_pause") {
      togglePlay();
      return;
    }
    if (!video) return;
    if (command === "seek_back_5") seek(-5);
    if (command === "seek_forward_5") seek(5);
    if (command === "seek_back_10") seek(-10);
    if (command === "seek_forward_10") seek(10);
    if (command === "seek_back_5m") seek(-300);
    if (command === "seek_forward_5m") seek(300);
    if (command === "seek_back_10m") seek(-600);
    if (command === "seek_forward_10m") seek(600);
    if (command === "step_back") seek(-0.04);
    if (command === "step_forward") seek(0.04);
    if (command === "speed_down") setPlaybackSpeed((speed) => nearestPlaybackSpeed(Math.max(0.25, speed - 0.25)));
    if (command === "speed_up") setPlaybackSpeed((speed) => nearestPlaybackSpeed(Math.min(3, speed + 0.25)));
    if (command === "speed_quarter") setPlaybackSpeed(0.25);
    if (command === "speed_half") setPlaybackSpeed(0.5);
    if (command === "speed_normal") setPlaybackSpeed(1);
    if (command === "speed_double") setPlaybackSpeed(2);
  }, [seek, togglePlay]);

  const moveTimelineWindow = useCallback((direction: -1 | 1) => {
    if (timelineWindowDuration === "full") return;
    setFollowPlayhead(false);
    setTimelineWindowStart(clampWindowStart(visibleWindowStart + direction * visibleWindowDuration, visibleWindowDuration, timelineDuration));
  }, [timelineDuration, timelineWindowDuration, visibleWindowDuration, visibleWindowStart]);

  const centreTimelineOn = useCallback((seconds: number) => {
    if (timelineWindowDuration === "full") return;
    setTimelineWindowStart(clampWindowStart(seconds - visibleWindowDuration / 2, visibleWindowDuration, timelineDuration));
  }, [timelineDuration, timelineWindowDuration, visibleWindowDuration]);

  const seekToTimelineEvent = useCallback((event: TimelineEvent) => {
    setSelectedEventId(event.id);
    setPanelOpen(true);
    setPanelTab("edit");
    const targetSeconds = Math.max(0, event.start_seconds - EVENT_REVIEW_PREROLL_SECONDS);
    const video = videoRef.current;
    if (video) {
      video.playbackRate = playbackSpeed;
      video.currentTime = targetSeconds;
      void video.play().catch(() => {
        setNotice(`Seeked to ${eventLabel(event)} at ${formatTime(targetSeconds)}. Press play to review.`);
      });
    }
    centreTimelineOn((event.start_seconds + event.end_seconds) / 2);
    setNotice(`Reviewing ${eventLabel(event)} from ${formatTime(targetSeconds)}.`);
  }, [centreTimelineOn, playbackSpeed]);

  const persistEventTiming = useCallback(async (eventId: number, startSeconds: number, endSeconds: number) => {
    const start = roundTimelineSeconds(startSeconds);
    const end = roundTimelineSeconds(Math.max(start + 0.5, endSeconds));
    try {
      const updated = await api.timeline.update(eventId, {
        start_seconds: start,
        end_seconds: end,
      });
      setEvents((current) => mergeTimelineEvents(current, [updated]));
      setSelectedEventId(updated.id);
      setNotice(`${eventLabel(updated)} timing saved from ${formatTime(updated.start_seconds)} to ${formatTime(updated.end_seconds)}. Reports and evidence now read the updated timeline event.`);
      if (updated.clip_requested || updated.clip) {
        void api.timeline.regenerateClip(updated.id).catch(() => undefined);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save event timing.");
      if (selectedMatchId) {
        void api.timeline.list(selectedMatchId, selectedVideoId ?? undefined).then(setEvents).catch(() => undefined);
      }
    }
  }, [selectedMatchId, selectedVideoId]);

  const deleteTimelineEvent = useCallback(async (eventId: number) => {
    const target = events.find((event) => event.id === eventId);
    if (!target) return;
    try {
      await api.timeline.delete(eventId);
      setEvents((current) => current.filter((event) => event.id !== eventId));
      setSelectedEventId((current) => current === eventId ? null : current);
      setNotice(`${eventLabel(target)} deleted from the shared timeline. Reports, evidence and clips will no longer include it.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete timeline event.");
    }
  }, [events]);

  const startTimelineDrag = useCallback((
    pointerEvent: ReactPointerEvent<HTMLElement>,
    timelineEvent: TimelineEvent,
    action: TimelineDragAction,
  ) => {
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    const lane = pointerEvent.currentTarget.closest(".video-analysis-track-lane") as HTMLElement | null;
    const laneWidth = lane?.getBoundingClientRect().width ?? 0;
    if (!laneWidth) return;
    setFollowPlayhead(false);
    setSelectedEventId(timelineEvent.id);
    setPanelOpen(true);
    setPanelTab("edit");
    setDragState({
      eventId: timelineEvent.id,
      action,
      pointerStartX: pointerEvent.clientX,
      laneWidth,
      originalStart: timelineEvent.start_seconds,
      originalEnd: timelineEvent.end_seconds,
      draftStart: timelineEvent.start_seconds,
      draftEnd: timelineEvent.end_seconds,
    });
  }, []);

  useEffect(() => {
    if (!dragState) return;
    const activeDrag = dragState;
    function onPointerMove(event: PointerEvent) {
      const deltaSeconds = ((event.clientX - activeDrag.pointerStartX) / Math.max(1, activeDrag.laneWidth)) * visibleWindowSpan;
      const originalDuration = Math.max(0.5, activeDrag.originalEnd - activeDrag.originalStart);
      let draftStart = activeDrag.originalStart;
      let draftEnd = activeDrag.originalEnd;
      if (activeDrag.action === "move") {
        draftStart = clampValue(activeDrag.originalStart + deltaSeconds, 0, Math.max(0, timelineDuration - originalDuration));
        draftEnd = draftStart + originalDuration;
      }
      if (activeDrag.action === "resize-start") {
        draftStart = clampValue(activeDrag.originalStart + deltaSeconds, Math.max(0, activeDrag.originalEnd - 300), activeDrag.originalEnd - 0.5);
      }
      if (activeDrag.action === "resize-end") {
        draftEnd = clampValue(activeDrag.originalEnd + deltaSeconds, activeDrag.originalStart + 0.5, Math.min(timelineDuration, activeDrag.originalStart + 300));
      }
      setDragState((current) => current ? { ...current, draftStart: roundTimelineSeconds(draftStart), draftEnd: roundTimelineSeconds(draftEnd) } : current);
    }
    function onPointerUp() {
      setDragState((current) => {
        if (current && (current.draftStart !== current.originalStart || current.draftEnd !== current.originalEnd)) {
          void persistEventTiming(current.eventId, current.draftStart, current.draftEnd);
        }
        return null;
      });
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragState, persistEventTiming, timelineDuration, visibleWindowSpan]);

  async function submitSelectedEventEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEvent) return;
    const form = new FormData(event.currentTarget);
    const start = Number(form.get("start_seconds"));
    const end = Number(form.get("end_seconds"));
    try {
      const updated = await api.timeline.update(selectedEvent.id, {
        event_type: String(form.get("event_type") || selectedEvent.event_type) as EventType,
        team: String(form.get("team") || selectedEvent.team) as EventTeam,
        outcome: String(form.get("outcome") || "").trim() || null,
        field_zone: String(form.get("field_zone") || "").trim() || null,
        notes: String(form.get("notes") || "").trim() || null,
        start_seconds: Number.isFinite(start) ? roundTimelineSeconds(start) : selectedEvent.start_seconds,
        end_seconds: Number.isFinite(end) ? roundTimelineSeconds(end) : selectedEvent.end_seconds,
        clip_requested: form.get("clip_requested") === "on",
      });
      setEvents((current) => mergeTimelineEvents(current, [updated]));
      setSelectedEventId(updated.id);
      setNotice(`${eventLabel(updated)} saved. Reports and evidence use the updated shared timeline event.`);
      if (updated.clip_requested || updated.clip) {
        void api.timeline.regenerateClip(updated.id).catch(() => undefined);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save timeline event.");
    }
  }

  const saveShortcut = useCallback((id: string, shortcut: string) => {
    const nextShortcut = normaliseShortcut(shortcut);
    if (nextShortcut === "Unassigned") return;
    setShortcuts((current) => {
      const conflict = current.find((binding) => binding.id !== id && normaliseShortcut(binding.shortcut) === nextShortcut);
      if (conflict) {
        setNotice(`${shortcutLabel(nextShortcut)} is already assigned to ${conflict.label}.`);
        return current;
      }
      const next = current.map((binding) => binding.id === id ? { ...binding, shortcut: nextShortcut } : binding);
      persistShortcuts(activeSport, next);
      const binding = current.find((item) => item.id === id);
      setEditingShortcutId(null);
      setNotice(`${binding?.label ?? "Shortcut"} now uses ${shortcutLabel(nextShortcut)}.`);
      return next;
    });
  }, [activeSport]);

  const createEventFromBinding = useCallback(async (binding: ShortcutBinding, overrideTeam?: EventTeam) => {
    if (!selectedMatchId || !selectedVideoId) {
      setNotice("Select a match and video before coding tags.");
      return;
    }
    const safeDuration = Math.max(1, binding.duration || QUICK_CODE_CAPTURE_SECONDS);
    const videoDuration = videoRef.current?.duration;
    const playhead = videoRef.current?.currentTime ?? currentTime;
    let start = Math.max(0, playhead - safeDuration / 2);
    let end = start + safeDuration;
    if (Number.isFinite(videoDuration) && videoDuration && end > videoDuration) {
      end = videoDuration;
      start = Math.max(0, end - safeDuration);
    }
    const team = overrideTeam ?? (binding.team === "selected" ? teamContext : binding.team) ?? teamContext;
    const eventType = binding.eventType ?? inferEventTypeFromLabel(binding.outcome || binding.label, "custom");
    try {
      const created = await api.timeline.create({
        match_id: selectedMatchId,
        video_asset_id: selectedVideoId,
        event_type: eventType,
        team,
        start_seconds: Number(start.toFixed(2)),
        end_seconds: Number(Math.max(start + 0.5, end).toFixed(2)),
        player_name: null,
        outcome: binding.outcome || binding.label,
        notes: binding.notes || null,
        phase_number: null,
        field_zone: binding.fieldZone || zoneValue(activeZone) || null,
        clip_requested: true,
      });
      setEvents((current) => mergeTimelineEvents(current, [created]));
      setSelectedEventId(created.id);
      if (followPlayhead && timelineWindowDuration !== "full") centreTimelineOn(created.start_seconds);
      setNotice(`${binding.label} tagged for ${team} from ${formatTime(created.start_seconds)} to ${formatTime(created.end_seconds)}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to add tag.");
    }
  }, [activeZone, centreTimelineOn, currentTime, followPlayhead, selectedMatchId, selectedVideoId, teamContext, timelineWindowDuration]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (editingShortcutId) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") {
          setEditingShortcutId(null);
          setNotice("Shortcut recording cancelled.");
          return;
        }
        if (isModifierOnlyKey(event.code)) return;
        saveShortcut(editingShortcutId, shortcutFromKeyboardEvent(event));
        return;
      }
      if (shortcutEditable(event)) return;
      if (event.key === "Delete" && selectedEventId) {
        event.preventDefault();
        void deleteTimelineEvent(selectedEventId);
        return;
      }
      const shortcut = shortcutFromKeyboardEvent(event);
      const binding = shortcuts.find((item) => normaliseShortcut(item.shortcut) === shortcut);
      if (!binding) return;
      event.preventDefault();
      if (binding.group === "video" && binding.command) runVideoCommand(binding.command);
      if (binding.group === "zone") {
        setActiveZone(binding);
        setNotice(`Active zone set to ${zoneValue(binding)}.`);
      }
      if (binding.group === "event") void createEventFromBinding(binding);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createEventFromBinding, deleteTimelineEvent, editingShortcutId, runVideoCommand, saveShortcut, selectedEventId, shortcuts]);

  return (
    <main className="video-analysis-workspace">
      <div className={`video-analysis-shell ${panelOpen ? "" : "is-panel-collapsed"}`}>
        <section className="video-analysis-main">
          <div className="video-analysis-topbar">
            <Link href="/" className="video-analysis-exit">
              <span>&lt;</span>
              Exit
            </Link>
            <div className="video-analysis-selectors">
              <select value={selectedMatchId ?? ""} onChange={(event) => setSelectedMatchId(Number(event.target.value) || null)}>
                <option value="">Select match</option>
                {matches.map((match) => {
                  const home = teams.find((team) => team.id === match.home_team_id)?.name ?? "Home";
                  const away = teams.find((team) => team.id === match.away_team_id)?.name ?? "Away";
                  return <option key={match.id} value={match.id}>{home} vs {away}</option>;
                })}
              </select>
              <select value={selectedVideoId ?? ""} onChange={(event) => setSelectedVideoId(Number(event.target.value) || null)}>
                <option value="">Select video</option>
                {videos.map((video) => <option key={video.id} value={video.id}>{video.original_filename}</option>)}
              </select>
            </div>
            <button type="button" className="video-analysis-collapse" onClick={() => setPanelOpen((open) => !open)}>
              {panelOpen ? ">" : "<"}
            </button>
          </div>

          <div className="video-analysis-left-stack">
            <div className="video-analysis-stage">
              <div className="video-analysis-player-frame">
                {selectedVideo ? (
                  <video
                    ref={videoRef}
                    src={sourceVideoUrl(selectedVideo.id)}
                    preload="metadata"
                    playsInline
                    className="video-analysis-video"
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                    onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
                    onLoadedData={(event) => { event.currentTarget.playbackRate = playbackSpeed; }}
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
                    key={`${control.label}-${control.delta ?? control.command}`}
                    type="button"
                    onClick={() => {
                      if (control.command === "play_pause") togglePlay();
                      else seek(control.delta ?? 0);
                    }}
                    className="video-analysis-control-button"
                    title={control.delta ? `${control.delta > 0 ? "Forward" : "Back"} ${Math.abs(control.delta)} seconds` : "Play / pause"}
                  >
                    {control.label}
                  </button>
                ))}
                <span className="video-analysis-time">{formatTime(currentTime)} / {formatTime(timelineDuration)}</span>
                <div className="video-analysis-speed-controls" aria-label="Playback speed controls">
                  <span>{playbackSpeed}x</span>
                  {PLAYBACK_SPEED_PRESETS.map((speed) => (
                    <button
                      key={speed}
                      type="button"
                      className={playbackSpeed === speed ? "is-active" : ""}
                      onClick={() => setPlaybackSpeed(speed)}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
                <span className="video-analysis-notice">{notice}</span>
                <span className="video-analysis-zone">{activeZone ? zoneValue(activeZone) : "No active zone"}</span>
              </div>
            </div>

            <div className="video-analysis-timeline">
              <div className="video-analysis-window-controls">
                <div className="video-analysis-window-group" aria-label="Timeline window size">
                  {TIMELINE_WINDOW_OPTIONS.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      className={timelineWindowDuration === option.seconds ? "is-active" : ""}
                      onClick={() => {
                        setTimelineWindowDuration(option.seconds);
                        if (option.seconds !== "full") {
                          setTimelineWindowStart(clampWindowStart(currentTime - option.seconds / 2, option.seconds, timelineDuration));
                        }
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="video-analysis-window-actions">
                  <button type="button" disabled={timelineWindowDuration === "full" || visibleWindowStart <= 0} onClick={() => moveTimelineWindow(-1)}>
                    Previous window
                  </button>
                  <button type="button" disabled={timelineWindowDuration === "full" || visibleWindowEnd >= timelineDuration} onClick={() => moveTimelineWindow(1)}>
                    Next window
                  </button>
                  <button
                    type="button"
                    className={followPlayhead ? "is-active" : ""}
                    onClick={() => {
                      setFollowPlayhead((value) => {
                        if (value) {
                          setTimelineWindowStart(visibleWindowStart);
                          return false;
                        }
                        return true;
                      });
                    }}
                  >
                    Follow playhead
                  </button>
                  <span>{timelineWindowLabel}</span>
                </div>
              </div>
              <div className="video-analysis-timeline-scroll">
                <div className="video-analysis-timeline-board">
                  <div className="video-analysis-time-row">
                    <div className="video-analysis-track-head" />
                    <div className="video-analysis-ruler">
                      {timelineTicks(visibleWindowStart, visibleWindowEnd).map(({ tick, seconds }) => (
                        <span key={tick} style={{ left: `${tick * 100}%` }}>{formatTime(seconds)}</span>
                      ))}
                    </div>
                  </div>
                  {playheadVisible ? (
                    <div className="video-analysis-playhead" style={{ left: `calc(220px + ${Math.min(100, Math.max(0, (currentTime - visibleWindowStart) / visibleWindowSpan * 100))}%)` }} />
                  ) : null}
                  {trackRows.map((row) => (
                    <div key={row.track.id} className={`video-analysis-track-row is-${row.track.group}`}>
                      <div className="video-analysis-track-label">{row.track.label}</div>
                      <div className="video-analysis-track-lane">
                        {row.events.map((event) => {
                          const clippedStart = Math.max(event.start_seconds, visibleWindowStart);
                          const clippedEnd = Math.min(event.end_seconds, visibleWindowEnd);
                          const left = Math.min(98, Math.max(0, (clippedStart - visibleWindowStart) / visibleWindowSpan * 100));
                          const width = Math.max(1.4, Math.min(100 - left, (clippedEnd - clippedStart) / visibleWindowSpan * 100));
                          const selected = selectedEventId === event.id;
                          return (
                            <div
                              key={event.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => seekToTimelineEvent(event)}
                              onKeyDown={(keyEvent) => {
                                if (keyEvent.key === "Enter" || keyEvent.key === " ") seekToTimelineEvent(event);
                              }}
                              onPointerDown={(pointerEvent) => startTimelineDrag(pointerEvent, event, "move")}
                              className={`video-analysis-timeline-clip team-${event.team} category-${event.event_type} ${selected ? "is-selected" : ""}`}
                              style={{ left: `${left}%`, width: `${width}%` }}
                              title={eventDetails(event, row.track.label)}
                            >
                              <span
                                className="video-analysis-clip-handle video-analysis-clip-handle--left"
                                onPointerDown={(pointerEvent) => startTimelineDrag(pointerEvent, event, "resize-start")}
                                aria-hidden="true"
                              />
                              <span className="video-analysis-clip-label">{eventAbbreviation(event)}</span>
                              <span
                                className="video-analysis-clip-handle video-analysis-clip-handle--right"
                                onPointerDown={(pointerEvent) => startTimelineDrag(pointerEvent, event, "resize-end")}
                                aria-hidden="true"
                              />
                            </div>
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

        <aside className={`video-analysis-tags ${panelOpen ? "" : "is-collapsed"}`}>
          <div className="video-analysis-title">
            <span>{fixtureTitle}</span>
            <button type="button" onClick={() => setPanelOpen(false)} aria-label="Collapse review panel">x</button>
          </div>

          <div className="video-analysis-tabbar">
            {(["edit", "clips", "tags", "keyboard"] as PanelTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={panelTab === tab ? "is-active" : ""}
                onClick={() => setPanelTab(tab)}
              >
                {tab === "edit" ? "Edit Event" : tab === "clips" ? "Your Clips" : tab === "tags" ? "Tags" : "Keyboard Legend"}
              </button>
            ))}
          </div>

          <div className="video-analysis-panel-body">
            {panelTab === "edit" && (
              <div className="video-analysis-edit-panel">
                {!selectedEvent ? (
                  <p>Select a timeline event to edit its timing, label, team and notes.</p>
                ) : (
                  <form key={selectedEvent.id} onSubmit={(event) => void submitSelectedEventEdit(event)}>
                    <div className="video-analysis-edit-heading">
                      <div>
                        <span>Selected Event</span>
                        <strong>{eventLabel(selectedEvent)}</strong>
                      </div>
                      <button type="button" onClick={() => void deleteTimelineEvent(selectedEvent.id)}>Delete</button>
                    </div>
                    <label>
                      Event type
                      <select name="event_type" defaultValue={selectedEvent.event_type}>
                        {(["kickoff", "scrum", "lineout", "carry", "tackle", "ruck", "maul", "pass", "kick", "turnover", "penalty", "try", "conversion", "card", "stoppage", "custom"] as EventType[]).map((type) => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Team
                      <select name="team" defaultValue={selectedEvent.team}>
                        {(["home", "away", "neutral"] as EventTeam[]).map((team) => (
                          <option key={team} value={team}>{team}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Outcome / label
                      <input name="outcome" defaultValue={selectedEvent.outcome ?? ""} placeholder="e.g. dominant carry" />
                    </label>
                    <div className="video-analysis-edit-time-grid">
                      <label>
                        Start seconds
                        <input name="start_seconds" type="number" step="0.1" min="0" defaultValue={selectedEvent.start_seconds} />
                      </label>
                      <label>
                        End seconds
                        <input name="end_seconds" type="number" step="0.1" min="0" defaultValue={selectedEvent.end_seconds} />
                      </label>
                    </div>
                    <label>
                      Zone
                      <input name="field_zone" defaultValue={selectedEvent.field_zone ?? ""} />
                    </label>
                    <label>
                      Notes
                      <textarea name="notes" defaultValue={selectedEvent.notes ?? ""} rows={4} />
                    </label>
                    <label className="video-analysis-checkbox">
                      <input name="clip_requested" type="checkbox" defaultChecked={selectedEvent.clip_requested} />
                      Include in clips/evidence queue
                    </label>
                    <div className="video-analysis-edit-actions">
                      <button type="button" onClick={() => seekToTimelineEvent(selectedEvent)}>Review</button>
                      <button type="submit">Save event</button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {panelTab === "clips" && (
              <div className="video-analysis-clip-list">
                {clipEvents.length === 0 ? <p>No clipped events yet.</p> : null}
                {clipEvents.slice(-80).reverse().map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    className={selectedEventId === event.id ? "is-selected" : ""}
                    onClick={() => seekToTimelineEvent(event)}
                  >
                    <span>{eventLabel(event)}</span>
                    <small>{event.team} | {formatTime(event.start_seconds)}-{formatTime(event.end_seconds)}</small>
                  </button>
                ))}
              </div>
            )}

            {panelTab === "tags" && (
              <>
                <div className="video-analysis-search">
                  <label>
                    Search
                    <input value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} placeholder="What are you looking for?" />
                  </label>
                </div>
                <div className="video-analysis-team-toggle">
                  {(["home", "away"] as EventTeam[]).map((team) => (
                    <button key={team} type="button" className={teamContext === team ? "is-active" : ""} onClick={() => setTeamContext(team)}>
                      {team === "home" ? homeTeam?.name ?? "Home" : awayTeam?.name ?? "Away"}
                    </button>
                  ))}
                </div>
                <div className="video-analysis-tag-list">
                  {filteredTags.map((binding) => (
                    <button key={binding.id} type="button" className="video-analysis-tag-card" onClick={() => void createEventFromBinding(binding, teamContext)}>
                      <span>{binding.label}</span>
                      <small>{categoryLabel(binding.category)} | {shortcutLabel(binding.shortcut)}</small>
                    </button>
                  ))}
                </div>
              </>
            )}

            {panelTab === "keyboard" && (
              <div className="video-analysis-legend">
                {(["event", "zone", "video"] as ShortcutBinding["group"][]).map((group) => (
                  <section key={group} className="video-analysis-legend-section">
                    <h3>{group === "event" ? "Code / Tag Shortcuts" : group === "zone" ? "Zone Shortcuts" : "Playback Shortcuts"}</h3>
                    {shortcuts.filter((binding) => binding.group === group).map((binding) => (
                      <div key={binding.id} className="video-analysis-legend-row">
                        <span>{binding.team === "home" ? "Home " : binding.team === "away" ? "Away " : ""}{binding.label}</span>
                        <button
                          type="button"
                          className={editingShortcutId === binding.id ? "is-recording" : ""}
                          onClick={() => {
                            setEditingShortcutId(binding.id);
                            setNotice(`Press a new shortcut for ${binding.label}, or Escape to cancel.`);
                          }}
                        >
                          {editingShortcutId === binding.id ? "Press new key..." : shortcutLabel(binding.shortcut)}
                        </button>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            )}
          </div>
        </aside>

        {!panelOpen ? (
          <button type="button" className="video-analysis-panel-toggle" onClick={() => setPanelOpen(true)}>
            Tags / Keyboard
          </button>
        ) : null}
      </div>
    </main>
  );
}
