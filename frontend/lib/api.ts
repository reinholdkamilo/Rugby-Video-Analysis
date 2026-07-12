const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

export const apiUrl =
  !configuredApiUrl ||
  configuredApiUrl === "http://localhost:8000" ||
  configuredApiUrl.includes(".app.github.dev")
    ? "/backend"
    : configuredApiUrl;

export type Organisation = { id: number; name: string; created_at: string };
export type Team = { id: number; organisation_id: number; name: string; age_group: string | null; created_at: string };
export type Match = { id: number; organisation_id: number; home_team_id: number; away_team_id: number; match_date: string; competition: string | null; venue: string | null; created_at: string };
export type VideoAsset = { id: number; match_id: number; original_filename: string; content_type: string | null; size_bytes: number; created_at: string };
export type AnalysisJob = { id: number; match_id: number; video_asset_id: number | null; status: "queued" | "processing" | "completed" | "failed"; progress_percent: number; message: string | null; created_at: string; updated_at: string };
export type VideoProcessingResult = { id: number; analysis_job_id: number; video_asset_id: number; duration_seconds: number; width: number; height: number; frame_rate: number; video_codec: string | null; audio_codec: string | null; thumbnail_path: string; created_at: string };
export type UploadSession = { upload_id: string; match_id: number; filename: string; size_bytes: number; chunk_size: number; total_chunks: number; uploaded_chunks: number[]; completed: boolean; video_asset_id: number | null; analysis_job_id: number | null };

export type EventType = "kickoff" | "scrum" | "lineout" | "carry" | "tackle" | "ruck" | "maul" | "pass" | "kick" | "turnover" | "penalty" | "try" | "conversion" | "card" | "stoppage" | "custom";
export type EventTeam = "home" | "away" | "neutral";
export type EventClip = { id: number; event_id: number; duration_seconds: number; file_path: string; created_at: string };
export type TimelineEvent = { id: number; match_id: number; video_asset_id: number; event_type: EventType; team: EventTeam; start_seconds: number; end_seconds: number; player_name: string | null; outcome: string | null; notes: string | null; phase_number: number | null; field_zone: string | null; clip_requested: boolean; created_at: string; updated_at: string; clip: EventClip | null };
export type SuggestionStatus = "pending" | "accepted" | "rejected";
export type AutomaticSuggestion = { id: number; match_id: number; video_asset_id: number; event_type: EventType; team: EventTeam; start_seconds: number; end_seconds: number; confidence: number; label: string; reason: string; status: SuggestionStatus; timeline_event_id: number | null };
export type VisionObservation = { id: number; match_id: number; video_asset_id: number; timestamp_seconds: number; frame_path: string; field_green_ratio: number; field_visible: boolean; scoreboard_region: string | null; scoreboard_confidence: number; brightness: number; motion_score: number };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `Request failed with status ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const thumbnailUrl = (result: VideoProcessingResult) => `${apiUrl}/media/thumbnails/${result.thumbnail_path.split("/").pop()}`;
export const clipUrl = (clip: EventClip) => `${apiUrl}/media/clips/${clip.file_path.split("/").pop()}`;
export const visionFrameUrl = (observation: VisionObservation) => {
  const marker = "vision_frames/";
  const relative = observation.frame_path.includes(marker) ? observation.frame_path.split(marker)[1] : observation.frame_path.split("/").slice(-2).join("/");
  return `${apiUrl}/media/vision/${relative}`;
};

export async function uploadVideoInChunks(matchId: number, file: File, onProgress: (percent: number, message: string) => void, signal?: AbortSignal): Promise<UploadSession> {
  const chunkSize = 4 * 1024 * 1024;
  let session = await request<UploadSession>("/api/uploads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ match_id: matchId, filename: file.name, content_type: file.type || null, size_bytes: file.size, chunk_size: chunkSize }), signal });
  const uploaded = new Set(session.uploaded_chunks);
  for (let index = 0; index < session.total_chunks; index += 1) {
    if (uploaded.has(index)) continue;
    const chunk = file.slice(index * chunkSize, Math.min(file.size, (index + 1) * chunkSize));
    session = await request<UploadSession>(`/api/uploads/${session.upload_id}/chunks/${index}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: chunk, signal });
    onProgress(Math.round((session.uploaded_chunks.length / session.total_chunks) * 95), `Uploading chunk ${session.uploaded_chunks.length} of ${session.total_chunks}`);
  }
  onProgress(97, "Finalising video upload");
  session = await request<UploadSession>(`/api/uploads/${session.upload_id}/complete`, { method: "POST", signal });
  onProgress(100, "Upload complete and analysis queued");
  return session;
}

