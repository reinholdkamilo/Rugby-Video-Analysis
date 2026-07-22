import { apiUrl, EventTeam, EventType, Match, Team, TimelineEvent, VideoAsset } from "@/lib/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

async function withBackendWakeRetry<T>(operation: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 2500));
    }
  }
  throw lastError;
}

export const codingApi = {
  matches: () => withBackendWakeRetry(() => request<Match[]>("/api/matches")),
  teams: () => withBackendWakeRetry(() => request<Team[]>("/api/teams")),
  allVideos: () => withBackendWakeRetry(() => request<VideoAsset[]>("/api/videos")),
  videos: (matchId: number) => withBackendWakeRetry(() => request<VideoAsset[]>(`/api/matches/${matchId}/videos`)),
  events: (matchId: number, videoAssetId?: number) => {
    const query = new URLSearchParams({ match_id: String(matchId) });
    if (videoAssetId) query.set("video_asset_id", String(videoAssetId));
    return withBackendWakeRetry(() => request<TimelineEvent[]>(`/api/timeline-events?${query}`));
  },
  runInference: (matchId: number, videoAssetId?: number) =>
    request<{ match_id: number; video_asset_id: number | null; source_event_count: number; created_count: number; stale_count: number; skipped_count: number; inferred_event_count: number }>("/api/timeline-events/infer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ match_id: matchId, video_asset_id: videoAssetId ?? null, replace_unconfirmed: true }),
    }),
  createEvent: (payload: {
    match_id: number;
    video_asset_id: number;
    event_type: EventType;
    team: EventTeam;
    start_seconds: number;
    end_seconds: number;
    player_name?: string | null;
    outcome?: string | null;
    notes?: string | null;
    phase_number?: number | null;
    field_zone?: string | null;
    clip_requested: boolean;
  }) =>
    request<TimelineEvent>("/api/timeline-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  updateEvent: (eventId: number, payload: Partial<TimelineEvent>) =>
    request<TimelineEvent>(`/api/timeline-events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  deleteEvent: (eventId: number) =>
    request<void>(`/api/timeline-events/${eventId}`, {
      method: "DELETE",
    }),
};

export const sourceVideoUrl = (videoAssetId: number) => `${apiUrl}/api/videos/${videoAssetId}/stream`;
