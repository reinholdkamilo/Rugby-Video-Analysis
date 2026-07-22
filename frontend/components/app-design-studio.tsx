"use client";

import { MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";

type PageKey = "home" | "upload" | "library" | "coding" | "reports" | "evidence" | "intelligence";
type NodeType = "section" | "row" | "column" | "container" | "group" | "static" | "slot";
type LayoutMode = "free" | "stack" | "row" | "grid";
type StaticKind = "blank" | "text" | "heading" | "label" | "notes" | "divider" | "spacer" | "button" | "image";

type ComponentDefinition = {
  id: string;
  label: string;
  page: PageKey | "any";
  stateful: boolean;
  minWidth: number;
  minHeight: number;
  description: string;
  href?: string;
};

type CanvasNode = {
  id: string;
  type: NodeType;
  parentId: string | null;
  children: string[];
  order: number;
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  layout: LayoutMode;
  columns?: number;
  rows?: number;
  gap: number;
  padding: number;
  margin: number;
  background: string;
  color: string;
  borderColor: string;
  borderWidth: number;
  radius: number;
  opacity: number;
  zIndex: number;
  align: "start" | "center" | "end" | "stretch";
  overflow: "visible" | "hidden" | "auto";
  locked?: boolean;
  hidden?: boolean;
  staticKind?: StaticKind;
  text?: string;
  componentId?: string | null;
};

type PageLayout = {
  page: PageKey;
  mode: "blank" | "default" | "custom";
  gridSize: number;
  snapEnabled: boolean;
  nodes: CanvasNode[];
  selectedTemplateName?: string;
  updatedAt: string;
};

type SavedTemplate = {
  id: string;
  name: string;
  page: PageKey;
  layout: PageLayout;
  createdAt: string;
};

type ElementCssResetMode = "all" | "colors" | "spacing" | "border" | "none";

type ElementCssReset = {
  id: string;
  page: PageKey;
  selector: string;
  label: string;
  mode: ElementCssResetMode;
  createdAt: string;
};

type DesignStore = {
  version: 3;
  layouts: Partial<Record<PageKey, PageLayout>>;
  templates: SavedTemplate[];
  elementCssResets?: ElementCssReset[];
};

type DragState =
  | { mode: "move"; id: string; startX: number; startY: number; baseX: number; baseY: number }
  | { mode: "resize"; id: string; startX: number; startY: number; baseWidth: number; baseHeight: number };

type LiveRect = { left: number; top: number; width: number; height: number };

const STORAGE_KEY = "rugby-video-analysis:blank-canvas-design:v3";
const SUPPORTED_PAGES: PageKey[] = ["home", "upload", "library", "coding", "reports", "evidence", "intelligence"];
const FULLY_WIRED_PAGES = new Set<PageKey>(["coding", "library", "reports"]);

const DEFAULT_STORE: DesignStore = { version: 3, layouts: {}, templates: [], elementCssResets: [] };

const COMPONENTS: ComponentDefinition[] = [
  { id: "video-player", label: "Video Player", page: "coding", stateful: true, minWidth: 520, minHeight: 300, description: "Video surface with playback, overlays and HUD.", href: "/coding" },
  { id: "video-controls", label: "Video Controls", page: "coding", stateful: true, minWidth: 320, minHeight: 120, description: "Playback controls and shortcut helpers.", href: "/coding" },
  { id: "quick-coding-matrix", label: "Quick Coding Matrix", page: "coding", stateful: true, minWidth: 520, minHeight: 360, description: "Home/Away quick code buttons.", href: "/coding" },
  { id: "transparent-overlay", label: "Transparent Video Overlay", page: "coding", stateful: true, minWidth: 320, minHeight: 180, description: "Key overlay attached to the video surface.", href: "/coding" },
  { id: "last-coded-hud", label: "Last Coded Event HUD", page: "coding", stateful: true, minWidth: 320, minHeight: 90, description: "Locked video-surface HUD with Undo.", href: "/coding" },
  { id: "timeline-cleanup", label: "Timeline Cleanup", page: "coding", stateful: true, minWidth: 480, minHeight: 260, description: "Edit and delete timeline events.", href: "/coding" },
  { id: "sportscode-timeline", label: "Sportscode Timeline", page: "coding", stateful: true, minWidth: 640, minHeight: 260, description: "Multi-lane sport timeline.", href: "/library/review/match-9" },
  { id: "manual-event-form", label: "Manual Event Form", page: "coding", stateful: true, minWidth: 360, minHeight: 260, description: "Manual event entry.", href: "/coding" },
  { id: "recent-codes", label: "Recent Codes", page: "coding", stateful: true, minWidth: 320, minHeight: 240, description: "Recently coded events.", href: "/coding" },
  { id: "keyboard-mapping", label: "Keyboard Mapping", page: "coding", stateful: true, minWidth: 520, minHeight: 320, description: "Shortcut assignment library.", href: "/coding" },
  { id: "zone-mapping", label: "Zone Mapping", page: "coding", stateful: true, minWidth: 420, minHeight: 240, description: "Zone keys and field descriptors.", href: "/coding" },
  { id: "match-video-selector", label: "Match/Video Selector", page: "coding", stateful: true, minWidth: 420, minHeight: 120, description: "Match and video selection.", href: "/coding" },
  { id: "upload-form", label: "Upload Form", page: "upload", stateful: true, minWidth: 520, minHeight: 320, description: "Create match and upload video.", href: "/upload" },
  { id: "pipeline-status", label: "Pipeline Status", page: "upload", stateful: true, minWidth: 480, minHeight: 220, description: "Upload and analysis pipeline state.", href: "/upload" },
  { id: "library-grid", label: "Library Grid", page: "library", stateful: true, minWidth: 640, minHeight: 420, description: "Games, clips, reports, evidence and reviews.", href: "/library" },
  { id: "library-filters", label: "Library Filters", page: "library", stateful: true, minWidth: 280, minHeight: 360, description: "Search, filters and sort controls.", href: "/library" },
  { id: "coach-review-player", label: "Coach Review Player", page: "library", stateful: true, minWidth: 640, minHeight: 380, description: "Review player, comments and clip list.", href: "/library/review/match-9" },
  { id: "report-setup", label: "Report Setup", page: "reports", stateful: true, minWidth: 340, minHeight: 360, description: "Report filters and included sections.", href: "/reports" },
  { id: "report-preview", label: "Report Preview", page: "reports", stateful: true, minWidth: 720, minHeight: 640, description: "Printable match report preview.", href: "/reports" },
  { id: "evidence-clips", label: "Evidence Clips", page: "evidence", stateful: true, minWidth: 560, minHeight: 360, description: "Evidence clips and training examples.", href: "/evidence" },
  { id: "intelligence-panels", label: "Intelligence Panels", page: "intelligence", stateful: true, minWidth: 640, minHeight: 360, description: "Learning, analysis and insight panels.", href: "/intelligence" },
];

const LIVE_COMPONENT_TARGETS: Partial<Record<PageKey, Record<string, string>>> = {
  coding: {
    "match-video-selector": "coding-match-video-selector-block",
    "video-player": "coding-playback-block",
    "video-controls": "coding-video-controls-block",
    "quick-coding-matrix": "coding-quick-matrix-block",
    "recent-codes": "coding-recent-codes-block",
    "manual-event-form": "coding-manual-event-block",
    "timeline-cleanup": "coding-timeline-cleanup-block",
    "keyboard-mapping": "coding-keyboard-mapping-block",
    "zone-mapping": "coding-zone-mapping-block",
  },
  library: {
    "library-filters": "library-filters-block",
    "library-grid": "library-grid-block",
  },
  reports: {
    "report-setup": "reports-setup-block",
    "report-preview": "reports-preview-block",
  },
};

const STATIC_BLOCKS: Array<{ kind: StaticKind; label: string; text: string; width: number; height: number }> = [
  { kind: "blank", label: "Blank Container", text: "", width: 320, height: 180 },
  { kind: "text", label: "Text Block", text: "Text block", width: 280, height: 110 },
  { kind: "heading", label: "Heading", text: "Heading", width: 360, height: 90 },
  { kind: "label", label: "Label", text: "Label", width: 180, height: 64 },
  { kind: "notes", label: "Notes Box", text: "Notes", width: 360, height: 180 },
  { kind: "divider", label: "Divider", text: "", width: 420, height: 24 },
  { kind: "spacer", label: "Spacer", text: "", width: 220, height: 64 },
  { kind: "button", label: "Static Button", text: "Button", width: 180, height: 52 },
  { kind: "image", label: "Image/Logo Block", text: "Logo", width: 240, height: 140 },
];

function pageKey(pathname: string): PageKey {
  const raw = pathname === "/" ? "home" : pathname.replace(/^\/+/, "").split("/")[0] || "home";
  return SUPPORTED_PAGES.includes(raw as PageKey) ? raw as PageKey : "home";
}

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function now() {
  return new Date().toISOString();
}

function snap(value: number, gridSize: number, enabled: boolean) {
  if (!enabled) return Math.round(value);
  const grid = Math.max(1, gridSize);
  return Math.round(value / grid) * grid;
}

function readStore(): DesignStore {
  if (typeof window === "undefined") return DEFAULT_STORE;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_STORE;
    const parsed = JSON.parse(saved) as Partial<DesignStore>;
    if (parsed.version !== 3) return DEFAULT_STORE;
    return { version: 3, layouts: parsed.layouts ?? {}, templates: parsed.templates ?? [], elementCssResets: parsed.elementCssResets ?? [] };
  } catch {
    return DEFAULT_STORE;
  }
}

