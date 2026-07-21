export const apiUrl = "/backend";

const directUploadApiUrl = apiUrl;

export type Organisation = { id: number; name: string; created_at: string };
export type Team = { id: number; organisation_id: number; name: string; age_group: string | null; created_at: string };
export type Match = { id: number; organisation_id: number; home_team_id: number; away_team_id: number; match_date: string; competition: string | null; venue: string | null; created_at: string };
export type VideoAsset = { id: number; match_id: number; original_filename: string; content_type: string | null; size_bytes: number; created_at: string };
export type AnalysisJob = { id: number; match_id: number; video_asset_id: number | null; status: "queued" | "processing" | "completed" | "failed"; progress_percent: number; message: string | null; created_at: string; updated_at: string };
export type VideoProcessingResult = { id: number; analysis_job_id: number; video_asset_id: number; duration_seconds: number; width: number; height: number; frame_rate: number; video_codec: string | null; audio_codec: string | null; thumbnail_path: string; created_at: string };
export type UploadSession = { upload_id: string; match_id: number; filename: string; size_bytes: number; chunk_size: number; total_chunks: number; uploaded_chunks: number[]; completed: boolean; video_asset_id: number | null; analysis_job_id: number | null };

type MultipartPart = { part_number: number; etag: string };
type MultipartSession = { upload_id: string; object_key: string; part_size: number; total_parts: number; uploaded_parts: MultipartPart[]; resumed: boolean };
const TEMPORARY_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024;

export type EventType = "kickoff" | "scrum" | "lineout" | "carry" | "tackle" | "ruck" | "maul" | "pass" | "kick" | "turnover" | "penalty" | "try" | "conversion" | "card" | "stoppage" | "custom";
export type EventTeam = "home" | "away" | "neutral";
export type EventClip = { id: number; event_id: number; duration_seconds: number; file_path: string; created_at: string };
export type TimelineEvent = { id: number; match_id: number; video_asset_id: number; event_type: EventType; team: EventTeam; start_seconds: number; end_seconds: number; player_name: string | null; outcome: string | null; notes: string | null; phase_number: number | null; field_zone: string | null; clip_requested: boolean; event_source?: string; trust_status?: string; linked_event_id?: number | null; linked_reason?: string | null; created_at: string; updated_at: string; clip: EventClip | null };
export type SuggestionStatus = "pending" | "accepted" | "rejected";
export type AutomaticSuggestion = { id: number; match_id: number; video_asset_id: number; event_type: EventType; team: EventTeam; start_seconds: number; end_seconds: number; confidence: number; label: string; reason: string; status: SuggestionStatus; timeline_event_id: number | null };
export type VisionObservation = { id: number; match_id: number; video_asset_id: number; timestamp_seconds: number; frame_path: string; field_green_ratio: number; field_visible: boolean; scoreboard_region: string | null; scoreboard_confidence: number; brightness: number; motion_score: number };
export type RugbyUnderstandingObservation = { id: number; match_id: number; video_asset_id: number; timestamp_seconds: number; estimated_players: number; dominant_team_colour_1: string | null; dominant_team_colour_2: string | null; field_zone: string; activity_level: number; possession_side_candidate: string; confidence: number; source_frame_path: string };
export type EvidenceType = "video" | "clip" | "frame" | "audio" | "referee_audio" | "scoreboard" | "commentary" | "note" | "other";
export type EvidenceItem = { id: number; match_id: number; video_asset_id: number | null; timeline_event_id: number | null; evidence_type: EvidenceType; label: string; rugby_element: string | null; source_uri: string | null; timestamp_seconds: number | null; confidence_label: string | null; notes: string | null; approved_for_training: boolean; status: string; source: string; trust_notes: string | null; created_at: string; updated_at: string };
export type EvidenceItemPayload = Omit<EvidenceItem, "id" | "created_at" | "updated_at" | "status" | "source" | "trust_notes"> & Partial<Pick<EvidenceItem, "status" | "source" | "trust_notes">>;

