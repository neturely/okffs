// The `okffs setup` wizard.
//
// Flow:
//   first run (no .env)  → Quick (auth+repo+base) or Full (every section)
//   re-run (.env exists) → Sync (only new/unconfigured vars) by default, with an
//                          explicit "reconfigure everything" opt-in
// then: regenerate .env cleanly → run a non-fatal sanity test → print the banner.

import { join, basename, relative } from "node:path";
import { existsSync, statSync, readFileSync, writeFileSync } from "node:fs";
import * as p from "@clack/prompts";

import { findGitRoot } from "../env_load.js";
import { isValidAppName } from "../apps.js";
import { gitignoreCoversEnv, gitignoreAnchoredEnvOnly, appendEnvIgnore } from "./gitignore.js";

import { SECTIONS, QUICK_KEYS, findVar, type Section, type VarSpec } from "./manifest.js";
import { parseEnv, serializeEnv, writeEnv, type Collected, type Entry } from "./env.js";
import { runSanity, type CheckStatus } from "./sanity.js";
import { buildBannerInfo, renderBanner, packageVersion } from "./banner.js";

type Mode = "quick" | "full" | "sync";

export async function runSetup(argv: string[]): Promise<number> {
  const forceReconfigure = argv.includes("--reconfigure") || argv.includes("--all");

  if (!process.stdin.isTTY) {
    console.error(
      "okffs setup needs an interactive terminal (TTY). Run it directly in a shell —\n" +
        "it can't prompt when piped or running in CI. Edit .env by hand instead (see .env.example)."
    );
    return 1;
  }

  const envPath = join(process.cwd(), ".env");
  const parsed = parseEnv(envPath);

  p.intro("okffs setup");

  // Multisite site mode (#313): running inside an app directory of a repo whose
  // root already has an okffs .env configures THIS directory's .env — just the
  // app name (everything else is inherited from the root, closer file wins).
  const site = detectSite(process.cwd());
  if (site) return runSiteSetup(site, envPath, parsed);

  p.note(
    [
      "This wizard configures okffs by writing your settings to a `.env` file.",
      "",
      "• Nothing is written until you confirm at the very end.",
      "• okffs only manages its own marked block — your own variables and",
      "  comments are preserved untouched.",
      "• Prefer to do it by hand? Press Ctrl-C to exit any time and copy the",
      "  variables you want from `.env.example` instead.",
    ].join("\n"),
    "Before we start"
  );

  if (parsed.exists) {
    p.log.info(`Found an existing .env at ${envPath} — it will be updated in place.`);
  } else {
    p.log.info(`No .env yet — this will create one at ${envPath}`);
  }

  // Seed from the existing file so a rewrite preserves everything not re-asked.
  const collected: Collected = {};
  for (const key of parsed.known) {
    const val = parsed.values[key];
    collected[key] = val !== undefined && val !== "" ? { state: "set", value: val } : { state: "declined", value: "" };
  }

  const mode = await chooseMode(parsed, forceReconfigure, collected);
  if (mode === null) {
    // Nothing to configure and the user declined a full redo — still offer value.
    await finish(collected, parsed, envPath, false);
    return 0;
  }

  if (mode === "quick") {
    for (const key of QUICK_KEYS) {
      const spec = findVar(key)!;
      applyResult(collected, key, await askVar(spec, collected[key]));
    }
  } else {
    await walkSections(collected, parsed, mode);
  }

  // Multisite (#313): offer an .env for every registered app directory that
  // doesn't have one yet — runs on every pass, so a sync run picks up apps
  // added to OKFFS_APPS since the last time.
  await offerSiteEnvs(valuesView(collected));

  // Confirm before writing to an existing file. Only okffs's own marked block is
  // rewritten; the user's other variables and comments are preserved verbatim.
  if (parsed.exists) {
    const go = await p.confirm({
      message: "Update .env now? Only okffs's own marked block is rewritten — your other variables and comments are kept as-is.",
      initialValue: true,
    });
    if (p.isCancel(go) || !go) {
      p.cancel("No changes written.");
      return 1;
    }
  }

  await finish(collected, parsed, envPath, true);
  return 0;
}

// ── Mode selection ───────────────────────────────────────────────────────────

