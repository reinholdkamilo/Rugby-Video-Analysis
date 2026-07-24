"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

import {
  LibraryAnnotation,
  LibraryCollection,
  LibraryComment,
  Match,
  Team,
  TimelineEvent,
  TimelineLaneEvent,
  TimelineLanes,
  VideoAsset,
  api,
} from "@/lib/api";
import { sourceVideoUrl } from "@/lib/coding-api";

const inputClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-emerald-500 [color-scheme:light]";

function formatTime(seconds: number | null | undefined) {
  const value = Math.max(0, seconds || 0);
  const minutes = Math.floor(value / 60);
  const remaining = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function teamName(match: Match | null, teams: Team[], team: string) {
  if (!match) return team;
  if (team === "home") return teams.find((item) => item.id === match.home_team_id)?.name ?? "Home";
  if (team === "away") return teams.find((item) => item.id === match.away_team_id)?.name ?? "Away";
  return "Neutral";
}

function laneColour(event: TimelineLaneEvent) {
  if (event.trust_status !== "confirmed") return "#f59e0b";
  if (event.team === "home") return "#10b981";
  if (event.team === "away") return "#38bdf8";
  return "#94a3b8";
}

export default function CoachReviewPage() {
  const params = useParams<{ id: string }>();
  const reviewId = params.id;
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const [collection, setCollection] = useState<LibraryCollection | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [videos, setVideos] = useState<VideoAsset[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [timeline, setTimeline] = useState<TimelineLanes | null>(null);
  const [comments, setComments] = useState<LibraryComment[]>([]);
  const [annotations, setAnnotations] = useState<LibraryAnnotation[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [notice, setNotice] = useState("Loading coach review...");
  const [busy, setBusy] = useState(false);

  const numericCollectionId = /^\d+$/.test(reviewId) ? Number(reviewId) : null;
  const matchIdFromRoute = reviewId.startsWith("match-") ? Number(reviewId.replace("match-", "")) : null;
  const selectedMatchId = collection?.match_id ?? matchIdFromRoute ?? null;
  const selectedMatch = useMemo(() => matches.find((match) => match.id === selectedMatchId) ?? null, [matches, selectedMatchId]);
  const selectedVideoId = collection?.video_asset_id ?? videos[0]?.id ?? null;
  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedEventId) ?? events[0] ?? null, [events, selectedEventId]);
  const timelineMax = useMemo(() => Math.max(1, ...(timeline?.events.map((event) => event.end_seconds) ?? [1])), [timeline]);
  const clipEvents = useMemo(() => {
    if (!collection?.item_refs?.length) return events;
    const selectedIds = new Set(collection.item_refs.filter((ref) => ref.ref_type === "timeline_event" || ref.ref_type === "clip").map((ref) => ref.ref_id));
    return selectedIds.size ? events.filter((event) => selectedIds.has(event.id)) : events;
  }, [collection, events]);

  useEffect(() => {
    async function loadReview() {
      setBusy(true);
      try {
        const [teamData, matchData] = await Promise.all([api.teams.list(), api.matches.list()]);
        setTeams(teamData);
        setMatches(matchData);
        let nextCollection: LibraryCollection | null = null;
        let matchId = matchIdFromRoute;
        let videoId: number | null = null;
        if (numericCollectionId) {
          nextCollection = await api.library.collection(numericCollectionId);
          setCollection(nextCollection);
          matchId = nextCollection.match_id;
          videoId = nextCollection.video_asset_id;
        }
        if (!matchId) {
          setNotice("This review package is not linked to a match yet.");
          return;
        }
        const videoData = await api.matches.videos(matchId);
        const chosenVideoId = videoId ?? videoData[0]?.id ?? null;
        const [eventData, laneData, commentData, annotationData] = await Promise.all([
          api.timeline.list(matchId, chosenVideoId ?? undefined),
          api.library.timelineLanes(matchId, chosenVideoId ?? undefined),
          api.library.comments(numericCollectionId ? { collection_id: numericCollectionId } : { match_id: matchId }),
          api.library.annotations(numericCollectionId ? { collection_id: numericCollectionId } : { match_id: matchId }),
        ]);
        setVideos(videoData);
        setEvents(eventData);
        setTimeline(laneData);
        setComments(commentData);
        setAnnotations(annotationData);
        setSelectedEventId(eventData[0]?.id ?? null);
        setNotice(`${eventData.length} timeline event${eventData.length === 1 ? "" : "s"} ready for review.`);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Unable to load coach review.");
      } finally {
        setBusy(false);
      }
    }
    void loadReview();
  }, [matchIdFromRoute, numericCollectionId]);

  function jumpToEvent(event: TimelineEvent | TimelineLaneEvent) {
    const video = playerRef.current;
    if (video) {
      video.currentTime = event.start_seconds;
      void video.play().catch(() => undefined);
    }
    setSelectedEventId(event.id);
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = String(form.get("body") || "").trim();
    if (!body || !selectedMatchId) return;
    setBusy(true);
    try {
      const created = await api.library.createComment({
        collection_id: numericCollectionId,
        match_id: selectedMatchId,
        video_asset_id: selectedVideoId,
        timeline_event_id: selectedEvent?.id ?? null,
        timestamp_seconds: playerRef.current?.currentTime ?? selectedEvent?.start_seconds ?? null,
        body,
        tags: String(form.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean),
      });
      setComments((current) => [created, ...current]);
      setNotice("Coach comment saved.");
      event.currentTarget.reset();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save comment.");
    } finally {
      setBusy(false);
    }
  }

  async function addTextAnnotation() {
    if (!selectedMatchId) return;
    setBusy(true);
    try {
      const created = await api.library.createAnnotation({
        collection_id: numericCollectionId,
        match_id: selectedMatchId,
        video_asset_id: selectedVideoId,
        timeline_event_id: selectedEvent?.id ?? null,
        comment_id: null,
        timestamp_seconds: playerRef.current?.currentTime ?? selectedEvent?.start_seconds ?? null,
        shape_type: "text",
        colour: "#f5b400",
        coordinates: { x: 50, y: 50, width: 18, height: 8 },
        label: selectedEvent ? `${selectedEvent.outcome || selectedEvent.event_type} note` : "Pause-frame note",
      });
      setAnnotations((current) => [created, ...current]);
      setNotice("Annotation marker saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save annotation.");
    } finally {
      setBusy(false);
    }
  }

  const title = collection?.title ?? (selectedMatch ? `${teamName(selectedMatch, teams, "home")} vs ${teamName(selectedMatch, teams, "away")} review` : "Coach Review");

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="bg-slate-950 text-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-end justify-between gap-6 px-6 py-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-400">Library review</p>
            <h1 className="mt-1 text-3xl font-bold">{title}</h1>
          </div>
          <nav className="flex gap-3 text-sm">
            <Link href="/library" className="rounded-lg border border-slate-700 px-3 py-2">Library</Link>
            {selectedMatchId ? <Link href={`/video-analysis?match_id=${selectedMatchId}`} className="rounded-lg border border-slate-700 px-3 py-2">Open Video Analysis</Link> : null}
            {selectedMatchId ? <Link href={`/reports?match_id=${selectedMatchId}`} className="rounded-lg bg-emerald-400 px-4 py-2 font-bold text-slate-950">Report</Link> : null}
          </nav>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1600px] gap-5 px-6 py-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="space-y-5">
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-black shadow-sm">
            {selectedVideoId ? (
              <video ref={playerRef} src={sourceVideoUrl(selectedVideoId)} controls className="aspect-video w-full bg-black" />
            ) : (
              <div className="grid aspect-video place-items-center text-white">No video linked to this review yet.</div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">Multi-lane timeline</h2>
                <p className="text-sm text-slate-600">{notice}</p>
              </div>
              <button type="button" onClick={addTextAnnotation} disabled={busy || !selectedMatchId} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Add pause-frame note</button>
            </div>

            <div className="mt-4 overflow-x-auto">
              <div className="min-w-[900px] space-y-2">
                {timeline?.lanes.map((lane) => {
                  const laneEvents = timeline.events.filter((event) => event.lane === lane);
                  return (
                    <div key={lane} className="grid grid-cols-[150px_1fr] items-center gap-3">
                      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{lane}</div>
                      <div className="relative h-10 rounded-lg bg-slate-100">
                        {laneEvents.map((event) => (
                          <button
                            key={event.id}
                            type="button"
                            onClick={() => jumpToEvent(event)}
                            title={`${event.label} · ${formatTime(event.start_seconds)}`}
                            className="absolute top-1 h-8 overflow-hidden rounded-md px-2 text-left text-[11px] font-bold text-white shadow-sm"
                            style={{
                              left: `${Math.min(98, (event.start_seconds / timelineMax) * 100)}%`,
                              width: `${Math.max(2.5, ((event.end_seconds - event.start_seconds) / timelineMax) * 100)}%`,
                              backgroundColor: laneColour(event),
                            }}
                          >
                            {event.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Clip list</h2>
            <div className="mt-3 grid max-h-[390px] gap-2 overflow-auto">
              {clipEvents.map((event) => (
                <button key={event.id} type="button" onClick={() => jumpToEvent(event)} className={`rounded-lg border p-3 text-left text-sm ${selectedEventId === event.id ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white"}`}>
                  <strong>{formatTime(event.start_seconds)} · {event.outcome || event.event_type}</strong>
                  <span className="mt-1 block text-xs text-slate-600">{teamName(selectedMatch, teams, event.team)} · {event.field_zone ?? "No zone"} · {event.event_source}</span>
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={submitComment} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Coach note</h2>
            <textarea name="body" rows={4} placeholder="Add a timestamped comment..." className={`${inputClass} mt-3 w-full`} />
            <input name="tags" placeholder="Tags, separated, by commas" className={`${inputClass} mt-3 w-full`} />
            <button disabled={busy || !selectedMatchId} className="mt-3 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Save comment</button>
          </form>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Comments</h2>
            <div className="mt-3 grid gap-2">
              {comments.map((comment) => (
                <article key={comment.id} className="rounded-lg bg-slate-100 p-3 text-sm">
                  <strong>{formatTime(comment.timestamp_seconds)}</strong>
                  <p className="mt-1 text-slate-700">{comment.body}</p>
                  {comment.tags.length ? <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{comment.tags.join(" · ")}</p> : null}
                </article>
              ))}
              {!comments.length ? <p className="text-sm text-slate-500">No comments yet.</p> : null}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Annotations</h2>
            <div className="mt-3 grid gap-2">
              {annotations.map((annotation) => (
                <article key={annotation.id} className="rounded-lg bg-slate-100 p-3 text-sm">
                  <strong>{annotation.shape_type} · {formatTime(annotation.timestamp_seconds)}</strong>
                  <p className="mt-1 text-slate-700">{annotation.label ?? "Untitled annotation"}</p>
                </article>
              ))}
              {!annotations.length ? <p className="text-sm text-slate-500">Pause-frame annotation metadata will appear here.</p> : null}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
