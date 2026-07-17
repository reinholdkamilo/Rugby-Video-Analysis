"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

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
};

type SectionSetting = {
  id: string;
  label: string;
  hidden: boolean;
  order: number;
};

type PageSettings = {
  sections: SectionSetting[];
};

type DesignSettings = {
  theme: ThemeSettings;
  pages: Record<string, PageSettings>;
};

const DESIGN_STORAGE_KEY = "rugby-video-analysis:app-design-studio:v1";

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
};

const DEFAULT_SETTINGS: DesignSettings = {
  theme: DEFAULT_THEME,
  pages: {},
};

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
  const heading = element.querySelector("h1,h2,h3");
  const text = heading?.textContent?.trim() || element.getAttribute("aria-label") || fallback;
  return readableLabel(text.slice(0, 52));
}

function loadSettings(): DesignSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  const saved = window.localStorage.getItem(DESIGN_STORAGE_KEY);
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
  return settings.pages[key] ?? { sections: [] };
}

function sectionSelector(id: string) {
  return `[data-design-section="${CSS.escape(id)}"]`;
}

export function AppDesignStudio() {
  const pathname = usePathname();
  const key = pageKey(pathname);
  const [settings, setSettings] = useState<DesignSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [sections, setSections] = useState<SectionSetting[]>([]);

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

  const detectSections = useCallback(() => {
    const main = document.querySelector("main");
    if (!main) return [];
    const candidates = Array.from(main.querySelectorAll(":scope > header, :scope > div > section, :scope > section, :scope > div > form, :scope > div > div, :scope section > section"));
    const seen = new Set<Element>();
    return candidates
      .filter((element) => {
        if (seen.has(element)) return false;
        seen.add(element);
        return element instanceof HTMLElement && element.offsetParent !== null;
      })
      .slice(0, 24)
      .map((element, index) => {
        const currentId = element.getAttribute("data-design-section") || `${key}-${index + 1}`;
        element.setAttribute("data-design-section", currentId);
        return {
          id: currentId,
          label: elementLabel(element, `Section ${index + 1}`),
          hidden: false,
          order: index,
        };
      });
  }, [key]);

  useEffect(() => {
    if (!ready) return;
    const sync = () => {
      const detected = detectSections();
      const saved = pageSettings(settings, key).sections;
      const merged = detected.map((item) => saved.find((section) => section.id === item.id) ?? item);
      setSections(merged.sort((a, b) => a.order - b.order));
    };
    const timer = window.setTimeout(sync, 80);
    return () => window.clearTimeout(timer);
  }, [detectSections, key, pathname, ready, settings]);

  useEffect(() => {
    const savedSections = pageSettings(settings, key).sections;
    const current = savedSections.length ? savedSections : sections;
    const editableActive = open || savedSections.length > 0;
    document.querySelectorAll(".design-editable-parent").forEach((element) => {
      element.classList.remove("design-editable-parent");
    });
    for (const section of current) {
      const element = document.querySelector<HTMLElement>(sectionSelector(section.id));
      if (!element) continue;
      element.parentElement?.classList.toggle("design-editable-parent", editableActive);
      element.style.order = String(section.order);
      element.hidden = section.hidden;
      element.classList.toggle("design-hidden-section", section.hidden);
    }
  }, [key, open, sections, settings]);

  const currentPage = useMemo(() => pageSettings(settings, key), [key, settings]);
  const currentSections = currentPage.sections.length ? currentPage.sections : sections;

  function updateTheme(updates: Partial<ThemeSettings>) {
    setSettings((current) => ({ ...current, theme: { ...current.theme, ...updates } }));
  }

  function updateSections(nextSections: SectionSetting[]) {
    const normalised = nextSections.map((section, index) => ({ ...section, order: index }));
    setSections(normalised);
    setSettings((current) => ({
      ...current,
      pages: {
        ...current.pages,
        [key]: { sections: normalised },
      },
    }));
  }

  function moveSection(sectionId: string, direction: -1 | 1) {
    const list = [...currentSections].sort((a, b) => a.order - b.order);
    const index = list.findIndex((section) => section.id === sectionId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return;
    const [item] = list.splice(index, 1);
    list.splice(nextIndex, 0, item);
    updateSections(list);
  }

  function toggleSection(sectionId: string) {
    updateSections(currentSections.map((section) => section.id === sectionId ? { ...section, hidden: !section.hidden } : section));
  }

  function resetCurrentPage() {
    const detected = detectSections();
    setSections(detected);
    setSettings((current) => {
      const pages = { ...current.pages };
      delete pages[key];
      return { ...current, pages };
    });
  }

  function resetAllDesign() {
    setSettings(DEFAULT_SETTINGS);
    setSections(detectSections());
  }

  if (!ready) return null;

  return (
    <>
      <button
        type="button"
        className="design-studio-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Design
      </button>

      {open ? (
        <aside className="design-studio-panel" aria-label="App design studio">
          <div className="design-studio-panel__head">
            <div>
              <p>Design Mode</p>
              <h2>{readableLabel(key)} Tab</h2>
            </div>
            <button type="button" onClick={() => setOpen(false)}>Close</button>
          </div>

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
          </section>

          <section>
            <div className="design-section-title">
              <h3>Sections</h3>
              <button type="button" onClick={resetCurrentPage}>Reset tab</button>
            </div>
            <div className="design-section-list">
              {currentSections.map((section, index) => (
                <div key={section.id} className="design-section-row">
                  <span>{section.label}</span>
                  <button type="button" onClick={() => moveSection(section.id, -1)} disabled={index === 0}>Up</button>
                  <button type="button" onClick={() => moveSection(section.id, 1)} disabled={index === currentSections.length - 1}>Down</button>
                  <button type="button" onClick={() => toggleSection(section.id)}>{section.hidden ? "Show" : "Hide"}</button>
                </div>
              ))}
            </div>
          </section>

          <button type="button" className="design-reset-all" onClick={resetAllDesign}>Reset all app design</button>
        </aside>
      ) : null}
    </>
  );
}