async function chooseMode(parsed: ReturnType<typeof parseEnv>, forceReconfigure: boolean, collected: Collected): Promise<Mode | null> {
  if (!parsed.exists) {
    const choice = guard(
      await p.select({
        message: "First run — how much do you want to configure now?",
        options: [
          { value: "quick", label: "Quick setup", hint: "auth, repo, and base branch only" },
          { value: "full", label: "Full wizard", hint: "walk through every section" },
        ],
      })
    );
    return choice as Mode;
  }

  if (forceReconfigure) {
    p.log.info("Reconfiguring everything (current values shown; press Enter to keep each).");
    return "full";
  }

  const newVars = SECTIONS.flatMap((s) => [...(s.gateKey ? [s.gateKey] : []), ...s.vars.map((v) => v.key)]).filter((k) => !parsed.known.has(k));

  if (newVars.length === 0) {
    const redo = guard(await p.confirm({ message: "Your .env already covers every known option. Reconfigure everything anyway?", initialValue: false }));
    return redo ? "full" : null;
  }

  const choice = guard(
    await p.select({
      message: `${newVars.length} new/unconfigured option${newVars.length === 1 ? "" : "s"} since your .env was written.`,
      options: [
        { value: "sync", label: "Sync", hint: "only ask about the new options" },
        { value: "full", label: "Reconfigure everything", hint: "review every option" },
      ],
    })
  );
  return choice as Mode;
}

// ── Section walk (full / sync) ────────────────────────────────────────────────

async function walkSections(collected: Collected, parsed: ReturnType<typeof parseEnv>, mode: Mode): Promise<void> {
  const firstRun = !parsed.exists;

  for (const section of SECTIONS) {
    // A section gated on prior answers (promotion needs a protected branch).
    if (section.onlyIf && !section.onlyIf(valuesView(collected))) {
      declineKeys(collected, section.vars.map((v) => v.key), false);
      continue;
    }

    // In sync mode, the vars we'd ask are only the not-yet-known ones.
    const newVars = mode === "sync" ? section.vars.filter((v) => !parsed.known.has(v.key)) : section.vars;
    const gateKeyUnknown = section.gateKey ? !parsed.known.has(section.gateKey) : false;

    // Ungated (auth & repo): ask directly.
    if (!section.gated) {
      if (newVars.length === 0) continue;
      p.log.step(section.title);
      for (const v of newVars) applyResult(collected, v.key, await askVar(v, collected[v.key]));
      continue;
    }

    // Gated section backed by a real env var (Projects → OKFFS_PROJECT_ENABLED).
    if (section.gateKey) {
      const gateKnown = parsed.known.has(section.gateKey);
      const gateOn = valuesView(collected)[section.gateKey] === "true";
      let enabled: boolean;
      if (mode === "sync" && gateKnown) {
        enabled = gateOn; // don't re-ask a settled gate
        if (!enabled) continue; // feature off — leave it, don't nag about sub-vars
      } else {
        enabled = guard(await p.confirm({ message: section.gatePrompt!, initialValue: firstRun ? false : gateOn }));
      }
      collected[section.gateKey] = { state: "set", value: enabled ? "true" : "false" };
      if (!enabled) {
        declineKeys(collected, section.vars.map((v) => v.key), true);
        continue;
      }
      p.log.step(section.title);
      // When the gate was previously off/unknown, every sub-var is effectively new.
      const toAsk = mode === "sync" && gateKnown ? newVars : section.vars;
      for (const v of toAsk) applyResult(collected, v.key, await askVar(v, collected[v.key]));
      continue;
    }

    // Plain gated section (a yes/no that isn't persisted as its own var).
    if (mode === "sync" && newVars.length === 0) continue;
    const sectionHasValues = section.vars.some((v) => valuesView(collected)[v.key]);
    const label = mode === "sync" ? `${section.gatePrompt!} (${newVars.length} new)` : section.gatePrompt!;
    const configure = guard(await p.confirm({ message: label, initialValue: firstRun ? true : sectionHasValues }));
    if (!configure) {
      declineKeys(collected, newVars.map((v) => v.key), true);
      continue;
    }
    p.log.step(section.title);
    for (const v of newVars) applyResult(collected, v.key, await askVar(v, collected[v.key]));
  }
}

// ── Per-variable prompt ───────────────────────────────────────────────────────

async function askVar(spec: VarSpec, current: Entry | undefined): Promise<Entry | "skip"> {
  const hasCurrent = current?.state === "set" && current.value !== "";
  const label = `${spec.key} — ${spec.description}`;

  if (spec.kind === "secret") {
    if (hasCurrent) {
      const keep = guard(await p.confirm({ message: `${spec.key} is set (${mask(current!.value)}). Keep it?`, initialValue: true }));
      if (keep) return current!;
    }
    const val = guard(await p.password({ message: label }));
    return val && val.trim() ? { state: "set", value: val.trim() } : "skip";
  }

  if (spec.kind === "boolean") {
    const initial = hasCurrent ? current!.value === "true" : spec.default === "true";
    const val = guard(await p.confirm({ message: label, initialValue: initial }));
    return { state: "set", value: val ? "true" : "false" };
  }

  if (spec.kind === "select") {
    const val = guard(
      await p.select({
        message: label,
        initialValue: hasCurrent ? current!.value : spec.default,
        options: spec.options!.map((o) => ({ value: o, label: o === "" ? "(unset — use default/skip)" : o })),
      })
    );
    return val === "" ? "skip" : { state: "set", value: val as string };
  }

  // text
  const val = guard(
    await p.text({
      message: label,
      placeholder: spec.placeholder ?? "(leave blank to skip)",
      initialValue: hasCurrent ? current!.value : undefined,
      defaultValue: "",
    })
  );
  return val && val.trim() ? { state: "set", value: val.trim() } : "skip";
}