function baseNode(overrides: Partial<CanvasNode>): CanvasNode {
  return {
    id: uid("node"),
    type: "container",
    parentId: null,
    children: [],
    order: 0,
    x: 40,
    y: 40,
    width: 320,
    height: 180,
    minWidth: 80,
    minHeight: 48,
    layout: "free",
    gap: 12,
    padding: 16,
    margin: 0,
    background: "#ffffff",
    color: "#13221f",
    borderColor: "#dfe6e2",
    borderWidth: 1,
    radius: 12,
    opacity: 1,
    zIndex: 1,
    align: "stretch",
    overflow: "visible",
    ...overrides,
  };
}

function makeEmptyLayout(page: PageKey, mode: PageLayout["mode"] = "blank"): PageLayout {
  return { page, mode, gridSize: 12, snapEnabled: true, nodes: [], updatedAt: now() };
}

function defaultLayout(page: PageKey): PageLayout {
  const layout = makeEmptyLayout(page, "default");
  const node = (overrides: Partial<CanvasNode>) => baseNode({ ...overrides, order: layout.nodes.length + 1 });
  if (page === "coding") {
    layout.nodes = [
      node({ id: "coding-selector-slot", type: "slot", componentId: "match-video-selector", x: 32, y: 28, width: 1120, height: 110, minWidth: 420, minHeight: 100 }),
      node({ id: "coding-video-slot", type: "slot", componentId: "video-player", x: 32, y: 166, width: 760, height: 430, minWidth: 520, minHeight: 300, background: "#0d1717", color: "#ffffff" }),
      node({ id: "coding-quick-slot", type: "slot", componentId: "quick-coding-matrix", x: 820, y: 166, width: 500, height: 430, minWidth: 420, minHeight: 320 }),
      node({ id: "coding-recent-slot", type: "slot", componentId: "recent-codes", x: 32, y: 628, width: 400, height: 260 }),
      node({ id: "coding-manual-slot", type: "slot", componentId: "manual-event-form", x: 460, y: 628, width: 400, height: 260 }),
      node({ id: "coding-timeline-slot", type: "slot", componentId: "timeline-cleanup", x: 888, y: 628, width: 432, height: 260 }),
    ];
  } else if (page === "library") {
    layout.nodes = [
      node({ id: "library-filter-slot", type: "slot", componentId: "library-filters", x: 32, y: 32, width: 300, height: 520, minWidth: 260, minHeight: 300 }),
      node({ id: "library-grid-slot", type: "slot", componentId: "library-grid", x: 360, y: 32, width: 900, height: 560, minWidth: 640, minHeight: 420 }),
      node({ id: "library-review-slot", type: "slot", componentId: "coach-review-player", x: 360, y: 628, width: 900, height: 360, minWidth: 640, minHeight: 300 }),
    ];
  } else if (page === "reports") {
    layout.nodes = [
      node({ id: "reports-setup-slot", type: "slot", componentId: "report-setup", x: 32, y: 32, width: 360, height: 560, minWidth: 320, minHeight: 300 }),
      node({ id: "reports-preview-slot", type: "slot", componentId: "report-preview", x: 424, y: 32, width: 820, height: 760, minWidth: 620, minHeight: 520 }),
    ];
  } else if (page === "upload") {
    layout.nodes = [
      node({ id: "upload-form-slot", type: "slot", componentId: "upload-form", x: 48, y: 48, width: 600, height: 360 }),
      node({ id: "pipeline-status-slot", type: "slot", componentId: "pipeline-status", x: 680, y: 48, width: 520, height: 280 }),
    ];
  } else if (page === "evidence") {
    layout.nodes = [node({ id: "evidence-clips-slot", type: "slot", componentId: "evidence-clips", x: 48, y: 48, width: 760, height: 440 })];
  } else if (page === "intelligence") {
    layout.nodes = [node({ id: "intelligence-panels-slot", type: "slot", componentId: "intelligence-panels", x: 48, y: 48, width: 820, height: 460 })];
  } else {
    layout.nodes = [
      node({ id: "home-heading", type: "static", staticKind: "heading", text: "Rugby Video Analysis", x: 48, y: 48, width: 520, height: 110, background: "#0e4b45", color: "#ffffff" }),
      node({ id: "home-library-link", type: "static", staticKind: "button", text: "Open Library", x: 48, y: 190, width: 220, height: 60, background: "#f5b400", borderColor: "#f5b400" }),
    ];
  }
  return layout;
}

