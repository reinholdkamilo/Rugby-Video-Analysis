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

type ElementStyleOverride = {
  id: string;
  page: PageKey;
  selector: string;
  label: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  background?: string;
  color?: string;
  borderColor?: string;
  borderWidth?: number;
  radius?: number;
  opacity?: number;
  zIndex?: number;
  display?: "revert" | "block" | "flex" | "grid";
  flexDirection?: "row" | "column";
  columns?: number;
  rows?: number;
  gap?: number;
  padding?: number;
  textAlign?: "left" | "center" | "right";
  alignItems?: "start" | "center" | "end" | "stretch";
  justifyContent?: "start" | "center" | "end" | "space-between" | "space-around";
  hidden?: boolean;
  createdAt: string;
  updatedAt: string;
};

type DesignStore = {
  version: 3;
  layouts: Partial<Record<PageKey, PageLayout>>;
  templates: SavedTemplate[];
  elementCssResets?: ElementCssReset[];
  elementStyleOverrides?: ElementStyleOverride[];
};

type DragState =
  | { mode: "move"; id: string; startX: number; startY: number; baseX: number; baseY: number }
  | { mode: "resize"; id: string; startX: number; startY: number; baseWidth: number; baseHeight: number };

type ElementDragState =
  | { mode: "move"; selector: string; startX: number; startY: number; baseX: number; baseY: number }
  | {
    mode: "resize";
    selector: string;
    edge: "n" | "e" | "s" | "w" | "se";
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    baseWidth: number;
    baseHeight: number;
  };

type LiveRect = { left: number; top: number; width: number; height: number };
type SelectedElement = { selector: string; label: string; rect: LiveRect };

const STORAGE_KEY = "rugby-video-analysis:blank-canvas-design:v3";
const SUPPORTED_PAGES: PageKey[] = ["home", "upload", "library", "coding", "reports", "evidence", "intelligence"];
const FULLY_WIRED_PAGES = new Set<PageKey>(["coding", "library", "reports"]);

const DEFAULT_STORE: DesignStore = { version: 3, layouts: {}, templates: [], elementCssResets: [], elementStyleOverrides: [] };

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
    return {
      version: 3,
      layouts: parsed.layouts ?? {},
      templates: parsed.templates ?? [],
      elementCssResets: parsed.elementCssResets ?? [],
      elementStyleOverrides: parsed.elementStyleOverrides ?? [],
    };
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
  if (designLabel) return cleanElementLabel(designLabel);
  const text = element.innerText?.trim().replace(/\s+/g, " ").slice(0, 42);
  const id = element.id ? `#${element.id}` : "";
  return `${element.tagName.toLowerCase()}${id}${text ? ` · ${text}` : ""}`;
}

