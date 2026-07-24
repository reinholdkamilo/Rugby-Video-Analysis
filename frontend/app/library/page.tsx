"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { LibraryItem, LibraryItemType, SportType, api, thumbnailPathUrl } from "@/lib/api";

const TYPE_LABELS: Record<LibraryItemType | "all", string> = {
  all: "All types",
  game: "Games",
  clip: "Clips",
  playlist: "Playlists",
  report: "Reports",
  evidence: "Evidence",
  coach_review: "Coach Review",
};

const SPORT_LABELS: Record<SportType | "all", string> = {
  all: "All sports",
  rugby_union: "Rugby Union",
  rugby_league: "Rugby League",
  afl: "AFL",
};

const inputClass = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-emerald-500 [color-scheme:light]";

function formatDuration(seconds: number | null) {
  if (!seconds) return "Duration pending";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function itemHref(item: LibraryItem) {
  if (item.item_type === "report" && item.match_id) return `/reports?match_id=${item.match_id}`;
  if (item.collection_id) return `/library/review/${item.collection_id}`;
  if (item.match_id) return `/library/review/match-${item.match_id}`;
  return "/library";
}

function codingHref(item: LibraryItem) {
  const query = new URLSearchParams();
  if (item.match_id) query.set("match_id", String(item.match_id));
  if (item.video_asset_id) query.set("video_id", String(item.video_asset_id));
  return `/video-analysis${query.size ? `?${query}` : ""}`;
}

export default function LibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<LibraryItemType | "all">("all");
  const [sportFilter, setSportFilter] = useState<SportType | "all">("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("Loading Library...");
  const [busy, setBusy] = useState(false);

  const selectedItems = useMemo(() => items.filter((item) => selectedIds.includes(item.id)), [items, selectedIds]);
  const counts = useMemo(() => items.reduce<Record<string, number>>((acc, item) => {
    acc[item.item_type] = (acc[item.item_type] ?? 0) + 1;
    return acc;
  }, {}), [items]);

  async function loadItems(nextSearch = search, nextType = typeFilter, nextSport = sportFilter) {
    setBusy(true);
    try {
      const data = await api.library.items({
        search: nextSearch.trim() || undefined,
        item_type: nextType,
        sport_type: nextSport,
        limit: 180,
      });
      setItems(data);
      setNotice(`${data.length} library item${data.length === 1 ? "" : "s"} loaded.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load the Library.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadItems("", "all", "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadItems();
  }

  function toggleSelected(itemId: string) {
    setSelectedIds((current) => current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]);
  }

  async function createReviewPackage() {
    const refs = selectedItems
      .map((item) => {
        if (item.timeline_event_id) return { ref_type: "timeline_event" as const, ref_id: item.timeline_event_id, label: item.title };
        if (item.evidence_item_id) return { ref_type: "evidence" as const, ref_id: item.evidence_item_id, label: item.title };
        if (item.video_asset_id) return { ref_type: "video" as const, ref_id: item.video_asset_id, label: item.title };
        return null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (!refs.length) {
      setNotice("Select clips, evidence, or games before creating a coach review.");
      return;
    }
    const first = selectedItems[0];
    setBusy(true);
    try {
      const collection = await api.library.createCollection({
        collection_type: "coach_review",
        title: `${first.home_team ?? "Coach"} review package`,
        description: "Coach review package created from Library selections.",
        sport_type: first.sport_type ?? "rugby_union",
        match_id: first.match_id,
        video_asset_id: first.video_asset_id,
        labels: ["Coach review", "Library"],
        items: refs,
      });
      setNotice(`Coach Review created: ${collection.title}`);
      setSelectedIds([]);
      await loadItems();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to create coach review.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="bg-slate-950 text-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-end justify-between gap-6 px-6 py-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-400">Central workspace</p>
            <h1 className="mt-1 text-3xl font-bold">Library</h1>
          </div>
          <nav className="flex gap-3 text-sm">
            <Link href="/upload" className="rounded-lg border border-slate-700 px-3 py-2">Upload</Link>
            <Link href="/video-analysis" className="rounded-lg border border-slate-700 px-3 py-2">Video Analysis</Link>
            <button type="button" onClick={createReviewPackage} disabled={busy || !selectedIds.length} className="rounded-lg bg-emerald-400 px-4 py-2 font-bold text-slate-950 disabled:opacity-50">
              Create Coach Review
            </button>
          </nav>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1600px] gap-5 px-6 py-6 lg:grid-cols-[310px_1fr]">
        <aside className="space-y-4" data-design-id="library-filters-block" data-design-label="Library filters block">
          <form onSubmit={applyFilters} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Find media</h2>
            <div className="mt-4 grid gap-3">
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search team, event, label..." className={inputClass} />
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as LibraryItemType | "all")} className={inputClass}>
                {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select value={sportFilter} onChange={(event) => setSportFilter(event.target.value as SportType | "all")} className={inputClass}>
                {Object.entries(SPORT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <button disabled={busy} className="rounded-lg bg-slate-950 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Apply filters</button>
            </div>
            <p className="mt-4 text-sm text-slate-600">{notice}</p>
          </form>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold">Filters</h2>
            <div className="mt-3 grid gap-2 text-sm text-slate-700">
              {Object.entries(TYPE_LABELS).filter(([key]) => key !== "all").map(([key, label]) => (
                <button key={key} type="button" onClick={() => setTypeFilter(key as LibraryItemType)} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left">
                  <span>{label}</span>
                  <strong>{counts[key] ?? 0}</strong>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="space-y-4" data-design-id="library-grid-block" data-design-label="Library grid block">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">Media, clips, reports and review packages</h2>
                <p className="text-sm text-slate-600">{selectedIds.length ? `${selectedIds.length} selected for review packaging` : "Open a match, clip, report, evidence item or coach review from one place."}</p>
              </div>
              <div className="flex rounded-lg border border-slate-200 p-1 text-sm">
                <button type="button" onClick={() => setViewMode("grid")} className={`rounded-md px-3 py-2 font-bold ${viewMode === "grid" ? "bg-slate-950 text-white" : "text-slate-700"}`}>Grid</button>
                <button type="button" onClick={() => setViewMode("list")} className={`rounded-md px-3 py-2 font-bold ${viewMode === "list" ? "bg-slate-950 text-white" : "text-slate-700"}`}>List</button>
              </div>
            </div>
          </div>

          <div className={viewMode === "grid" ? "grid gap-4 md:grid-cols-2 xl:grid-cols-3" : "grid gap-3"}>
            {items.map((item) => (
              <article key={item.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <button type="button" onClick={() => toggleSelected(item.id)} className={`block h-2 w-full ${selectedIds.includes(item.id) ? "bg-emerald-500" : "bg-slate-200"}`} aria-label={`Select ${item.title}`} />
                <div className="aspect-video bg-slate-900">
                  {item.thumbnail_path ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbnailPathUrl(item.thumbnail_path)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-sm font-bold uppercase tracking-[0.16em] text-slate-400">{TYPE_LABELS[item.item_type]}</div>
                  )}
                </div>
                <div className="grid gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold uppercase text-emerald-800">{TYPE_LABELS[item.item_type]}</span>
                      <h3 className="mt-2 text-lg font-bold leading-tight">{item.title}</h3>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{item.status}</span>
                  </div>
                  <p className="text-sm text-slate-600">{item.sport_display_name ?? "Sport"} · {item.match_date ?? "No date"} · {formatDuration(item.duration_seconds)}</p>
                  <p className="text-sm text-slate-600">{item.competition ?? "No competition"} {item.venue ? `· ${item.venue}` : ""}</p>
                  <div className="flex flex-wrap gap-2">
                    {item.labels.filter(Boolean).slice(0, 4).map((label) => <span key={label} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{label}</span>)}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs font-bold text-slate-600">
                    <span className="rounded-lg bg-slate-100 p-2">{item.event_count} events</span>
                    <span className="rounded-lg bg-slate-100 p-2">{item.clip_count} clips</span>
                    <span className="rounded-lg bg-slate-100 p-2">{item.home_team ?? "Team"}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={itemHref(item)} className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-bold text-white">Open</Link>
                    {item.match_id ? <Link href={codingHref(item)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Open in Video Analysis</Link> : null}
                    {item.match_id ? <Link href={`/reports?match_id=${item.match_id}`} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Report</Link> : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
