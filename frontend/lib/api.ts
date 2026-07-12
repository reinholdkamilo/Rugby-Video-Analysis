export const apiUrl =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

export type Organisation = { id: number; name: string; created_at: string };
export type Team = { id: number; organisation_id: number; name: string; age_group: string | null; created_at: string };
export type Match = { id: number; organisation_id: number; home_team_id: number; away_team_id: number; match_date: string; competition: string | null; venue: string | null; created_at: string };
export type VideoAsset = { id: number; match_id: number; original_filename: string; content_type: string | null; size_bytes: number; created_at: string };
export type AnalysisJob = { id: number; match_id: number; video_asset_id: number | null; status: "queued" | "processing" | "completed" | "failed"; progress_percent: number; message: string | null; created_at: string; updated_at: string };
export type VideoProcessingResult = { id: number; analysis_job_id: number; video_asset_id: number; duration_seconds: number; width: number; height: number; frame_rate: number; video_codec: string | null; audio_codec: string | null; thumbnail_path: string; created_at: string };

export type EventType = "kickoff" | "scrum" | "lineout" | "carry" | "tackle" | "ruck" | "maul" | "pass" | "kick" | "turnover" | "penalty" | "try" | "conversion" | "card" | "stoppage" | "custom";
export type EventTeam = "home" | "away" | "neutral";
export type EventClip = { id: number; event_id: number; duration_seconds: number; file_path: string; created_at: string };
export type TimelineEvent = {
  id: number;
  match_id: number;
  video_asset_id: number;
  event_type: EventType;
  team: EventTeam;
  start_seconds: number;
  end_seconds: number;
  player_name: string | null;
  outcome: string | null;
  notes: string | null;
  phase_number: number | null;
  field_zone: string | null;
  clip_requested: boolean;
  created_at: string;
  updated_at: string;
  clip: EventClip | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export const thumbnailUrl = (result: VideoProcessingResult) => `${apiUrl}/media/thumbnails/${result.thumbnail_path.split("/").pop()}`;
export const clipUrl = (clip: EventClip) => `${apiUrl}/media/clips/${clip.file_path.split("/").pop()}`;

export const api = {
  health: () => request<{ status: string }>("/health"),
  organisations: {
    list: () => request<Organisation[]>("/api/organisations"),
    create: (name: string) => request<Organisation>("/api/organisations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }),
  },
  teams: {
    list: (organisationId?: number) => request<Team[]>(`/api/teams${organisationId ? `?organisation_id=${organisationId}` : ""}`),
    create: (payload: { organisation_id: number; name: string; age_group?: string }) => request<Team>("/api/teams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
  },
  matches: {
    list: (organisationId?: number) => request<Match[]>(`/api/matches${organisationId ? `?organisation_id=${organisationId}` : ""}`),
    create: (payload: { organisation_id: number; home_team_id: number; away_team_id: number; match_date: string; competition?: string; venue?: string }) => request<Match>("/api/matches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    uploadVideo: (matchId: number, file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return request<VideoAsset>(`/api/matches/${matchId}/videos`, { method: "POST", body: formData });
    },
    videos: (matchId: number) => request<VideoAsset[]>(`/api/matches/${matchId}/videos`),
  },
  videos: {
    processingResult: (videoAssetId: number) => request<VideoProcessingResult>(`/api/videos/${videoAssetId}/processing-result`),
  },
  jobs: {
    list: () => request<AnalysisJob[]>("/api/analysis-jobs"),
    create: (payload: { match_id: number; video_asset_id?: number }) => request<AnalysisJob>("/api/analysis-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    get: (jobId: number) => request<AnalysisJob>(`/api/analysis-jobs/${jobId}`),
  },
  timeline: {
    list: (matchId?: number, videoAssetId?: number) => {
      const query = new URLSearchParams();
      if (matchId) query.set("match_id", String(matchId));
      if (videoAssetId) query.set("video_asset_id", String(videoAssetId));
      return request<TimelineEvent[]>(`/api/timeline-events${query.size ? `?${query}` : ""}`);
    },
    create: (payload: Omit<TimelineEvent, "id" | "created_at" | "updated_at" | "clip">) => request<TimelineEvent>("/api/timeline-events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    update: (eventId: number, payload: Partial<TimelineEvent>) => request<TimelineEvent>(`/api/timeline-events/${eventId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    regenerateClip: (eventId: number) => request<EventClip>(`/api/timeline-events/${eventId}/clip`, { method: "POST" }),
  },
};