export const api = {
  health: () => request<{ status: string }>("/health"),
  organisations: { list: () => request<Organisation[]>("/api/organisations"), create: (name: string) => request<Organisation>("/api/organisations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }) },
  teams: { list: (organisationId?: number) => request<Team[]>(`/api/teams${organisationId ? `?organisation_id=${organisationId}` : ""}`), create: (payload: { organisation_id: number; name: string; age_group?: string }) => request<Team>("/api/teams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }) },
  matches: { list: (organisationId?: number) => request<Match[]>(`/api/matches${organisationId ? `?organisation_id=${organisationId}` : ""}`), create: (payload: { organisation_id: number; home_team_id: number; away_team_id: number; match_date: string; competition?: string; venue?: string }) => request<Match>("/api/matches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), videos: (matchId: number) => request<VideoAsset[]>(`/api/matches/${matchId}/videos`) },
  videos: { processingResult: (videoAssetId: number) => request<VideoProcessingResult>(`/api/videos/${videoAssetId}/processing-result`) },
  jobs: { list: () => request<AnalysisJob[]>("/api/analysis-jobs"), create: (payload: { match_id: number; video_asset_id?: number }) => request<AnalysisJob>("/api/analysis-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), get: (jobId: number) => request<AnalysisJob>(`/api/analysis-jobs/${jobId}`) },
  timeline: { list: (matchId?: number, videoAssetId?: number) => { const query = new URLSearchParams(); if (matchId) query.set("match_id", String(matchId)); if (videoAssetId) query.set("video_asset_id", String(videoAssetId)); return request<TimelineEvent[]>(`/api/timeline-events${query.size ? `?${query}` : ""}`); }, create: (payload: Omit<TimelineEvent, "id" | "created_at" | "updated_at" | "clip">) => request<TimelineEvent>("/api/timeline-events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), update: (eventId: number, payload: Partial<TimelineEvent>) => request<TimelineEvent>(`/api/timeline-events/${eventId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), regenerateClip: (eventId: number) => request<EventClip>(`/api/timeline-events/${eventId}/clip`, { method: "POST" }) },
  suggestions: { detect: (videoAssetId: number, sceneThreshold = 0.28) => request<AutomaticSuggestion[]>("/api/automatic-suggestions/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video_asset_id: videoAssetId, replace_pending: true, scene_threshold: sceneThreshold }) }), list: (videoAssetId?: number, status?: SuggestionStatus) => { const query = new URLSearchParams(); if (videoAssetId) query.set("video_asset_id", String(videoAssetId)); if (status) query.set("suggestion_status", status); return request<AutomaticSuggestion[]>(`/api/automatic-suggestions${query.size ? `?${query}` : ""}`); }, update: (suggestionId: number, payload: Partial<Pick<AutomaticSuggestion, "event_type" | "team" | "start_seconds" | "end_seconds" | "label">>) => request<AutomaticSuggestion>(`/api/automatic-suggestions/${suggestionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), accept: (suggestionId: number) => request<AutomaticSuggestion>(`/api/automatic-suggestions/${suggestionId}/accept`, { method: "POST" }), reject: (suggestionId: number) => request<AutomaticSuggestion>(`/api/automatic-suggestions/${suggestionId}/reject`, { method: "POST" }) },
  vision: { run: (videoAssetId: number, intervalSeconds = 2) => request<VisionObservation[]>("/api/vision/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video_asset_id: videoAssetId, interval_seconds: intervalSeconds, max_frames: 240, replace_existing: true }) }), list: (videoAssetId: number) => request<VisionObservation[]>(`/api/vision/observations?video_asset_id=${videoAssetId}`) },
};
