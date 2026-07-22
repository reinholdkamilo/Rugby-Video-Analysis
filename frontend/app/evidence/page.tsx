"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { EvidenceItem, EvidenceType, Match, Team, TimelineEvent, VideoAsset, api, clipUrl, evidenceClipUrl } from "@/lib/api";
import { sportRulePack } from "@/lib/rugby-events";
import { sourceVideoUrl } from "@/lib/coding-api";

const EVIDENCE_TYPES: { value: EvidenceType; label: string }[] = [
  { value: "video", label: "Video" },
  { value: "clip", label: "Clip" },
  { value: "frame", label: "Frame" },
  { value: "audio", label: "Audio" },
  { value: "referee_audio", label: "Ref audio" },
  { value: "scoreboard", label: "Scoreboard" },
  { value: "commentary", label: "Commentary" },
  { value: "note", label: "Note" },
  { value: "other", label: "Other" },
];

const RUGBY_ELEMENTS = [
  "carry",
  "tackle",
  "ruck",
  "maul",
  "scrum",
  "lineout",
  "kick",
  "counter attack",
  "zone entry",
  "exit",
  "restart",
  "line break",
  "jackal",
  "penalty",
  "drop out",
  "scoreboard",
];

const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-emerald-500 [color-scheme:light]";