function cleanElementLabel(label: string) {
  return label
    .replace(/\b(video player shell|shell|container|box|grid|list|block)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim() || label;
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

function designIdFromSelector(selector: string) {
  const match = selector.match(/^\[data-design-id="(.+)"\]$/);
  return match ? match[1].replace(/\\([^a-zA-Z0-9_-])/g, "$1") : null;
}

function isSimplifiedDesignRootId(designId: string) {
  if (designId.endsWith("-key-overlay") || designId.endsWith("-overlay") || designId.endsWith("-hud")) return true;
  if (designId.endsWith("-block")) return !(designId.includes("shell") || designId.includes("grid") || designId.includes("list") || designId.includes("box"));
  if (designId.includes("shell") || designId.includes("grid") || designId.includes("list") || designId.includes("board")) return false;
  if (designId.includes("box") || designId.includes("card") || designId.includes("row") || designId.includes("section")) return false;
  if (designId.includes("column") || designId.includes("form") || designId.includes("field") || designId.includes("selector")) return false;
  if (designId.includes("button") || designId.includes("key") || designId.includes("text") || designId.includes("count")) return false;
  return false;
}

function isSimplifiedSelector(selector: string) {
  const designId = designIdFromSelector(selector);
  return !designId || isSimplifiedDesignRootId(designId);
}

function simplifiedDesignElement(element: HTMLElement) {
  const roots: HTMLElement[] = [];
  let current: HTMLElement | null = element;
  while (current && current.tagName.toLowerCase() !== "main") {
    const designId = current.getAttribute("data-design-id");
    if (designId && isSimplifiedDesignRootId(designId)) roots.push(current);
    current = current.parentElement;
  }
  return roots[0] ?? element.closest<HTMLElement>("[data-design-id]") ?? element;
}

function isDesignChromeElement(element: HTMLElement) {
  return Boolean(element.closest(".design-live-topbar, .design-live-panel, .design-studio-toggle"));
}

function selectableElementFromPoint(target: HTMLElement, clientX: number, clientY: number) {
  if (isDesignChromeElement(target)) return null;
  const fromTarget = target.closest<HTMLElement>("main *");
  if (fromTarget && !fromTarget.closest(".design-live-overlays")) return simplifiedDesignElement(fromTarget);

  for (const element of document.elementsFromPoint(clientX, clientY)) {
    if (!(element instanceof HTMLElement)) continue;
    if (isDesignChromeElement(element)) return null;
    if (element.closest(".design-live-overlays")) continue;
    const candidate = element.closest<HTMLElement>("main *");
    if (candidate) return simplifiedDesignElement(candidate);
  }
  return null;
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
    .filter((reset) => reset.page === page && reset.mode !== "none" && isSimplifiedSelector(reset.selector))
    .map((reset) => `${reset.selector}{${elementResetStyles(reset.mode)}}`)
    .join("\n");
}

function elementStyleOverrideStyles(override: ElementStyleOverride) {
  return [
    override.x || override.y ? `transform:translate(${override.x ?? 0}px, ${override.y ?? 0}px)!important` : "",
    override.x || override.y ? "position:relative!important" : "",
    override.width ? `width:${override.width}px!important` : "",
    override.width ? `max-width:${override.width}px!important` : "",
    override.height ? `height:${override.height}px!important` : "",
    override.height ? `min-height:${override.height}px!important` : "",
    override.background ? `background:${override.background}!important` : "",
    override.color ? `color:${override.color}!important` : "",
    override.borderColor ? `border-color:${override.borderColor}!important` : "",
    typeof override.borderWidth === "number" ? `border-width:${override.borderWidth}px!important` : "",
    typeof override.borderWidth === "number" ? "border-style:solid!important" : "",
    typeof override.radius === "number" ? `border-radius:${override.radius}px!important` : "",
    typeof override.opacity === "number" ? `opacity:${override.opacity}!important` : "",
    typeof override.zIndex === "number" ? `z-index:${override.zIndex}!important` : "",
    typeof override.zIndex === "number" ? "position:relative!important" : "",
    override.display && override.display !== "revert" ? `display:${override.display}!important` : "",
    override.display === "flex" && override.flexDirection ? `flex-direction:${override.flexDirection}!important` : "",
    override.display === "grid" && override.columns ? `grid-template-columns:repeat(${override.columns}, minmax(0, 1fr))!important` : "",
    override.display === "grid" && override.rows ? `grid-template-rows:repeat(${override.rows}, minmax(0, auto))!important` : "",
    typeof override.gap === "number" ? `gap:${override.gap}px!important` : "",
    typeof override.padding === "number" ? `padding:${override.padding}px!important` : "",
    override.textAlign ? `text-align:${override.textAlign}!important` : "",
    override.alignItems ? `align-items:${override.alignItems}!important` : "",
    override.justifyContent ? `justify-content:${override.justifyContent}!important` : "",
    override.hidden ? "display:none!important" : "",
  ].filter(Boolean).join(";");
}

function elementStyleOverrideCss(page: PageKey, overrides: ElementStyleOverride[]) {
  return overrides
    .filter((override) => override.page === page && isSimplifiedSelector(override.selector))
    .map((override) => `${override.selector}{${elementStyleOverrideStyles(override)}}`)
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
  const elementDragRef = useRef<ElementDragState | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [store, setStore] = useState<DesignStore>(DEFAULT_STORE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [elementPickMode, setElementPickMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [notice, setNotice] = useState("Design Engine ready.");
  const [, setMeasureTick] = useState(0);

  const layout = useMemo(() => normalizeLayout(store.layouts[page] ?? defaultLayout(page)), [page, store.layouts]);
  const selected = layout.nodes.find((node) => node.id === selectedId) ?? null;
  const pageComponents = componentsForPage(page);
  const usedComponents = usedStatefulComponents(layout);
  const sortedNodes = [...layout.nodes].filter((node) => !node.hidden).sort((a, b) => a.order - b.order);
  const pageTemplates = store.templates.filter((template) => template.page === page);
  const pageElementResets = (store.elementCssResets ?? []).filter((reset) => reset.page === page && isSimplifiedSelector(reset.selector));
  const pageElementOverrides = (store.elementStyleOverrides ?? []).filter((override) => override.page === page && isSimplifiedSelector(override.selector));
  const pageElementEditCount = pageElementResets.length + pageElementOverrides.length;
  const selectedElementOverride = selectedElement ? pageElementOverrides.find((override) => override.selector === selectedElement.selector) : null;
  const wiredStatus = FULLY_WIRED_PAGES.has(page) ? "Canvas-enabled" : "Registered placeholder";
  const appliedLayoutCss = useMemo(
    () => [
      liveLayoutCss(page, layout),
      elementResetCss(page, store.elementCssResets ?? []),
      elementStyleOverrideCss(page, store.elementStyleOverrides ?? []),
    ].filter(Boolean).join("\n"),
    [layout, page, store.elementCssResets, store.elementStyleOverrides],
  );

  const updateStore = useCallback((updater: (current: DesignStore) => DesignStore) => {
    setStore((current) => {
      const next = updater(current);
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const updateElementOverride = useCallback((selector: string, updates: Partial<ElementStyleOverride>) => {
    const label = selectedElement?.selector === selector ? selectedElement.label : selector;
    updateStore((current) => {
      const existing = current.elementStyleOverrides ?? [];
      const currentOverride = existing.find((override) => override.page === page && override.selector === selector);
      const nextOverride: ElementStyleOverride = {
        ...currentOverride,
        id: currentOverride?.id ?? uid("element-style"),
        page,
        selector,
        label: currentOverride?.label ?? label,
        createdAt: currentOverride?.createdAt ?? now(),
        ...updates,
        updatedAt: now(),
      };
      return {
        ...current,
        elementStyleOverrides: [
          ...existing.filter((override) => !(override.page === page && override.selector === selector)),
          nextOverride,
        ],
      };
    });
  }, [page, selectedElement, updateStore]);

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
    if (!open) return;
    const onMove = (event: MouseEvent) => {
      const state = elementDragRef.current;
      if (!state) return;
      event.preventDefault();
      if (state.mode === "move") {
        updateElementOverride(state.selector, {
          x: snap(state.baseX + event.clientX - state.startX, layout.gridSize, layout.snapEnabled),
          y: snap(state.baseY + event.clientY - state.startY, layout.gridSize, layout.snapEnabled),
        });
      } else {
        const deltaX = event.clientX - state.startX;
        const deltaY = event.clientY - state.startY;
        const nextX = state.edge === "w" ? snap(state.baseX + deltaX, layout.gridSize, layout.snapEnabled) : state.baseX;
        const nextY = state.edge === "n" ? snap(state.baseY + deltaY, layout.gridSize, layout.snapEnabled) : state.baseY;
        const widthDelta = state.edge === "w" ? -deltaX : state.edge === "e" || state.edge === "se" ? deltaX : 0;
        const heightDelta = state.edge === "n" ? -deltaY : state.edge === "s" || state.edge === "se" ? deltaY : 0;
        updateElementOverride(state.selector, {
          x: nextX,
          y: nextY,
          width: Math.max(12, snap(state.baseWidth + widthDelta, layout.gridSize, layout.snapEnabled)),
          height: Math.max(12, snap(state.baseHeight + heightDelta, layout.gridSize, layout.snapEnabled)),
        });
      }
      setMeasureTick((tick) => tick + 1);
    };
    const onUp = () => {
      elementDragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [layout.gridSize, layout.snapEnabled, open, updateElementOverride]);

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
    if (!open || !selectedElement || selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest(".design-engine-panel")) return;
      const map: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const direction = map[event.key];
      if (!direction) return;
      event.preventDefault();
      const step = event.altKey ? 1 : event.shiftKey ? layout.gridSize * 4 : layout.gridSize;
      updateElementOverride(selectedElement.selector, {
        x: (selectedElementOverride?.x ?? 0) + direction[0] * step,
        y: (selectedElementOverride?.y ?? 0) + direction[1] * step,
      });
      setMeasureTick((tick) => tick + 1);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [layout.gridSize, open, selected, selectedElement, selectedElementOverride, updateElementOverride]);

  useEffect(() => {
    if (!open || !elementPickMode) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const candidate = selectableElementFromPoint(target, event.clientX, event.clientY);
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

  function updateSelectedElement(updates: Partial<ElementStyleOverride>) {
    if (!selectedElement) {
      setNotice("Turn on Element Inspect and click a page element first.");
      return;
    }
    updateElementOverride(selectedElement.selector, updates);
    setNotice(`Updated ${selectedElement.label}.`);
  }

  function deleteSelectedElement() {
    if (!selectedElement) return;
    updateElementOverride(selectedElement.selector, { hidden: true });
    setNotice(`${selectedElement.label} hidden. Use Restore selected element to bring it back.`);
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
      elementStyleOverrides: (current.elementStyleOverrides ?? []).filter((override) => !(override.page === page && override.selector === selectedElement.selector)),
    }));
    setNotice(`Restored styling for ${selectedElement.label}.`);
  }

  function clearPageElementResets() {
    updateStore((current) => ({
      ...current,
      elementCssResets: (current.elementCssResets ?? []).filter((reset) => reset.page !== page),
      elementStyleOverrides: (current.elementStyleOverrides ?? []).filter((override) => override.page !== page),
    }));
    setSelectedElement(null);
    setNotice(`All element edits cleared for ${readable(page)}.`);
  }

  function startElementDrag(mode: ElementDragState["mode"], event: ReactMouseEvent<HTMLButtonElement>, edge: "n" | "e" | "s" | "w" | "se" = "se") {
    if (!selectedElement) return;
    event.preventDefault();
    event.stopPropagation();
    const current = selectedElementOverride;
    elementDragRef.current = mode === "move"
      ? {
        mode,
        selector: selectedElement.selector,
        startX: event.clientX,
        startY: event.clientY,
        baseX: current?.x ?? 0,
        baseY: current?.y ?? 0,
      }
      : {
        mode,
        selector: selectedElement.selector,
        edge,
        startX: event.clientX,
        startY: event.clientY,
        baseX: current?.x ?? 0,
        baseY: current?.y ?? 0,
        baseWidth: current?.width ?? selectedElement.rect.width,
        baseHeight: current?.height ?? selectedElement.rect.height,
      };
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
                <div className="design-engine-form-grid">
                  <label>X <input type="number" value={selectedElementOverride?.x ?? 0} onChange={(event) => updateSelectedElement({ x: Number(event.target.value) })} /></label>
                  <label>Y <input type="number" value={selectedElementOverride?.y ?? 0} onChange={(event) => updateSelectedElement({ y: Number(event.target.value) })} /></label>
                  <label>W <input type="number" min="1" value={selectedElementOverride?.width ?? Math.round(selectedElement.rect.width)} onChange={(event) => updateSelectedElement({ width: Number(event.target.value) })} /></label>
                  <label>H <input type="number" min="1" value={selectedElementOverride?.height ?? Math.round(selectedElement.rect.height)} onChange={(event) => updateSelectedElement({ height: Number(event.target.value) })} /></label>
                </div>
                <div className="design-engine-form-grid">
                  <label>BG <input type="color" value={selectedElementOverride?.background ?? "#ffffff"} onChange={(event) => updateSelectedElement({ background: event.target.value })} /></label>
                  <label>Text <input type="color" value={selectedElementOverride?.color ?? "#13221f"} onChange={(event) => updateSelectedElement({ color: event.target.value })} /></label>
                  <label>Border <input type="color" value={selectedElementOverride?.borderColor ?? "#dfe6e2"} onChange={(event) => updateSelectedElement({ borderColor: event.target.value })} /></label>
                  <label>Opacity <input type="number" min="0" max="1" step="0.05" value={selectedElementOverride?.opacity ?? 1} onChange={(event) => updateSelectedElement({ opacity: Number(event.target.value) })} /></label>
                </div>
                <div className="design-engine-form-grid">
                  <label>Border W <input type="number" min="0" value={selectedElementOverride?.borderWidth ?? 0} onChange={(event) => updateSelectedElement({ borderWidth: Number(event.target.value) })} /></label>
                  <label>Radius <input type="number" min="0" max="120" value={selectedElementOverride?.radius ?? 0} onChange={(event) => updateSelectedElement({ radius: Number(event.target.value) })} /></label>
                  <label>Layer <input type="number" min="0" max="999" value={selectedElementOverride?.zIndex ?? 1} onChange={(event) => updateSelectedElement({ zIndex: Number(event.target.value) })} /></label>
                  <label>Hidden <input type="checkbox" checked={Boolean(selectedElementOverride?.hidden)} onChange={(event) => updateSelectedElement({ hidden: event.target.checked })} /></label>
                </div>
                <div className="design-engine-form-grid">
                  <label>Layout <select value={selectedElementOverride?.display ?? "revert"} onChange={(event) => updateSelectedElement({ display: event.target.value as ElementStyleOverride["display"] })}>
                    <option value="revert">Default</option>
                    <option value="block">Block</option>
                    <option value="flex">Flex</option>
                    <option value="grid">Grid</option>
                  </select></label>
                  <label>Flow <select value={selectedElementOverride?.flexDirection ?? "row"} onChange={(event) => updateSelectedElement({ flexDirection: event.target.value as ElementStyleOverride["flexDirection"], display: "flex" })}>
                    <option value="row">Rows</option>
                    <option value="column">Columns</option>
                  </select></label>
                  <label>Columns <input type="number" min="1" max="12" value={selectedElementOverride?.columns ?? 2} onChange={(event) => updateSelectedElement({ columns: Number(event.target.value), display: "grid" })} /></label>
                  <label>Rows <input type="number" min="1" max="12" value={selectedElementOverride?.rows ?? 1} onChange={(event) => updateSelectedElement({ rows: Number(event.target.value), display: "grid" })} /></label>
                </div>
                <div className="design-engine-form-grid">
                  <label>Gap <input type="number" min="0" max="80" value={selectedElementOverride?.gap ?? 0} onChange={(event) => updateSelectedElement({ gap: Number(event.target.value) })} /></label>
                  <label>Padding <input type="number" min="0" max="120" value={selectedElementOverride?.padding ?? 0} onChange={(event) => updateSelectedElement({ padding: Number(event.target.value) })} /></label>
                  <label>Text <select value={selectedElementOverride?.textAlign ?? "left"} onChange={(event) => updateSelectedElement({ textAlign: event.target.value as ElementStyleOverride["textAlign"] })}>
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </select></label>
                  <label>Align <select value={selectedElementOverride?.alignItems ?? "stretch"} onChange={(event) => updateSelectedElement({ alignItems: event.target.value as ElementStyleOverride["alignItems"] })}>
                    <option value="start">Start</option>
                    <option value="center">Center</option>
                    <option value="end">End</option>
                    <option value="stretch">Stretch</option>
                  </select></label>
                </div>
                <div className="design-engine-form-grid">
                  <label>Justify <select value={selectedElementOverride?.justifyContent ?? "start"} onChange={(event) => updateSelectedElement({ justifyContent: event.target.value as ElementStyleOverride["justifyContent"] })}>
                    <option value="start">Start</option>
                    <option value="center">Center</option>
                    <option value="end">End</option>
                    <option value="space-between">Between</option>
                    <option value="space-around">Around</option>
                  </select></label>
                  <button type="button" onClick={() => updateSelectedElement({ display: "flex", flexDirection: "row" })}>Fit in row</button>
                  <button type="button" onClick={() => updateSelectedElement({ display: "flex", flexDirection: "column" })}>Fit in column</button>
                  <button type="button" onClick={() => updateSelectedElement({ display: "grid", columns: selectedElementOverride?.columns ?? 2 })}>Fit grid</button>
                </div>
                <div className="design-engine-button-row">
                  <button type="button" onClick={() => applyElementReset("all")}>Remove all CSS</button>
                  <button type="button" onClick={() => applyElementReset("colors")}>Remove colours</button>
                  <button type="button" onClick={() => applyElementReset("spacing")}>Remove spacing</button>
                  <button type="button" onClick={() => applyElementReset("border")}>Remove borders</button>
                </div>
                <div className="design-engine-button-row">
                  <button type="button" className="design-engine-danger" onClick={deleteSelectedElement}>Delete / hide element</button>
                  <button type="button" onClick={restoreSelectedElement}>Restore selected element</button>
                </div>
              </>
            ) : <p>Turn on inspect, then click any page element to target it.</p>}
            {pageElementEditCount ? (
              <>
                <small>{pageElementEditCount} saved element edit{pageElementEditCount === 1 ? "" : "s"} on this page.</small>
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
    const selectedElementRect = selectedElement ? {
      left: selectedElement.rect.left + (selectedElementOverride?.x ?? 0),
      top: selectedElement.rect.top + (selectedElementOverride?.y ?? 0),
      width: selectedElementOverride?.width ?? selectedElement.rect.width,
      height: selectedElementOverride?.height ?? selectedElement.rect.height,
    } : null;
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
        {selectedElement && selectedElementRect ? (
          <div className="design-live-element-outline" style={selectedElementRect}>
            <button type="button" className="design-live-element-outline__handle" onMouseDown={(event) => startElementDrag("move", event)}>
              {selectedElementOverride?.hidden ? "Hidden" : selectedElement.label}
            </button>
            <button type="button" className="design-live-element-outline__edge design-live-element-outline__edge--n" onMouseDown={(event) => startElementDrag("resize", event, "n")} aria-label={`Resize ${selectedElement.label} from top`} />
            <button type="button" className="design-live-element-outline__edge design-live-element-outline__edge--e" onMouseDown={(event) => startElementDrag("resize", event, "e")} aria-label={`Resize ${selectedElement.label} from right`} />
            <button type="button" className="design-live-element-outline__edge design-live-element-outline__edge--s" onMouseDown={(event) => startElementDrag("resize", event, "s")} aria-label={`Resize ${selectedElement.label} from bottom`} />
            <button type="button" className="design-live-element-outline__edge design-live-element-outline__edge--w" onMouseDown={(event) => startElementDrag("resize", event, "w")} aria-label={`Resize ${selectedElement.label} from left`} />
            <button type="button" className="design-live-element-outline__resize" onMouseDown={(event) => startElementDrag("resize", event, "se")} aria-label={`Resize ${selectedElement.label} from corner`} />
          </div>
        ) : null}
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
