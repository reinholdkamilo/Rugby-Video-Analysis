import { apiUrl, EventTeam, EventType, Match, Team, TimelineEvent, VideoAsset } from "@/lib/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export const codingApi = {
  matches: () => request<Match[]>("/api/matches"),
  teams: () => request<Team[]>("/api/teams"),
  videos: (matchId: number) => request<VideoAsset[]>(`/api/matches/${matchId}/videos`),
  events: (matchId: number, videoAssetId?: number) => {
    const query = new URLSearchParams({ match_id: String(matchId) });
    if (videoAssetId) query.set("video_asset_id", String(videoAssetId));
    return request<TimelineEvent[]>(`/api/timeline-events?${query}`);
  },
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