function componentFor(id?: string | null) {
  return COMPONENTS.find((item) => item.id === id) ?? null;
}

function componentsForPage(page: PageKey) {
  return COMPONENTS.filter((item) => item.page === page || item.page === "any");
}

function usedStatefulComponents(layout: PageLayout) {
  return new Set(layout.nodes.map((node) => componentFor(node.componentId)).filter((item): item is ComponentDefinition => Boolean(item?.stateful)).map((item) => item.id));
}

function readable(value: string) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeLayout(layout: PageLayout): PageLayout {
  return {
    ...layout,
    nodes: layout.nodes.map((node, index) => ({
      ...baseNode({}),
      ...node,
      order: node.order ?? index + 1,
      children: Array.isArray(node.children) ? node.children : [],
    })),
  };
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function liveNodeSelector(targetId: string) {
  return `[data-design-id="${cssEscape(targetId)}"]`;
}

function elementLabel(element: HTMLElement) {
  const designLabel = element.getAttribute("data-design-label");
  if (designLabel) return designLabel;
  const text = element.innerText?.trim().replace(/\s+/g, " ").slice(0, 42);
  const id = element.id ? `#${element.id}` : "";
  return `${element.tagName.toLowerCase()}${id}${text ? ` · ${text}` : ""}`;
}

function selectorForElement(element: HTMLElement) {
  const designId = element.getAttribute("data-design-id");
  if (designId) return `[data-design-id="${cssEscape(designId)}"]`;
  if (element.id) return `#${cssEscape(element.id)}`;
  const parts: string[] = [];
  let current: HTMLElement | null = element;
  while (current && current.tagName.toLowerCase() !== "html") {
    const tag = current.tagName.toLowerCase();
    if (tag === "body") {
      parts.unshift("body");
      break;
    }
    if (tag === "main") {
      parts.unshift("main");
      break;
    }
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) break;
    const currentTag = current.tagName;
    const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === currentTag);
    const index = sameTagSiblings.indexOf(current) + 1;
    parts.unshift(`${tag}:nth-of-type(${Math.max(1, index)})`);
    current = parent;
  }
  return parts.join(" > ");
}

function liveNodeStyles(node: CanvasNode) {
  return [
    "position:absolute!important",
    `left:${node.x}px!important`,
    `top:${node.y}px!important`,
    `width:${node.width}px!important`,
    `min-width:${node.minWidth ?? 0}px!important`,
    `min-height:${node.minHeight ?? 0}px!important`,
    `height:${node.height}px!important`,
    `padding:${node.padding}px!important`,
    `gap:${node.gap}px!important`,
    `margin:${node.margin}px!important`,
    `background:${node.background}!important`,
    `color:${node.color}!important`,
    `border-color:${node.borderColor}!important`,
    `border-width:${node.borderWidth}px!important`,
    "border-style:solid!important",
    `border-radius:${node.radius}px!important`,
    `opacity:${node.opacity}!important`,
    `z-index:${node.zIndex}!important`,
    `overflow:${node.overflow}!important`,
    node.hidden ? "display:none!important" : "",
  ].filter(Boolean).join(";");
}

