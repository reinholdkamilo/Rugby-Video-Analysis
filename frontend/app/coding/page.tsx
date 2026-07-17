"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EventTeam, EventType, Match, Team, TimelineEvent, VideoAsset } from "@/lib/api";
import { codingApi, sourceVideoUrl } from "@/lib/coding-api";

const EVENT_TYPES: EventType[] = [
  "kickoff", "scrum", "lineout", "carry", "tackle", "ruck", "maul", "pass",
  "kick", "turnover", "penalty", "try", "conversion", "card", "stoppage", "custom",
];

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

type EventCategory = "core" | "attack" | "defence" | "set_piece" | "discipline" | "transition" | "kicking" | "possession";
type ReviewStatus = "unreviewed" | "confirmed" | "flagged";
type EventSource = "manual" | "auto" | "vision" | "imported";
type VideoLayoutMode = "standard" | "large" | "theatre";
type LayoutDensity = "compact" | "comfortable";
type LayoutColumnCount = 2 | 3 | 4;
type QuickColumnId = "home" | "away";

type CodingLayout = {
  quickColumns: LayoutColumnCount;
  mappingColumns: LayoutColumnCount;
  density: LayoutDensity;
  quickColumnOrder: QuickColumnId[];
};

type ReviewMeta = {
  status: ReviewStatus;
  source: EventSource;
  confidence: number;
};

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
  variant?: boolean;
  command?: VideoCommand;
  zoneLength?: string;
};

const SHORTCUT_STORAGE_KEY = "rugby-video-analysis:coding-shortcuts:v1";
const REVIEW_STORAGE_KEY = "rugby-video-analysis:coding-review:v1";
const VIDEO_LAYOUT_STORAGE_KEY = "rugby-video-analysis:coding-video-layout:v1";
const CODING_LAYOUT_STORAGE_KEY = "rugby-video-analysis:coding-layout:v1";

const DEFAULT_QUICK_COLUMN_ORDER: QuickColumnId[] = ["home", "away"];
const DEFAULT_CODING_LAYOUT: CodingLayout = {
  quickColumns: 2,
  mappingColumns: 4,
  density: "comfortable",
  quickColumnOrder: DEFAULT_QUICK_COLUMN_ORDER,
};

const EVENT_LIBRARY_CATEGORIES: { value: EventCategory; label: string }[] = [
  { value: "attack", label: "Attack" },
  { value: "defence", label: "Defence" },
  { value: "set_piece", label: "Set piece" },
  { value: "discipline", label: "Discipline" },
  { value: "transition", label: "Transition" },
  { value: "kicking", label: "Kicking" },
  { value: "possession", label: "Possession" },
  { value: "core", label: "General" },
];

const REVIEW_STATUSES: { value: ReviewStatus; label: string }[] = [
  { value: "unreviewed", label: "Unreviewed" },
  { value: "confirmed", label: "Confirmed" },
  { value: "flagged", label: "Flagged" },
];

const EVENT_SOURCES: { value: EventSource; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "auto", label: "Auto" },
  { value: "vision", label: "Vision" },
  { value: "imported", label: "Imported" },
];

const HOME_EVENT_KEYS = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal", "Backquote"];
const AWAY_EVENT_KEYS = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight", "Backslash"];
const ZONE_KEYS = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK"];
const BASE_EVENT_SHORTCUTS: Omit<ShortcutBinding, "id" | "shortcut" | "team">[] = [
  { label: "Carry", group: "event", eventType: "carry", duration: 6, category: "attack" },
  { label: "Tackle", group: "event", eventType: "tackle", duration: 5, category: "defence" },
  { label: "Ruck", group: "event", eventType: "ruck", duration: 6, category: "possession" },
  { label: "Pass", group: "event", eventType: "pass", duration: 4, category: "attack" },
  { label: "Kick", group: "event", eventType: "kick", duration: 8, category: "kicking" },
  { label: "Lineout", group: "event", eventType: "lineout", duration: 18, category: "set_piece" },
  { label: "Scrum", group: "event", eventType: "scrum", duration: 22, category: "set_piece" },
  { label: "Penalty", group: "event", eventType: "penalty", duration: 8, category: "discipline" },
  { label: "Try", group: "event", eventType: "try", duration: 12, category: "attack" },
  { label: "Turnover", group: "event", eventType: "turnover", duration: 8, category: "transition" },
  { label: "Maul", group: "event", eventType: "maul", duration: 10, category: "set_piece" },
  { label: "Stoppage", group: "event", eventType: "stoppage", duration: 10, category: "core" },
  { label: "Blank event", group: "event", eventType: "custom", duration: 8, category: "core" },
];

const VARIANT_EVENT_SHORTCUTS: Omit<ShortcutBinding, "id" | "shortcut" | "team">[] = [
  { label: "Dominant carry", group: "event", eventType: "carry", duration: 6, category: "attack", outcome: "Dominant carry", variant: true },
  { label: "Missed tackle", group: "event", eventType: "tackle", duration: 5, category: "defence", outcome: "Missed tackle", variant: true },
  { label: "Ruck won", group: "event", eventType: "ruck", duration: 6, category: "possession", outcome: "Ruck won", variant: true },
  { label: "Forward pass", group: "event", eventType: "pass", duration: 4, category: "attack", outcome: "Forward pass", variant: true },
  { label: "Contestable kick", group: "event", eventType: "kick", duration: 8, category: "kicking", outcome: "Contestable kick", variant: true },
  { label: "Lineout lost", group: "event", eventType: "lineout", duration: 18, category: "set_piece", outcome: "Lineout lost", variant: true },
  { label: "Scrum lost", group: "event", eventType: "scrum", duration: 22, category: "set_piece", outcome: "Scrum lost", variant: true },
  { label: "Penalty conceded", group: "event", eventType: "penalty", duration: 8, category: "discipline", outcome: "Penalty conceded", variant: true },
  { label: "Line break", group: "event", eventType: "carry", duration: 10, category: "attack", outcome: "Line break", variant: true },
  { label: "Jackal win", group: "event", eventType: "turnover", duration: 8, category: "defence", outcome: "Jackal win", variant: true },
  { label: "Maul lost", group: "event", eventType: "maul", duration: 10, category: "set_piece", outcome: "Maul lost", variant: true },
  { label: "Drop out", group: "event", eventType: "kick", duration: 10, category: "kicking", outcome: "Drop out", variant: true },
  { label: "Quick restart", group: "event", eventType: "kickoff", duration: 8, category: "kicking", outcome: "Quick restart", variant: true },
];

const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  ...BASE_EVENT_SHORTCUTS.flatMap((binding, index) => [
    { ...binding, id: `tag_home_${binding.eventType}_${index}`, label: `Home ${binding.label}`, shortcut: HOME_EVENT_KEYS[index], team: "home" as const },
    { ...binding, id: `tag_away_${binding.eventType}_${index}`, label: `Away ${binding.label}`, shortcut: AWAY_EVENT_KEYS[index], team: "away" as const },
  ]),
  ...VARIANT_EVENT_SHORTCUTS.flatMap((binding, index) => [
    { ...binding, id: `tag_home_variant_${binding.eventType}_${index}`, label: `Home ${binding.label}`, shortcut: `Shift+${HOME_EVENT_KEYS[index]}`, team: "home" as const },
    { ...binding, id: `tag_away_variant_${binding.eventType}_${index}`, label: `Away ${binding.label}`, shortcut: `Shift+${AWAY_EVENT_KEYS[index]}`, team: "away" as const },
  ]),
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

const inputClass = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400";

