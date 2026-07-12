export const apiUrl =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

export type Organisation = {
  id: number;
  name: string;
  created_at: string;
};

export type Team = {
  id: number;
  organisation_id: number;
  name: string;
  age_group: string | null;
  created_at: string;
};

export type Match = {
  id: number;
  organisation_id: number;
  home_team_id: number;
  away_team_id: number;
  match_date: string;
  competition: string | null;
  venue: string | null;
  created_at: string;
};

export type VideoAsset = {
  id: number;
  match_id: number;
  original_filename: string;
  content_type: string | null;
  size_bytes: number;
  created_at: string;
};

export type AnalysisJob = {
  id: number;
  match_id: number;
  video_asset_id: number | null;
  status: "queued" | "processing" | "completed" | "failed";
  progress_percent: number;
  message: string | null;
  created_at: string;
  updated_at: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export const api = {
  health: () => request<{ status: string }>("/health"),
  organisations: {
    list: () => request<Organisation[]>("/api/organisations"),
    create: (name: string) =>
      request<Organisation>("/api/organisations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
  },
  teams: {
    list: (organisationId?: number) =>
      request<Team[]>(`/api/teams${organisationId ? `?organisation_id=${organisationId}` : ""}`),
    create: (payload: { organisation_id: number; name: string; age_group?: string }) =>
      request<Team>("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
  },
  matches: {
    list: (organisationId?: number) =>
      request<Match[]>(`/api/matches${organisationId ? `?organisation_id=${organisationId}` : ""}`),
    create: (payload: {
      organisation_id: number;
      home_team_id: number;
      away_team_id: number;
      match_date: string;
      competition?: string;
      venue?: string;
    }) =>
      request<Match>("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    uploadVideo: (matchId: number, file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      return request<VideoAsset>(`/api/matches/${matchId}/videos`, {
        method: "POST",
        body: formData,
      });
    },
  },
  jobs: {
    list: () => request<AnalysisJob[]>("/api/analysis-jobs"),
    create: (payload: { match_id: number; video_asset_id?: number }) =>
      request<AnalysisJob>("/api/analysis-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    get: (jobId: number) => request<AnalysisJob>(`/api/analysis-jobs/${jobId}`),
  },
};