function liveLayoutCss(page: PageKey, layout: PageLayout) {
  const targets = LIVE_COMPONENT_TARGETS[page];
  if (!targets || !FULLY_WIRED_PAGES.has(page)) return "";
  const slotNodes = layout.nodes
    .filter((node) => node.componentId && targets[node.componentId])
    .sort((a, b) => a.order - b.order);
  if (!slotNodes.length) return "";
  const maxHeight = Math.max(920, ...slotNodes.map((node) => node.y + node.height + 80));
  const rules = [
    "body.design-engine-editing [data-design-id]{outline:none!important}",
    `body:has(${liveNodeSelector(Object.values(targets)[0])}) main{position:relative!important;min-height:${maxHeight}px!important;}`,
    `body:has(${liveNodeSelector(Object.values(targets)[0])}) main > header{position:relative!important;z-index:50!important;}`,
  ];
  slotNodes.forEach((node) => {
    const targetId = targets[node.componentId ?? ""];
    if (!targetId) return;
    rules.push(`${liveNodeSelector(targetId)}{${liveNodeStyles(node)}}`);
  });
  return rules.join("\n");
}

function elementResetStyles(mode: ElementCssResetMode) {
  if (mode === "all") {
    return [
      "all:revert!important",
      "box-sizing:border-box!important",
      "font:inherit!important",
      "color:inherit!important",
    ].join(";");
  }
  if (mode === "colors") {
    return [
      "color:inherit!important",
      "background:transparent!important",
      "background-image:none!important",
      "box-shadow:none!important",
    ].join(";");
  }
  if (mode === "spacing") {
    return [
      "margin:0!important",
      "padding:0!important",
      "gap:0!important",
      "min-width:0!important",
      "min-height:0!important",
    ].join(";");
  }
  if (mode === "border") {
    return [
      "border:0!important",
      "border-radius:0!important",
      "box-shadow:none!important",
      "outline:0!important",
    ].join(";");
  }
  return "";
}

function elementResetCss(page: PageKey, resets: ElementCssReset[]) {
  return resets
    .filter((reset) => reset.page === page && reset.mode !== "none")
    .map((reset) => `${reset.selector}{${elementResetStyles(reset.mode)}}`)
    .join("\n");
}

function liveStaticNodeStyle(node: CanvasNode): React.CSSProperties {
  return {
    position: "absolute",
    left: node.x,
    top: node.y,
    width: node.width,
    height: node.height,
    minWidth: node.minWidth,
    minHeight: node.minHeight,
    padding: node.padding,
    margin: node.margin,
    background: node.background,
    color: node.color,
    borderColor: node.borderColor,
    borderWidth: node.borderWidth,
    borderStyle: "solid",
    borderRadius: node.radius,
    opacity: node.opacity,
    zIndex: node.zIndex,
    overflow: node.overflow,
    display: node.hidden ? "none" : "grid",
    alignContent: node.align === "center" ? "center" : node.align,
    pointerEvents: "none",
  };
}

function nodeLabel(node: CanvasNode) {
  return componentFor(node.componentId)?.label ?? node.text ?? readable(node.staticKind ?? node.type);
}

function LiveStaticLayout({ layout, page }: { layout: PageLayout; page: PageKey }) {
  const [mainElement, setMainElement] = useState<HTMLElement | null>(null);
  const staticNodes = useMemo(() => (
    FULLY_WIRED_PAGES.has(page)
      ? layout.nodes.filter((node) => !node.componentId && !node.hidden).sort((a, b) => a.order - b.order)
      : []
  ), [layout.nodes, page]);

  useEffect(() => {
    setMainElement(document.querySelector("main"));
  }, [page]);

  if (!mainElement || !staticNodes.length) return null;

  return createPortal(
    <div className="design-live-static-layer" aria-hidden="true">
      {staticNodes.map((node) => (
        <div key={node.id} data-design-live-node-id={node.id} className={`design-live-static design-live-static--${node.staticKind ?? node.type}`} style={liveStaticNodeStyle(node)}>
          {node.staticKind === "divider" || node.staticKind === "spacer" ? null : <span>{node.text || readable(node.staticKind ?? node.type)}</span>}
        </div>
      ))}
    </div>,
    mainElement,
  );
}

