"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Organisation = { id: number; name: string };
type Team = { id: number; organisation_id: number; name: string };
type Season = { id: number; organisation_id: number; name: string; start_date: string | null; end_date: string | null; is_active: boolean };
type Competition = { id: number; organisation_id: number; season_id: number | null; name: string; level: string | null };
type Player = { id: number; organisation_id: number; team_id: number | null; first_name: string; last_name: string; preferred_name: string | null; position: string | null; jersey_number: number | null; is_active: boolean };
type Catalog = { seasons: Season[]; competitions: Competition[]; players: Player[] };

const fieldClass = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400";
const buttonClass = "rounded-lg bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/backend${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `Request failed with status ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export default function CatalogPage() {
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedOrganisationId, setSelectedOrganisationId] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<Catalog>({ seasons: [], competitions: [], players: [] });
  const [notice, setNotice] = useState("Loading rugby programme data...");
  const [busy, setBusy] = useState(false);

  const selectedTeams = useMemo(
    () => teams.filter((team) => team.organisation_id === selectedOrganisationId),
    [teams, selectedOrganisationId],
  );

  const loadCatalog = useCallback(async (organisationId: number) => {
    const data = await request<Catalog>(`/api/catalog/bootstrap?organisation_id=${organisationId}`);
    setCatalog(data);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [organisationData, teamData] = await Promise.all([
          request<Organisation[]>("/api/organisations"),
          request<Team[]>("/api/teams"),
        ]);
        setOrganisations(organisationData);
        setTeams(teamData);
        const firstId = organisationData[0]?.id ?? null;
        setSelectedOrganisationId(firstId);
        if (firstId) await loadCatalog(firstId);
        setNotice(firstId ? "Programme catalogue ready" : "Create an organisation from the workspace first.");
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Unable to load catalogue");
      }
    })();
  }, [loadCatalog]);

  async function selectOrganisation(id: number | null) {
    setSelectedOrganisationId(id);
    if (!id) return setCatalog({ seasons: [], competitions: [], players: [] });
    try {
      await loadCatalog(id);
      setNotice("Programme catalogue updated");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load catalogue");
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function createSeason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!selectedOrganisationId) return;
    const form = new FormData(formElement);
    await run(async () => {
      await request<Season>("/api/catalog/seasons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisation_id: selectedOrganisationId,
          name: String(form.get("name")).trim(),
          start_date: String(form.get("start_date") || "") || null,
          end_date: String(form.get("end_date") || "") || null,
          is_active: true,
        }),
      });
      await loadCatalog(selectedOrganisationId);
      formElement.reset();
      setNotice("Season created successfully");
    });
  }

  async function createCompetition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!selectedOrganisationId) return;
    const form = new FormData(formElement);
    await run(async () => {
      await request<Competition>("/api/catalog/competitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisation_id: selectedOrganisationId,
          season_id: form.get("season_id") ? Number(form.get("season_id")) : null,
          name: String(form.get("name")).trim(),
          level: String(form.get("level") || "").trim() || null,
        }),
      });
      await loadCatalog(selectedOrganisationId);
      formElement.reset();
      setNotice("Competition created successfully");
    });
  }

  async function createPlayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    if (!selectedOrganisationId) return;
    const form = new FormData(formElement);
    await run(async () => {
      await request<Player>("/api/catalog/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisation_id: selectedOrganisationId,
          team_id: form.get("team_id") ? Number(form.get("team_id")) : null,
          first_name: String(form.get("first_name")).trim(),
          last_name: String(form.get("last_name")).trim(),
          preferred_name: String(form.get("preferred_name") || "").trim() || null,
          position: String(form.get("position") || "").trim() || null,
          jersey_number: form.get("jersey_number") ? Number(form.get("jersey_number")) : null,
          is_active: true,
        }),
      });
      await loadCatalog(selectedOrganisationId);
      formElement.reset();
      setNotice("Player added successfully");
    });
  }

  async function deleteCatalogRecord(path: string, label: string) {
    const confirmed = window.confirm(`Delete ${label}?`);
    if (!confirmed || !selectedOrganisationId) return;
    await run(async () => {
      await request<void>(path, { method: "DELETE" });
      await loadCatalog(selectedOrganisationId);
      setNotice(`${label} deleted`);
    });
  }

  const teamName = (teamId: number | null) => selectedTeams.find((team) => team.id === teamId)?.name ?? "Unassigned";

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-400">Programme foundation</p>
            <h1 className="mt-1 text-2xl font-bold">Rugby Catalogue</h1>
          </div>
          <Link href="/" className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:border-emerald-400">Back to workspace</Link>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 grid gap-4 md:grid-cols-[1fr_2fr]">
          <select className={fieldClass} value={selectedOrganisationId ?? ""} onChange={(event) => void selectOrganisation(event.target.value ? Number(event.target.value) : null)}>
            <option value="">Select organisation</option>
            {organisations.map((organisation) => <option key={organisation.id} value={organisation.id}>{organisation.name}</option>)}
          </select>
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-3 text-sm text-slate-300">{notice}</div>
        </div>

        <section className="grid gap-6 lg:grid-cols-3">
          <form onSubmit={createSeason} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs font-bold uppercase text-slate-500">Structure</p><h2 className="mt-2 text-xl font-bold">Season</h2>
            <input name="name" required minLength={2} placeholder="e.g. 2026 Super Rugby" className={`${fieldClass} mt-5`} />
            <div className="mt-3 grid grid-cols-2 gap-3"><input name="start_date" type="date" className={fieldClass} /><input name="end_date" type="date" className={fieldClass} /></div>
            <button disabled={busy || !selectedOrganisationId} className={`${buttonClass} mt-3 w-full`}>Create season</button>
          </form>

          <form onSubmit={createCompetition} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs font-bold uppercase text-slate-500">Structure</p><h2 className="mt-2 text-xl font-bold">Competition</h2>
            <select name="season_id" className={`${fieldClass} mt-5`}><option value="">No season</option>{catalog.seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}</select>
            <div className="mt-3 grid grid-cols-2 gap-3"><input name="name" required minLength={2} placeholder="Competition" className={fieldClass} /><input name="level" placeholder="Level" className={fieldClass} /></div>
            <button disabled={busy || !selectedOrganisationId} className={`${buttonClass} mt-3 w-full`}>Create competition</button>
          </form>

          <form onSubmit={createPlayer} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs font-bold uppercase text-slate-500">Roster</p><h2 className="mt-2 text-xl font-bold">Player</h2>
            <select name="team_id" className={`${fieldClass} mt-5`}><option value="">Unassigned team</option>{selectedTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
            <div className="mt-3 grid grid-cols-2 gap-3"><input name="first_name" required placeholder="First name" className={fieldClass} /><input name="last_name" required placeholder="Last name" className={fieldClass} /><input name="preferred_name" placeholder="Preferred name" className={fieldClass} /><input name="position" placeholder="Position" className={fieldClass} /><input name="jersey_number" type="number" min={1} max={99} placeholder="Jersey number" className={fieldClass} /></div>
            <button disabled={busy || !selectedOrganisationId} className={`${buttonClass} mt-3 w-full`}>Add player</button>
          </form>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-lg font-bold">Seasons <span className="text-slate-500">({catalog.seasons.length})</span></h2><div className="mt-4 space-y-2">{catalog.seasons.map((season) => <div key={season.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-950 p-3"><div><p className="font-semibold">{season.name}</p><p className="text-xs text-slate-500">{season.start_date || "No start date"} → {season.end_date || "Open ended"}</p></div><button type="button" disabled={busy} onClick={() => void deleteCatalogRecord(`/api/catalog/seasons/${season.id}`, season.name)} className="rounded-md border border-red-400/30 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-400/10">Delete</button></div>)}</div></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-lg font-bold">Competitions <span className="text-slate-500">({catalog.competitions.length})</span></h2><div className="mt-4 space-y-2">{catalog.competitions.map((competition) => <div key={competition.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-950 p-3"><div><p className="font-semibold">{competition.name}</p><p className="text-xs text-slate-500">{competition.level || "Level not set"}</p></div><button type="button" disabled={busy} onClick={() => void deleteCatalogRecord(`/api/catalog/competitions/${competition.id}`, competition.name)} className="rounded-md border border-red-400/30 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-400/10">Delete</button></div>)}</div></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="text-lg font-bold">Players <span className="text-slate-500">({catalog.players.length})</span></h2><div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto">{catalog.players.map((player) => <div key={player.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-950 p-3"><div><p className="font-semibold">{player.jersey_number ? `${player.jersey_number}. ` : ""}{player.preferred_name || `${player.first_name} ${player.last_name}`}</p><p className="text-xs text-slate-500">{player.position || "Position not set"} · {teamName(player.team_id)}</p></div><button type="button" disabled={busy} onClick={() => void deleteCatalogRecord(`/api/catalog/players/${player.id}`, player.preferred_name || `${player.first_name} ${player.last_name}`)} className="rounded-md border border-red-400/30 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-400/10">Delete</button></div>)}</div></div>
        </section>
      </div>
    </main>
  );
}
