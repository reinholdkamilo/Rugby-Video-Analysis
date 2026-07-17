"use client";

import { usePathname } from "next/navigation";
import { MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type LayoutMode = "default" | "stack" | "row" | "grid";

type ThemeSettings = {
  ink: string;
  canvas: string;
  surface: string;
  accent: string;
  action: string;
  textScale: number;
  spacingScale: number;
  radius: number;
  contentWidth: number;
  snapGrid: number;
};

type ElementDesign = {
  id: string;
  label: string;
  groupId?: string;
  custom?: boolean;
  kind?: "block" | "button" | "text" | "row" | "column";
  hidden?: boolean;
  deleted?: boolean;
  order?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  minHeight?: number;
  layout?: LayoutMode;
  columns?: number;
  rows?: number;
  gap?: number;
  padding?: number;
  margin?: number;
  align?: "start" | "center" | "end" | "stretch";
  background?: string;
  color?: string;
  borderColor?: string;
  radius?: number;
  fontSize?: number;
  fontWeight?: number;
  text?: string;
};

type PageSettings = {
  elements: ElementDesign[];
};

type DesignSettings = {
  theme: ThemeSettings;
  pages: Record<string, PageSettings>;
};

type DragState =
  | { mode: "move"; ids: string[]; startX: number; startY: number; bases: Record<string, { x: number; y: number }> }
  | { mode: "resize"; ids: string[]; startX: number; startY: number; bases: Record<string, { width: number; height: number }> };

const DESIGN_STORAGE_KEY = "rugby-video-analysis:app-design-studio:v2";
const LEGACY_DESIGN_STORAGE_KEY = "rugby-video-analysis:app-design-studio:v1";

const DEFAULT_THEME: ThemeSettings = {
  ink: "#13221f",
  canvas: "#f6f7f5",
  surface: "#ffffff",
  accent: "#0e4b45",
  action: "#f5b400",
  textScale: 1,
  spacingScale: 1,
  radius: 18,
  contentWidth: 1440,
  snapGrid: 12,
};

const DEFAULT_SETTINGS: DesignSettings = {
  theme: DEFAULT_THEME,
  pages: {},
};

const editableSelector = [
  "main [data-design-id]",
  "main > header",
  "main > div",
  "main > section",
  "main section",
  "main article",
  "main form",
  "main aside",
  "main .rounded-xl",
  "main .rounded-lg",
  "main button",
  "main a",
  "main h1",
  "main h2",
  "main h3",
  "main h4",
  "main p",
  "main label",
  "main kbd",
].join(",");

const textSelector = "h1,h2,h3,h4,p,span,strong,small,a,button,label,kbd";

function pageKey(pathname: string) {
  return pathname === "/" ? "home" : pathname.replace(/^\/+/, "").split("/")[0] || "home";
}

function readableLabel(value: string) {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function elementLabel(element: Element, fallback: string) {
  const designLabel = element.getAttribute("data-design-label");
  if (designLabel) return readableLabel(designLabel);
  const heading = element.matches(textSelector) ? element : element.querySelector("h1,h2,h3,h4,p,button,a,label");
  const text = heading?.textContent?.trim() || element.getAttribute("aria-label") || fallback;
  return readableLabel(text.slice(0, 54));
}

function elementPriority(element: Element) {
  const value = Number(element.getAttribute("data-design-priority"));
  return Number.isFinite(value) ? value : undefined;
}

function elementSelector(id: string) {
  return `[data-design-id="${CSS.escape(id)}"]`;
}

function unionRect(rects: DOMRect[]) {
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { left, top, width: right - left, height: bottom - top };
}

function loadSettings(): DesignSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  const saved = window.localStorage.getItem(DESIGN_STORAGE_KEY) || window.localStorage.getItem(LEGACY_DESIGN_STORAGE_KEY);
  if (!saved) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(saved) as Partial<DesignSettings>;
    return {
      theme: { ...DEFAULT_THEME, ...parsed.theme },
      pages: parsed.pages ?? {},
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function pageSettings(settings: DesignSettings, key: string): PageSettings {
  return settings.pages[key] ?? { elements: [] };
}

function isTextEditableElement(element: HTMLElement) {
  if (!element.matches(textSelector)) return false;
  if (element.querySelector("input,select,textarea,video")) return false;
  const text = element.textContent?.trim() ?? "";
  return Boolean(text) && text.length < 180;
}

function numericValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function snap(value: number, grid: number) {
  const size = Math.max(1, grid);
  return Math.round(value / size) * size;
}

function closestDesignElement(target: EventTarget | null) {
  return target instanceof HTMLElement ? target.closest<HTMLElement>("[data-design-id]") : null;
}

function isDesignPanelInput(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (!target.closest(".design-studio-panel")) return false;
  return target.matches("input,select,textarea,button") || Boolean(target.closest("input,select,textarea,button"));
}

export function AppDesignStudio() {
  const pathname = usePathname();
  const key = pageKey(pathname);
  const dragRef = useRef<DragState | null>(null);
  const [settings, setSettings] = useState<DesignSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [elements, setElements] = useState<ElementDesign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [panelTab, setPanelTab] = useState<"element" | "layout" | "blocks" | "text" | "style" | "page">("element");

  const currentPage = useMemo(() => pageSettings(settings, key), [key, settings]);
  const currentElements = elements.length ? elements : currentPage.elements;
  const priorityElements = currentElements.filter((item) => (item.order ?? 1000) < 1000);
  const selected = currentElements.find((item) => item.id === selectedId) ?? null;
  const activeSelectionIds = useMemo(() => selectedIds.length ? selectedIds : selectedId ? [selectedId] : [], [selectedId, selectedIds]);
  const selectedGroupId = selected?.groupId;

  const updateElement = useCallback((id: string, updates: Partial<ElementDesign>) => {
    setSettings((current) => {
      const page = pageSettings(current, key);
      const existing = page.elements.find((item) => item.id === id) ?? elements.find((item) => item.id === id) ?? { id, label: readableLabel(id) };
      const nextElement = { ...existing, ...updates };
      const nextElements = page.elements.some((item) => item.id === id)
        ? page.elements.map((item) => item.id === id ? nextElement : item)
        : [...page.elements, nextElement];
      return { ...current, pages: { ...current.pages, [key]: { elements: nextElements } } };
    });
    setElements((current) => current.map((item) => item.id === id ? { ...item, ...updates } : item));
  }, [elements, key]);

  const updateElements = useCallback((updates: Record<string, Partial<ElementDesign>>) => {
    const ids = Object.keys(updates);
    if (!ids.length) return;
    setSettings((current) => {
      const page = pageSettings(current, key);
      const nextElements = [...page.elements];
      for (const id of ids) {
        const existingIndex = nextElements.findIndex((item) => item.id === id);
        const existing = existingIndex >= 0 ? nextElements[existingIndex] : elements.find((item) => item.id === id) ?? { id, label: readableLabel(id) };
        const nextElement = { ...existing, ...updates[id] };
        if (existingIndex >= 0) nextElements[existingIndex] = nextElement;
        else nextElements.push(nextElement);
      }
      return { ...current, pages: { ...current.pages, [key]: { elements: nextElements } } };
    });
    setElements((current) => current.map((item) => updates[item.id] ? { ...item, ...updates[item.id] } : item));
  }, [elements, key]);

  const applyElementDesigns = useCallback(() => {
    const saved = pageSettings(settings, key).elements;
    const active = open || saved.length > 0;
    document.body.classList.toggle("design-mode-active", open);
    document.querySelectorAll<HTMLElement>("[data-design-id]").forEach((element) => {
      const design = saved.find((item) => item.id === element.dataset.designId);
      element.classList.toggle("design-editable", open);
      element.classList.toggle("design-selected", open && activeSelectionIds.includes(element.dataset.designId ?? ""));
      element.classList.toggle("design-grouped", open && Boolean(design?.groupId));
      element.hidden = Boolean(design?.hidden);
      element.classList.toggle("design-hidden-section", Boolean(design?.hidden));
      element.style.order = design?.order !== undefined ? String(design.order) : "";
      element.style.transform = design?.x || design?.y ? `translate(${design.x ?? 0}px, ${design.y ?? 0}px)` : "";
      element.style.width = design?.width ? `${design.width}px` : "";
      element.style.height = design?.height ? `${design.height}px` : "";
      element.style.minHeight = design?.minHeight ? `${design.minHeight}px` : "";
      element.style.gap = design?.gap !== undefined ? `${design.gap}px` : "";
      element.style.padding = design?.padding !== undefined ? `${design.padding}px` : "";
      element.style.margin = design?.margin !== undefined ? `${design.margin}px` : "";
      element.style.background = design?.background ?? "";
      element.style.color = design?.color ?? "";
      element.style.borderColor = design?.borderColor ?? "";
      element.style.borderRadius = design?.radius !== undefined ? `${design.radius}px` : "";
      element.style.fontSize = design?.fontSize ? `${design.fontSize}px` : "";
      element.style.fontWeight = design?.fontWeight ? String(design.fontWeight) : "";
      element.style.justifyContent = design?.align && design.align !== "stretch" ? design.align : "";
      element.style.alignItems = design?.align ?? "";

      if (design?.layout && design.layout !== "default") {
        element.classList.add("design-layout-controlled");
        if (design.layout === "grid") {
          element.style.display = "grid";
          element.style.gridTemplateColumns = `repeat(${design.columns ?? 2}, minmax(0, 1fr))`;
          element.style.gridTemplateRows = design.rows ? `repeat(${design.rows}, minmax(0, auto))` : "";
        } else {
          element.style.display = "flex";
          element.style.flexDirection = design.layout === "row" ? "row" : "column";
          element.style.flexWrap = "wrap";
          element.style.gridTemplateRows = "";
        }
      } else {
        element.classList.remove("design-layout-controlled");
        if (!active) {
          element.style.display = "";
          element.style.gridTemplateColumns = "";
          element.style.gridTemplateRows = "";
          element.style.flexDirection = "";
          element.style.flexWrap = "";
        }
      }

      if (design?.text && (isTextEditableElement(element) || design.custom)) {
        element.textContent = design.text;
      }
      element.contentEditable = open && (isTextEditableElement(element) || Boolean(design?.custom)) ? "true" : "false";
    });
  }, [activeSelectionIds, key, open, settings]);

  const detectElements = useCallback((): ElementDesign[] => {
    const main = document.querySelector("main");
    if (!main) return [];
    const candidates = Array.from(main.querySelectorAll<HTMLElement>(editableSelector));
    const seen = new Set<HTMLElement>();
    return candidates
      .filter((element) => {
        if (seen.has(element)) return false;
        seen.add(element);
        if (element.closest(".design-studio-panel")) return false;
        if (element.matches("video,source")) return false;
        if (element.matches("input,select,textarea") && !element.dataset.designId) return false;
        return element.offsetParent !== null || element === main.firstElementChild;
      })
      .slice(0, 360)
      .map((element, index) => {
        const currentId = element.dataset.designId || `${key}-${element.tagName.toLowerCase()}-${index + 1}`;
        element.dataset.designId = currentId;
        return {
          id: currentId,
          label: elementLabel(element, `${element.tagName.toLowerCase()} ${index + 1}`),
          hidden: false,
          order: elementPriority(element) ?? index + 1000,
        };
      });
  }, [key]);

  useEffect(() => {
    setSettings(loadSettings());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(settings));
  }, [ready, settings]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--ink", settings.theme.ink);
    root.style.setProperty("--canvas", settings.theme.canvas);
    root.style.setProperty("--surface", settings.theme.surface);
    root.style.setProperty("--forest", settings.theme.accent);
    root.style.setProperty("--forest-deep", settings.theme.accent);
    root.style.setProperty("--yellow", settings.theme.action);
    root.style.setProperty("--yellow-hover", settings.theme.action);
    root.style.setProperty("--design-text-scale", String(settings.theme.textScale));
    root.style.setProperty("--design-spacing-scale", String(settings.theme.spacingScale));
    root.style.setProperty("--design-radius", `${settings.theme.radius}px`);
    root.style.setProperty("--design-content-width", `${settings.theme.contentWidth}px`);
  }, [settings.theme]);

  useEffect(() => {
    if (!ready) return;
    const sync = () => {
      const detected = detectElements();
      const saved = pageSettings(settings, key).elements;
      const custom = saved.filter((item) => item.custom && !item.deleted);
      const merged: ElementDesign[] = [
        ...detected.map((item) => saved.find((element) => element.id === item.id) ?? item),
        ...custom,
      ].filter((item) => !item.deleted);
      setElements(merged.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    };
    const timer = window.setTimeout(sync, 100);
    return () => window.clearTimeout(timer);
  }, [detectElements, key, pathname, ready, settings]);

  useEffect(() => {
    applyElementDesigns();
  }, [applyElementDesigns, elements]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if ((event.target as HTMLElement | null)?.closest(".design-studio-panel,.design-studio-toggle,.design-resize-handle,.design-drag-handle")) return;
      const element = closestDesignElement(event.target);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      const id = element.dataset.designId ?? null;
      if (!id) return;
      const clicked = currentElements.find((item) => item.id === id);
      const groupIds = clicked?.groupId ? currentElements.filter((item) => item.groupId === clicked.groupId).map((item) => item.id) : [id];
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        setSelectedIds((current) => {
          const next = new Set(current.length ? current : selectedId ? [selectedId] : []);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          const values = Array.from(next);
          setSelectedId(values[values.length - 1] ?? null);
          return values;
        });
      } else {
        setSelectedIds(groupIds);
        setSelectedId(id);
      }
    };
    const onBlur = (event: FocusEvent) => {
      const element = closestDesignElement(event.target);
      const design = currentElements.find((item) => item.id === element?.dataset.designId);
      if (!element || (!isTextEditableElement(element) && !design?.custom)) return;
      updateElement(element.dataset.designId ?? "", { text: element.textContent?.trim() ?? "" });
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("blur", onBlur, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("blur", onBlur, true);
    };
  }, [currentElements, open, selectedId, updateElement]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const state = dragRef.current;
      if (!state) return;
      event.preventDefault();
      if (state.mode === "move") {
        const updates = Object.fromEntries(state.ids.map((id) => [
          id,
          {
            x: snap(state.bases[id].x + event.clientX - state.startX, settings.theme.snapGrid),
            y: snap(state.bases[id].y + event.clientY - state.startY, settings.theme.snapGrid),
          },
        ]));
        updateElements(updates);
      } else {
        const updates = Object.fromEntries(state.ids.map((id) => [
          id,
          {
            width: Math.max(80, snap(state.bases[id].width + event.clientX - state.startX, settings.theme.snapGrid)),
            height: Math.max(36, snap(state.bases[id].height + event.clientY - state.startY, settings.theme.snapGrid)),
          },
        ]));
        updateElements(updates);
      }
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [settings.theme.snapGrid, updateElements]);

  function updateTheme(updates: Partial<ThemeSettings>) {
    setSettings((current) => ({ ...current, theme: { ...current.theme, ...updates } }));
  }

  function updateCurrent(updates: Partial<ElementDesign>) {
    if (!activeSelectionIds.length) return;
    updateElements(Object.fromEntries(activeSelectionIds.map((id) => [id, updates])));
  }

  const nudgeSelected = useCallback((direction: "up" | "down" | "left" | "right", event: KeyboardEvent) => {
    if (!activeSelectionIds.length) return;
    const baseStep = event.altKey ? 1 : settings.theme.snapGrid;
    const step = event.shiftKey ? baseStep * 4 : baseStep;
    const updates = Object.fromEntries(activeSelectionIds.map((id) => {
      const item = currentElements.find((element) => element.id === id);
      return [
        id,
        {
          x: (item?.x ?? 0) + (direction === "left" ? -step : direction === "right" ? step : 0),
          y: (item?.y ?? 0) + (direction === "up" ? -step : direction === "down" ? step : 0),
        },
      ];
    }));
    updateElements(updates);
  }, [activeSelectionIds, currentElements, settings.theme.snapGrid, updateElements]);

  useEffect(() => {
    if (!open || !activeSelectionIds.length) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isDesignPanelInput(event.target)) return;
      const directions: Record<string, "up" | "down" | "left" | "right"> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      nudgeSelected(direction, event);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeSelectionIds.length, nudgeSelected, open]);

  function moveElement(direction: -1 | 1) {
    if (!selectedId) return;
    const list = [...currentElements].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const index = list.findIndex((item) => item.id === selectedId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return;
    const [item] = list.splice(index, 1);
    list.splice(nextIndex, 0, item);
    const reordered = list.map((item, order) => ({ ...item, order }));
    setSettings((current) => ({ ...current, pages: { ...current.pages, [key]: { elements: reordered } } }));
    setElements(reordered);
  }

  function addCustomElement(kind: NonNullable<ElementDesign["kind"]>) {
    const customCount = currentElements.filter((item) => item.custom).length;
    const defaults: Record<NonNullable<ElementDesign["kind"]>, Partial<ElementDesign>> = {
      block: { label: "New block", text: "New block", width: 320, height: 180, padding: 20, background: "#ffffff", color: "#13221f", borderColor: "#dfe6e2", radius: 14, layout: "stack", gap: 12 },
      row: { label: "New row", text: "New row", width: 640, height: 120, padding: 16, background: "#ffffff", color: "#13221f", borderColor: "#dfe6e2", radius: 12, layout: "row", gap: 12 },
      column: { label: "New column", text: "New column", width: 260, height: 360, padding: 16, background: "#ffffff", color: "#13221f", borderColor: "#dfe6e2", radius: 12, layout: "stack", gap: 12 },
      button: { label: "New button", text: "New button", width: 160, height: 48, padding: 12, background: settings.theme.action, color: "#13221f", borderColor: settings.theme.action, radius: 10, fontWeight: 900 },
      text: { label: "New text", text: "New text", width: 280, height: 80, padding: 8, background: "#ffffff", color: "#13221f", borderColor: "#dfe6e2", radius: 8, fontSize: 18, fontWeight: 700 },
    };
    const defaultDesign = defaults[kind];
    const next: ElementDesign = {
      id: `${key}-custom-${kind}-${Date.now()}`,
      label: defaultDesign.label ?? readableLabel(kind),
      custom: true,
      kind,
      order: currentElements.length + 1,
      x: snap(48 + customCount * 24, settings.theme.snapGrid),
      y: snap(120 + customCount * 24, settings.theme.snapGrid),
      ...defaultDesign,
    };
    setSettings((current) => {
      const page = pageSettings(current, key);
      return { ...current, pages: { ...current.pages, [key]: { elements: [...page.elements, next] } } };
    });
    setElements((current) => [...current, next]);
    setSelectedId(next.id);
    setSelectedIds([next.id]);
    setPanelTab("element");
  }

  function deleteSelected() {
    if (!activeSelectionIds.length) return;
    setSettings((current) => {
      const page = pageSettings(current, key);
      let nextElements = [...page.elements];
      for (const id of activeSelectionIds) {
        const selectedElement = currentElements.find((item) => item.id === id);
        const existing = page.elements.find((item) => item.id === id) ?? selectedElement;
        nextElements = selectedElement?.custom
          ? nextElements.filter((item) => item.id !== id)
          : nextElements.some((item) => item.id === id)
            ? nextElements.map((item) => item.id === id ? { ...item, hidden: true, deleted: true } : item)
            : existing
              ? [...nextElements, { ...existing, hidden: true, deleted: true }]
              : nextElements;
      }
      return { ...current, pages: { ...current.pages, [key]: { elements: nextElements } } };
    });
    setElements((current) => current.filter((item) => !activeSelectionIds.includes(item.id)));
    setSelectedId(null);
    setSelectedIds([]);
  }

  function resetSelected() {
    if (!activeSelectionIds.length) return;
    setSettings((current) => {
      const page = pageSettings(current, key);
      return { ...current, pages: { ...current.pages, [key]: { elements: page.elements.filter((item) => !activeSelectionIds.includes(item.id)) } } };
    });
  }

  function resetCurrentPage() {
    setSelectedId(null);
    setSelectedIds([]);
    setElements(detectElements());
    setSettings((current) => {
      const pages = { ...current.pages };
      delete pages[key];
      return { ...current, pages };
    });
  }

  function resetAllDesign() {
    setSelectedId(null);
    setSelectedIds([]);
    setSettings(DEFAULT_SETTINGS);
    setElements(detectElements());
  }

  function groupSelected() {
    if (activeSelectionIds.length < 2) return;
    const groupId = `group-${Date.now()}`;
    updateElements(Object.fromEntries(activeSelectionIds.map((id) => [id, { groupId }])));
  }

  function ungroupSelected() {
    const groupIds = new Set(currentElements.filter((item) => activeSelectionIds.includes(item.id) && item.groupId).map((item) => item.groupId));
    const ids = currentElements.filter((item) => activeSelectionIds.includes(item.id) || (item.groupId && groupIds.has(item.groupId))).map((item) => item.id);
    updateElements(Object.fromEntries(ids.map((id) => [id, { groupId: undefined }])));
    setSelectedIds(ids);
  }

  function selectCurrentGroup() {
    if (!selectedGroupId) return;
    setSelectedIds(currentElements.filter((item) => item.groupId === selectedGroupId).map((item) => item.id));
  }

  function startHandleDrag(mode: DragState["mode"], event: ReactMouseEvent<HTMLButtonElement>) {
    const ids = activeSelectionIds.length ? activeSelectionIds : selectedId ? [selectedId] : [];
    if (!ids.length) return;
    event.preventDefault();
    event.stopPropagation();
    if (mode === "move") {
      dragRef.current = {
        mode,
        ids,
        startX: event.clientX,
        startY: event.clientY,
        bases: Object.fromEntries(ids.map((id) => {
          const item = currentElements.find((element) => element.id === id);
          return [id, { x: item?.x ?? 0, y: item?.y ?? 0 }];
        })),
      };
    } else {
      dragRef.current = {
        mode,
        ids,
        startX: event.clientX,
        startY: event.clientY,
        bases: Object.fromEntries(ids.map((id) => {
          const element = document.querySelector<HTMLElement>(elementSelector(id));
          const rect = element?.getBoundingClientRect();
          const item = currentElements.find((element) => element.id === id);
          return [id, { width: item?.width ?? Math.round(rect?.width ?? 120), height: item?.height ?? Math.round(rect?.height ?? 48) }];
        })),
      };
    }
  }

  const selectedRect = activeSelectionIds.length && open
    ? unionRect(activeSelectionIds.map((id) => document.querySelector<HTMLElement>(elementSelector(id))?.getBoundingClientRect()).filter((rect): rect is DOMRect => Boolean(rect)))
    : null;

  if (!ready) return null;

  return (
    <>
      <button type="button" className="design-studio-toggle" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        Design
      </button>

      {open && selectedRect ? (
        <div className="design-selection-tools" style={{ left: selectedRect.left, top: selectedRect.top, width: selectedRect.width, height: selectedRect.height }}>
          <button type="button" className="design-drag-handle" onMouseDown={(event) => startHandleDrag("move", event)}>Move</button>
          <button type="button" className="design-resize-handle" onMouseDown={(event) => startHandleDrag("resize", event)}>Resize</button>
        </div>
      ) : null}

      {open ? (
        <aside className="design-studio-panel" aria-label="App design studio">
          <div className="design-studio-panel__head">
            <div>
              <p>Design Mode</p>
              <h2>{activeSelectionIds.length > 1 ? `${activeSelectionIds.length} selected` : selected ? selected.label : `${readableLabel(key)} Tab`}</h2>
            </div>
            <button type="button" onClick={() => setOpen(false)}>Close</button>
          </div>

          <div className="design-tabs">
            {(["element", "layout", "blocks", "text", "style", "page"] as const).map((tab) => (
              <button key={tab} type="button" onClick={() => setPanelTab(tab)} className={panelTab === tab ? "is-active" : ""}>{readableLabel(tab)}</button>
            ))}
          </div>

          {panelTab === "element" ? (
            <section>
              <h3>Selected Element</h3>
              {selected ? (
                <>
                  <label>Name <input value={selected.label} disabled={activeSelectionIds.length > 1} onChange={(event) => updateCurrent({ label: event.target.value })} /></label>
                  <div className="design-button-row">
                    <button type="button" onClick={() => moveElement(-1)}>Move up</button>
                    <button type="button" onClick={() => moveElement(1)}>Move down</button>
                    <button type="button" onClick={() => updateCurrent({ hidden: !selected.hidden })}>{selected.hidden ? "Show" : "Hide"}</button>
                  </div>
                  <div className="design-button-row">
                    <button type="button" onClick={groupSelected} disabled={activeSelectionIds.length < 2}>Group</button>
                    <button type="button" onClick={ungroupSelected} disabled={!activeSelectionIds.some((id) => currentElements.find((item) => item.id === id)?.groupId)}>Ungroup</button>
                    <button type="button" onClick={selectCurrentGroup} disabled={!selectedGroupId}>Select group</button>
                  </div>
                  <div className="design-button-row">
                    <button type="button" onClick={() => updateCurrent({ x: 0, y: 0 })}>Reset position</button>
                    <button type="button" onClick={resetSelected}>Reset element</button>
                    <button type="button" className="design-danger" onClick={deleteSelected}>Delete</button>
                  </div>
                  <p className="design-empty">Shift-click to multi-select. Grouped items move and resize together. Arrow keys move the current selection; hold Shift for larger moves or Option for 1px nudges.</p>
                </>
              ) : <p className="design-empty">Click any section, card, text, button or tool on the page.</p>}
            </section>
          ) : null}

          {panelTab === "layout" ? (
            <section>
              <h3>Layout</h3>
              <label>Mode <select value={selected?.layout ?? "default"} onChange={(event) => updateCurrent({ layout: event.target.value as LayoutMode })}><option value="default">Default</option><option value="stack">Stack</option><option value="row">Row</option><option value="grid">Grid</option></select></label>
              <label>Columns <input type="range" min="1" max="8" step="1" value={selected?.columns ?? 2} onChange={(event) => updateCurrent({ columns: Number(event.target.value) })} /></label>
              <label>Rows <input type="range" min="1" max="8" step="1" value={selected?.rows ?? 1} onChange={(event) => updateCurrent({ rows: Number(event.target.value) })} /></label>
              <label>Gap <input type="range" min="0" max="48" step="1" value={selected?.gap ?? 12} onChange={(event) => updateCurrent({ gap: Number(event.target.value) })} /></label>
              <label>Padding <input type="range" min="0" max="64" step="1" value={selected?.padding ?? 16} onChange={(event) => updateCurrent({ padding: Number(event.target.value) })} /></label>
              <label>Margin <input type="range" min="0" max="64" step="1" value={selected?.margin ?? 0} onChange={(event) => updateCurrent({ margin: Number(event.target.value) })} /></label>
              <label>Align <select value={selected?.align ?? "stretch"} onChange={(event) => updateCurrent({ align: event.target.value as ElementDesign["align"] })}><option value="stretch">Stretch</option><option value="start">Left/top</option><option value="center">Center</option><option value="end">Right/bottom</option></select></label>
              <label>Width <input type="number" min="0" value={selected?.width ?? ""} onChange={(event) => updateCurrent({ width: numericValue(event.target.value) })} /></label>
              <label>Height <input type="number" min="0" value={selected?.height ?? ""} onChange={(event) => updateCurrent({ height: numericValue(event.target.value) })} /></label>
            </section>
          ) : null}

          {panelTab === "blocks" ? (
            <section>
              <h3>Add Blocks</h3>
              <div className="design-block-grid">
                <button type="button" onClick={() => addCustomElement("block")}>Block</button>
                <button type="button" onClick={() => addCustomElement("row")}>Row</button>
                <button type="button" onClick={() => addCustomElement("column")}>Column</button>
                <button type="button" onClick={() => addCustomElement("button")}>Button</button>
                <button type="button" onClick={() => addCustomElement("text")}>Text</button>
              </div>
              <p className="design-empty">New blocks are added to this tab. Select them to move, resize, style, edit text or delete.</p>
            </section>
          ) : null}

          {panelTab === "text" ? (
            <section>
              <h3>Text</h3>
              <p className="design-empty">Text can also be edited directly on the page while Design Mode is open.</p>
              <label>Override <textarea value={selected?.text ?? ""} onChange={(event) => updateCurrent({ text: event.target.value })} /></label>
              <label>Font size <input type="range" min="10" max="72" step="1" value={selected?.fontSize ?? 16} onChange={(event) => updateCurrent({ fontSize: Number(event.target.value) })} /></label>
              <label>Font weight <input type="range" min="300" max="950" step="50" value={selected?.fontWeight ?? 700} onChange={(event) => updateCurrent({ fontWeight: Number(event.target.value) })} /></label>
              <label>Text colour <input type="color" value={selected?.color ?? settings.theme.ink} onChange={(event) => updateCurrent({ color: event.target.value })} /></label>
            </section>
          ) : null}

          {panelTab === "style" ? (
            <section>
              <h3>Style</h3>
              <label>Background <input type="color" value={selected?.background ?? settings.theme.surface} onChange={(event) => updateCurrent({ background: event.target.value })} /></label>
              <label>Text <input type="color" value={selected?.color ?? settings.theme.ink} onChange={(event) => updateCurrent({ color: event.target.value })} /></label>
              <label>Border <input type="color" value={selected?.borderColor ?? "#dfe6e2"} onChange={(event) => updateCurrent({ borderColor: event.target.value })} /></label>
              <label>Radius <input type="range" min="0" max="40" step="1" value={selected?.radius ?? settings.theme.radius} onChange={(event) => updateCurrent({ radius: Number(event.target.value) })} /></label>
            </section>
          ) : null}

          {panelTab === "page" ? (
            <>
              {priorityElements.length ? (
                <section>
                  <h3>Priority Blocks</h3>
                  <div className="design-section-list">
                    {priorityElements.map((element) => (
                      <button key={element.id} type="button" className={element.id === selectedId ? "is-active" : ""} onClick={() => setSelectedId(element.id)}>{element.label}</button>
                    ))}
                  </div>
                </section>
              ) : null}

              <section>
                <h3>Theme</h3>
                <label>Text <input type="color" value={settings.theme.ink} onChange={(event) => updateTheme({ ink: event.target.value })} /></label>
                <label>Background <input type="color" value={settings.theme.canvas} onChange={(event) => updateTheme({ canvas: event.target.value })} /></label>
                <label>Cards <input type="color" value={settings.theme.surface} onChange={(event) => updateTheme({ surface: event.target.value })} /></label>
                <label>Accent <input type="color" value={settings.theme.accent} onChange={(event) => updateTheme({ accent: event.target.value })} /></label>
                <label>Action <input type="color" value={settings.theme.action} onChange={(event) => updateTheme({ action: event.target.value })} /></label>
              </section>

              <section>
                <h3>Page Shape</h3>
                <label>Text size <input type="range" min="0.85" max="1.25" step="0.05" value={settings.theme.textScale} onChange={(event) => updateTheme({ textScale: Number(event.target.value) })} /></label>
                <label>Spacing <input type="range" min="0.75" max="1.45" step="0.05" value={settings.theme.spacingScale} onChange={(event) => updateTheme({ spacingScale: Number(event.target.value) })} /></label>
                <label>Corner radius <input type="range" min="0" max="28" step="1" value={settings.theme.radius} onChange={(event) => updateTheme({ radius: Number(event.target.value) })} /></label>
                <label>Content width <input type="range" min="980" max="1760" step="20" value={settings.theme.contentWidth} onChange={(event) => updateTheme({ contentWidth: Number(event.target.value) })} /></label>
                <label>Snap grid <input type="range" min="1" max="32" step="1" value={settings.theme.snapGrid} onChange={(event) => updateTheme({ snapGrid: Number(event.target.value) })} /></label>
              </section>

              <section>
                <h3>Detected Elements</h3>
                <div className="design-section-list">
                  {currentElements.slice(0, 90).map((element) => (
                    <button key={element.id} type="button" className={element.id === selectedId ? "is-active" : ""} onClick={() => setSelectedId(element.id)}>{element.label}</button>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          <div className="design-button-row">
            <button type="button" onClick={resetCurrentPage}>Reset tab</button>
            <button type="button" className="design-reset-all" onClick={resetAllDesign}>Reset all</button>
          </div>
        </aside>
      ) : null}

      {currentElements.filter((element) => element.custom && !element.deleted && !element.hidden).map((element) => (
        <div
          key={element.id}
          data-design-id={element.id}
          className={`design-custom-block design-custom-block--${element.kind ?? "block"}`}
          hidden={Boolean(element.hidden)}
          suppressContentEditableWarning
        >
          {element.text || element.label}
        </div>
      ))}
    </>
  );
}
