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
  contentId?: string;
  groupId?: string;
  custom?: boolean;
  kind?: "block" | "button" | "text" | "row" | "column" | "notes" | "divider" | "label" | "spacer";
  hidden?: boolean;
  deleted?: boolean;
  locked?: boolean;
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
  opacity?: number;
  zIndex?: number;
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

const CODING_STATEFUL_BLOCKS: Array<{ id: string; label: string; kind: NonNullable<ElementDesign["kind"]> }> = [
  { id: "coding-match-video-selector-block", label: "Match/Video Selector", kind: "block" },
  { id: "coding-notice-block", label: "Status Notice", kind: "block" },
  { id: "coding-zone-status-block", label: "Active Zone Status", kind: "block" },
  { id: "coding-workspace-layout-block", label: "Workspace Layout Controls", kind: "block" },
  { id: "coding-playback-block", label: "Playback Area", kind: "block" },
  { id: "coding-video-shell-block", label: "Video Player", kind: "block" },
  { id: "coding-video-controls-block", label: "Video Controls", kind: "block" },
  { id: "coding-quick-matrix-block", label: "Quick Coding Matrix", kind: "block" },
  { id: "coding-quick-home-column", label: "Home Quick Codes", kind: "block" },
  { id: "coding-quick-away-column", label: "Away Quick Codes", kind: "block" },
  { id: "coding-lower-workspace-grid", label: "Lower Workspace", kind: "row" },
  { id: "coding-recent-codes-block", label: "Recent Codes", kind: "block" },
  { id: "coding-manual-event-block", label: "Manual Event Form", kind: "block" },
  { id: "coding-timeline-cleanup-block", label: "Timeline Cleanup", kind: "block" },
  { id: "coding-keyboard-mapping-block", label: "Keyboard Mapping", kind: "block" },
  { id: "coding-zone-mapping-block", label: "Zone Mapping", kind: "block" },
  { id: "coding-floating-home-key-overlay", label: "Home Transparent Overlay", kind: "block" },
  { id: "coding-floating-away-key-overlay", label: "Away Transparent Overlay", kind: "block" },
  { id: "coding-last-code-toast", label: "Last Coded Event Toast", kind: "block" },
];

const CUSTOM_CONTAINER_LIBRARY: Array<{ kind: NonNullable<ElementDesign["kind"]>; label: string; text: string }> = [
  { kind: "block", label: "Blank Container", text: "" },
  { kind: "text", label: "Blank Text Block", text: "Text block" },
  { kind: "notes", label: "Notes Box", text: "Notes" },
  { kind: "divider", label: "Divider/Spacer", text: "" },
  { kind: "label", label: "Custom Label", text: "Label" },
  { kind: "button", label: "Custom Button", text: "Button" },
];

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