// ── Finish: write, sanity, banner ─────────────────────────────────────────────

async function finish(collected: Collected, parsed: ReturnType<typeof parseEnv>, envPath: string, rewrote: boolean, inherited: Record<string, string> | null = null): Promise<void> {
  if (rewrote) {
    const contents = serializeEnv(collected, parsed.preamble, parsed.postamble, packageVersion());
    writeEnv(envPath, contents);
    p.log.success(`Wrote ${envPath}`);
  }

  // .env files hold tokens: make sure the repo ignores them at EVERY depth (a
  // site's finance/.env too), not just an anchored /.env at the root (#313).
  await ensureGitignore(findGitRoot(process.cwd()) ?? process.cwd());

  const spin = p.spinner();
  spin.start("Running sanity checks against GitHub");
  const { results, resolved } = await runSanity({ ...(inherited ?? {}), ...valuesView(collected) });
  spin.stop("Sanity checks complete");

  const lines = results.map((r) => `${icon(r.status)}  ${r.label}: ${r.detail}`);
  p.note(lines.join("\n") || "no checks run", "Sanity test (non-blocking)");

  const info = buildBannerInfo({ ...(inherited ?? {}), ...valuesView(collected) }, resolved);
  p.note(renderBanner(info), "Current configuration");

  const failed = results.some((r) => r.status === "fail");
  if (failed) {
    p.log.warn("Some checks failed — okffs may not work until they're resolved. Your .env was still written.");
  }
  p.outro(
    "Next: add okffs to your project's .mcp.json, then start Claude Code.\n" +
      "  Quick start guide: https://github.com/neturely/okffs#quick-start"
  );
}

// ── Multisite (#313) ──────────────────────────────────────────────────────────

interface SiteContext {
  gitRoot: string;
  rootEnvPath: string;
  rootValues: Record<string, string>;
  dirName: string;
}

// Site mode: cwd is below the git root AND the root has an okffs .env (any
// okffs var). Otherwise this is the (root) wizard as usual.
function detectSite(cwd: string): SiteContext | null {
  const gitRoot = findGitRoot(cwd);
  if (!gitRoot || gitRoot === cwd) return null;
  const rootEnvPath = join(gitRoot, ".env");
  const rootParsed = parseEnv(rootEnvPath);
  if (!rootParsed.exists || rootParsed.known.size === 0) return null;
  return { gitRoot, rootEnvPath, rootValues: rootParsed.values, dirName: basename(cwd) };
}

