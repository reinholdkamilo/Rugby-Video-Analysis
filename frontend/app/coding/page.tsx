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

type ShortcutBinding = {
  id: string;
  label: string;
  group: "event" | "video";
  shortcut: string;
  eventType?: EventType;
  duration?: number;
  category?: EventCategory;
  outcome?: string;
  fieldZone?: string;
  notes?: string;
  custom?: boolean;
  command?: VideoCommand;
};

const SHORTCUT_STORAGE_KEY = "rugby-video-analysis:coding-shortcuts:v1";

const EVENT_LIBRARY_CATEGORIES: { value: EventCategory; label: string }[] = [
  { value: "attack", label: "Attack" },
  { value: "defence", label: "Defence" },
  { value: "set_piece", label: "Set piece" },
  { value: "discipline", label: "Discipline" },
  { value: "transition", label: "Transition" },
  { value: "kicking", label: "Kicking" },
  { value: "possession", label: "Possession" },
  { value: "core", label: "Core" },
];

const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  { id: "tag_blank", label: "Blank event", group: "event", shortcut: "KeyB", eventType: "custom", duration: 8, category: "core" },
  { id: "tag_carry", label: "Carry", group: "event", shortcut: "Digit1", eventType: "carry", duration: 6, category: "attack" },
  { id: "tag_tackle", label: "Tackle", group: "event", shortcut: "Digit2", eventType: "tackle", duration: 5, category: "defence" },
  { id: "tag_ruck", label: "Ruck", group: "event", shortcut: "Digit3", eventType: "ruck", duration: 6, category: "possession" },
  { id: "tag_pass", label: "Pass", group: "event", shortcut: "Digit4", eventType: "pass", duration: 4, category: "attack" },
  { id: "tag_kick", label: "Kick", group: "event", shortcut: "Digit5", eventType: "kick", duration: 8, category: "kicking" },
  { id: "tag_lineout", label: "Lineout", group: "event", shortcut: "Digit6", eventType: "lineout", duration: 18, category: "set_piece" },
  { id: "tag_scrum", label: "Scrum", group: "event", shortcut: "Digit7", eventType: "scrum", duration: 22, category: "set_piece" },
  { id: "tag_penalty", label: "Penalty", group: "event", shortcut: "Digit8", eventType: "penalty", duration: 8, category: "discipline" },
  { id: "tag_try", label: "Try", group: "event", shortcut: "Digit9", eventType: "try", duration: 12, category: "attack" },
  { id: "tag_turnover", label: "Turnover", group: "event", shortcut: "KeyO", eventType: "turnover", duration: 8, category: "transition" },
  { id: "tag_maul", label: "Maul", group: "event", shortcut: "KeyM", eventType: "maul", duration: 10, category: "set_piece" },
  { id: "tag_stoppage", label: "Stoppage", group: "event", shortcut: "KeyX", eventType: "stoppage", duration: 10, category: "core" },
  { id: "video_play_pause", label: "Play / pause", group: "video", shortcut: "Space", command: "play_pause" },
  { id: "video_back_5", label: "Back 5 seconds", group: "video", shortcut: "ArrowLeft", command: "seek_back_5" },
  { id: "video_forward_5", label: "Forward 5 seconds", group: "video", shortcut: "ArrowRight", command: "seek_forward_5" },
  { id: "video_back_10", label: "Back 10 seconds", group: "video", shortcut: "Shift+ArrowLeft", command: "seek_back_10" },
  { id: "video_forward_10", label: "Forward 10 seconds", group: "video", shortcut: "Shift+ArrowRight", command: "seek_forward_10" },
  { id: "video_back_5m", label: "Back 5 minutes", group: "video", shortcut: "Alt+ArrowLeft", command: "seek_back_5m" },
  { id: "video_forward_5m", label: "Forward 5 minutes", group: "video", shortcut: "Alt+ArrowRight", command: "seek_forward_5m" },
  { id: "video_back_10m", label: "Back 10 minutes", group: "video", shortcut: "Alt+Shift+ArrowLeft", command: "seek_back_10m" },
  { id: "video_forward_10m", label: "Forward 10 minutes", group: "video", shortcut: "Alt+Shift+ArrowRight", command: "seek_forward_10m" },
  { id: "video_step_back", label: "Step back", group: "video", shortcut: "Comma", command: "step_back" },
  { id: "video_step_forward", label: "Step forward", group: "video", shortcut: "Period", command: "step_forward" },
  { id: "video_speed_down", label: "Decrease speed", group: "video", shortcut: "BracketLeft", command: "speed_down" },
  { id: "video_speed_up", label: "Increase speed", group: "video", shortcut: "BracketRight", command: "speed_up" },
  { id: "video_speed_quarter", label: "Set speed 0.25x", group: "video", shortcut: "Shift+Digit1", command: "speed_quarter" },
  { id: "video_speed_half", label: "Set speed 0.5x", group: "video", shortcut: "Shift+Digit2", command: "speed_half" },
  { id: "video_speed_normal", label: "Set speed 1x", group: "video", shortcut: "Shift+Digit3", command: "speed_normal" },
  { id: "video_speed_double", label: "Set speed 2x", group: "video", shortcut: "Shift+Digit4", command: "speed_double" },
];

