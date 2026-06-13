import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const FG = "var(--muxy-foreground)";
const MUTED = "var(--muxy-foreground-muted)";
const ACCENT = "var(--muxy-accent)";

// Token palettes per color scheme. The muxy theme variables only expose a
// single accent hue, which is not enough to tell keywords, strings, types and
// functions apart, so syntax tokens get their own palette. It is installed as
// CSS variables and re-applied on theme switches so every consumer (the
// CodeMirror editor, the tree-sitter highlighter, the markdown preview)
// tracks the live color scheme.
const PALETTES = {
  light: {
    keyword: "#cf222e",
    string: "#0a3069",
    regexp: "#116329",
    escape: "#0550ae",
    constant: "#0550ae",
    function: "#8250df",
    type: "#953800",
    property: "#0550ae",
    tag: "#116329",
  },
  dark: {
    keyword: "#ff7b72",
    string: "#a5d6ff",
    regexp: "#7ee787",
    escape: "#79c0ff",
    constant: "#79c0ff",
    function: "#d2a8ff",
    type: "#ffa657",
    property: "#79c0ff",
    tag: "#7ee787",
  },
};

export const syn = (name) => `var(--muxy-files-syn-${name})`;

let palette_installed = false;

export function ensure_syntax_palette() {
  if (palette_installed || typeof document === "undefined") return;
  palette_installed = true;
  const apply = (scheme) => {
    const palette = PALETTES[scheme === "dark" ? "dark" : "light"];
    for (const [name, color] of Object.entries(palette)) {
      document.documentElement.style.setProperty(`--muxy-files-syn-${name}`, color);
    }
  };
  if (typeof muxy !== "undefined" && muxy?.theme) {
    apply(muxy.theme.colorScheme);
    muxy.onThemeChange?.((theme) => apply(theme.colorScheme));
  } else {
    apply(window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  }
}

export const SYNTAX_SPEC = [
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword], color: syn("keyword") },
  { tag: [t.string, t.special(t.string), t.attributeValue], color: syn("string") },
  { tag: [t.regexp], color: syn("regexp") },
  { tag: [t.escape, t.character], color: syn("escape") },
  { tag: [t.number, t.bool, t.integer, t.float], color: syn("constant") },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: MUTED, fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: syn("function") },
  { tag: [t.typeName, t.className, t.namespace], color: syn("type") },
  { tag: [t.constant(t.variableName), t.standard(t.name), t.atom, t.self], color: syn("constant") },
  { tag: [t.propertyName, t.attributeName], color: syn("property") },
  { tag: [t.tagName], color: syn("tag") },
  { tag: [t.punctuation, t.separator, t.bracket, t.operator], color: MUTED },
  { tag: [t.meta, t.processingInstruction], color: MUTED },
  { tag: [t.link], color: ACCENT, textDecoration: "underline" },
  { tag: [t.heading], color: FG, fontWeight: "bold" },
  { tag: [t.strong], fontWeight: "bold" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.strikethrough], textDecoration: "line-through" },
  { tag: [t.invalid], color: "var(--muxy-diff-remove, var(--muxy-foreground))" },
];

export function muxy_highlight_style() {
  ensure_syntax_palette();
  return syntaxHighlighting(HighlightStyle.define(SYNTAX_SPEC));
}

const PREVIEW_STYLE_ID = "muxy-files-syntax";

export function ensure_preview_highlight_css() {
  if (typeof document === "undefined") return;
  ensure_syntax_palette();
  if (document.getElementById(PREVIEW_STYLE_ID)) return;
  const css = SYNTAX_SPEC.map((rule, i) => {
    const decls = [];
    if (rule.color) decls.push(`color: ${rule.color}`);
    if (rule.fontStyle) decls.push(`font-style: ${rule.fontStyle}`);
    if (rule.fontWeight) decls.push(`font-weight: ${rule.fontWeight}`);
    if (rule.textDecoration) decls.push(`text-decoration: ${rule.textDecoration}`);
    return `.md-preview .tok-${i}{${decls.join(";")}}`;
  }).join("\n");
  const style = document.createElement("style");
  style.id = PREVIEW_STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}