async function errorMessage(response: Response, fallback: string) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await response.json().catch(() => null)) as { detail?: string; message?: string } | null;
    return body?.detail ?? body?.message ?? fallback;
  }
  const text = (await response.text().catch(() => "")).trim();
  return text && !text.startsWith("<") ? text : fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(await errorMessage(response, `Request failed with status ${response.status}`));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function directUploadRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${directUploadApiUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(await errorMessage(response, `Upload service error (${response.status}). Please retry the upload.`));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const thumbnailUrl = (result: VideoProcessingResult) => `${apiUrl}/media/thumbnails/${result.thumbnail_path.split("/").pop()}`;
export const clipUrl = (clip: EventClip) => `${apiUrl}/media/clips/${clip.file_path.split("/").pop()}`;
export const evidenceClipUrl = (sourceUri: string) => {
  if (/^https?:\/\//i.test(sourceUri)) return sourceUri;
  return `${apiUrl}/media/clips/${sourceUri.split("/").pop()}`;
};
export const visionFrameUrl = (observation: VisionObservation | RugbyUnderstandingObservation) => {
  const framePath = "frame_path" in observation ? observation.frame_path : observation.source_frame_path;
  const marker = "vision_frames/";
  const relative = framePath.includes(marker) ? framePath.split(marker)[1] : framePath.split("/").slice(-2).join("/");
  return `${apiUrl}/media/vision/${relative}`;
};

function uploadKey(matchId: number, file: File) {
  return `rugby-upload:${matchId}:${file.name}:${file.size}:${file.lastModified}`;
}

async function withRetry<T>(operation: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

async function uploadDirectToR2(
  matchId: number,
  file: File,
  onProgress: (percent: number, message: string) => void,
  signal?: AbortSignal,
): Promise<UploadSession> {
  const session = await directUploadRequest<MultipartSession>("/api/multipart-uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ match_id: matchId, filename: file.name, content_type: file.type || null, size_bytes: file.size }),
    signal,
  });

  const completedParts = new Map<number, MultipartPart>();
  for (const part of session.uploaded_parts ?? []) completedParts.set(part.part_number, part);
  if (session.resumed && completedParts.size) {
    const percent = Math.round((completedParts.size / session.total_parts) * 95);
    onProgress(percent, `Resuming full-match upload from part ${completedParts.size + 1} of ${session.total_parts}`);
  }

  for (let partNumber = 1; partNumber <= session.total_parts; partNumber += 1) {
    if (completedParts.has(partNumber)) continue;
    const start = (partNumber - 1) * session.part_size;
    const end = Math.min(file.size, start + session.part_size);
    const part = file.slice(start, end);
    const signed = await directUploadRequest<{ part_number: number; url: string }>(
      `/api/multipart-uploads/part-url?object_key=${encodeURIComponent(session.object_key)}&upload_id=${encodeURIComponent(session.upload_id)}&part_number=${partNumber}`,
      { signal },
    );
    const response = await withRetry(() => fetch(signed.url, { method: "PUT", body: part, signal }));
    if (!response.ok) throw new Error(`R2 rejected part ${partNumber} with status ${response.status}`);
    const etag = response.headers.get("etag");
    if (!etag) throw new Error("Cloudflare R2 did not expose the ETag header. Check the bucket CORS configuration.");
    const uploadedPart = { part_number: partNumber, etag };
    completedParts.set(partNumber, uploadedPart);
    await directUploadRequest<MultipartSession>("/api/multipart-uploads/parts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ object_key: session.object_key, upload_id: session.upload_id, part: uploadedPart }),
      signal,
    });
    const percent = Math.round((completedParts.size / session.total_parts) * 95);
    onProgress(percent, `Uploaded ${completedParts.size} of ${session.total_parts} full-match parts`);
  }

  onProgress(97, "Finalising persistent full-match upload");
  const parts = Array.from(completedParts.values()).sort((a, b) => a.part_number - b.part_number);
  const completed = await directUploadRequest<{ video_asset_id: number; analysis_job_id: number }>("/api/multipart-uploads/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      match_id: matchId,
      filename: file.name,
      content_type: file.type || null,
      size_bytes: file.size,
      object_key: session.object_key,
      upload_id: session.upload_id,
      parts,
    }),
    signal,
  });
  onProgress(100, "Full match stored permanently and analysis queued");
  return {
    upload_id: session.upload_id,
    match_id: matchId,
    filename: file.name,
    size_bytes: file.size,
    chunk_size: session.part_size,
    total_chunks: session.total_parts,
    uploaded_chunks: parts.map((part) => part.part_number - 1),
    completed: true,
    video_asset_id: completed.video_asset_id,
    analysis_job_id: completed.analysis_job_id,
  };
}