const inputClass = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400";

function formatTime(seconds: number) {
  const value = Math.max(0, seconds || 0);
  const minutes = Math.floor(value / 60);
  const remaining = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function normaliseShortcut(shortcut: string) {
  return shortcut.split("+").filter(Boolean).join("+");
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
    .replace("Digit", "")
    .replace("Key", "")
    .replace("ArrowLeft", "Left")
    .replace("ArrowRight", "Right")
    .replace("BracketLeft", "[")
    .replace("BracketRight", "]")
    .replace("Comma", ",")
    .replace("Period", ".")
    .replace("Space", "Space");
}

function shortcutEditable(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  return target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT" || target?.isContentEditable;
}

function loadShortcutBindings() {
  if (typeof window === "undefined") return DEFAULT_SHORTCUTS;
  const saved = window.localStorage.getItem(SHORTCUT_STORAGE_KEY);
  if (!saved) return DEFAULT_SHORTCUTS;
  try {
    const parsed = JSON.parse(saved) as Partial<ShortcutBinding>[];
    const defaults = DEFAULT_SHORTCUTS.map((binding) => ({
      ...binding,
      shortcut: parsed.find((item) => item.id === binding.id)?.shortcut || binding.shortcut,
    }));
    const custom = parsed
      .filter((item) => item.custom && item.id && item.label && item.shortcut)
      .map((item) => ({
        id: String(item.id),
        label: String(item.label),
        group: "event" as const,
        shortcut: String(item.shortcut),
        eventType: "custom" as EventType,
        duration: Number(item.duration || 8),
        category: (item.category as EventCategory) || "attack",
        outcome: item.outcome ? String(item.outcome) : String(item.label),
        fieldZone: item.fieldZone ? String(item.fieldZone) : undefined,
        notes: item.notes ? String(item.notes) : undefined,
        custom: true,
      }));
    return [...defaults, ...custom];
  } catch {
    return DEFAULT_SHORTCUTS;
  }
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
  const [notice, setNotice] = useState("Loading coding workspace...");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setShortcuts(loadShortcutBindings());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(shortcuts.map(({ id, shortcut, custom, label, duration, category, outcome, fieldZone, notes }) => (
      custom ? { id, shortcut, custom, label, duration, category, outcome, fieldZone, notes } : { id, shortcut }
    ))));
  }, [shortcuts]);

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

  const eventCounts = useMemo(() => {
    return events.reduce<Record<string, number>>((counts, event) => {
      counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
      return counts;
    }, {});
  }, [events]);

  const eventShortcuts = useMemo(() => shortcuts.filter((shortcut) => shortcut.group === "event"), [shortcuts]);
  const videoShortcuts = useMemo(() => shortcuts.filter((shortcut) => shortcut.group === "video"), [shortcuts]);

  const shortcutConflict = useMemo(() => {
    const counts = shortcuts.reduce<Record<string, number>>((items, shortcut) => {
      items[shortcut.shortcut] = (items[shortcut.shortcut] ?? 0) + 1;
      return items;
    }, {});
    return (shortcut: string) => counts[shortcut] > 1;
  }, [shortcuts]);

  const createEvent = useCallback(async (type: EventType, duration = 8, extras?: { notes?: string; outcome?: string; phaseNumber?: number | null; fieldZone?: string; label?: string }) => {
    if (!selectedMatchId || !selectedVideoId) return;
    const start = Math.max(0, videoRef.current?.currentTime ?? currentTime);
    const end = Math.min(videoRef.current?.duration || start + duration, start + duration);
    setBusy(true);
    try {
      const created = await codingApi.createEvent({
        match_id: selectedMatchId,
        video_asset_id: selectedVideoId,
        event_type: type,
        team: selectedTeam,
        start_seconds: Number(start.toFixed(2)),
        end_seconds: Number(Math.max(start + 0.5, end).toFixed(2)),
        player_name: null,
        outcome: extras?.outcome || null,
        notes: extras?.notes || null,
        phase_number: extras?.phaseNumber ?? null,
        field_zone: extras?.fieldZone || null,
        clip_requested: false,
      });
      setEvents((current) => [...current, created].sort((a, b) => a.start_seconds - b.start_seconds));
      setSelectedEventId(created.id);
      setNotice(type === "custom" ? `${extras?.label || extras?.outcome || "Blank event"} created at ${formatTime(start)}. Edit it in the timeline panel.` : `${type} coded at ${formatTime(start)} for ${selectedTeam}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to create event");
    } finally {
      setBusy(false);
    }
  }, [currentTime, selectedMatchId, selectedTeam, selectedVideoId]);

  const createEventFromBinding = useCallback((binding: ShortcutBinding) => {
    if (!binding.eventType) return;
    void createEvent(binding.eventType, binding.duration, {
      outcome: binding.outcome || (binding.custom ? binding.label : undefined),
      notes: binding.notes,
      fieldZone: binding.fieldZone,
      label: binding.label,
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
      updateShortcut(editingShortcutId, shortcutFromKeyboardEvent(event));
    };
    window.addEventListener("keydown", onCapture, true);
    return () => window.removeEventListener("keydown", onCapture, true);
  }, [editingShortcutId, updateShortcut]);

  function resetShortcuts() {
    setShortcuts(DEFAULT_SHORTCUTS);
    setEditingShortcutId(null);
    setNotice("Keyboard shortcuts and custom library events reset to defaults.");
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
      fieldZone: String(form.get("field_zone") || "").trim() || undefined,
      notes: String(form.get("notes") || "").trim() || undefined,
      custom: true,
    };
    setShortcuts((current) => [...current, binding]);
    setNotice(`${label} added to the coding event library.`);
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
    setNotice(`${binding?.label ?? "Custom event"} removed from the coding event library.`);
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
      setNotice(`${updated.event_type} updated at ${formatTime(updated.start_seconds)}.`);
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

        <div className="mb-5 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-300">{notice}</div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_minmax(360px,1fr)]">
          <section className="space-y-5">
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-black">
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

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="font-bold">Quick coding</h2><p className="text-xs text-slate-500">Use your mapped keys to tag team-level events at the current video time.</p></div>
                <div className="flex rounded-lg border border-slate-700 p-1 text-sm">
                  {(["home", "away", "neutral"] as EventTeam[]).map((team) => <button key={team} type="button" onClick={() => setSelectedTeam(team)} className={`rounded-md px-3 py-1.5 capitalize ${selectedTeam === team ? "bg-emerald-400 font-bold text-slate-950" : "text-slate-300"}`}>{team === "home" ? homeTeam?.name ?? "Home" : team === "away" ? awayTeam?.name ?? "Away" : "Neutral"}</button>)}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 md:grid-cols-5 lg:grid-cols-9">
                {eventShortcuts.map((binding) => <button key={binding.id} type="button" disabled={busy || !selectedVideoId || !binding.eventType} onClick={() => createEventFromBinding(binding)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-3 text-sm hover:border-emerald-400 disabled:opacity-40"><span className="block text-xs text-slate-500">{shortcutLabel(binding.shortcut)}</span>{binding.label}</button>)}
              </div>
            </div>

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="mb-4">
                <h2 className="font-bold">Event library</h2>
                <p className="mt-1 text-xs text-slate-500">Create personalised rugby actions that appear as quick-code buttons and keyboard events.</p>
              </div>

              <form onSubmit={submitLibraryEvent} className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950 p-3 md:grid-cols-2 lg:grid-cols-6">
                <input name="label" placeholder="Event name" className={`${inputClass} lg:col-span-2`} />
                <select name="category" className={inputClass} defaultValue="attack">{EVENT_LIBRARY_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select>
                <input name="shortcut" placeholder="Key code e.g. KeyC" className={inputClass} />
                <input name="duration" type="number" min="1" max="300" defaultValue="8" className={inputClass} />
                <input name="field_zone" placeholder="Default zone" className={inputClass} />
                <textarea name="notes" placeholder="Default note" className={`${inputClass} md:col-span-2 lg:col-span-5`} />
                <button type="submit" className="rounded-lg bg-emerald-400 px-4 py-2 font-bold text-slate-950">Add library event</button>
              </form>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {eventShortcuts.map((binding) => (
                  <div key={binding.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <span className="rounded bg-slate-900 px-2 py-1 text-xs font-bold capitalize text-slate-400">{(binding.category ?? "core").replace("_", " ")}</span>
                      <kbd className={`rounded border px-2 py-1 text-xs font-bold ${shortcutConflict(binding.shortcut) ? "border-rose-400 text-rose-400" : "border-slate-700 text-emerald-400"}`}>{shortcutLabel(binding.shortcut)}</kbd>
                    </div>
                    {binding.custom ? (
                      <div className="grid gap-2">
                        <input value={binding.label} onChange={(event) => updateLibraryEvent(binding.id, { label: event.target.value, outcome: event.target.value })} className={inputClass} aria-label={`${binding.label} name`} />
                        <div className="grid grid-cols-2 gap-2">
                          <select value={binding.category ?? "attack"} onChange={(event) => updateLibraryEvent(binding.id, { category: event.target.value as EventCategory })} className={inputClass} aria-label={`${binding.label} category`}>{EVENT_LIBRARY_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select>
                          <input type="number" min="1" max="300" value={binding.duration ?? 8} onChange={(event) => updateLibraryEvent(binding.id, { duration: Number(event.target.value || 8) })} className={inputClass} aria-label={`${binding.label} duration`} />
                          <input value={binding.fieldZone ?? ""} onChange={(event) => updateLibraryEvent(binding.id, { fieldZone: event.target.value })} placeholder="Default zone" className={inputClass} aria-label={`${binding.label} field zone`} />
                          <input value={binding.notes ?? ""} onChange={(event) => updateLibraryEvent(binding.id, { notes: event.target.value })} placeholder="Default note" className={inputClass} aria-label={`${binding.label} note`} />
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setEditingShortcutId(binding.id)} className="flex-1 rounded border border-slate-700 px-3 py-2 text-sm font-bold">Change key</button>
                          <button type="button" onClick={() => deleteLibraryEvent(binding.id)} className="rounded border border-rose-900 px-3 py-2 text-sm font-bold text-rose-300">Delete</button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                        <div>
                          <p className="font-semibold">{binding.label}</p>
                          <p className="mt-1 text-xs text-slate-500">{binding.duration ?? 8} second default window</p>
                        </div>
                        <button type="button" onClick={() => setEditingShortcutId(binding.id)} className="rounded border border-slate-700 px-3 py-2 text-sm font-bold">Change key</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <form onSubmit={submitCustomEvent} className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="md:col-span-2 lg:col-span-4">
                <h2 className="font-bold">Custom team-level event</h2>
                <p className="mt-1 text-xs text-slate-500">Add field zone, phase and outcome without collecting individual player analytics.</p>
              </div>
              <select name="event_type" className={inputClass} defaultValue="custom">{EVENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select>
              <input name="outcome" placeholder="Outcome" className={inputClass} />
              <input name="field_zone" placeholder="Field zone" className={inputClass} />
              <input name="phase_number" type="number" min="1" placeholder="Phase" className={inputClass} />
              <input name="duration" type="number" min="1" max="300" defaultValue="8" className={inputClass} />
              <textarea name="notes" placeholder="Analyst notes" className={`${inputClass} md:col-span-2 lg:col-span-3`} />
              <button type="submit" disabled={busy || !selectedVideoId} className="rounded-lg bg-emerald-400 px-4 py-2 font-bold text-slate-950 disabled:opacity-40">Add event at {formatTime(currentTime)}</button>
            </form>

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold">Keyboard mapping</h2>
                  <p className="text-xs text-slate-500">Click Change, press the new key combination, or press Escape to cancel. Playback is currently {playbackRate}x.</p>
                </div>
                <button type="button" onClick={resetShortcuts} className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-bold">Reset defaults</button>
              </div>

              <section className="grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Event keys</h3>
                  <div className="grid gap-2">
                    {eventShortcuts.map((binding) => (
                      <div key={binding.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3">
                        <span className="text-sm font-semibold">{binding.label}</span>
                        <kbd className={`rounded border px-2 py-1 text-xs font-bold ${shortcutConflict(binding.shortcut) ? "border-rose-400 text-rose-400" : "border-slate-700 text-emerald-400"}`}>{editingShortcutId === binding.id ? "Press keys..." : shortcutLabel(binding.shortcut)}</kbd>
                        <button type="button" onClick={() => setEditingShortcutId(binding.id)} className="rounded border border-slate-700 px-2 py-1 text-xs font-bold">Change</button>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Video controls</h3>
                  <div className="grid gap-2">
                    {videoShortcuts.map((binding) => (
                      <div key={binding.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3">
                        <span className="text-sm font-semibold">{binding.label}</span>
                        <kbd className={`rounded border px-2 py-1 text-xs font-bold ${shortcutConflict(binding.shortcut) ? "border-rose-400 text-rose-400" : "border-slate-700 text-emerald-400"}`}>{editingShortcutId === binding.id ? "Press keys..." : shortcutLabel(binding.shortcut)}</kbd>
                        <button type="button" onClick={() => setEditingShortcutId(binding.id)} className="rounded border border-slate-700 px-2 py-1 text-xs font-bold">Change</button>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </section>

          <aside className="space-y-5">
            <form onSubmit={submitEventEdit} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold">Edit selected event</h2>
                  <p className="text-xs text-slate-500">Select a timeline event, then shape it into the rugby action you need.</p>
                </div>
                {selectedEvent && <span className="rounded bg-slate-950 px-2 py-1 text-xs font-bold text-emerald-400">#{selectedEvent.id}</span>}
              </div>
              {selectedEvent ? (
                <div className="grid gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <select key={`type-${selectedEvent.id}`} name="event_type" defaultValue={selectedEvent.event_type} className={inputClass}>{EVENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select>
                    <select key={`team-${selectedEvent.id}`} name="team" defaultValue={selectedEvent.team} className={inputClass}><option value="home">{homeTeam?.name ?? "Home"}</option><option value="away">{awayTeam?.name ?? "Away"}</option><option value="neutral">Neutral</option></select>
                    <input key={`start-${selectedEvent.id}`} name="start_seconds" type="number" min="0" step="0.1" defaultValue={selectedEvent.start_seconds} className={inputClass} />
                    <input key={`end-${selectedEvent.id}`} name="end_seconds" type="number" min="0.1" step="0.1" defaultValue={selectedEvent.end_seconds} className={inputClass} />
                    <input key={`outcome-${selectedEvent.id}`} name="outcome" placeholder="Outcome or detail" defaultValue={selectedEvent.outcome ?? ""} className={inputClass} />
                    <input key={`zone-${selectedEvent.id}`} name="field_zone" placeholder="Field zone" defaultValue={selectedEvent.field_zone ?? ""} className={inputClass} />
                    <input key={`phase-${selectedEvent.id}`} name="phase_number" type="number" min="1" placeholder="Phase" defaultValue={selectedEvent.phase_number ?? ""} className={inputClass} />
                  </div>
                  <textarea key={`notes-${selectedEvent.id}`} name="notes" placeholder="Analyst notes" defaultValue={selectedEvent.notes ?? ""} className={inputClass} />
                  <div className="flex gap-2">
                    <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-emerald-400 px-4 py-2 font-bold text-slate-950 disabled:opacity-40">Save event</button>
                    <button type="button" onClick={() => seekTo(selectedEvent.start_seconds)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-bold">Play</button>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">Press the blank-event key or select an event from the timeline.</div>
              )}
            </form>

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="font-bold">Live event summary</h2>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {Object.entries(eventCounts).sort((a, b) => b[1] - a[1]).slice(0, 9).map(([type, count]) => <div key={type} className="rounded-lg bg-slate-950 p-3"><p className="text-xs capitalize text-slate-500">{type}</p><p className="mt-1 text-xl font-bold">{count}</p></div>)}
                {!events.length && <p className="col-span-3 text-sm text-slate-500">No events coded yet.</p>}
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Timeline</h2><span className="text-xs text-slate-500">Chronological</span></div>
              <div className="max-h-[680px] space-y-2 overflow-y-auto pr-1">
                {events.map((item) => <button key={item.id} type="button" onClick={() => { setSelectedEventId(item.id); seekTo(item.start_seconds); }} className={`w-full rounded-lg border bg-slate-950 p-3 text-left hover:border-emerald-400 ${selectedEventId === item.id ? "border-emerald-400" : "border-slate-800"}`}><div className="flex items-center justify-between gap-3"><span className="font-mono text-sm text-emerald-400">{formatTime(item.start_seconds)}</span><span className="rounded bg-slate-800 px-2 py-1 text-xs capitalize">{item.team}</span></div><p className="mt-2 font-semibold capitalize">{item.event_type}</p><p className="mt-1 truncate text-xs text-slate-500">{item.outcome || item.field_zone || item.notes || `${Math.round(item.end_seconds - item.start_seconds)} second window`}</p></button>)}
                {!events.length && <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">Play the video and use the quick-tag buttons to build the timeline.</div>}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