function designTargetSelector(isCodingBuilder: boolean) {
  return isCodingBuilder ? "[data-coding-layout-container],[data-design-custom='true']" : "[data-design-id]";
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

function hasVisualLayout(design?: ElementDesign) {
  return design?.x !== undefined || design?.y !== undefined || design?.width !== undefined || design?.height !== undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function closestDesignElement(target: EventTarget | null, isCodingBuilder = false) {
  if (!(target instanceof HTMLElement)) return null;
  const closest = target.closest<HTMLElement>(designTargetSelector(isCodingBuilder));
  if (!closest) return null;
  const interactiveContainer = closest.closest<HTMLElement>("button[data-design-id],a[data-design-id]");
  if (!isCodingBuilder && interactiveContainer) return interactiveContainer;
  return closest;
}

function displayForDesignMove(element: HTMLElement, design?: ElementDesign) {
  if (design?.layout && design.layout !== "default") return "";
  const computedDisplay = window.getComputedStyle(element).display;
  if (computedDisplay === "inline") return "inline-block";
  if (computedDisplay === "contents") return "block";
  return "";
}

function isDesignPanelInput(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (!target.closest(".design-studio-panel")) return false;
  return target.matches("input,select,textarea,button") || Boolean(target.closest("input,select,textarea,button"));
}

export function AppDesignStudio() {
  const pathname = usePathname();
  const key = pageKey(pathname);
  const isCodingBuilder = key === "coding";
  const dragRef = useRef<DragState | null>(null);
  const customIdRef = useRef(0);
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
  const movableSelectionIds = useMemo(() => activeSelectionIds.filter((id) => !currentElements.find((item) => item.id === id)?.locked), [activeSelectionIds, currentElements]);
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
    document.body.classList.toggle("coding-builder-active", open && isCodingBuilder);
    document.querySelectorAll<HTMLElement>("[data-design-id]").forEach((element) => {
      if (isCodingBuilder && !element.matches(designTargetSelector(true))) {
        element.classList.remove("design-editable", "design-selected", "design-grouped", "design-locked", "design-positioned", "design-layout-controlled", "design-hidden-section");
        element.hidden = false;
        element.style.order = "";
        element.style.transform = "";
        element.style.position = "";
        element.style.zIndex = "";
        element.style.width = "";
        element.style.height = "";
        element.style.minHeight = "";
        element.style.gap = "";
        element.style.padding = "";
        element.style.margin = "";
        element.style.background = "";
        element.style.color = "";
        element.style.borderColor = "";
        element.style.opacity = "";
        element.style.borderRadius = "";
        element.style.fontSize = "";
        element.style.fontWeight = "";
        element.style.justifyContent = "";
        element.style.alignItems = "";
        element.contentEditable = "false";
        return;
      }
      const design = saved.find((item) => item.id === element.dataset.designId);
      element.classList.toggle("design-editable", open);
      element.classList.toggle("design-selected", open && activeSelectionIds.includes(element.dataset.designId ?? ""));
      element.classList.toggle("design-grouped", open && Boolean(design?.groupId));
      element.classList.toggle("design-locked", open && Boolean(design?.locked));
      element.classList.toggle("design-positioned", hasVisualLayout(design));
      element.hidden = Boolean(design?.hidden);
      element.classList.toggle("design-hidden-section", Boolean(design?.hidden));
      element.style.order = design?.order !== undefined ? String(design.order) : "";
      element.style.transform = design?.x !== undefined || design?.y !== undefined ? `translate(${design.x ?? 0}px, ${design.y ?? 0}px)` : "";
      element.style.position = design?.x !== undefined || design?.y !== undefined
        ? (window.getComputedStyle(element).position === "static" ? "relative" : "")
        : "";
      element.style.zIndex = design?.zIndex !== undefined ? String(design.zIndex) : (design?.x !== undefined || design?.y !== undefined ? "5" : "");
      element.style.width = design?.width ? `${design.width}px` : "";
      element.style.height = design?.height ? `${design.height}px` : "";
      element.style.minHeight = design?.minHeight ? `${design.minHeight}px` : "";
      element.style.gap = design?.gap !== undefined ? `${design.gap}px` : "";
      element.style.padding = design?.padding !== undefined ? `${design.padding}px` : "";
      element.style.margin = design?.margin !== undefined ? `${design.margin}px` : "";
      element.style.background = design?.background ?? "";
      element.style.color = design?.color ?? "";
      element.style.borderColor = design?.borderColor ?? "";
      element.style.opacity = design?.opacity !== undefined ? String(design.opacity) : "";
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
        const moveDisplay = hasVisualLayout(design) ? displayForDesignMove(element, design) : "";
        element.style.display = moveDisplay;
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
  }, [activeSelectionIds, isCodingBuilder, key, open, settings]);

  const detectElements = useCallback((): ElementDesign[] => {
    const main = document.querySelector("main");
    if (!main) return [];
    const candidates = Array.from(main.querySelectorAll<HTMLElement>(isCodingBuilder ? designTargetSelector(true) : editableSelector));
    const seen = new Set<HTMLElement>();
    return candidates
      .filter((element) => {
        if (seen.has(element)) return false;
        seen.add(element);
        if (element.closest(".design-studio-panel")) return false;
        if (element.matches("video,source")) return false;
        if (!isCodingBuilder && element.matches("input,select,textarea") && !element.dataset.designId) return false;
        return element.offsetParent !== null || element === main.firstElementChild;
      })
      .slice(0, isCodingBuilder ? 80 : 360)
      .map((element, index) => {
        const currentId = element.dataset.designId || `${key}-${element.tagName.toLowerCase()}-${index + 1}`;
        element.dataset.designId = currentId;
        const registryItem = isCodingBuilder ? CODING_STATEFUL_BLOCKS.find((block) => block.id === currentId) : undefined;
        return {
          id: currentId,
          label: registryItem?.label ?? elementLabel(element, `${element.tagName.toLowerCase()} ${index + 1}`),
          contentId: registryItem?.id ?? (element.dataset.designCustom ? currentId : undefined),
          hidden: false,
          order: elementPriority(element) ?? index + 1000,
        };
      });
  }, [isCodingBuilder, key]);

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
      const retainedSaved = saved.filter((item) => (
        !item.custom &&
        !item.deleted &&
        !detected.some((detectedItem) => detectedItem.id === item.id) &&
        (!isCodingBuilder || CODING_STATEFUL_BLOCKS.some((block) => block.id === item.id))
      ));
      const merged: ElementDesign[] = [
        ...detected.map((item) => saved.find((element) => element.id === item.id) ?? item),
        ...retainedSaved,
        ...custom,
      ].filter((item) => !item.deleted);
      setElements(merged.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    };
    const timer = window.setTimeout(sync, 100);
    return () => window.clearTimeout(timer);
  }, [detectElements, isCodingBuilder, key, pathname, ready, settings]);

  useEffect(() => {
    applyElementDesigns();
  }, [applyElementDesigns, elements]);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if ((event.target as HTMLElement | null)?.closest(".design-studio-panel,.design-studio-toggle,.design-resize-handle,.design-drag-handle")) return;
      const element = closestDesignElement(event.target, isCodingBuilder);
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
      const element = closestDesignElement(event.target, isCodingBuilder);
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
  }, [currentElements, isCodingBuilder, open, selectedId, updateElement]);

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
    if (!movableSelectionIds.length) return;
    const baseStep = event.altKey ? 1 : settings.theme.snapGrid;
    const step = event.shiftKey ? baseStep * 4 : baseStep;
    const updates = Object.fromEntries(movableSelectionIds.map((id) => {
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
  }, [currentElements, movableSelectionIds, settings.theme.snapGrid, updateElements]);

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

  function customDefaults(kind: NonNullable<ElementDesign["kind"]>): Partial<ElementDesign> {
    const custom = CUSTOM_CONTAINER_LIBRARY.find((item) => item.kind === kind);
    const shared = { background: "#ffffff", color: "#13221f", borderColor: "#dfe6e2", radius: 12 };
    if (kind === "button") return { ...shared, label: custom?.label ?? "Custom Button", text: custom?.text ?? "Button", width: 180, height: 48, padding: 12, background: settings.theme.action, borderColor: settings.theme.action, fontWeight: 900 };
    if (kind === "text" || kind === "label") return { ...shared, label: custom?.label ?? "Text Block", text: custom?.text ?? "Text block", width: 280, height: 80, padding: 8, fontSize: 18, fontWeight: 800 };
    if (kind === "notes") return { ...shared, label: "Notes Box", text: "Notes", width: 360, height: 180, padding: 16, layout: "stack", gap: 10 };
    if (kind === "divider" || kind === "spacer") return { ...shared, label: custom?.label ?? "Divider/Spacer", text: "", width: 420, height: 24, padding: 0, background: "#334155", borderColor: "#334155", radius: 999 };
    if (kind === "row") return { ...shared, label: "New row", text: "New row", width: 640, height: 120, padding: 16, layout: "row", gap: 12 };
    if (kind === "column") return { ...shared, label: "New column", text: "New column", width: 260, height: 360, padding: 16, layout: "stack", gap: 12 };
    return { ...shared, label: custom?.label ?? "Blank Container", text: custom?.text ?? "", width: 320, height: 180, padding: 20, layout: "stack", gap: 12 };
  }

  function addCustomElement(kind: NonNullable<ElementDesign["kind"]>) {
    const customCount = currentElements.filter((item) => item.custom).length;
    const defaultDesign = customDefaults(kind);
    customIdRef.current += 1;
    const customIndex = customCount + customIdRef.current;
    const next: ElementDesign = {
      id: `${key}-custom-${kind}-${customIndex}`,
      label: defaultDesign.label ?? readableLabel(kind),
      contentId: `custom-${kind}`,
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
            ? nextElements.map((item) => item.id === id ? { ...item, hidden: true, deleted: false } : item)
            : existing
              ? [...nextElements, { ...existing, hidden: true, deleted: false }]
              : nextElements;
      }
      return { ...current, pages: { ...current.pages, [key]: { elements: nextElements } } };
    });
    setElements((current) => current.map((item) => activeSelectionIds.includes(item.id) && !item.custom ? { ...item, hidden: true, deleted: false } : item).filter((item) => !(activeSelectionIds.includes(item.id) && item.custom)));
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

  function restoreHiddenBlocks() {
    const hiddenIds = currentElements.filter((item) => item.hidden && !item.deleted).map((item) => item.id);
    if (!hiddenIds.length) return;
    updateElements(Object.fromEntries(hiddenIds.map((id) => [id, { hidden: false, deleted: false }])));
  }

  function selectOrRestoreBlock(block: { id: string; label: string; kind: NonNullable<ElementDesign["kind"]> }) {
    const existing = currentElements.find((item) => item.id === block.id);
    if (existing) {
      if (existing.hidden) updateElement(block.id, { hidden: false, deleted: false });
      setSelectedId(block.id);
      setSelectedIds([block.id]);
      setPanelTab("element");
      return;
    }
    setSettings((current) => {
      const page = pageSettings(current, key);
      const next: ElementDesign = {
        id: block.id,
        label: block.label,
        contentId: block.id,
        kind: block.kind,
        hidden: false,
        order: 100 + CODING_STATEFUL_BLOCKS.findIndex((item) => item.id === block.id),
      };
      return { ...current, pages: { ...current.pages, [key]: { elements: [...page.elements, next] } } };
    });
    setSelectedId(block.id);
    setSelectedIds([block.id]);
    setPanelTab("element");
  }

  function duplicateSelected() {
    if (!selected?.custom) return;
    customIdRef.current += 1;
    const customIndex = currentElements.filter((item) => item.custom).length + customIdRef.current;
    const next: ElementDesign = {
      ...selected,
      id: `${key}-custom-${selected.kind ?? "block"}-${customIndex}`,
      label: `${selected.label} copy`,
      x: snap((selected.x ?? 0) + 24, settings.theme.snapGrid),
      y: snap((selected.y ?? 0) + 24, settings.theme.snapGrid),
      order: currentElements.length + 1,
    };
    setSettings((current) => {
      const page = pageSettings(current, key);
      return { ...current, pages: { ...current.pages, [key]: { elements: [...page.elements, next] } } };
    });
    setElements((current) => [...current, next]);
    setSelectedId(next.id);
    setSelectedIds([next.id]);
  }

  function changeCustomContent(kind: NonNullable<ElementDesign["kind"]>) {
    if (!selected?.custom) return;
    updateCurrent({ ...customDefaults(kind), kind, contentId: `custom-${kind}` });
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
    const ids = currentElements.filter((item) => item.groupId === selectedGroupId).map((item) => item.id);
    setSelectedIds(ids);
    setSelectedId(ids[0] ?? null);
  }

  function startHandleDrag(mode: DragState["mode"], event: ReactMouseEvent<HTMLButtonElement>) {
    const ids = (activeSelectionIds.length ? activeSelectionIds : selectedId ? [selectedId] : [])
      .filter((id) => !currentElements.find((element) => element.id === id)?.locked);
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
          <button type="button" className="design-drag-handle" disabled={!movableSelectionIds.length} onMouseDown={(event) => startHandleDrag("move", event)}>
            {movableSelectionIds.length ? "Move" : "Locked"}
          </button>
          <button type="button" className="design-resize-handle" disabled={!movableSelectionIds.length} onMouseDown={(event) => startHandleDrag("resize", event)}>Resize</button>
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

          {isCodingBuilder ? (
            <>
              <section>
                <h3>Selected Container</h3>
                {selected ? (
                  <>
                    <label>Name <input value={selected.label} disabled={activeSelectionIds.length > 1} onChange={(event) => updateCurrent({ label: event.target.value })} /></label>
                    <label>Content <select value={selected.contentId ?? (selected.custom ? `custom-${selected.kind ?? "block"}` : selected.id)} disabled={!selected.custom} onChange={(event) => changeCustomContent(event.target.value.replace(/^custom-/, "") as NonNullable<ElementDesign["kind"]>)}>
                      {selected.custom ? CUSTOM_CONTAINER_LIBRARY.map((item) => <option key={item.kind} value={`custom-${item.kind}`}>{item.label}</option>) : <option value={selected.contentId ?? selected.id}>{selected.label}</option>}
                    </select></label>
                    <div className="design-button-row">
                      <button type="button" onClick={() => updateCurrent({ hidden: !selected.hidden })}>{selected.hidden ? "Show" : "Hide"}</button>
                      <button type="button" onClick={() => updateCurrent({ locked: !selected.locked })}>{selected.locked ? "Unlock" : "Lock"}</button>
                      <button type="button" onClick={duplicateSelected} disabled={!selected.custom}>Duplicate</button>
                      <button type="button" className="design-danger" onClick={deleteSelected}>{selected.custom ? "Delete" : "Hide"}</button>
                    </div>
                    <div className="design-button-row">
                      <button type="button" onClick={() => updateCurrent({ x: 0, y: 0 })}>Reset position</button>
                      <button type="button" onClick={resetSelected}>Reset selected</button>
                    </div>
                    <p className="design-empty">Stateful rugby blocks are one instance only. Custom containers can be duplicated or deleted.</p>
                  </>
                ) : <p className="design-empty">Click a large Coding container on the page, or add/select one below.</p>}
              </section>

              <section>
                <h3>Add Container</h3>
                <div className="design-block-grid">
                  {CUSTOM_CONTAINER_LIBRARY.map((item) => (
                    <button key={item.kind} type="button" onClick={() => addCustomElement(item.kind)}>{item.label}</button>
                  ))}
                </div>
              </section>

              <section>
                <h3>Stateful Blocks</h3>
                <div className="design-section-list">
                  {CODING_STATEFUL_BLOCKS.map((block) => {
                    const existing = currentElements.find((item) => item.id === block.id);
                    return (
                      <button key={block.id} type="button" className={selectedId === block.id ? "is-active" : ""} onClick={() => selectOrRestoreBlock(block)}>
                        {block.label}{existing?.hidden ? " · hidden" : " · select"}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section>
                <h3>Layout</h3>
                <label>Mode <select value={selected?.layout ?? "default"} onChange={(event) => updateCurrent({ layout: event.target.value as LayoutMode })}><option value="default">Default</option><option value="stack">Stack</option><option value="row">Row</option><option value="grid">Grid</option></select></label>
                <label>Columns <input type="range" min="1" max="8" step="1" value={selected?.columns ?? 2} onChange={(event) => updateCurrent({ columns: Number(event.target.value) })} /></label>
                <label>Rows <input type="range" min="1" max="8" step="1" value={selected?.rows ?? 1} onChange={(event) => updateCurrent({ rows: Number(event.target.value) })} /></label>
                <label>Gap <input type="range" min="0" max="48" step="1" value={selected?.gap ?? 12} onChange={(event) => updateCurrent({ gap: Number(event.target.value) })} /></label>
                <label>Padding <input type="range" min="0" max="64" step="1" value={selected?.padding ?? 16} onChange={(event) => updateCurrent({ padding: Number(event.target.value) })} /></label>
                <label>Width <input type="number" min="0" value={selected?.width ?? ""} onChange={(event) => updateCurrent({ width: numericValue(event.target.value) })} /></label>
                <label>Height <input type="number" min="0" value={selected?.height ?? ""} onChange={(event) => updateCurrent({ height: numericValue(event.target.value) })} /></label>
                <label>X <input type="number" value={selected?.x ?? 0} onChange={(event) => updateCurrent({ x: numericValue(event.target.value) ?? 0 })} /></label>
                <label>Y <input type="number" value={selected?.y ?? 0} onChange={(event) => updateCurrent({ y: numericValue(event.target.value) ?? 0 })} /></label>
                <label>Layer <input type="number" min="0" max="200" value={selected?.zIndex ?? ""} onChange={(event) => updateCurrent({ zIndex: numericValue(event.target.value) })} /></label>
              </section>

              <section>
                <h3>Style</h3>
                {selected?.custom ? <label>Text <textarea value={selected?.text ?? ""} onChange={(event) => updateCurrent({ text: event.target.value })} /></label> : null}
                <label>Background <input type="color" value={selected?.background ?? settings.theme.surface} onChange={(event) => updateCurrent({ background: event.target.value })} /></label>
                <label>Text colour <input type="color" value={selected?.color ?? settings.theme.ink} onChange={(event) => updateCurrent({ color: event.target.value })} /></label>
                <label>Border <input type="color" value={selected?.borderColor ?? "#dfe6e2"} onChange={(event) => updateCurrent({ borderColor: event.target.value })} /></label>
                <label>Opacity <input type="range" min="0" max="1" step="0.05" value={selected?.opacity ?? 1} onInput={(event) => updateCurrent({ opacity: clamp(Number(event.currentTarget.value), 0, 1) })} onChange={(event) => updateCurrent({ opacity: clamp(Number(event.target.value), 0, 1) })} /></label>
                <label>Radius <input type="range" min="0" max="40" step="1" value={selected?.radius ?? settings.theme.radius} onChange={(event) => updateCurrent({ radius: Number(event.target.value) })} /></label>
              </section>

              <section>
                <h3>Page Safety</h3>
                <div className="design-button-row">
                  <button type="button" onClick={restoreHiddenBlocks}>Restore hidden</button>
                  <button type="button" onClick={resetCurrentPage}>Reset Coding layout</button>
                </div>
              </section>
            </>
          ) : (
            <>
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
                    <button type="button" aria-label={selected.hidden ? "Show selected block" : "Hide selected block"} onClick={() => updateCurrent({ hidden: !selected.hidden })}>{selected.hidden ? "Show" : "Hide"}</button>
                    <button type="button" aria-label={selected.locked ? "Unlock selected block" : "Lock selected block"} onClick={() => updateCurrent({ locked: !selected.locked })}>{selected.locked ? "Unlock" : "Lock"}</button>
                  </div>
                  <div className="design-button-row">
                    <button type="button" onClick={groupSelected} disabled={activeSelectionIds.length < 2}>Group</button>
                    <button type="button" onClick={ungroupSelected} disabled={!activeSelectionIds.some((id) => currentElements.find((item) => item.id === id)?.groupId)}>Ungroup</button>
                    <button type="button" onClick={selectCurrentGroup} disabled={!selectedGroupId}>Select group</button>
                  </div>
                  <div className="design-button-row">
                    <button type="button" onClick={() => updateCurrent({ x: 0, y: 0 })}>Reset position</button>
                    <button type="button" onClick={resetSelected}>Reset element</button>
                    <button type="button" className="design-danger" aria-label={selected.custom ? "Delete selected custom block" : "Hide selected app block"} onClick={deleteSelected}>{selected.custom ? "Delete" : "Hide"}</button>
                  </div>
                  <p className="design-empty">Shift-click to multi-select. Grouped items move and resize together. Arrow keys move unlocked selections; hold Shift for larger moves or Option for 1px nudges.</p>
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
              <label>X position <input type="number" value={selected?.x ?? 0} onChange={(event) => updateCurrent({ x: numericValue(event.target.value) ?? 0 })} /></label>
              <label>Y position <input type="number" value={selected?.y ?? 0} onChange={(event) => updateCurrent({ y: numericValue(event.target.value) ?? 0 })} /></label>
              <label>Layer <input type="number" min="0" max="200" value={selected?.zIndex ?? ""} onChange={(event) => updateCurrent({ zIndex: numericValue(event.target.value) })} /></label>
            </section>
          ) : null}

          {panelTab === "blocks" ? (
            <section>
              {key === "coding" ? (
                <>
                  <h3>Coding Blocks</h3>
                  <div className="design-section-list">
                    {CODING_STATEFUL_BLOCKS.map((block) => {
                      const existing = currentElements.find((item) => item.id === block.id);
                      return (
                        <button key={block.id} type="button" className={selectedId === block.id ? "is-active" : ""} onClick={() => selectOrRestoreBlock(block)}>
                          {block.label}{existing?.hidden ? " · hidden" : existing ? " · on page" : " · add"}
                        </button>
                      );
                    })}
                  </div>
                  <div className="design-button-row">
                    <button type="button" onClick={restoreHiddenBlocks}>Restore hidden blocks</button>
                    <button type="button" onClick={resetCurrentPage}>Reset Coding layout</button>
                  </div>
                </>
              ) : null}
              <h3>Custom Blocks</h3>
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
              <label>Opacity <input type="range" min="0" max="1" step="0.05" value={selected?.opacity ?? 1} onInput={(event) => updateCurrent({ opacity: clamp(Number(event.currentTarget.value), 0, 1) })} onChange={(event) => updateCurrent({ opacity: clamp(Number(event.target.value), 0, 1) })} /></label>
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
                      <button key={element.id} type="button" className={element.id === selectedId ? "is-active" : ""} onClick={() => { setSelectedId(element.id); setSelectedIds([element.id]); }}>{element.label}</button>
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
                <h3>Hidden Blocks</h3>
                <div className="design-section-list">
                  {currentElements.filter((element) => element.hidden && !element.deleted).map((element) => (
                    <button key={element.id} type="button" onClick={() => { updateElement(element.id, { hidden: false, deleted: false }); setSelectedId(element.id); setSelectedIds([element.id]); }}>{element.label}</button>
                  ))}
                  {!currentElements.some((element) => element.hidden && !element.deleted) ? <p className="design-empty">No hidden blocks on this tab.</p> : null}
                </div>
                <div className="design-button-row">
                  <button type="button" onClick={restoreHiddenBlocks}>Restore all hidden</button>
                </div>
              </section>

              <section>
                <h3>Detected Elements</h3>
                <div className="design-section-list">
                  {currentElements.slice(0, 90).map((element) => (
                    <button key={element.id} type="button" className={element.id === selectedId ? "is-active" : ""} onClick={() => { setSelectedId(element.id); setSelectedIds([element.id]); }}>{element.label}</button>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          <div className="design-button-row">
            <button type="button" onClick={resetCurrentPage}>Reset tab</button>
            <button type="button" className="design-reset-all" onClick={resetAllDesign}>Reset all</button>
          </div>
            </>
          )}
        </aside>
      ) : null}

      {currentElements.filter((element) => element.custom && !element.deleted && !element.hidden).map((element) => (
        <div
          key={element.id}
          data-design-id={element.id}
          data-design-custom="true"
          className={`design-custom-block design-custom-block--${element.kind ?? "block"}`}
          hidden={Boolean(element.hidden)}
          suppressContentEditableWarning
        >
          {element.kind === "divider" || element.kind === "spacer" ? null : element.text || element.label}
        </div>
      ))}
    </>
  );
}