export function AppDesignStudio() {
  const pathname = usePathname();
  const page = pageKey(pathname);
  const dragRef = useRef<DragState | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [store, setStore] = useState<DesignStore>(DEFAULT_STORE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [elementPickMode, setElementPickMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<{ selector: string; label: string; rect: LiveRect } | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [notice, setNotice] = useState("Design Engine ready.");
  const [, setMeasureTick] = useState(0);

  const layout = useMemo(() => normalizeLayout(store.layouts[page] ?? defaultLayout(page)), [page, store.layouts]);
  const selected = layout.nodes.find((node) => node.id === selectedId) ?? null;
  const pageComponents = componentsForPage(page);
  const usedComponents = usedStatefulComponents(layout);
  const sortedNodes = [...layout.nodes].filter((node) => !node.hidden).sort((a, b) => a.order - b.order);
  const pageTemplates = store.templates.filter((template) => template.page === page);
  const pageElementResets = (store.elementCssResets ?? []).filter((reset) => reset.page === page);
  const wiredStatus = FULLY_WIRED_PAGES.has(page) ? "Canvas-enabled" : "Registered placeholder";
  const appliedLayoutCss = useMemo(() => [liveLayoutCss(page, layout), elementResetCss(page, store.elementCssResets ?? [])].filter(Boolean).join("\n"), [layout, page, store.elementCssResets]);

  const updateStore = useCallback((updater: (current: DesignStore) => DesignStore) => {
    setStore((current) => {
      const next = updater(current);
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const updateLayout = useCallback((updater: (current: PageLayout) => PageLayout) => {
    updateStore((current) => {
      const currentLayout = normalizeLayout(current.layouts[page] ?? defaultLayout(page));
      const nextLayout = normalizeLayout({ ...updater(currentLayout), updatedAt: now(), mode: "custom" });
      return { ...current, layouts: { ...current.layouts, [page]: nextLayout } };
    });
  }, [page, updateStore]);

  const updateNode = useCallback((id: string, updates: Partial<CanvasNode>) => {
    updateLayout((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, ...updates } : node) }));
  }, [updateLayout]);

  useEffect(() => {
    const loaded = readStore();
    setStore(loaded);
    setReady(true);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("design-engine-editing", open);
    return () => document.body.classList.remove("design-engine-editing");
  }, [open]);

  useEffect(() => {
    if (open) return;
    setElementPickMode(false);
    setSelectedElement(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const refresh = () => setMeasureTick((tick) => tick + 1);
    refresh();
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMove = (event: MouseEvent) => {
      const state = dragRef.current;
      if (!state) return;
      event.preventDefault();
      const node = layout.nodes.find((item) => item.id === state.id);
      if (!node || node.locked) return;
      if (state.mode === "move") {
        updateNode(state.id, {
          x: snap(state.baseX + event.clientX - state.startX, layout.gridSize, layout.snapEnabled),
          y: snap(state.baseY + event.clientY - state.startY, layout.gridSize, layout.snapEnabled),
        });
      } else {
        updateNode(state.id, {
          width: Math.max(node.minWidth ?? 80, snap(state.baseWidth + event.clientX - state.startX, layout.gridSize, layout.snapEnabled)),
          height: Math.max(node.minHeight ?? 48, snap(state.baseHeight + event.clientY - state.startY, layout.gridSize, layout.snapEnabled)),
        });
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
  }, [layout.gridSize, layout.nodes, layout.snapEnabled, open, updateNode]);

  useEffect(() => {
    if (!open || !selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest(".design-engine-panel")) return;
      const map: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const direction = map[event.key];
      if (!direction || selected.locked) return;
      event.preventDefault();
      const step = event.altKey ? 1 : event.shiftKey ? layout.gridSize * 4 : layout.gridSize;
      updateNode(selected.id, { x: selected.x + direction[0] * step, y: selected.y + direction[1] * step });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [layout.gridSize, open, selected, updateNode]);

  useEffect(() => {
    if (!open || !elementPickMode) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.closest(".design-live-topbar, .design-live-panel, .design-studio-toggle, .design-live-overlays")) return;
      const candidate = target.closest<HTMLElement>("main *");
      if (!candidate) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = candidate.getBoundingClientRect();
      const next = {
        selector: selectorForElement(candidate),
        label: elementLabel(candidate),
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      };
      setSelectedElement(next);
      setSelectedId(null);
      setNotice(`Selected element: ${next.label}`);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [elementPickMode, open]);

  function startDrag(mode: DragState["mode"], node: CanvasNode, event: ReactMouseEvent<HTMLButtonElement | HTMLDivElement>) {
    if (node.locked) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = mode === "move"
      ? { mode, id: node.id, startX: event.clientX, startY: event.clientY, baseX: node.x, baseY: node.y }
      : { mode, id: node.id, startX: event.clientX, startY: event.clientY, baseWidth: node.width, baseHeight: node.height };
  }

  function liveRectForNode(node: CanvasNode): LiveRect {
    if (typeof document === "undefined") return { left: node.x, top: node.y, width: node.width, height: node.height };
    const main = document.querySelector<HTMLElement>("main");
    if (!main) return { left: node.x, top: node.y, width: node.width, height: node.height };
    const rect = main.getBoundingClientRect();
    return { left: rect.left + node.x, top: rect.top + node.y, width: node.width, height: node.height };
  }

  function addNode(type: NodeType = "container", staticKind?: StaticKind) {
    const count = layout.nodes.length;
    const staticDef = staticKind ? STATIC_BLOCKS.find((item) => item.kind === staticKind) : null;
    const next = baseNode({
      id: uid(type),
      type: staticKind ? "static" : type,
      staticKind,
      text: staticDef?.text,
      x: snap(40 + count * 20, layout.gridSize, layout.snapEnabled),
      y: snap(44 + count * 20, layout.gridSize, layout.snapEnabled),
      width: staticDef?.width ?? (type === "row" ? 640 : type === "column" ? 260 : 320),
      height: staticDef?.height ?? (type === "row" ? 140 : type === "column" ? 380 : 180),
      layout: type === "row" ? "row" : type === "column" ? "stack" : "free",
      background: staticKind === "divider" ? "#334155" : staticKind === "button" ? "#f5b400" : "#ffffff",
      borderColor: staticKind === "button" ? "#f5b400" : "#dfe6e2",
      order: count + 1,
    });
    updateLayout((current) => ({ ...current, nodes: [...current.nodes, next] }));
    setSelectedId(next.id);
    setNotice(`${readable(staticKind ?? type)} added to ${readable(page)} canvas.`);
  }

  function insertComponent(componentId: string) {
    const definition = componentFor(componentId);
    if (!definition) return;
    if (definition.stateful && usedComponents.has(definition.id)) {
      const existing = layout.nodes.find((node) => node.componentId === definition.id);
      setSelectedId(existing?.id ?? null);
      setNotice(`${definition.label} already exists on this page; selected existing slot.`);
      return;
    }
    const target = selected && selected.type !== "slot" ? selected : null;
    if (target) {
      updateNode(target.id, {
        type: "slot",
        componentId: definition.id,
        minWidth: definition.minWidth,
        minHeight: definition.minHeight,
        width: Math.max(target.width, definition.minWidth),
        height: Math.max(target.height, definition.minHeight),
      });
      setNotice(`${definition.label} inserted into selected container.`);
      return;
    }
    const count = layout.nodes.length;
    const next = baseNode({
      id: uid("slot"),
      type: "slot",
      componentId: definition.id,
      x: snap(40 + count * 20, layout.gridSize, layout.snapEnabled),
      y: snap(44 + count * 20, layout.gridSize, layout.snapEnabled),
      width: definition.minWidth,
      height: definition.minHeight,
      minWidth: definition.minWidth,
      minHeight: definition.minHeight,
      order: count + 1,
      background: definition.id === "video-player" ? "#0d1717" : "#ffffff",
      color: definition.id === "video-player" ? "#ffffff" : "#13221f",
    });
    updateLayout((current) => ({ ...current, nodes: [...current.nodes, next] }));
    setSelectedId(next.id);
    setNotice(`${definition.label} added as a component slot.`);
  }

  function deleteSelected() {
    if (!selected) return;
    updateLayout((current) => ({ ...current, nodes: current.nodes.filter((node) => node.id !== selected.id).map((node) => node.parentId === selected.id ? { ...node, parentId: selected.parentId } : node) }));
    setSelectedId(null);
    setNotice("Selected node deleted. App data was not touched.");
  }

  function duplicateSelected() {
    if (!selected) return;
    const definition = componentFor(selected.componentId);
    if (definition?.stateful) {
      setNotice("Stateful app components cannot be duplicated. Select the existing instance instead.");
      return;
    }
    const next = { ...selected, id: uid("copy"), x: selected.x + layout.gridSize * 2, y: selected.y + layout.gridSize * 2, order: layout.nodes.length + 1 };
    updateLayout((current) => ({ ...current, nodes: [...current.nodes, next] }));
    setSelectedId(next.id);
    setNotice("Static node duplicated.");
  }

  function splitSelected(direction: "rows" | "columns") {
    if (!selected) return;
    const children = [0, 1].map((index) => baseNode({
      id: uid(direction === "rows" ? "row" : "column"),
      type: direction === "rows" ? "row" : "column",
      parentId: selected.id,
      order: index + 1,
      x: selected.x + selected.padding + (direction === "columns" ? index * ((selected.width - selected.padding * 2) / 2) : 0),
      y: selected.y + selected.padding + (direction === "rows" ? index * ((selected.height - selected.padding * 2) / 2) : 0),
      width: direction === "columns" ? Math.max(120, (selected.width - selected.padding * 2 - selected.gap) / 2) : Math.max(120, selected.width - selected.padding * 2),
      height: direction === "rows" ? Math.max(72, (selected.height - selected.padding * 2 - selected.gap) / 2) : Math.max(72, selected.height - selected.padding * 2),
      layout: "free",
      background: "#f8fafc",
    }));
    updateLayout((current) => ({
      ...current,
      nodes: [
        ...current.nodes.map((node) => node.id === selected.id ? { ...node, layout: (direction === "rows" ? "stack" : "row") as LayoutMode, children: children.map((child) => child.id) } : node),
        ...children,
      ],
    }));
    setSelectedId(children[0].id);
    setNotice(`Container split into ${direction}.`);
  }

  function resetToBlank() {
    const next = makeEmptyLayout(page, "blank");
    updateStore((current) => ({ ...current, layouts: { ...current.layouts, [page]: next } }));
    setSelectedId(null);
    setNotice(`${readable(page)} canvas reset to blank.`);
  }

  function resetToDefault() {
    const next = defaultLayout(page);
    updateStore((current) => ({ ...current, layouts: { ...current.layouts, [page]: next } }));
    setSelectedId(next.nodes[0]?.id ?? null);
    setNotice(`${readable(page)} default template restored.`);
  }

  function saveTemplate() {
    const name = templateName.trim();
    if (!name) {
      setNotice("Name the template before saving.");
      return;
    }
    const template: SavedTemplate = { id: uid("template"), name, page, layout, createdAt: now() };
    updateStore((current) => ({ ...current, templates: [template, ...current.templates] }));
    setTemplateName("");
    setNotice(`${name} saved as a ${readable(page)} template.`);
  }

  function loadTemplate(id: string) {
    const template = store.templates.find((item) => item.id === id);
    if (!template) return;
    updateStore((current) => ({ ...current, layouts: { ...current.layouts, [page]: { ...template.layout, mode: "custom", updatedAt: now(), selectedTemplateName: template.name } } }));
    setSelectedId(template.layout.nodes[0]?.id ?? null);
    setNotice(`${template.name} loaded.`);
  }

  function resetSelected() {
    if (!selected) return;
    const definition = componentFor(selected.componentId);
    updateNode(selected.id, {
      width: definition?.minWidth ?? 320,
      height: definition?.minHeight ?? 180,
      minWidth: definition?.minWidth ?? 80,
      minHeight: definition?.minHeight ?? 48,
      layout: "free",
      columns: undefined,
      rows: undefined,
      gap: 12,
      padding: 16,
      margin: 0,
      background: definition?.id === "video-player" ? "#0d1717" : "#ffffff",
      color: definition?.id === "video-player" ? "#ffffff" : "#13221f",
      borderColor: "#dfe6e2",
      borderWidth: 1,
      radius: 12,
      opacity: 1,
      zIndex: 1,
      align: "stretch",
      overflow: "visible",
      locked: false,
      hidden: false,
    });
  }

  function updateSelected(updates: Partial<CanvasNode>) {
    if (!selected) return;
    updateNode(selected.id, updates);
  }

  function applyElementReset(mode: ElementCssResetMode) {
    if (!selectedElement) {
      setNotice("Turn on Element Inspect and click a page element first.");
      return;
    }
    updateStore((current) => {
      const existing = current.elementCssResets ?? [];
      const nextReset: ElementCssReset = {
        id: uid("element-css"),
        page,
        selector: selectedElement.selector,
        label: selectedElement.label,
        mode,
        createdAt: now(),
      };
      return {
        ...current,
        elementCssResets: [...existing.filter((reset) => !(reset.page === page && reset.selector === selectedElement.selector)), nextReset],
      };
    });
    setNotice(`${mode === "all" ? "All CSS rules" : readable(mode)} removed from ${selectedElement.label}.`);
  }

  function restoreSelectedElement() {
    if (!selectedElement) return;
    updateStore((current) => ({
      ...current,
      elementCssResets: (current.elementCssResets ?? []).filter((reset) => !(reset.page === page && reset.selector === selectedElement.selector)),
    }));
    setNotice(`Restored styling for ${selectedElement.label}.`);
  }

  function clearPageElementResets() {
    updateStore((current) => ({ ...current, elementCssResets: (current.elementCssResets ?? []).filter((reset) => reset.page !== page) }));
    setSelectedElement(null);
    setNotice(`All element CSS resets cleared for ${readable(page)}.`);
  }

  function renderLiveOverlay(node: CanvasNode) {
    const rect = liveRectForNode(node);
    const selectedClass = selectedId === node.id ? " is-selected" : "";
    return (
      <div
        key={node.id}
        className={`design-live-outline${selectedClass}${node.locked ? " is-locked" : ""}`}
        style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, zIndex: 700 + node.zIndex }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setSelectedId(node.id);
        }}
      >
        <button type="button" className="design-live-outline__handle" onMouseDown={(event) => startDrag("move", node, event)}>
          {node.locked ? "Locked" : nodeLabel(node)}
        </button>
        <button type="button" className="design-live-outline__resize" onMouseDown={(event) => startDrag("resize", node, event)} aria-label={`Resize ${nodeLabel(node)}`} />
      </div>
    );
  }

  function renderInlineInspector() {
    return (
      <aside className="design-live-panel design-engine-panel">
        <section>
          <h2>Layers</h2>
          <div className="design-engine-layer-list">
            {layout.nodes.map((node) => (
              <button key={node.id} type="button" className={selectedId === node.id ? "is-active" : ""} onClick={() => setSelectedId(node.id)}>
                <span>{nodeLabel(node)}</span>
                <small>{node.type}{node.hidden ? " · hidden" : ""}</small>
              </button>
            ))}
            {!layout.nodes.length ? <p>No visible layout nodes yet.</p> : null}
          </div>
        </section>

        <section>
          <h2>Add</h2>
          <div className="design-engine-grid-buttons">
            <button type="button" onClick={() => addNode("section")}>Section</button>
            <button type="button" onClick={() => addNode("row")}>Row</button>
            <button type="button" onClick={() => addNode("column")}>Column</button>
            <button type="button" onClick={() => addNode("container")}>Container</button>
            {STATIC_BLOCKS.slice(1, 7).map((block) => <button key={block.kind} type="button" onClick={() => addNode("static", block.kind)}>{block.label}</button>)}
          </div>
        </section>

        <section>
          <h2>Components</h2>
          <div className="design-engine-component-list">
            {pageComponents.map((component) => {
              const used = usedComponents.has(component.id);
              return (
                <button key={component.id} type="button" onClick={() => insertComponent(component.id)} className={used ? "is-used" : ""}>
                  <strong>{component.label}</strong>
                  <span>{used && component.stateful ? "Already on page" : component.description}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h2>Inspector</h2>
          {selected ? (
            <div className="design-engine-form">
              <label>Text <input value={selected.text ?? ""} onChange={(event) => updateSelected({ text: event.target.value })} /></label>
              <label>Content <select value={selected.componentId ?? ""} onChange={(event) => event.target.value ? insertComponent(event.target.value) : updateSelected({ type: "container", componentId: null })}>
                <option value="">No component</option>
                {pageComponents.map((component) => <option key={component.id} value={component.id}>{component.label}</option>)}
              </select></label>
              <div className="design-engine-form-grid">
                <label>X <input type="number" value={selected.x} onChange={(event) => updateSelected({ x: Number(event.target.value) })} /></label>
                <label>Y <input type="number" value={selected.y} onChange={(event) => updateSelected({ y: Number(event.target.value) })} /></label>
                <label>W <input type="number" value={selected.width} onChange={(event) => updateSelected({ width: Number(event.target.value) })} /></label>
                <label>H <input type="number" value={selected.height} onChange={(event) => updateSelected({ height: Number(event.target.value) })} /></label>
              </div>
              <div className="design-engine-form-grid">
                <label>Padding <input type="number" min="0" value={selected.padding} onChange={(event) => updateSelected({ padding: Number(event.target.value) })} /></label>
                <label>Gap <input type="number" min="0" value={selected.gap} onChange={(event) => updateSelected({ gap: Number(event.target.value) })} /></label>
                <label>Radius <input type="number" min="0" max="80" value={selected.radius} onChange={(event) => updateSelected({ radius: Number(event.target.value) })} /></label>
                <label>Layer <input type="number" min="0" max="200" value={selected.zIndex} onChange={(event) => updateSelected({ zIndex: Number(event.target.value) })} /></label>
              </div>
              <div className="design-engine-form-grid">
                <label>BG <input type="color" value={selected.background} onChange={(event) => updateSelected({ background: event.target.value })} /></label>
                <label>Text <input type="color" value={selected.color} onChange={(event) => updateSelected({ color: event.target.value })} /></label>
                <label>Border <input type="color" value={selected.borderColor} onChange={(event) => updateSelected({ borderColor: event.target.value })} /></label>
                <label>Opacity <input type="number" min="0" max="1" step="0.05" value={selected.opacity} onChange={(event) => updateSelected({ opacity: Number(event.target.value) })} /></label>
              </div>
              <div className="design-engine-button-row">
                <button type="button" onClick={() => splitSelected("columns")}>Split columns</button>
                <button type="button" onClick={() => splitSelected("rows")}>Split rows</button>
              </div>
              <div className="design-engine-button-row">
                <button type="button" onClick={() => updateSelected({ locked: !selected.locked })}>{selected.locked ? "Unlock" : "Lock"}</button>
                <button type="button" onClick={() => updateSelected({ hidden: !selected.hidden })}>{selected.hidden ? "Show" : "Hide"}</button>
                <button type="button" onClick={duplicateSelected}>Duplicate</button>
                <button type="button" onClick={resetSelected}>Reset</button>
                <button type="button" className="design-engine-danger" onClick={deleteSelected}>Delete</button>
              </div>
            </div>
          ) : <p>Click a highlighted page block to edit it here.</p>}
        </section>

        <section>
          <h2>Element CSS</h2>
          <div className="design-engine-form">
            <button type="button" onClick={() => setElementPickMode((current) => !current)} className={elementPickMode ? "is-active" : ""}>
              {elementPickMode ? "Element Inspect On" : "Inspect Any Element"}
            </button>
            {selectedElement ? (
              <>
                <p><strong>{selectedElement.label}</strong></p>
                <small>{selectedElement.selector}</small>
                <div className="design-engine-button-row">
                  <button type="button" onClick={() => applyElementReset("all")}>Remove all CSS</button>
                  <button type="button" onClick={() => applyElementReset("colors")}>Remove colours</button>
                  <button type="button" onClick={() => applyElementReset("spacing")}>Remove spacing</button>
                  <button type="button" onClick={() => applyElementReset("border")}>Remove borders</button>
                </div>
                <button type="button" onClick={restoreSelectedElement}>Restore selected element</button>
              </>
            ) : <p>Turn on inspect, then click any page element to target it.</p>}
            {pageElementResets.length ? (
              <>
                <small>{pageElementResets.length} saved CSS reset{pageElementResets.length === 1 ? "" : "s"} on this page.</small>
                <button type="button" className="design-engine-danger" onClick={clearPageElementResets}>Restore all page elements</button>
              </>
            ) : null}
          </div>
        </section>

        <section>
          <h2>Templates</h2>
          <div className="design-engine-form">
            <input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Template name" />
            <button type="button" onClick={saveTemplate}>Save template</button>
            <select value="" onChange={(event) => event.target.value && loadTemplate(event.target.value)}>
              <option value="">Load saved template</option>
              {pageTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </div>
        </section>
      </aside>
    );
  }

  function renderLiveDesignMode() {
    if (typeof document === "undefined") return null;
    return createPortal(
      <>
        <div className="design-live-topbar">
          <div>
            <strong>{readable(page)} Live Design</strong>
            <span>{wiredStatus} · {layout.mode} layout · {layout.nodes.length} node{layout.nodes.length === 1 ? "" : "s"}</span>
          </div>
          <div className="design-engine-toolbar__actions">
            <label><input type="checkbox" checked={layout.snapEnabled} onChange={(event) => updateLayout((current) => ({ ...current, snapEnabled: event.target.checked }))} /> Snap</label>
            <label>Grid <input type="number" min="4" max="40" value={layout.gridSize} onChange={(event) => updateLayout((current) => ({ ...current, gridSize: Number(event.target.value || 12) }))} /></label>
            <button type="button" onClick={resetToBlank}>Blank</button>
            <button type="button" onClick={resetToDefault}>Default</button>
            <button type="button" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
        <div className="design-live-notice">{notice}</div>
        <div className="design-live-overlays">{sortedNodes.map(renderLiveOverlay)}</div>
        {selectedElement ? <div className="design-live-element-outline" style={{ left: selectedElement.rect.left, top: selectedElement.rect.top, width: selectedElement.rect.width, height: selectedElement.rect.height }}>{selectedElement.label}</div> : null}
        {renderInlineInspector()}
      </>,
      document.body,
    );
  }

  if (!ready) return null;

  return (
    <>
      {appliedLayoutCss ? <style id="rugby-live-design-layout">{appliedLayoutCss}</style> : null}
      <LiveStaticLayout layout={layout} page={page} />
      <button type="button" className="design-studio-toggle" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        {open ? "Done" : "Design"}
      </button>
      {open ? renderLiveDesignMode() : null}
    </>
  );
}