function formatTime(seconds: number | null) {
  if (seconds === null) return "";
  const value = Math.max(0, seconds || 0);
  const minutes = Math.floor(value / 60);
  const remaining = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

export default function EvidenceLibraryPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [notice, setNotice] = useState("Loading evidence library...");
  const [busy, setBusy] = useState(false);

  const teamName = useCallback((teamId: number) => teams.find((team) => team.id === teamId)?.name ?? `Team ${teamId}`, [teams]);
  const selectedMatch = useMemo(() => matches.find((match) => match.id === selectedMatchId) ?? null, [matches, selectedMatchId]);
  const selectedVideo = useMemo(() => videos.find((video) => video.id === selectedVideoId) ?? null, [selectedVideoId, videos]);
  const approvedCount = items.filter((item) => item.approved_for_training).length;
  const filteredItems = useMemo(() => items.filter((item) => {
    if (statusFilter !== "all" && item.status !== statusFilter) return false;
    if (sourceFilter !== "all" && item.source !== sourceFilter) return false;
    return true;
  }), [items, sourceFilter, statusFilter]);

  const eventLabel = useCallback((event: TimelineEvent) => {
    const label = event.outcome || event.event_type;
    return `${formatTime(event.start_seconds)} · ${event.team} · ${label}`;
  }, []);

  const loadBase = useCallback(async () => {
    setBusy(true);
    try {
      const [teamData, matchData] = await Promise.all([api.teams.list(), api.matches.list()]);
      setTeams(teamData);
      setMatches(matchData);
      setSelectedMatchId((current) => current ?? matchData[0]?.id ?? null);
      setNotice(matchData.length ? "Evidence library ready." : "Create a match before adding evidence.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load evidence library.");
    } finally {
      setBusy(false);
    }
  }, []);

  const loadMatchEvidence = useCallback(async (matchId: number) => {
    setBusy(true);
    try {
      const videoData = await api.matches.videos(matchId);
      const nextVideoId = selectedVideoId && videoData.some((video) => video.id === selectedVideoId)
        ? selectedVideoId
        : videoData[0]?.id ?? null;
      const [eventData, evidenceData] = await Promise.all([
        api.timeline.list(matchId, nextVideoId ?? undefined),
        api.evidence.list(matchId),
      ]);
      setVideos(videoData);
      setSelectedVideoId(nextVideoId);
      setEvents(eventData);
      setItems(evidenceData);
      setNotice(`${evidenceData.length} evidence item${evidenceData.length === 1 ? "" : "s"} loaded.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load match evidence.");
    } finally {
      setBusy(false);
    }
  }, [selectedVideoId]);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (!selectedMatchId) {
      setVideos([]);
      setEvents([]);
      setItems([]);
      setSelectedVideoId(null);
      return;
    }
    void loadMatchEvidence(selectedMatchId);
  }, [loadMatchEvidence, selectedMatchId]);

  useEffect(() => {
    if (!selectedMatchId || !selectedVideoId) return;
    void api.timeline.list(selectedMatchId, selectedVideoId).then(setEvents).catch((error) => {
      setNotice(error instanceof Error ? error.message : "Unable to reload video events.");
    });
  }, [selectedMatchId, selectedVideoId]);

  async function submitEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMatchId) return;
    const form = new FormData(event.currentTarget);
    const label = String(form.get("label") || "").trim();
    if (!label) {
      setNotice("Name the evidence item before saving it.");
      return;
    }
    const eventId = Number(form.get("timeline_event_id") || 0) || null;
    const rawTimestamp = String(form.get("timestamp_seconds") || "").trim();
    const timestampSeconds = rawTimestamp ? Number(rawTimestamp) : null;
    setBusy(true);
    try {
      const created = await api.evidence.create({
        match_id: selectedMatchId,
        sport_type: selectedMatch?.sport_type ?? "rugby_union",
        video_asset_id: selectedVideoId,
        timeline_event_id: eventId,
        evidence_type: String(form.get("evidence_type") || "note") as EvidenceType,
        label,
        rugby_element: String(form.get("rugby_element") || "").trim() || null,
        source_uri: String(form.get("source_uri") || "").trim() || null,
        timestamp_seconds: timestampSeconds !== null && Number.isFinite(timestampSeconds) ? timestampSeconds : null,
        confidence_label: String(form.get("confidence_label") || "").trim() || null,
        notes: String(form.get("notes") || "").trim() || null,
        approved_for_training: form.get("approved_for_training") === "on",
        status: String(form.get("status") || "unconfirmed"),
        source: "manual",
        trust_notes: null,
      });
      setItems((current) => [created, ...current]);
      setNotice(`${created.label} saved to the evidence library.`);
      event.currentTarget.reset();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save evidence item.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleTrainingApproval(item: EvidenceItem) {
    setBusy(true);
    try {
      const updated = await api.evidence.update(item.id, { approved_for_training: !item.approved_for_training });
      setItems((current) => current.map((currentItem) => currentItem.id === updated.id ? updated : currentItem));
      setNotice(updated.approved_for_training ? "Evidence approved for training." : "Evidence removed from the training set.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update evidence item.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteEvidence(item: EvidenceItem) {
    const confirmed = window.confirm(`Delete ${item.label} from the evidence library?`);
    if (!confirmed) return;
    setBusy(true);
    try {
      await api.evidence.delete(item.id);
      setItems((current) => current.filter((currentItem) => currentItem.id !== item.id));
      setNotice(`${item.label} deleted.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete evidence item.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAllEvidence() {
    if (!selectedMatchId) return;
    const confirmed = window.confirm("Delete all evidence items for this match? This also clears generated evidence clips, but keeps the match, source video and timeline events.");
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await api.evidence.deleteAll(selectedMatchId);
      setItems([]);
      setEvents((current) => current.map((timelineEvent) => ({ ...timelineEvent, clip: null })));
      setNotice(`Deleted ${result.evidence_items_deleted} evidence item${result.evidence_items_deleted === 1 ? "" : "s"} and ${result.clips_deleted} clip${result.clips_deleted === 1 ? "" : "s"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete evidence items.");
    } finally {
      setBusy(false);
    }
  }

  async function updateEvidenceStatus(item: EvidenceItem, status: string) {
    setBusy(true);
    try {
      const updated = await api.evidence.update(item.id, {
        status,
        approved_for_training: status === "confirmed" ? true : item.approved_for_training,
        trust_notes: status === "rejected" ? "Evidence marked incorrect by analyst." : item.trust_notes,
      });
      setItems((current) => current.map((currentItem) => currentItem.id === updated.id ? updated : currentItem));
      setNotice(`${item.label} marked ${status.replace("_", " ")}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update evidence status.");
    } finally {
      setBusy(false);
    }
  }

  async function regenerateEvidenceClip(item: EvidenceItem, linkedEvent: TimelineEvent | undefined) {
    if (!linkedEvent) {
      setNotice("Link this evidence item to a timeline event before generating a clip.");
      return;
    }
    setBusy(true);
    try {
      const clip = await api.timeline.regenerateClip(linkedEvent.id);
      setEvents((current) => current.map((timelineEvent) => (
        timelineEvent.id === linkedEvent.id ? { ...timelineEvent, clip } : timelineEvent
      )));
      const updatedItem = await api.evidence.update(item.id, {
        evidence_type: "clip",
        source_uri: clip.file_path,
        timestamp_seconds: linkedEvent.start_seconds,
        trust_notes: "Evidence clip regenerated from linked timeline timing.",
      });
      setItems((current) => current.map((currentItem) => currentItem.id === updatedItem.id ? updatedItem : currentItem));
      setNotice("Evidence clip regenerated.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to regenerate evidence clip.");
    } finally {
      setBusy(false);
    }
  }

  function itemMediaUrl(item: EvidenceItem, linkedEvent?: TimelineEvent) {
    if (item.evidence_type === "clip") {
      if (linkedEvent?.clip) return clipUrl(linkedEvent.clip);
      if (item.source_uri) return evidenceClipUrl(item.source_uri);
      return null;
    }
    if (item.source_uri && /^https?:\/\//i.test(item.source_uri)) return item.source_uri;
    if (item.evidence_type === "video" && item.video_asset_id) return sourceVideoUrl(item.video_asset_id);
    return null;
  }

  async function saveEvidenceTiming(item: EvidenceItem, linkedEvent: TimelineEvent | undefined, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const start = Number(form.get("start_seconds") || 0);
    const end = Number(form.get("end_seconds") || 0);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      setNotice("Set a valid evidence clip start and end time.");
      return;
    }
    setBusy(true);
    try {
      if (linkedEvent) {
        const updatedEvent = await api.timeline.update(linkedEvent.id, {
          start_seconds: Number(start.toFixed(2)),
          end_seconds: Number(end.toFixed(2)),
          clip_requested: true,
        });
        const clip = await api.timeline.regenerateClip(linkedEvent.id);
        setEvents((current) => current.map((timelineEvent) => (
          timelineEvent.id === updatedEvent.id ? { ...updatedEvent, clip } : timelineEvent
        )));
        const updatedItem = await api.evidence.update(item.id, {
          timestamp_seconds: Number(start.toFixed(2)),
          trust_notes: "Evidence clip timing reviewed by analyst.",
        });
        setItems((current) => current.map((currentItem) => currentItem.id === updatedItem.id ? updatedItem : currentItem));
        setNotice("Evidence clip timing saved and clip regenerated.");
      } else {
        const updatedItem = await api.evidence.update(item.id, {
          timestamp_seconds: Number(start.toFixed(2)),
          trust_notes: "Evidence timestamp reviewed by analyst.",
        });
        setItems((current) => current.map((currentItem) => currentItem.id === updatedItem.id ? updatedItem : currentItem));
        setNotice("Evidence timestamp saved.");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save evidence timing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="bg-slate-950 text-white">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-end justify-between gap-5 px-6 py-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-400">Training evidence</p>
            <h1 className="mt-1 text-3xl font-bold">Evidence Library</h1>
          </div>
          <div className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300">
            {items.length} items · {approvedCount} approved{selectedMatch ? ` · ${sportRulePack(selectedMatch.sport_type).displayName}` : ""}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-6 py-6">
        <div className="mb-5 grid gap-3 rounded-xl border border-slate-300 bg-white p-4 shadow-sm lg:grid-cols-[1fr_1fr_auto]">
          <select className={inputClass} value={selectedMatchId ?? ""} onChange={(event) => setSelectedMatchId(event.target.value ? Number(event.target.value) : null)}>
            <option value="">Select match</option>
            {matches.map((match) => (
              <option key={match.id} value={match.id}>
                {match.match_date} · {teamName(match.home_team_id)} vs {teamName(match.away_team_id)} · {sportRulePack(match.sport_type).displayName}
              </option>
            ))}
          </select>
          <select className={inputClass} value={selectedVideoId ?? ""} onChange={(event) => setSelectedVideoId(event.target.value ? Number(event.target.value) : null)} disabled={!videos.length}>
            <option value="">All videos</option>
            {videos.map((video) => <option key={video.id} value={video.id}>{video.original_filename}</option>)}
          </select>
          <div className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">
            {busy ? "Working..." : notice}
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(360px,0.8fr)_1.2fr]">
          <form onSubmit={submitEvidence} className="space-y-4 rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-bold">Add evidence</h2>
              <p className="mt-1 text-sm text-slate-500">{selectedMatch ? `${teamName(selectedMatch.home_team_id)} vs ${teamName(selectedMatch.away_team_id)} · ${sportRulePack(selectedMatch.sport_type).displayName}` : "Select a match first."}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <input name="label" placeholder="Evidence name" className={`${inputClass} md:col-span-2`} />
              <select name="evidence_type" className={inputClass} defaultValue="clip">
                {EVIDENCE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
              <input name="rugby_element" list="rugby-elements" placeholder="Rugby element" className={inputClass} />
              <datalist id="rugby-elements">
                {RUGBY_ELEMENTS.map((element) => <option key={element} value={element} />)}
              </datalist>
              <select name="timeline_event_id" className={`${inputClass} md:col-span-2`} defaultValue="">
                <option value="">No linked timeline event</option>
                {events.map((timelineEvent) => (
                  <option key={timelineEvent.id} value={timelineEvent.id}>{eventLabel(timelineEvent)}</option>
                ))}
              </select>
              <input name="source_uri" placeholder="Source link, path, or R2 URI" className={`${inputClass} md:col-span-2`} />
              <input name="timestamp_seconds" type="number" min="0" step="0.1" placeholder="Timestamp seconds" className={inputClass} />
              <input name="confidence_label" placeholder="positive, negative, uncertain" className={inputClass} />
              <select name="status" className={inputClass} defaultValue="unconfirmed">
                <option value="unconfirmed">Unconfirmed</option>
                <option value="confirmed">Confirmed</option>
                <option value="linked_unconfirmed">Linked / unconfirmed</option>
                <option value="rejected">Rejected</option>
              </select>
              <textarea name="notes" placeholder="Notes" className={`${inputClass} min-h-24 md:col-span-2`} />
            </div>

            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <input name="approved_for_training" type="checkbox" className="h-4 w-4 accent-emerald-600" />
              Approved for training
            </label>

            <button type="submit" disabled={busy || !selectedMatchId} className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
              Save evidence
            </button>
          </form>

          <section className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Evidence items</h2>
                <p className="mt-1 text-sm text-slate-500">{selectedVideo ? selectedVideo.original_filename : "All match evidence"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => selectedMatchId && void loadMatchEvidence(selectedMatchId)} disabled={busy || !selectedMatchId} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold disabled:opacity-50">
                  Refresh
                </button>
                <button type="button" onClick={() => void deleteAllEvidence()} disabled={busy || !selectedMatchId || !items.length} className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-bold text-rose-700 disabled:opacity-50">
                  Delete all
                </button>
              </div>
            </div>
            <div className="mb-4 grid gap-3 md:grid-cols-2">
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={inputClass}>
                <option value="all">All trust statuses</option>
                <option value="confirmed">Confirmed</option>
                <option value="unconfirmed">Unconfirmed</option>
                <option value="linked_unconfirmed">Linked / unconfirmed</option>
                <option value="rejected">Rejected</option>
              </select>
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className={inputClass}>
                <option value="all">All evidence sources</option>
                <option value="manual_code">Manual codes</option>
                <option value="uploaded_video">Uploaded videos</option>
                <option value="auto_analysis">Auto analysis</option>
                <option value="linked_logic">Linked logic</option>
                <option value="manual">Manual evidence</option>
              </select>
            </div>

            <div className="space-y-3">
              {filteredItems.map((item) => {
                const linkedEvent = events.find((timelineEvent) => timelineEvent.id === item.timeline_event_id);
                const mediaUrl = itemMediaUrl(item, linkedEvent);
                const startSeconds = linkedEvent?.start_seconds ?? item.timestamp_seconds ?? 0;
                const endSeconds = linkedEvent?.end_seconds ?? (startSeconds + 10);
                return (
                  <article key={item.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">{item.evidence_type.replace("_", " ")}</p>
                        <h3 className="mt-1 font-bold">{item.label}</h3>
                        <p className="mt-1 text-sm text-slate-500">
                          {item.rugby_element || "General"}{item.timestamp_seconds !== null ? ` · ${formatTime(item.timestamp_seconds)}` : ""}
                        </p>
                        <p className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">{item.status.replace("_", " ")} · {item.source.replace("_", " ")}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${item.approved_for_training ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                        {item.approved_for_training ? "Training approved" : "Draft"}
                      </span>
                    </div>
                    {linkedEvent ? <p className="mt-3 text-sm text-slate-600">Linked event: {eventLabel(linkedEvent)}</p> : null}
                    {item.source_uri ? <p className="mt-2 break-all text-sm text-slate-600">Source: {item.source_uri}</p> : null}
                    {mediaUrl ? (
                      <video key={`${item.id}-${linkedEvent?.clip?.id ?? "source"}`} controls preload="metadata" src={mediaUrl} className="mt-3 aspect-video w-full rounded-lg border border-slate-200 bg-black" />
                    ) : item.evidence_type === "clip" ? (
                      <div className="mt-3 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
                        This evidence item does not have a generated event clip yet.
                        {linkedEvent ? " Regenerate it from the linked event timing." : " Link it to a timeline event to generate a clip."}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">No playable media is linked yet.</div>
                    )}
                    <form onSubmit={(event) => void saveEvidenceTiming(item, linkedEvent, event)} className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-[1fr_1fr_auto]">
                      <label className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                        Start seconds
                        <input name="start_seconds" type="number" min="0" step="0.1" defaultValue={startSeconds.toFixed(1)} className={`${inputClass} mt-1`} />
                      </label>
                      <label className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                        End seconds
                        <input name="end_seconds" type="number" min="0" step="0.1" defaultValue={endSeconds.toFixed(1)} className={`${inputClass} mt-1`} />
                      </label>
                      <button type="submit" disabled={busy} className="self-end rounded-lg bg-slate-950 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
                        Save timing
                      </button>
                    </form>
                    {item.notes ? <p className="mt-2 text-sm text-slate-600">{item.notes}</p> : null}
                    {item.trust_notes ? <p className="mt-2 text-sm text-amber-700">Trust note: {item.trust_notes}</p> : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" onClick={() => void updateEvidenceStatus(item, "confirmed")} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-50">
                        Confirm
                      </button>
                      <button type="button" onClick={() => void updateEvidenceStatus(item, "unconfirmed")} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-50">
                        Needs review
                      </button>
                      <button type="button" onClick={() => void updateEvidenceStatus(item, "rejected")} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-50">
                        Incorrect
                      </button>
                      {item.evidence_type === "clip" ? (
                        <button type="button" onClick={() => void regenerateEvidenceClip(item, linkedEvent)} disabled={busy || !linkedEvent} className="rounded-lg border border-sky-300 px-3 py-2 text-sm font-bold text-sky-700 disabled:opacity-50">
                          Regenerate clip
                        </button>
                      ) : null}
                      <button type="button" onClick={() => void toggleTrainingApproval(item)} disabled={busy} className="rounded-lg border border-emerald-600 px-3 py-2 text-sm font-bold text-emerald-700 disabled:opacity-50">
                        {item.approved_for_training ? "Remove approval" : "Approve for training"}
                      </button>
                      <button type="button" onClick={() => void deleteEvidence(item)} disabled={busy} className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-bold text-rose-700 disabled:opacity-50">
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })}
              {!filteredItems.length ? <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No evidence matches the current filters.</div> : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