async function runSiteSetup(site: SiteContext, envPath: string, parsed: ReturnType<typeof parseEnv>): Promise<number> {
  const rel = relative(site.gitRoot, process.cwd());
  p.note(
    [
      `This directory (${rel}/) sits inside a repo whose root .env is already`,
      `configured for okffs. A site .env here only needs the app's name —`,
      `token, board, branches and merge settings are inherited from the root`,
      `.env (a value set here wins over the root's).`,
      ``,
      `The app name becomes the tag prefix ({app}-X.Y.Z), the release-branch`,
      `prefix, the default branch identifier and an issue label.`,
    ].join("\n"),
    "Multisite: app directory"
  );

  const registry = (site.rootValues.OKFFS_APPS ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
  const current = parsed.values.OKFFS_APP;
  const suggested = current || (isValidAppName(site.dirName) ? site.dirName : "");
  let app = "";
  for (;;) {
    const val = guard(
      await p.text({
        message: `OKFFS_APP — the app this directory is${registry.length ? ` (root OKFFS_APPS: ${registry.join(", ")})` : ""}`,
        placeholder: suggested || "finance",
        initialValue: suggested || undefined,
        defaultValue: suggested,
      })
    );
    app = (val ?? "").trim().toLowerCase();
    if (!isValidAppName(app)) {
      p.log.warn("Use lowercase letters, digits and hyphens (e.g. finance).");
      continue;
    }
    if (registry.length > 0 && !registry.includes(app)) {
      const go = guard(await p.confirm({ message: `"${app}" is not in the root's OKFFS_APPS (${registry.join(", ")}). Use it anyway? (Add it to OKFFS_APPS in the root .env afterwards.)`, initialValue: false }));
      if (!go) continue;
    }
    break;
  }

  const collected: Collected = {};
  for (const key of parsed.known) {
    const v = parsed.values[key];
    collected[key] = v !== undefined && v !== "" ? { state: "set", value: v } : { state: "declined", value: "" };
  }
  collected.OKFFS_APP = { state: "set", value: app };

  const go = guard(await p.confirm({ message: `Write ${envPath} with OKFFS_APP=${app}?${parsed.exists ? " (only okffs's marked block is rewritten)" : ""}`, initialValue: true }));
  if (!go) {
    p.cancel("No changes written.");
    return 1;
  }
  await finish(collected, parsed, envPath, true, site.rootValues);
  return 0;
}

// From the root wizard: create `{app}/.env` (OKFFS_APP={app}) for each registry
// app directory that exists and isn't configured yet.
async function offerSiteEnvs(values: Record<string, string>): Promise<void> {
  const apps = (values.OKFFS_APPS ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
  if (apps.length === 0) return;
  const rootApp = (values.OKFFS_APP ?? "").trim().toLowerCase();
  for (const app of apps) {
    if (app === rootApp) continue; // the root itself
    if (!isValidAppName(app)) {
      p.log.warn(`OKFFS_APPS entry "${app}" is not a valid app name (lowercase letters, digits, hyphens) — skipped.`);
      continue;
    }
    const dir = join(process.cwd(), app);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      p.log.warn(`App "${app}": no ${app}/ directory at the repo root yet — create it, then run \`okffs setup\` inside it.`);
      continue;
    }
    const sitePath = join(dir, ".env");
    const siteParsed = parseEnv(sitePath);
    if (siteParsed.values.OKFFS_APP === app) {
      p.log.info(`App "${app}": ${app}/.env already sets OKFFS_APP=${app}.`);
      continue;
    }
    const create = guard(await p.confirm({ message: `App "${app}": write ${app}/.env with OKFFS_APP=${app}? (inherits this root .env)`, initialValue: true }));
    if (!create) continue;
    const collected: Collected = {};
    for (const key of siteParsed.known) {
      const v = siteParsed.values[key];
      collected[key] = v !== undefined && v !== "" ? { state: "set", value: v } : { state: "declined", value: "" };
    }
    collected.OKFFS_APP = { state: "set", value: app };
    writeEnv(sitePath, serializeEnv(collected, siteParsed.preamble, siteParsed.postamble, packageVersion()));
    p.log.success(`Wrote ${sitePath}`);
  }
}

// Offer to add a depth-agnostic `.env` rule to the repo's .gitignore.
async function ensureGitignore(root: string): Promise<void> {
  const giPath = join(root, ".gitignore");
  let content = "";
  try {
    content = readFileSync(giPath, "utf8");
  } catch {
    content = "";
  }
  if (gitignoreCoversEnv(content)) return;
  const why = gitignoreAnchoredEnvOnly(content)
    ? `${giPath} ignores only the root /.env (anchored) — an app directory's .env would NOT be ignored.`
    : `${giPath} does not ignore .env files.`;
  const add = guard(await p.confirm({ message: `${why} Add a \`.env\` rule that applies at every depth?`, initialValue: true }));
  if (!add) {
    p.log.warn("Skipped — make sure every .env (root and app directories) is git-ignored; they hold your token.");
    return;
  }
  writeFileSync(giPath, appendEnvIgnore(content), "utf8");
  p.log.success(`Updated ${giPath}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function valuesView(collected: Collected): Record<string, string> {
  const v: Record<string, string> = {};
  for (const [k, e] of Object.entries(collected)) if (e.state === "set" && e.value !== "") v[k] = e.value;
  return v;
}

function applyResult(collected: Collected, key: string, res: Entry | "skip"): void {
  collected[key] = res === "skip" ? { state: "declined", value: "" } : res;
}

function declineKeys(collected: Collected, keys: string[], force: boolean): void {
  for (const k of keys) if (force || !collected[k]) collected[k] = { state: "declined", value: "" };
}

function mask(v: string): string {
  if (v.length <= 8) return "•".repeat(v.length);
  return `${v.slice(0, 4)}${"•".repeat(6)}${v.slice(-4)}`;
}

function icon(status: CheckStatus): string {
  return status === "pass" ? "✔" : status === "warn" ? "⚠" : status === "fail" ? "✖" : "·";
}

function guard<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel("Setup cancelled — no changes written.");
    process.exit(130);
  }
  return value as T;
}