function designId(...parts: Array<string | number | undefined | null>) {
  return parts
    .filter((part) => part !== undefined && part !== null && String(part).length > 0)
    .map((part) => String(part).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .join("-");
}

function formatTime(seconds: number) {
  const value = Math.max(0, seconds || 0);
  const minutes = Math.floor(value / 60);
  const remaining = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function normaliseShortcut(shortcut: string) {
  return shortcut.split("+").filter(Boolean).join("+");
}

function isModifierOnlyKey(code: string) {
  return ["ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "ControlLeft", "ControlRight", "MetaLeft", "MetaRight"].includes(code);
}

function shortcutFromKeyboardEvent(event: KeyboardEvent | React.KeyboardEvent) {
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  parts.push(event.code);
  return normaliseShortcut(parts.join("+"));
}

function shortcutLabel(shortcut: string) {
  return shortcut
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
    .replace("Comma", ",")
    .replace("Period", ".")
    .replace("Space", "Space");
}

function shortcutEditable(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  return target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT" || target?.isContentEditable;
}

function gridColumnsClass(count: LayoutColumnCount) {
  if (count === 2) return "xl:grid-cols-2";
  if (count === 3) return "xl:grid-cols-3";
  return "xl:grid-cols-4";
}

function quickColumnTarget(columnId: QuickColumnId): Pick<ShortcutBinding, "team"> {
  return {
    team: columnId === "home" ? "home" : "away",
  };
}

function loadCodingLayout(): CodingLayout {
  if (typeof window === "undefined") return DEFAULT_CODING_LAYOUT;
  const saved = window.localStorage.getItem(CODING_LAYOUT_STORAGE_KEY);
  if (!saved) return DEFAULT_CODING_LAYOUT;
  try {
    const parsed = JSON.parse(saved) as Partial<CodingLayout>;
    const order = parsed.quickColumnOrder?.filter((item): item is QuickColumnId => DEFAULT_QUICK_COLUMN_ORDER.includes(item as QuickColumnId)) ?? [];
    return {
      quickColumns: parsed.quickColumns === 2 || parsed.quickColumns === 3 || parsed.quickColumns === 4 ? parsed.quickColumns : DEFAULT_CODING_LAYOUT.quickColumns,
      mappingColumns: parsed.mappingColumns === 2 || parsed.mappingColumns === 3 || parsed.mappingColumns === 4 ? parsed.mappingColumns : DEFAULT_CODING_LAYOUT.mappingColumns,
      density: parsed.density === "compact" ? "compact" : "comfortable",
      quickColumnOrder: [...order, ...DEFAULT_QUICK_COLUMN_ORDER.filter((item) => !order.includes(item))],
    };
  } catch {
    return DEFAULT_CODING_LAYOUT;
  }
}

function displayEventLabel(binding: ShortcutBinding) {
  return binding.label.replace(/^Home\s+/i, "").replace(/^Away\s+/i, "");
}

function zoneValue(binding?: Pick<ShortcutBinding, "label" | "fieldZone" | "zoneLength"> | null) {
  if (!binding) return "";
  const label = binding.fieldZone || binding.label;
  return binding.zoneLength ? `${label} - ${binding.zoneLength}` : label;
}

function categoryLabel(category?: EventCategory) {
  return (category === "core" ? "general" : category ?? "event").replace("_", " ");
}

function loadShortcutBindings() {
  if (typeof window === "undefined") return DEFAULT_SHORTCUTS;
  const saved = window.localStorage.getItem(SHORTCUT_STORAGE_KEY);
  if (!saved) return DEFAULT_SHORTCUTS;
  try {
    const parsed = JSON.parse(saved) as Partial<ShortcutBinding>[];
    const defaults = DEFAULT_SHORTCUTS.map((binding) => {
      const savedBinding = parsed.find((item) => item.id === binding.id);
      return {
        ...binding,
        ...savedBinding,
        id: binding.id,
        group: binding.group,
        custom: binding.custom,
        shortcut: savedBinding?.shortcut || binding.shortcut,
        team: (savedBinding?.team as ShortcutBinding["team"]) || binding.team,
      };
    });
    const custom = parsed
      .filter((item) => item.custom && item.id && item.label && item.shortcut)
      .map((item) => ({
        id: String(item.id),
        label: String(item.label),
        group: item.group === "zone" ? "zone" as const : "event" as const,
        shortcut: String(item.shortcut),
        eventType: "custom" as EventType,
        duration: Number(item.duration || 8),
        category: (item.category as EventCategory) || "attack",
        outcome: item.outcome ? String(item.outcome) : String(item.label),
        team: (item.team as ShortcutBinding["team"]) || "selected",
        fieldZone: item.fieldZone ? String(item.fieldZone) : undefined,
        notes: item.notes ? String(item.notes) : undefined,
        zoneLength: item.zoneLength ? String(item.zoneLength) : undefined,
        custom: true,
      }));
    return [...defaults, ...custom];
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

function loadVideoLayoutMode(): VideoLayoutMode {
  if (typeof window === "undefined") return "standard";
  const saved = window.localStorage.getItem(VIDEO_LAYOUT_STORAGE_KEY);
  return saved === "large" || saved === "theatre" ? saved : "standard";
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

function defaultReviewMeta(event?: TimelineEvent | null): ReviewMeta {
  return {
    status: "unreviewed",
    source: event?.created_at === event?.updated_at ? "manual" : "auto",
    confidence: 100,
  };
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
  const [playbackRate, setPlaybackRate] = useState(1);
  const [shortcuts, setShortcuts] = useState<ShortcutBinding[]>(DEFAULT_SHORTCUTS);
  const [editingShortcutId, setEditingShortcutId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [reviewMeta, setReviewMeta] = useState<Record<number, ReviewMeta>>({});
  const [timelineSearch, setTimelineSearch] = useState("");
  const [timelineTeamFilter, setTimelineTeamFilter] = useState<EventTeam | "all">("all");
  const [timelineTypeFilter, setTimelineTypeFilter] = useState<EventType | "all">("all");
  const [timelineCategoryFilter, setTimelineCategoryFilter] = useState<EventCategory | "all">("all");
  const [timelineReviewFilter, setTimelineReviewFilter] = useState<ReviewStatus | "all">("all");
  const [timelineSourceFilter, setTimelineSourceFilter] = useState<EventSource | "all">("all");
  const [activeZoneId, setActiveZoneId] = useState<string | null>(null);
  const [videoLayout, setVideoLayout] = useState<VideoLayoutMode>("standard");
  const [codingLayout, setCodingLayout] = useState<CodingLayout>(DEFAULT_CODING_LAYOUT);
  const [draggingShortcutId, setDraggingShortcutId] = useState<string | null>(null);
  const [draggingColumnId, setDraggingColumnId] = useState<QuickColumnId | null>(null);
  const [notice, setNotice] = useState("Loading coding workspace...");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setShortcuts(loadShortcutBindings());
    setReviewMeta(loadReviewMeta());
    setVideoLayout(loadVideoLayoutMode());
    setCodingLayout(loadCodingLayout());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(shortcuts.map(({ id, shortcut, custom, label, group, duration, category, eventType, outcome, team, fieldZone, notes, variant, zoneLength }) => (
      { id, shortcut, custom, label, group, duration, category, eventType, outcome, team, fieldZone, notes, variant, zoneLength }
    ))));
  }, [shortcuts]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(reviewMeta));
  }, [reviewMeta]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VIDEO_LAYOUT_STORAGE_KEY, videoLayout);
  }, [videoLayout]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CODING_LAYOUT_STORAGE_KEY, JSON.stringify(codingLayout));
  }, [codingLayout]);

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
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? null;
  const teamLabel = useCallback((team?: EventTeam | "selected") => {
    if (!team || team === "selected") return "Selected team";
    if (team === "home") return homeTeam?.name ?? "Home";
    if (team === "away") return awayTeam?.name ?? "Away";
    return "Neutral";
  }, [awayTeam?.name, homeTeam?.name]);

  const eventCounts = useMemo(() => {
    return events.reduce<Record<string, number>>((counts, event) => {
      counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
      return counts;
    }, {});
  }, [events]);

  const eventShortcuts = useMemo(() => shortcuts.filter((shortcut) => shortcut.group === "event"), [shortcuts]);
  const zoneShortcuts = useMemo(() => shortcuts.filter((shortcut) => shortcut.group === "zone"), [shortcuts]);
  const videoShortcuts = useMemo(() => shortcuts.filter((shortcut) => shortcut.group === "video"), [shortcuts]);
  const activeZone = useMemo(() => zoneShortcuts.find((zone) => zone.id === activeZoneId) ?? null, [activeZoneId, zoneShortcuts]);
  const videoShellClass = videoLayout === "theatre"
    ? "mx-auto max-w-[1500px]"
    : videoLayout === "large"
      ? "mx-auto max-w-[1180px]"
      : "mx-auto max-w-[920px]";

  const eventLabel = useCallback((event: TimelineEvent) => event.outcome || event.event_type, []);

  const eventCategory = useCallback((event: TimelineEvent) => {
    const label = eventLabel(event).toLowerCase();
    return eventShortcuts.find((shortcut) => (
      shortcut.eventType === event.event_type && (!shortcut.outcome || shortcut.outcome.toLowerCase() === label)
    ))?.category ?? "core";
  }, [eventLabel, eventShortcuts]);

  const reviewForEvent = useCallback((event: TimelineEvent) => reviewMeta[event.id] ?? defaultReviewMeta(event), [reviewMeta]);

  const selectedReview = selectedEvent ? reviewForEvent(selectedEvent) : null;

  const filteredEvents = useMemo(() => {
    const query = timelineSearch.trim().toLowerCase();
    return events.filter((event) => {
      const review = reviewForEvent(event);
      const label = eventLabel(event);
      const searchable = [label, event.event_type, event.team, event.field_zone, event.notes, event.outcome, event.phase_number ? `phase ${event.phase_number}` : ""].filter(Boolean).join(" ").toLowerCase();
      if (query && !searchable.includes(query)) return false;
      if (timelineTeamFilter !== "all" && event.team !== timelineTeamFilter) return false;
      if (timelineTypeFilter !== "all" && event.event_type !== timelineTypeFilter) return false;
      if (timelineCategoryFilter !== "all" && eventCategory(event) !== timelineCategoryFilter) return false;
      if (timelineReviewFilter !== "all" && review.status !== timelineReviewFilter) return false;
      if (timelineSourceFilter !== "all" && review.source !== timelineSourceFilter) return false;
      return true;
    });
  }, [eventCategory, eventLabel, events, reviewForEvent, timelineCategoryFilter, timelineReviewFilter, timelineSearch, timelineSourceFilter, timelineTeamFilter, timelineTypeFilter]);

  const reviewCounts = useMemo(() => {
    return events.reduce<Record<ReviewStatus, number>>((counts, event) => {
      const status = reviewForEvent(event).status;
      counts[status] += 1;
      return counts;
    }, { unreviewed: 0, confirmed: 0, flagged: 0 });
  }, [events, reviewForEvent]);

  const shortcutConflict = useMemo(() => {
    const counts = shortcuts.reduce<Record<string, number>>((items, shortcut) => {
      items[shortcut.shortcut] = (items[shortcut.shortcut] ?? 0) + 1;
      return items;
    }, {});
    return (shortcut: string) => counts[shortcut] > 1;
  }, [shortcuts]);

  const quickMatrixColumns = useMemo(() => {
    const columns: Record<QuickColumnId, { id: QuickColumnId; title: string; subtitle: string; items: ShortcutBinding[] }> = {
      home: {
        id: "home",
        title: "Home events",
        subtitle: homeTeam?.name ?? "Home",
        items: eventShortcuts.filter((shortcut) => shortcut.team === "home" && !shortcut.custom),
      },
      away: {
        id: "away",
        title: "Away events",
        subtitle: awayTeam?.name ?? "Away",
        items: eventShortcuts.filter((shortcut) => shortcut.team === "away" && !shortcut.custom),
      },
    };
    return codingLayout.quickColumnOrder.map((columnId) => columns[columnId]);
  }, [awayTeam?.name, codingLayout.quickColumnOrder, eventShortcuts, homeTeam?.name]);

  const customEventShortcuts = useMemo(() => eventShortcuts.filter((shortcut) => shortcut.custom || !["home", "away"].includes(String(shortcut.team))), [eventShortcuts]);

  const mappingColumns = useMemo(() => {
    const groups: { id: EventCategory | "custom"; title: string; items: ShortcutBinding[] }[] = [
      { id: "attack", title: "Attack", items: [] },
      { id: "defence", title: "Defence", items: [] },
      { id: "set_piece", title: "Set piece", items: [] },
      { id: "custom", title: "Special / custom", items: [] },
    ];
    for (const shortcut of eventShortcuts) {
      if (shortcut.category === "attack" || shortcut.category === "kicking" || shortcut.category === "transition") groups[0].items.push(shortcut);
      else if (shortcut.category === "defence" || shortcut.category === "discipline" || shortcut.category === "possession") groups[1].items.push(shortcut);
      else if (shortcut.category === "set_piece") groups[2].items.push(shortcut);
      else groups[3].items.push(shortcut);
    }
    return groups;
  }, [eventShortcuts]);

  const recentEvents = useMemo(() => [...events].sort((a, b) => b.start_seconds - a.start_seconds).slice(0, 10), [events]);

  const quickButtonClass = codingLayout.density === "compact"
    ? "grid grid-cols-[auto_1fr] items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-left hover:border-emerald-400 disabled:opacity-40"
    : "grid grid-cols-[auto_1fr] items-center gap-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-left hover:border-emerald-400 disabled:opacity-40";
  const mappingCardClass = codingLayout.density === "compact"
    ? "rounded-lg border border-slate-800 bg-slate-900 p-2"
    : "rounded-lg border border-slate-800 bg-slate-900 p-3";

  const createEvent = useCallback(async (type: EventType, duration = 8, extras?: { notes?: string; outcome?: string; phaseNumber?: number | null; fieldZone?: string; label?: string; team?: EventTeam | "selected" }) => {
    if (!selectedMatchId || !selectedVideoId) return;
    const start = Math.max(0, videoRef.current?.currentTime ?? currentTime);
    const end = Math.min(videoRef.current?.duration || start + duration, start + duration);
    const team = extras?.team && extras.team !== "selected" ? extras.team : selectedTeam;
    setBusy(true);
    try {
      const created = await codingApi.createEvent({
        match_id: selectedMatchId,
        video_asset_id: selectedVideoId,
        event_type: type,
        team,
        start_seconds: Number(start.toFixed(2)),
        end_seconds: Number(Math.max(start + 0.5, end).toFixed(2)),
        player_name: null,
        outcome: extras?.outcome || null,
        notes: extras?.notes || null,
        phase_number: extras?.phaseNumber ?? null,
        field_zone: extras?.fieldZone || zoneValue(activeZone) || null,
        clip_requested: false,
      });
      setEvents((current) => [...current, created].sort((a, b) => a.start_seconds - b.start_seconds));
      setSelectedEventId(created.id);
      const zoneText = created.field_zone ? ` in ${created.field_zone}` : "";
      setNotice(type === "custom" ? `${extras?.label || extras?.outcome || "Blank event"} saved to the timeline at ${formatTime(start)} for ${team}${zoneText}. Reports update from saved timeline events.` : `${type} saved to the timeline at ${formatTime(start)} for ${team}${zoneText}. Reports update from saved timeline events.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to create event");
    } finally {
      setBusy(false);
    }
  }, [activeZone, currentTime, selectedMatchId, selectedTeam, selectedVideoId]);

  const createEventFromBinding = useCallback((binding: ShortcutBinding) => {
    if (!binding.eventType) return;
    void createEvent(binding.eventType, binding.duration, {
      outcome: binding.outcome || (binding.custom ? binding.label : undefined),
      notes: binding.notes,
      fieldZone: binding.fieldZone,
      label: binding.label,
      team: binding.team,
    });
  }, [createEvent]);

  const runVideoCommand = useCallback((command: VideoCommand) => {
    const video = videoRef.current;
    if (!video) return;
    const seek = (seconds: number) => {
      video.currentTime = Math.min(Math.max(0, video.currentTime + seconds), video.duration || video.currentTime + seconds);
    };
    const setSpeed = (speed: number) => {
      const next = Math.min(Math.max(speed, 0.25), 2);
      video.playbackRate = next;
      setPlaybackRate(next);
      setNotice(`Playback speed set to ${next}x.`);
    };

    if (command === "play_pause") {
      if (video.paused) void video.play(); else video.pause();
    } else if (command === "seek_back_5") seek(-5);
    else if (command === "seek_forward_5") seek(5);
    else if (command === "seek_back_10") seek(-10);
    else if (command === "seek_forward_10") seek(10);
    else if (command === "seek_back_5m") seek(-300);
    else if (command === "seek_forward_5m") seek(300);
    else if (command === "seek_back_10m") seek(-600);
    else if (command === "seek_forward_10m") seek(600);
    else if (command === "step_back") {
      video.pause();
      seek(-0.04);
    } else if (command === "step_forward") {
      video.pause();
      seek(0.04);
    } else if (command === "speed_down") setSpeed(Number((video.playbackRate - 0.25).toFixed(2)));
    else if (command === "speed_up") setSpeed(Number((video.playbackRate + 0.25).toFixed(2)));
    else if (command === "speed_quarter") setSpeed(0.25);
    else if (command === "speed_half") setSpeed(0.5);
    else if (command === "speed_normal") setSpeed(1);
    else if (command === "speed_double") setSpeed(2);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (editingShortcutId || shortcutEditable(event)) return;
      const shortcut = shortcutFromKeyboardEvent(event);
      const binding = shortcuts.find((item) => item.shortcut === shortcut);
      if (!binding) return;
      event.preventDefault();
      if (binding.group === "event" && binding.eventType) {
        createEventFromBinding(binding);
      } else if (binding.group === "zone") {
        setActiveZoneId(binding.id);
        setNotice(`Active coding zone set to ${zoneValue(binding)}.`);
      } else if (binding.group === "video" && binding.command) {
        runVideoCommand(binding.command);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createEventFromBinding, editingShortcutId, runVideoCommand, shortcuts]);

  const updateShortcut = useCallback((bindingId: string, shortcut: string) => {
    const duplicate = shortcuts.some((binding) => binding.id !== bindingId && binding.shortcut === shortcut);
    setShortcuts((current) => current.map((binding) => binding.id === bindingId ? { ...binding, shortcut } : binding));
    setEditingShortcutId(null);
    setNotice(duplicate ? `${shortcutLabel(shortcut)} is mapped to more than one action.` : "Keyboard shortcut updated.");
  }, [shortcuts]);

  useEffect(() => {
    if (!editingShortcutId) return;
    const onCapture = (event: KeyboardEvent) => {
      event.preventDefault();
      if (event.code === "Escape") {
        setEditingShortcutId(null);
        setNotice("Shortcut edit cancelled.");
        return;
      }
      if (isModifierOnlyKey(event.code)) {
        setNotice("Hold the modifier, then press the event key.");
        return;
      }
      updateShortcut(editingShortcutId, shortcutFromKeyboardEvent(event));
    };
    window.addEventListener("keydown", onCapture, true);
    return () => window.removeEventListener("keydown", onCapture, true);
  }, [editingShortcutId, updateShortcut]);

  function resetShortcuts() {
    setShortcuts(DEFAULT_SHORTCUTS);
    setEditingShortcutId(null);
    setActiveZoneId(null);
    setNotice("Keyboard shortcuts, zone keys and custom library events reset to defaults.");
  }

  function updateCodingLayout(updates: Partial<CodingLayout>) {
    setCodingLayout((current) => ({ ...current, ...updates }));
  }

  function resetCodingLayout() {
    setCodingLayout(DEFAULT_CODING_LAYOUT);
    setNotice("Coding workspace layout reset.");
  }

  function moveQuickColumn(targetColumnId: QuickColumnId) {
    if (!draggingColumnId || draggingColumnId === targetColumnId) return;
    setCodingLayout((current) => {
      const next = current.quickColumnOrder.filter((item) => item !== draggingColumnId);
      const targetIndex = next.indexOf(targetColumnId);
      next.splice(targetIndex < 0 ? next.length : targetIndex, 0, draggingColumnId);
      return { ...current, quickColumnOrder: next };
    });
    setDraggingColumnId(null);
    setNotice("Quick coding columns reordered.");
  }

  function moveShortcutToColumn(targetColumnId: QuickColumnId, targetShortcutId?: string) {
    if (!draggingShortcutId) return;
    const target = quickColumnTarget(targetColumnId);
    setShortcuts((current) => {
      const dragged = current.find((item) => item.id === draggingShortcutId);
      if (!dragged) return current;
      const draggedNext = { ...dragged, ...target };
      const withoutDragged = current.filter((item) => item.id !== draggingShortcutId);
      const targetIndex = targetShortcutId ? withoutDragged.findIndex((item) => item.id === targetShortcutId) : -1;
      const insertIndex = targetIndex >= 0 ? targetIndex : withoutDragged.length;
      withoutDragged.splice(insertIndex, 0, draggedNext);
      return withoutDragged;
    });
    setDraggingShortcutId(null);
    setNotice("Quick code moved. Team column saved.");
  }

  function submitLibraryEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = String(form.get("label") || "").trim();
    if (!label) {
      setNotice("Name the library event before adding it.");
      return;
    }
    const binding: ShortcutBinding = {
      id: `custom_${Date.now()}`,
      label,
      group: "event",
      shortcut: String(form.get("shortcut") || "").trim() || "Unassigned",
      eventType: "custom",
      duration: Number(form.get("duration") || 8),
      category: String(form.get("category") || "attack") as EventCategory,
      outcome: label,
      team: String(form.get("team") || "selected") as ShortcutBinding["team"],
      fieldZone: String(form.get("field_zone") || "").trim() || undefined,
      notes: String(form.get("notes") || "").trim() || undefined,
      custom: true,
    };
    setShortcuts((current) => [...current, binding]);
    setNotice(`${label} added to the coding event library.`);
    event.currentTarget.reset();
  }

  function submitZoneShortcut(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = String(form.get("label") || "").trim();
    const fieldZone = String(form.get("field_zone") || label).trim();
    if (!label || !fieldZone) {
      setNotice("Name the zone before adding it.");
      return;
    }
    const binding: ShortcutBinding = {
      id: `custom_zone_${Date.now()}`,
      label,
      group: "zone",
      shortcut: String(form.get("shortcut") || "").trim() || "Unassigned",
      fieldZone,
      zoneLength: String(form.get("zone_length") || "").trim() || undefined,
      notes: String(form.get("notes") || "").trim() || undefined,
      custom: true,
    };
    setShortcuts((current) => [...current, binding]);
    setNotice(`${label} added to the zone keyboard map.`);
    event.currentTarget.reset();
  }

  function updateLibraryEvent(bindingId: string, updates: Partial<ShortcutBinding>) {
    setShortcuts((current) => current.map((binding) => (
      binding.id === bindingId
        ? { ...binding, ...updates, outcome: updates.label ?? binding.outcome ?? binding.label }
        : binding
    )));
  }

  function deleteLibraryEvent(bindingId: string) {
    const binding = shortcuts.find((item) => item.id === bindingId);
    setShortcuts((current) => current.filter((item) => item.id !== bindingId));
    if (bindingId === activeZoneId) setActiveZoneId(null);
    setNotice(`${binding?.label ?? "Custom item"} removed from the keyboard library.`);
  }

  function updateReview(eventId: number, updates: Partial<ReviewMeta>) {
    const event = events.find((item) => item.id === eventId);
    setReviewMeta((current) => ({
      ...current,
      [eventId]: { ...defaultReviewMeta(event), ...current[eventId], ...updates },
    }));
  }

  function markFilteredReviewed() {
    setReviewMeta((current) => {
      const next = { ...current };
      for (const event of filteredEvents) {
        next[event.id] = { ...defaultReviewMeta(event), ...next[event.id], status: "confirmed" };
      }
      return next;
    });
    setNotice(`${filteredEvents.length} filtered events marked confirmed.`);
  }

  async function deleteTimelineEvents(eventsToDelete: TimelineEvent[], label: string) {
    if (!eventsToDelete.length) return;
    const confirmed = window.confirm(`Delete ${label}? This removes the coding event${eventsToDelete.length === 1 ? "" : "s"} from the timeline and reports.`);
    if (!confirmed) return;
    const eventIds = new Set(eventsToDelete.map((event) => event.id));
    setBusy(true);
    try {
      await Promise.all(eventsToDelete.map((event) => codingApi.deleteEvent(event.id)));
      setEvents((current) => current.filter((event) => !eventIds.has(event.id)));
      setReviewMeta((current) => {
        const next = { ...current };
        for (const eventId of eventIds) {
          delete next[eventId];
        }
        return next;
      });
      setSelectedEventId((current) => current && eventIds.has(current) ? null : current);
      setNotice(`${eventsToDelete.length} timeline event${eventsToDelete.length === 1 ? "" : "s"} deleted.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete timeline events");
    } finally {
      setBusy(false);
    }
  }

  async function toggleClipRequest(event: TimelineEvent) {
    setBusy(true);
    try {
      const updated = await codingApi.updateEvent(event.id, { clip_requested: !event.clip_requested });
      setEvents((current) => current.map((item) => item.id === updated.id ? updated : item).sort((a, b) => a.start_seconds - b.start_seconds));
      setNotice(updated.clip_requested ? "Event added to the clip queue." : "Event removed from the clip queue.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update clip request");
    } finally {
      setBusy(false);
    }
  }

  async function submitCustomEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await createEvent(String(form.get("event_type")) as EventType, Number(form.get("duration") || 8), {
      outcome: String(form.get("outcome") || "").trim(),
      notes: String(form.get("notes") || "").trim(),
      phaseNumber: form.get("phase_number") ? Number(form.get("phase_number")) : null,
      fieldZone: String(form.get("field_zone") || "").trim(),
    });
    event.currentTarget.reset();
  }

  async function submitEventEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEvent) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const updated = await codingApi.updateEvent(selectedEvent.id, {
        event_type: String(form.get("event_type")) as EventType,
        team: String(form.get("team")) as EventTeam,
        start_seconds: Number(form.get("start_seconds")),
        end_seconds: Number(form.get("end_seconds")),
        player_name: null,
        outcome: String(form.get("outcome") || "").trim() || null,
        notes: String(form.get("notes") || "").trim() || null,
        phase_number: form.get("phase_number") ? Number(form.get("phase_number")) : null,
        field_zone: String(form.get("field_zone") || "").trim() || null,
      });
      setEvents((current) => current.map((item) => item.id === updated.id ? updated : item).sort((a, b) => a.start_seconds - b.start_seconds));
      setSelectedEventId(updated.id);
      setNotice(`${updated.event_type} saved at ${formatTime(updated.start_seconds)}. Reports update from saved timeline events.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update event");
    } finally {
      setBusy(false);
    }
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
            <Link href="/upload" className="rounded-lg border border-slate-700 px-3 py-2">Upload Match</Link>
            <Link href="/reports" className="rounded-lg border border-slate-700 px-3 py-2">Reports</Link>
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

        <div className="mb-5 grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-300">{notice}</div>
          <div className="rounded-xl border border-emerald-900 bg-emerald-950/30 px-4 py-3 text-sm font-bold text-emerald-200">
            {activeZone ? `Active zone: ${zoneValue(activeZone)}` : "Timeline events save immediately"}
          </div>
        </div>

        <section className="space-y-5">
          <section
            className="rounded-xl border border-slate-800 bg-slate-900 p-4"
            data-design-id="coding-workspace-layout-block"
            data-design-label="Workspace layout block"
            data-design-priority="10"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold">Workspace layout</h2>
                <p className="text-xs text-slate-500">Design the coding surface for the way you review rugby: home/away columns, zone keys, density and drag order are saved in this browser.</p>
              </div>
              <button type="button" onClick={resetCodingLayout} className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-bold">Reset layout</button>
            </div>
            <div className="grid gap-3 lg:grid-cols-4">
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Quick code columns</p>
                <div className="flex rounded-lg border border-slate-700 p-1 text-sm">
                  {([2, 3, 4] as LayoutColumnCount[]).map((count) => (
                    <button key={count} type="button" onClick={() => updateCodingLayout({ quickColumns: count })} className={`flex-1 rounded-md px-3 py-1.5 ${codingLayout.quickColumns === count ? "bg-emerald-400 font-bold text-slate-950" : "text-slate-300"}`}>{count}</button>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Mapping columns</p>
                <div className="flex rounded-lg border border-slate-700 p-1 text-sm">
                  {([2, 3, 4] as LayoutColumnCount[]).map((count) => (
                    <button key={count} type="button" onClick={() => updateCodingLayout({ mappingColumns: count })} className={`flex-1 rounded-md px-3 py-1.5 ${codingLayout.mappingColumns === count ? "bg-emerald-400 font-bold text-slate-950" : "text-slate-300"}`}>{count}</button>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Density</p>
                <div className="flex rounded-lg border border-slate-700 p-1 text-sm">
                  {(["comfortable", "compact"] as LayoutDensity[]).map((density) => (
                    <button key={density} type="button" onClick={() => updateCodingLayout({ density })} className={`flex-1 rounded-md px-3 py-1.5 capitalize ${codingLayout.density === density ? "bg-emerald-400 font-bold text-slate-950" : "text-slate-300"}`}>{density}</button>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Drag mode</p>
                <p className="text-sm text-slate-300">Drag column headers or event buttons to reshape the home and away coding matrix.</p>
              </div>
            </div>
          </section>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold">Playback</h2>
                <p className="text-xs text-slate-500">Centered video workspace for live coding.</p>
              </div>
              <div className="flex rounded-lg border border-slate-700 p-1 text-sm">
                {(["standard", "large", "theatre"] as VideoLayoutMode[]).map((mode) => (
                  <button key={mode} type="button" onClick={() => setVideoLayout(mode)} className={`rounded-md px-3 py-1.5 capitalize ${videoLayout === mode ? "bg-emerald-400 font-bold text-slate-950" : "text-slate-300"}`}>{mode}</button>
                ))}
              </div>
            </div>
            <div className={`${videoShellClass} overflow-hidden rounded-xl border border-slate-800 bg-black`}>
              {selectedVideo ? (
                <video
                  key={selectedVideo.id}
                  ref={videoRef}
                  src={sourceVideoUrl(selectedVideo.id)}
                  controls
                  playsInline
                  className="aspect-video w-full bg-black"
                  onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                  onRateChange={(event) => setPlaybackRate(event.currentTarget.playbackRate)}
                  onError={() => setNotice("Source video is unavailable. Free Render storage is temporary and may have been cleared after sleep or redeploy.")}
                />
              ) : <div className="flex aspect-video items-center justify-center text-slate-500">Select a match with uploaded footage.</div>}
            </div>
          </div>

          <section
            className="rounded-xl border border-slate-800 bg-slate-900 p-4"
            data-design-id="coding-quick-matrix-block"
            data-design-label="Quick coding matrix block"
            data-design-priority="15"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold">Quick coding matrix</h2>
                <p className="text-xs text-slate-500">Home uses number keys. Away uses Q-row keys. Zone keys set the active field zone for the next coded events.</p>
              </div>
              <div className="flex rounded-lg border border-slate-700 p-1 text-sm">
                {(["home", "away", "neutral"] as EventTeam[]).map((team) => (
                  <button key={team} type="button" onClick={() => setSelectedTeam(team)} className={`rounded-md px-3 py-1.5 capitalize ${selectedTeam === team ? "bg-emerald-400 font-bold text-slate-950" : "text-slate-300"}`}>
                    {team === "home" ? homeTeam?.name ?? "Home" : team === "away" ? awayTeam?.name ?? "Away" : "Neutral"}
                  </button>
                ))}
              </div>
            </div>

            <div className={`grid gap-3 ${gridColumnsClass(codingLayout.quickColumns)}`}>
              {quickMatrixColumns.map((column, columnIndex) => (
                <div
                  key={column.id}
                  className={`rounded-lg border bg-slate-950 p-3 ${draggingColumnId === column.id ? "border-emerald-400" : "border-slate-800"}`}
                  data-design-id={`coding-quick-${designId(column.id)}-column`}
                  data-design-label={`${column.title} quick column`}
                  data-design-priority={150 + columnIndex}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (draggingColumnId) moveQuickColumn(column.id);
                    else moveShortcutToColumn(column.id);
                  }}
                >
                  <div
                    className="mb-3 flex cursor-grab items-center justify-between gap-2 rounded-md border border-transparent p-1 active:cursor-grabbing hover:border-slate-700"
                    draggable
                    onDragStart={() => setDraggingColumnId(column.id)}
                    onDragEnd={() => setDraggingColumnId(null)}
                  >
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-slate-300">{column.title}</h3>
                      <p className="text-xs text-slate-500">{column.subtitle}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-slate-900 px-2 py-1 text-xs font-bold text-slate-500">{column.items.length}</span>
                      <span className="text-xs text-slate-600">Drag</span>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    {column.items.map((binding) => (
                      <button
                        key={binding.id}
                        type="button"
                        data-design-id={`coding-quick-${designId(binding.id)}-button`}
                        data-design-label={`${binding.label} quick button`}
                        draggable
                        aria-disabled={busy || !selectedVideoId || !binding.eventType}
                        onDragStart={() => setDraggingShortcutId(binding.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          moveShortcutToColumn(column.id, binding.id);
                        }}
                        onDragEnd={() => setDraggingShortcutId(null)}
                        onClick={() => {
                          if (busy || !selectedVideoId || !binding.eventType) {
                            setNotice("Select a source video before coding events. Drag-and-drop layout editing still works.");
                            return;
                          }
                          createEventFromBinding(binding);
                        }}
                        className={`${quickButtonClass} ${busy || !selectedVideoId || !binding.eventType ? "opacity-50" : ""} ${draggingShortcutId === binding.id ? "border-emerald-400 opacity-70" : ""}`}
                      >
                        <kbd data-design-id={`coding-quick-${designId(binding.id)}-key`} data-design-label={`${binding.label} key badge`} className={`min-w-14 rounded border px-2 py-1 text-center text-xs font-bold ${shortcutConflict(binding.shortcut) ? "border-rose-400 text-rose-400" : "border-slate-700 text-emerald-400"}`}>{shortcutLabel(binding.shortcut)}</kbd>
                        <span data-design-id={`coding-quick-${designId(binding.id)}-text`} data-design-label={`${binding.label} quick text`}>
                          <span className="block text-sm font-bold">{displayEventLabel(binding)}</span>
                          <span className="block text-[11px] uppercase tracking-[0.12em] text-slate-500">{binding.fieldZone || categoryLabel(binding.category)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {customEventShortcuts.length ? (
              <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-3">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Custom and neutral keys</h3>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {customEventShortcuts.map((binding) => (
                    <button key={binding.id} type="button" disabled={busy || !selectedVideoId || !binding.eventType} onClick={() => createEventFromBinding(binding)} className="grid grid-cols-[auto_1fr] items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-left hover:border-emerald-400 disabled:opacity-40">
                      <kbd className={`rounded border px-2 py-1 text-xs font-bold ${shortcutConflict(binding.shortcut) ? "border-rose-400 text-rose-400" : "border-slate-700 text-emerald-400"}`}>{shortcutLabel(binding.shortcut)}</kbd>
                      <span className="truncate text-sm font-semibold">{displayEventLabel(binding)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section
            className="rounded-xl border border-slate-800 bg-slate-900 p-4"
            data-design-id="coding-recent-codes-block"
            data-design-label="Recent codes block"
            data-design-priority="18"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold">Recent codes</h2>
                <p className="text-xs text-slate-500">Last timeline events remain visible without stealing the coding workspace.</p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded bg-slate-950 px-3 py-2"><p className="font-bold text-slate-400">Unreviewed</p><p className="text-white">{reviewCounts.unreviewed}</p></div>
                <div className="rounded bg-slate-950 px-3 py-2"><p className="font-bold text-emerald-400">Confirmed</p><p className="text-white">{reviewCounts.confirmed}</p></div>
                <div className="rounded bg-slate-950 px-3 py-2"><p className="font-bold text-amber-300">Flagged</p><p className="text-white">{reviewCounts.flagged}</p></div>
              </div>
            </div>
            <div
              className="grid gap-2 lg:grid-cols-5"
              data-design-id="coding-recent-codes-list"
              data-design-label="Recent codes list"
              data-design-priority="180"
            >
              {recentEvents.map((item) => {
                const review = reviewForEvent(item);
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-design-id={`coding-recent-event-${item.id}`}
                    data-design-label={`${eventLabel(item)} recent code card`}
                    onClick={() => { setSelectedEventId(item.id); seekTo(item.start_seconds); }}
                    className={`rounded-lg border bg-slate-950 p-3 text-left hover:border-emerald-400 ${selectedEventId === item.id ? "border-emerald-400" : "border-slate-800"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-emerald-400">{formatTime(item.start_seconds)}</span>
                      <span className="rounded bg-slate-800 px-2 py-1 text-[11px] capitalize text-slate-300">{teamLabel(item.team)}</span>
                    </div>
                    <p className="mt-2 truncate text-sm font-bold capitalize">{eventLabel(item)}</p>
                    <p className={`mt-2 text-[11px] font-bold uppercase tracking-[0.12em] ${review.status === "confirmed" ? "text-emerald-300" : review.status === "flagged" ? "text-amber-300" : "text-slate-500"}`}>{review.status}</p>
                  </button>
                );
              })}
              {!recentEvents.length && <div className="rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500 lg:col-span-5">Play the video and use the quick-code matrix to build the timeline.</div>}
            </div>
            {events.length ? (
              <div
                className="mt-3 grid gap-2 md:grid-cols-4 xl:grid-cols-8"
                data-design-id="coding-recent-counts-grid"
                data-design-label="Recent code counts grid"
                data-design-priority="181"
              >
                {Object.entries(eventCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([type, count]) => (
                  <div key={type} className="rounded-lg bg-slate-950 p-3" data-design-id={`coding-recent-count-${designId(type)}`} data-design-label={`${type} count card`}>
                    <p className="truncate text-xs capitalize text-slate-500">{type}</p>
                    <p className="mt-1 text-xl font-bold">{count}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <form
            onSubmit={submitCustomEvent}
            className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 md:grid-cols-2 xl:grid-cols-7"
            data-design-id="coding-manual-event-block"
            data-design-label="Manual event block"
            data-design-priority="20"
          >
            <div className="md:col-span-2 xl:col-span-7">
              <h2 className="font-bold">Manual event at {formatTime(currentTime)}</h2>
              <p className="mt-1 text-xs text-slate-500">Use this when the rugby action needs a one-off detail that is not mapped yet.</p>
            </div>
            <select name="event_type" className={inputClass} defaultValue="custom" data-design-id="coding-manual-event-type" data-design-label="Manual event type field">{EVENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select>
            <input name="outcome" placeholder="Outcome" className={inputClass} data-design-id="coding-manual-outcome" data-design-label="Manual outcome field" />
            <input name="field_zone" placeholder="Field zone" className={inputClass} data-design-id="coding-manual-zone" data-design-label="Manual field zone field" />
            <input name="phase_number" type="number" min="1" placeholder="Phase" className={inputClass} data-design-id="coding-manual-phase" data-design-label="Manual phase field" />
            <input name="duration" type="number" min="1" max="300" defaultValue="8" className={inputClass} data-design-id="coding-manual-duration" data-design-label="Manual duration field" />
            <textarea name="notes" placeholder="Analyst notes" className={`${inputClass} md:col-span-2 xl:col-span-1`} data-design-id="coding-manual-notes" data-design-label="Manual notes field" />
            <button type="submit" disabled={busy || !selectedVideoId} className="rounded-lg bg-emerald-400 px-4 py-2 font-bold text-slate-950 disabled:opacity-40" data-design-id="coding-manual-add-button" data-design-label="Manual add event button">Add event</button>
          </form>

          <section
            className="rounded-xl border border-slate-800 bg-slate-900 p-4"
            data-design-id="coding-keyboard-mapping-block"
            data-design-label="Keyboard mapping block"
            data-design-priority="30"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold">Keyboard mapping</h2>
                <p className="text-xs text-slate-500">This replaces the old quick-code library. Edit event names, outcomes and keys from the mapping itself. Playback is {playbackRate}x.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={resetShortcuts} className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-bold">Reset defaults</button>
              </div>
            </div>

            <form onSubmit={submitLibraryEvent} className="mb-4 grid gap-3 rounded-lg border border-slate-800 bg-slate-950 p-3 md:grid-cols-2 xl:grid-cols-7" data-design-id="coding-keyboard-add-event-form" data-design-label="Keyboard add event form" data-design-priority="300">
              <input name="label" placeholder="New event name" className={`${inputClass} xl:col-span-2`} data-design-id="coding-keyboard-add-label" data-design-label="Keyboard add event name field" />
              <select name="category" className={inputClass} defaultValue="attack" data-design-id="coding-keyboard-add-category" data-design-label="Keyboard add category field">{EVENT_LIBRARY_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select>
              <select name="team" className={inputClass} defaultValue="selected" data-design-id="coding-keyboard-add-team" data-design-label="Keyboard add team field">
                <option value="selected">Selected team</option>
                <option value="home">{homeTeam?.name ?? "Home"}</option>
                <option value="away">{awayTeam?.name ?? "Away"}</option>
                <option value="neutral">Neutral</option>
              </select>
              <input name="shortcut" placeholder="Key code e.g. KeyA" className={inputClass} data-design-id="coding-keyboard-add-shortcut" data-design-label="Keyboard add shortcut field" />
              <input name="duration" type="number" min="1" max="300" defaultValue="8" className={inputClass} data-design-id="coding-keyboard-add-duration" data-design-label="Keyboard add duration field" />
              <button type="submit" className="rounded-lg bg-emerald-400 px-4 py-2 font-bold text-slate-950" data-design-id="coding-keyboard-add-button" data-design-label="Keyboard add event button">Add event</button>
              <input name="field_zone" placeholder="Default zone" className={inputClass} data-design-id="coding-keyboard-add-zone" data-design-label="Keyboard add zone field" />
              <textarea name="notes" placeholder="Default note" className={`${inputClass} md:col-span-2 xl:col-span-6`} data-design-id="coding-keyboard-add-notes" data-design-label="Keyboard add notes field" />
            </form>

            <div className={`grid gap-4 ${gridColumnsClass(codingLayout.mappingColumns)}`} data-design-id="coding-keyboard-mapping-grid" data-design-label="Keyboard mapping grid" data-design-priority="310">
              {mappingColumns.map((column, columnIndex) => (
                <div key={column.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3" data-design-id={`coding-keyboard-${designId(column.id)}-column`} data-design-label={`${column.title} mapping column`} data-design-priority={320 + columnIndex}>
                  <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{column.title}</h3>
                  <div className="grid gap-2">
                    {column.items.map((binding) => (
                      <div key={binding.id} className={mappingCardClass} data-design-id={`coding-keyboard-${designId(binding.id)}-card`} data-design-label={`${binding.label} mapping card`}>
                        <div className="mb-2 flex items-center justify-between gap-2" data-design-id={`coding-keyboard-${designId(binding.id)}-header`} data-design-label={`${binding.label} mapping header`}>
                          <input value={binding.label} onChange={(event) => updateLibraryEvent(binding.id, { label: event.target.value, outcome: binding.custom ? event.target.value : binding.outcome })} className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm font-semibold text-white outline-none focus:border-emerald-400" aria-label={`${binding.label} name`} data-design-id={`coding-keyboard-${designId(binding.id)}-name`} data-design-label={`${binding.label} name field`} />
                          <kbd className={`rounded border px-2 py-1 text-xs font-bold ${shortcutConflict(binding.shortcut) ? "border-rose-400 text-rose-400" : "border-slate-700 text-emerald-400"}`} data-design-id={`coding-keyboard-${designId(binding.id)}-key`} data-design-label={`${binding.label} key badge`}>{editingShortcutId === binding.id ? "Hold + key" : shortcutLabel(binding.shortcut)}</kbd>
                        </div>
                        <div className="grid grid-cols-2 gap-2" data-design-id={`coding-keyboard-${designId(binding.id)}-fields`} data-design-label={`${binding.label} fields grid`}>
                          <select value={binding.eventType ?? "custom"} onChange={(event) => updateLibraryEvent(binding.id, { eventType: event.target.value as EventType })} className={inputClass} aria-label={`${binding.label} event type`} data-design-id={`coding-keyboard-${designId(binding.id)}-type`} data-design-label={`${binding.label} event type field`}>{EVENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select>
                          <select value={binding.category ?? "attack"} onChange={(event) => updateLibraryEvent(binding.id, { category: event.target.value as EventCategory })} className={inputClass} aria-label={`${binding.label} category`} data-design-id={`coding-keyboard-${designId(binding.id)}-category`} data-design-label={`${binding.label} category field`}>{EVENT_LIBRARY_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select>
                          <select value={binding.team ?? "selected"} onChange={(event) => updateLibraryEvent(binding.id, { team: event.target.value as ShortcutBinding["team"] })} className={inputClass} aria-label={`${binding.label} team target`} data-design-id={`coding-keyboard-${designId(binding.id)}-team`} data-design-label={`${binding.label} team field`}>
                            <option value="selected">Selected</option>
                            <option value="home">{homeTeam?.name ?? "Home"}</option>
                            <option value="away">{awayTeam?.name ?? "Away"}</option>
                            <option value="neutral">Neutral</option>
                          </select>
                          <input type="number" min="1" max="300" value={binding.duration ?? 8} onChange={(event) => updateLibraryEvent(binding.id, { duration: Number(event.target.value || 8) })} className={inputClass} aria-label={`${binding.label} duration`} data-design-id={`coding-keyboard-${designId(binding.id)}-duration`} data-design-label={`${binding.label} duration field`} />
                          <input value={binding.outcome ?? ""} onChange={(event) => updateLibraryEvent(binding.id, { outcome: event.target.value })} placeholder="Outcome" className={`${inputClass} col-span-2`} aria-label={`${binding.label} outcome`} data-design-id={`coding-keyboard-${designId(binding.id)}-outcome`} data-design-label={`${binding.label} outcome field`} />
                          <input value={binding.fieldZone ?? ""} onChange={(event) => updateLibraryEvent(binding.id, { fieldZone: event.target.value })} placeholder="Zone" className={inputClass} aria-label={`${binding.label} field zone`} data-design-id={`coding-keyboard-${designId(binding.id)}-zone`} data-design-label={`${binding.label} zone field`} />
                          <button type="button" onClick={() => setEditingShortcutId(binding.id)} className="rounded border border-slate-700 px-3 py-2 text-sm font-bold" data-design-id={`coding-keyboard-${designId(binding.id)}-change-key`} data-design-label={`${binding.label} change key button`}>Change key</button>
                        </div>
                        <input value={binding.notes ?? ""} onChange={(event) => updateLibraryEvent(binding.id, { notes: event.target.value })} placeholder="Default note" className={`${inputClass} mt-2`} aria-label={`${binding.label} note`} data-design-id={`coding-keyboard-${designId(binding.id)}-note`} data-design-label={`${binding.label} note field`} />
                        {binding.custom && <button type="button" onClick={() => deleteLibraryEvent(binding.id)} className="mt-2 w-full rounded border border-rose-900 px-3 py-2 text-sm font-bold text-rose-300" data-design-id={`coding-keyboard-${designId(binding.id)}-delete`} data-design-label={`${binding.label} delete custom button`}>Delete custom event</button>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div
              className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3"
              data-design-id="coding-zone-mapping-block"
              data-design-label="Zone keyboard mapping block"
              data-design-priority="35"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Zone keys</h3>
                  <p className="mt-1 text-xs text-slate-500">Press a zone key to set where the next coded events happened. Zone names, keys and length descriptions are editable.</p>
                </div>
                <button type="button" onClick={() => setActiveZoneId(null)} className="rounded border border-slate-700 px-3 py-2 text-xs font-bold">Clear active zone</button>
              </div>

              <form onSubmit={submitZoneShortcut} className="mb-3 grid gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3 md:grid-cols-2 xl:grid-cols-6" data-design-id="coding-zone-add-form" data-design-label="Add zone key form">
                <input name="label" placeholder="Zone name" className={`${inputClass} xl:col-span-2`} data-design-id="coding-zone-add-label" data-design-label="Add zone name field" />
                <input name="field_zone" placeholder="Saved zone label" className={inputClass} data-design-id="coding-zone-add-field-zone" data-design-label="Add saved zone field" />
                <input name="zone_length" placeholder="Zone length e.g. inside 22m" className={inputClass} data-design-id="coding-zone-add-length" data-design-label="Add zone length field" />
                <input name="shortcut" placeholder="Key code e.g. KeyL" className={inputClass} data-design-id="coding-zone-add-shortcut" data-design-label="Add zone key field" />
                <button type="submit" className="rounded-lg bg-emerald-400 px-4 py-2 font-bold text-slate-950" data-design-id="coding-zone-add-button" data-design-label="Add zone key button">Add zone</button>
                <textarea name="notes" placeholder="Zone notes" className={`${inputClass} md:col-span-2 xl:col-span-6`} data-design-id="coding-zone-add-notes" data-design-label="Add zone notes field" />
              </form>

              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4" data-design-id="coding-zone-mapping-grid" data-design-label="Zone keyboard grid">
                {zoneShortcuts.map((binding) => (
                  <div key={binding.id} className={`rounded-lg border bg-slate-900 p-3 ${activeZoneId === binding.id ? "border-emerald-400" : "border-slate-800"}`} data-design-id={`coding-zone-${designId(binding.id)}-card`} data-design-label={`${binding.label} zone card`}>
                    <div className="mb-2 flex items-center justify-between gap-2" data-design-id={`coding-zone-${designId(binding.id)}-header`} data-design-label={`${binding.label} zone header`}>
                      <input value={binding.label} onChange={(event) => updateLibraryEvent(binding.id, { label: event.target.value })} className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm font-semibold text-white outline-none focus:border-emerald-400" aria-label={`${binding.label} zone name`} data-design-id={`coding-zone-${designId(binding.id)}-name`} data-design-label={`${binding.label} zone name field`} />
                      <kbd className={`rounded border px-2 py-1 text-xs font-bold ${shortcutConflict(binding.shortcut) ? "border-rose-400 text-rose-400" : "border-slate-700 text-emerald-400"}`} data-design-id={`coding-zone-${designId(binding.id)}-key`} data-design-label={`${binding.label} zone key badge`}>{editingShortcutId === binding.id ? "Hold + key" : shortcutLabel(binding.shortcut)}</kbd>
                    </div>
                    <div className="grid gap-2" data-design-id={`coding-zone-${designId(binding.id)}-fields`} data-design-label={`${binding.label} zone fields`}>
                      <input value={binding.fieldZone ?? ""} onChange={(event) => updateLibraryEvent(binding.id, { fieldZone: event.target.value })} placeholder="Saved zone label" className={inputClass} aria-label={`${binding.label} saved zone`} data-design-id={`coding-zone-${designId(binding.id)}-field-zone`} data-design-label={`${binding.label} saved zone field`} />
                      <input value={binding.zoneLength ?? ""} onChange={(event) => updateLibraryEvent(binding.id, { zoneLength: event.target.value })} placeholder="Zone length" className={inputClass} aria-label={`${binding.label} zone length`} data-design-id={`coding-zone-${designId(binding.id)}-length`} data-design-label={`${binding.label} zone length field`} />
                      <input value={binding.notes ?? ""} onChange={(event) => updateLibraryEvent(binding.id, { notes: event.target.value })} placeholder="Zone notes" className={inputClass} aria-label={`${binding.label} zone notes`} data-design-id={`coding-zone-${designId(binding.id)}-notes`} data-design-label={`${binding.label} zone notes field`} />
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setActiveZoneId(binding.id)} className="rounded border border-slate-700 px-3 py-2 text-sm font-bold" data-design-id={`coding-zone-${designId(binding.id)}-activate`} data-design-label={`${binding.label} activate zone button`}>Use zone</button>
                        <button type="button" onClick={() => setEditingShortcutId(binding.id)} className="rounded border border-slate-700 px-3 py-2 text-sm font-bold" data-design-id={`coding-zone-${designId(binding.id)}-change-key`} data-design-label={`${binding.label} change zone key button`}>Change key</button>
                      </div>
                      {binding.custom && <button type="button" onClick={() => deleteLibraryEvent(binding.id)} className="rounded border border-rose-900 px-3 py-2 text-sm font-bold text-rose-300" data-design-id={`coding-zone-${designId(binding.id)}-delete`} data-design-label={`${binding.label} delete zone button`}>Delete zone</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3"
              data-design-id="coding-video-controls-block"
              data-design-label="Video controls block"
              data-design-priority="40"
            >
              <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Video controls</h3>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4" data-design-id="coding-video-controls-grid" data-design-label="Video controls grid" data-design-priority="410">
                {videoShortcuts.map((binding) => (
                  <div key={binding.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3" data-design-id={`coding-video-control-${designId(binding.id)}-row`} data-design-label={`${binding.label} video control row`}>
                    <span className="text-sm font-semibold" data-design-id={`coding-video-control-${designId(binding.id)}-label`} data-design-label={`${binding.label} video control label`}>{binding.label}</span>
                    <kbd className={`rounded border px-2 py-1 text-xs font-bold ${shortcutConflict(binding.shortcut) ? "border-rose-400 text-rose-400" : "border-slate-700 text-emerald-400"}`} data-design-id={`coding-video-control-${designId(binding.id)}-key`} data-design-label={`${binding.label} video key badge`}>{editingShortcutId === binding.id ? "Hold + key" : shortcutLabel(binding.shortcut)}</kbd>
                    <button type="button" onClick={() => setEditingShortcutId(binding.id)} className="rounded border border-slate-700 px-2 py-1 text-xs font-bold" data-design-id={`coding-video-control-${designId(binding.id)}-change`} data-design-label={`${binding.label} change button`}>Change</button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section
            className="rounded-xl border border-slate-800 bg-slate-900 p-4"
            data-design-id="coding-timeline-cleanup-block"
            data-design-label="Timeline cleanup block"
            data-design-priority="50"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold">Timeline cleanup</h2>
                <p className="text-xs text-slate-500">Compact review controls for deleting, confirming and editing events after the live coding pass.</p>
              </div>
              <span className="rounded bg-slate-950 px-2 py-1 text-xs font-bold text-emerald-400">{filteredEvents.length}/{events.length}</span>
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-7" data-design-id="coding-timeline-filter-grid" data-design-label="Timeline filter grid" data-design-priority="510">
              <input value={timelineSearch} onChange={(event) => setTimelineSearch(event.target.value)} placeholder="Search event, note, zone or phase" className={`${inputClass} xl:col-span-2`} data-design-id="coding-timeline-search" data-design-label="Timeline search field" />
              <select value={timelineTeamFilter} onChange={(event) => setTimelineTeamFilter(event.target.value as EventTeam | "all")} className={inputClass} data-design-id="coding-timeline-team-filter" data-design-label="Timeline team filter">
                <option value="all">All teams</option>
                <option value="home">{homeTeam?.name ?? "Home"}</option>
                <option value="away">{awayTeam?.name ?? "Away"}</option>
                <option value="neutral">Neutral</option>
              </select>
              <select value={timelineTypeFilter} onChange={(event) => setTimelineTypeFilter(event.target.value as EventType | "all")} className={inputClass} data-design-id="coding-timeline-type-filter" data-design-label="Timeline type filter">
                <option value="all">All event types</option>
                {EVENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <select value={timelineReviewFilter} onChange={(event) => setTimelineReviewFilter(event.target.value as ReviewStatus | "all")} className={inputClass} data-design-id="coding-timeline-review-filter" data-design-label="Timeline review filter">
                <option value="all">All review states</option>
                {REVIEW_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
              </select>
              <button type="button" onClick={markFilteredReviewed} disabled={!filteredEvents.length} className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-bold disabled:opacity-40" data-design-id="coding-timeline-confirm-filtered" data-design-label="Timeline confirm filtered button">Confirm filtered</button>
              <button type="button" onClick={() => void deleteTimelineEvents(filteredEvents, `${filteredEvents.length} filtered timeline event${filteredEvents.length === 1 ? "" : "s"}`)} disabled={busy || !filteredEvents.length} className="rounded-lg border border-rose-900 px-3 py-2 text-sm font-bold text-rose-300 disabled:opacity-40" data-design-id="coding-timeline-delete-filtered" data-design-label="Timeline delete filtered button">Delete filtered</button>
              <select value={timelineCategoryFilter} onChange={(event) => setTimelineCategoryFilter(event.target.value as EventCategory | "all")} className={inputClass} data-design-id="coding-timeline-category-filter" data-design-label="Timeline category filter">
                <option value="all">All categories</option>
                {EVENT_LIBRARY_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
              </select>
              <select value={timelineSourceFilter} onChange={(event) => setTimelineSourceFilter(event.target.value as EventSource | "all")} className={inputClass} data-design-id="coding-timeline-source-filter" data-design-label="Timeline source filter">
                <option value="all">All sources</option>
                {EVENT_SOURCES.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}
              </select>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5" data-design-id="coding-timeline-event-grid" data-design-label="Timeline event grid" data-design-priority="520">
              {filteredEvents.slice(0, 20).map((item) => {
                const review = reviewForEvent(item);
                return (
                  <button key={item.id} type="button" data-design-id={`coding-timeline-event-${item.id}`} data-design-label={`${eventLabel(item)} timeline card`} onClick={() => { setSelectedEventId(item.id); seekTo(item.start_seconds); }} className={`rounded-lg border bg-slate-950 p-3 text-left hover:border-emerald-400 ${selectedEventId === item.id ? "border-emerald-400" : "border-slate-800"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs text-emerald-400">{formatTime(item.start_seconds)}</span>
                      <span className="rounded bg-slate-800 px-2 py-1 text-[11px] capitalize">{item.team}</span>
                    </div>
                    <p className="mt-2 truncate text-sm font-bold capitalize">{eventLabel(item)}</p>
                    <div className="mt-2 flex flex-wrap gap-1 text-[11px] font-bold uppercase tracking-[0.12em]">
                      <span className="rounded bg-slate-900 px-2 py-1 text-slate-400">{categoryLabel(eventCategory(item))}</span>
                      <span className={`rounded px-2 py-1 ${review.status === "confirmed" ? "bg-emerald-950 text-emerald-300" : review.status === "flagged" ? "bg-amber-950 text-amber-300" : "bg-slate-900 text-slate-400"}`}>{review.status}</span>
                      {item.clip_requested && <span className="rounded bg-sky-950 px-2 py-1 text-sky-300">clip</span>}
                    </div>
                  </button>
                );
              })}
              {!events.length && <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-5">Play the video and use the quick-code matrix to build the timeline.</div>}
              {Boolean(events.length && !filteredEvents.length) && <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-5">No events match the current review filters.</div>}
            </div>

            {selectedEvent ? (
              <form onSubmit={submitEventEdit} className="mt-4 grid gap-3 rounded-lg border border-slate-800 bg-slate-950 p-3 md:grid-cols-2 xl:grid-cols-8" data-design-id="coding-timeline-selected-editor" data-design-label="Selected timeline event editor" data-design-priority="530">
                <div className="md:col-span-2 xl:col-span-8 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-bold">Edit selected event #{selectedEvent.id}</h3>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => seekTo(selectedEvent.start_seconds)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-bold">Play</button>
                    <button type="button" onClick={() => void toggleClipRequest(selectedEvent)} disabled={busy} className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-bold disabled:opacity-40">{selectedEvent.clip_requested ? "Queued" : "Clip queue"}</button>
                    <button type="button" onClick={() => void deleteTimelineEvents([selectedEvent], `${eventLabel(selectedEvent)} at ${formatTime(selectedEvent.start_seconds)}`)} disabled={busy} className="rounded-lg border border-rose-900 px-3 py-2 text-sm font-bold text-rose-300 disabled:opacity-40">Delete</button>
                  </div>
                </div>
                <select key={`type-${selectedEvent.id}`} name="event_type" defaultValue={selectedEvent.event_type} className={inputClass}>{EVENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select>
                <select key={`team-${selectedEvent.id}`} name="team" defaultValue={selectedEvent.team} className={inputClass}><option value="home">{homeTeam?.name ?? "Home"}</option><option value="away">{awayTeam?.name ?? "Away"}</option><option value="neutral">Neutral</option></select>
                <input key={`start-${selectedEvent.id}`} name="start_seconds" type="number" min="0" step="0.1" defaultValue={selectedEvent.start_seconds} className={inputClass} />
                <input key={`end-${selectedEvent.id}`} name="end_seconds" type="number" min="0.1" step="0.1" defaultValue={selectedEvent.end_seconds} className={inputClass} />
                <input key={`outcome-${selectedEvent.id}`} name="outcome" placeholder="Outcome or detail" defaultValue={selectedEvent.outcome ?? ""} className={inputClass} />
                <input key={`zone-${selectedEvent.id}`} name="field_zone" placeholder="Field zone" defaultValue={selectedEvent.field_zone ?? ""} className={inputClass} />
                <input key={`phase-${selectedEvent.id}`} name="phase_number" type="number" min="1" placeholder="Phase" defaultValue={selectedEvent.phase_number ?? ""} className={inputClass} />
                <button type="submit" disabled={busy} className="rounded-lg bg-emerald-400 px-4 py-2 font-bold text-slate-950 disabled:opacity-40">Save</button>
                <textarea key={`notes-${selectedEvent.id}`} name="notes" placeholder="Analyst notes" defaultValue={selectedEvent.notes ?? ""} className={`${inputClass} md:col-span-2 xl:col-span-4`} />
                <select value={selectedReview?.status ?? "unreviewed"} onChange={(event) => updateReview(selectedEvent.id, { status: event.target.value as ReviewStatus })} className={inputClass} aria-label="Review status">{REVIEW_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select>
                <select value={selectedReview?.source ?? "manual"} onChange={(event) => updateReview(selectedEvent.id, { source: event.target.value as EventSource })} className={inputClass} aria-label="Event source">{EVENT_SOURCES.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}</select>
                <input type="number" min="0" max="100" value={selectedReview?.confidence ?? 100} onChange={(event) => updateReview(selectedEvent.id, { confidence: Number(event.target.value || 0) })} className={inputClass} aria-label="Confidence percent" />
                <button type="button" onClick={() => updateReview(selectedEvent.id, { status: "confirmed" })} className="rounded-lg border border-emerald-900 px-3 py-2 text-sm font-bold text-emerald-300">Confirm</button>
              </form>
            ) : null}
          </section>
        </section>
      </div>
    </main>
  );
}
