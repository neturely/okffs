// Reading and (re)writing .env for the setup wizard.
//
// okffs owns ONLY a marker-delimited block. Everything OUTSIDE the block — the
// user's own variables, their comments, their layout — is preserved verbatim
// across every run. Inside the block okffs regenerates its own variables in a
// fixed section order.
//
//   <user content, preserved byte-for-byte>
//   # okffs:env:start  ── managed; regenerated each run ──
//   OKFFS_… = …
//   # okffs:env:end
//   <more user content, preserved byte-for-byte>
//
// Recognized okffs variables found OUTSIDE the block (e.g. in a hand-written
// .env being adopted for the first time, or one copied from .env.example) are
// MIGRATED into the block: their value is read and re-emitted inside the block,
// and the stray line is removed so there is never a duplicate assignment. Their
// value is never lost — only relocated to the block okffs manages. Any comment
// that happened to sit directly above such a line stays where it was.
//
// The parser also powers sync mode: a variable counts as "known" whether it is
// set (`KEY=value`) or written as a declined placeholder (`# KEY=`), which is
// how sync distinguishes "asked and declined" from "new, never asked".

import { readFileSync, writeFileSync } from "node:fs";
import { SECTIONS, allKeys } from "./manifest.js";

const KEY_RE = /^([A-Z][A-Z0-9_]*)=(.*)$/;
const COMMENTED_KEY_RE = /^#\s*([A-Z][A-Z0-9_]*)\s*=/;

const START_MARKER = "okffs:env:start";
const END_MARKER = "okffs:env:end";

export interface ParsedEnv {
  /** Whether the file existed at all. */
  exists: boolean;
  /** User content before okffs's managed block — preserved verbatim (okffs var lines migrated out). */
  preamble: string;
  /** User content after okffs's managed block — preserved verbatim (okffs var lines migrated out). */
  postamble: string;
  /** okffs var values found anywhere (managed block or migrated from user content), for seeding. */
  values: Record<string, string>;
  /** Every okffs key that appears, set OR as a `# KEY=` placeholder, anywhere in the file. */
  known: Set<string>;
}

export function parseEnv(path: string): ParsedEnv {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { exists: false, preamble: "", postamble: "", values: {}, known: new Set() };
  }

  const manifestKeys = new Set(allKeys());
  const lines = raw.split("\n");

  // Locate okffs's managed block by its markers.
  const startIdx = lines.findIndex((l) => l.includes(START_MARKER));
  const endIdx = lines.findIndex((l) => l.includes(END_MARKER));

  let preLines: string[];
  let managedLines: string[];
  let postLines: string[];
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    preLines = lines.slice(0, startIdx);
    managedLines = lines.slice(startIdx + 1, endIdx);
    postLines = lines.slice(endIdx + 1);
  } else {
    // No markers: the whole file is user content. okffs vars in it get migrated.
    preLines = lines;
    managedLines = [];
    postLines = [];
  }

  const values: Record<string, string> = {};
  const known = new Set<string>();

  // The managed block is discarded and regenerated; just harvest its values.
  for (const line of managedLines) harvest(line, manifestKeys, values, known);

  // From user content, migrate okffs var lines out (harvest + drop) and keep
  // everything else — comments, blanks, custom vars, commented custom vars —
  // byte-for-byte.
  const preamble = migrate(preLines, manifestKeys, values, known);
  const postamble = migrate(postLines, manifestKeys, values, known);

  return { exists: true, preamble, postamble, values, known };
}

// Record an okffs var line's key (+ value if set) without keeping the line.
function harvest(line: string, manifestKeys: Set<string>, values: Record<string, string>, known: Set<string>): boolean {
  const cm = line.match(COMMENTED_KEY_RE);
  if (cm && manifestKeys.has(cm[1])) {
    known.add(cm[1]);
    return true;
  }
  const m = line.match(KEY_RE);
  if (m && manifestKeys.has(m[1])) {
    known.add(m[1]);
    const v = unquote(m[2].trim());
    if (v !== "" && values[m[1]] === undefined) values[m[1]] = v; // first occurrence wins (dotenv semantics)
    return true;
  }
  return false;
}

// Harvest okffs var lines out of `lines` and return the remaining lines
// (verbatim) joined back together.
function migrate(lines: string[], manifestKeys: Set<string>, values: Record<string, string>, known: Set<string>): string {
  const kept: string[] = [];
  for (const line of lines) {
    if (harvest(line, manifestKeys, values, known)) continue; // okffs var — migrated into the block
    kept.push(line); // user content — preserved
  }
  return kept.join("\n");
}

function unquote(v: string): string {
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

// Quote a value only when it needs it (spaces, #, or leading/trailing space),
// so simple values stay bare and readable.
function quoteIfNeeded(v: string): string {
  if (v === "") return "";
  if (/[\s#'"]/.test(v) || v !== v.trim()) return JSON.stringify(v);
  return v;
}

// Three states a manifest var can be in when writing the managed block:
//   set      → `KEY=value`
//   declined → `# KEY=`          (explicitly skipped; marks the key "known")
//   (absent) → omitted entirely  (never asked, e.g. a Quick-setup var; a later
//                                  sync run WILL offer it because it's unknown)
export type EntryState = "set" | "declined";
export interface Entry {
  state: EntryState;
  value: string;
}

/** Keys absent from the map are "never asked" and omitted from the output. */
export type Collected = Record<string, Entry>;

// The block boundary is a SINGLE decorative line that CONTAINS the marker, so a
// re-parse slices exactly at it — no stray rule line can leak into the preserved
// user content and make the file grow on each run (regen must be idempotent).
const START_LINE = `# ${"═".repeat(22)} ${START_MARKER} ${"═".repeat(22)}`;
const END_LINE = `# ${"═".repeat(23)} ${END_MARKER} ${"═".repeat(24)}`;

/**
 * Assemble the full .env: the preserved user preamble, then okffs's managed
 * block (regenerated from the manifest + collected values), then the preserved
 * user postamble. Only the managed block is okffs's to rewrite.
 */
export function serializeEnv(collected: Collected, preamble: string, postamble: string): string {
  const block: string[] = [
    START_LINE,
    "# Managed by `okffs setup` — regenerated on every run; set these via",
    "# `okffs setup`, not by hand. Your own variables and comments OUTSIDE this",
    "# block are left untouched.",
    "",
  ];

  for (const section of SECTIONS) {
    const keys = [...(section.gateKey ? [section.gateKey] : []), ...section.vars.map((v) => v.key)];
    if (!keys.some((k) => collected[k])) continue; // whole section unasked — skip it

    block.push(`# ${section.title}`);
    if (section.blurb) block.push(`# ${section.blurb}`);
    for (const k of keys) emitVar(block, k, collected);
    block.push("");
  }

  block.push(END_LINE);

  const pre = preamble.trim() ? preamble.replace(/\s+$/, "") + "\n\n" : "";
  const post = postamble.trim() ? "\n" + postamble.replace(/^\s+/, "") : "";
  const out = pre + block.join("\n") + post;
  return out.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function emitVar(out: string[], key: string, collected: Collected): void {
  const e = collected[key];
  if (!e) return; // never asked — omit so a later sync run offers it
  if (e.state === "declined" || e.value === "") {
    out.push(`# ${key}=`);
  } else {
    out.push(`${key}=${quoteIfNeeded(e.value)}`);
  }
}

export function writeEnv(path: string, contents: string): void {
  writeFileSync(path, contents, "utf8");
}