async function uploadThroughBackendChunks(
  matchId: number,
  file: File,
  onProgress: (percent: number, message: string) => void,
  signal?: AbortSignal,
): Promise<UploadSession> {
  const chunkSize = 4 * 1024 * 1024;
  const key = uploadKey(matchId, file);
  let session: UploadSession | null = null;
  const savedId = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;

  if (savedId) {
    try {
      session = await request<UploadSession>(`/api/uploads/${savedId}`, { signal });
      if (session.match_id !== matchId || session.filename !== file.name || session.size_bytes !== file.size) session = null;
    } catch {
      session = null;
    }
  }

  if (!session) {
    session = await request<UploadSession>("/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ match_id: matchId, filename: file.name, content_type: file.type || null, size_bytes: file.size, chunk_size: chunkSize }),
      signal,
    });
    if (typeof window !== "undefined") window.localStorage.setItem(key, session.upload_id);
  }

  const uploaded = new Set(session.uploaded_chunks);
  for (let index = 0; index < session.total_chunks; index += 1) {
    if (uploaded.has(index)) continue;
    const chunk = file.slice(index * chunkSize, Math.min(file.size, (index + 1) * chunkSize));
    session = await withRetry(() => request<UploadSession>(`/api/uploads/${session!.upload_id}/chunks/${index}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: chunk,
      signal,
    }));
    onProgress(Math.round((session.uploaded_chunks.length / session.total_chunks) * 95), `Uploaded ${session.uploaded_chunks.length} of ${session.total_chunks} chunks`);
  }
  onProgress(97, "Assembling upload on the server");
  session = await request<UploadSession>(`/api/uploads/${session.upload_id}/complete`, { method: "POST", signal });
  if (typeof window !== "undefined") window.localStorage.removeItem(key);
  onProgress(100, "Upload complete and analysis queued");
  return session;
}

export async function uploadVideoInChunks(
  matchId: number,
  file: File,
  onProgress: (percent: number, message: string) => void,
  signal?: AbortSignal,
): Promise<UploadSession> {
  try {
    return await uploadDirectToR2(matchId, file, onProgress, signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("not configured") && !message.includes("503")) throw error;
    if (file.size > TEMPORARY_UPLOAD_LIMIT_BYTES) {
      throw new Error(
        "Full-match uploads require persistent Cloudflare R2 storage. The temporary upload path is limited to 100 MB because its sessions can disappear if the backend sleeps or restarts.",
      );
    }
    onProgress(0, "Persistent storage unavailable; using temporary upload mode");
    return uploadThroughBackendChunks(matchId, file, onProgress, signal);
  }
}

async function waitForDetectionJob(jobId: number, videoAssetId: number): Promise<AutomaticSuggestion[]> {
  const startedAt = Date.now();
  const timeoutMs = 30 * 60 * 1000;
  while (Date.now() - startedAt < timeoutMs) {
    const job = await api.jobs.get(jobId);
    if (job.status === "completed") return api.suggestions.list(videoAssetId);
    if (job.status === "failed") throw new Error(job.message ?? "Automatic detection failed");
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error("Automatic detection is still running. Refresh the suggestions list in a few minutes.");
}

export const api = {
  health: () => request<{ status: string }>("/health"),
  organisations: { list: () => request<Organisation[]>("/api/organisations"), create: (name: string) => request<Organisation>("/api/organisations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }), delete: (organisationId: number) => request<void>(`/api/organisations/${organisationId}`, { method: "DELETE" }) },
  teams: { list: (organisationId?: number) => request<Team[]>(`/api/teams${organisationId ? `?organisation_id=${organisationId}` : ""}`), create: (payload: { organisation_id: number; name: string; age_group?: string }) => request<Team>("/api/teams", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), delete: (teamId: number) => request<void>(`/api/teams/${teamId}`, { method: "DELETE" }) },
  matches: { list: (organisationId?: number) => request<Match[]>(`/api/matches${organisationId ? `?organisation_id=${organisationId}` : ""}`), create: (payload: { organisation_id: number; home_team_id: number; away_team_id: number; match_date: string; competition?: string; venue?: string }) => request<Match>("/api/matches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), delete: (matchId: number) => request<void>(`/api/matches/${matchId}`, { method: "DELETE" }), videos: (matchId: number) => request<VideoAsset[]>(`/api/matches/${matchId}/videos`) },
  videos: { processingResult: (videoAssetId: number) => request<VideoProcessingResult>(`/api/videos/${videoAssetId}/processing-result`) },
  jobs: { list: () => request<AnalysisJob[]>("/api/analysis-jobs"), create: (payload: { match_id: number; video_asset_id?: number }) => request<AnalysisJob>("/api/analysis-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), get: (jobId: number) => request<AnalysisJob>(`/api/analysis-jobs/${jobId}`) },
  timeline: { list: (matchId?: number, videoAssetId?: number) => { const query = new URLSearchParams(); if (matchId) query.set("match_id", String(matchId)); if (videoAssetId) query.set("video_asset_id", String(videoAssetId)); return request<TimelineEvent[]>(`/api/timeline-events${query.size ? `?${query}` : ""}`); }, create: (payload: Omit<TimelineEvent, "id" | "created_at" | "updated_at" | "clip">) => request<TimelineEvent>("/api/timeline-events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), update: (eventId: number, payload: Partial<TimelineEvent>) => request<TimelineEvent>(`/api/timeline-events/${eventId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), delete: (eventId: number) => request<void>(`/api/timeline-events/${eventId}`, { method: "DELETE" }), regenerateClip: (eventId: number) => request<EventClip>(`/api/timeline-events/${eventId}/clip`, { method: "POST" }) },
  evidence: { list: (matchId?: number, videoAssetId?: number, approvedForTraining?: boolean) => { const query = new URLSearchParams(); if (matchId) query.set("match_id", String(matchId)); if (videoAssetId) query.set("video_asset_id", String(videoAssetId)); if (approvedForTraining !== undefined) query.set("approved_for_training", String(approvedForTraining)); return request<EvidenceItem[]>(`/api/evidence-items${query.size ? `?${query}` : ""}`); }, create: (payload: EvidenceItemPayload) => request<EvidenceItem>("/api/evidence-items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), update: (itemId: number, payload: Partial<EvidenceItemPayload>) => request<EvidenceItem>(`/api/evidence-items/${itemId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), delete: (itemId: number) => request<void>(`/api/evidence-items/${itemId}`, { method: "DELETE" }), deleteAll: (matchId: number) => request<{ evidence_items_deleted: number; clips_deleted: number }>(`/api/evidence-items?match_id=${matchId}&confirm=true`, { method: "DELETE" }) },
  suggestions: { detect: async (videoAssetId: number, sceneThreshold = 0.28) => { const job = await request<AnalysisJob>("/api/automatic-suggestions/detect-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video_asset_id: videoAssetId, replace_pending: true, scene_threshold: sceneThreshold }) }); return waitForDetectionJob(job.id, videoAssetId); }, list: (videoAssetId?: number, status?: SuggestionStatus) => { const query = new URLSearchParams(); if (videoAssetId) query.set("video_asset_id", String(videoAssetId)); if (status) query.set("suggestion_status", status); return request<AutomaticSuggestion[]>(`/api/automatic-suggestions${query.size ? `?${query}` : ""}`); }, update: (suggestionId: number, payload: Partial<Pick<AutomaticSuggestion, "event_type" | "team" | "start_seconds" | "end_seconds" | "label">>) => request<AutomaticSuggestion>(`/api/automatic-suggestions/${suggestionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }), accept: (suggestionId: number) => request<AutomaticSuggestion>(`/api/automatic-suggestions/${suggestionId}/accept`, { method: "POST" }), reject: (suggestionId: number) => request<AutomaticSuggestion>(`/api/automatic-suggestions/${suggestionId}/reject`, { method: "POST" }) },
  vision: { run: (videoAssetId: number, intervalSeconds = 30) => request<VisionObservation[]>("/api/vision/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ video_asset_id: videoAssetId, interval_seconds: intervalSeconds, max_frames: 12, replace_existing: true }) }), list: (videoAssetId: number) => request<VisionObservation[]>(`/api/vision/observations?video_asset_id=${videoAssetId}`) },
  understanding: { run: (videoAssetId: number) => request<RugbyUnderstandingObservation[]>(`/api/understanding/run/${videoAssetId}`, { method: "POST" }), list: (videoAssetId: number) => request<RugbyUnderstandingObservation[]>(`/api/understanding/${videoAssetId}`) },
};
