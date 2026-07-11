// The `okffs setup` wizard.
//
// Flow:
//   first run (no .env)  → Quick (auth+repo+base) or Full (every section)
//   re-run (.env exists) → Sync (only new/unconfigured vars) by default, with an
//                          explicit "reconfigure everything" opt-in
// then: regenerate .env cleanly → run a non-fatal sanity test → print the banner.

import { join } from "node:path";
import * as p from "@clack/prompts";

import { SECTIONS, QUICK_KEYS, findVar, type Section, type VarSpec } from "./manifest.js";
import { parseEnv, serializeEnv, writeEnv, type Collected, type Entry } from "./env.js";
import { runSanity, type CheckStatus } from "./sanity.js";
import { buildBannerInfo, renderBanner } from "./banner.js";

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
  if (parsed.exists) {
    p.log.info(`Found an existing .env at ${envPath}`);
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

  // Confirm before overwriting an existing file (a fresh, regenerated one).
  if (parsed.exists) {
    const go = await p.confirm({ message: "Write a freshly regenerated .env now? (unknown custom vars are preserved)", initialValue: true });
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

async function finish(collected: Collected, parsed: ReturnType<typeof parseEnv>, envPath: string, rewrote: boolean): Promise<void> {
  if (rewrote) {
    const contents = serializeEnv(collected, parsed.extra);
    writeEnv(envPath, contents);
    p.log.success(`Wrote ${envPath}`);
  }

  const spin = p.spinner();
  spin.start("Running sanity checks against GitHub");
  const { results, resolved } = await runSanity(valuesView(collected));
  spin.stop("Sanity checks complete");

  const lines = results.map((r) => `${icon(r.status)}  ${r.label}: ${r.detail}`);
  p.note(lines.join("\n") || "no checks run", "Sanity test (non-blocking)");

  const info = buildBannerInfo(valuesView(collected), resolved);
  p.note(renderBanner(info), "Current configuration");

  const failed = results.some((r) => r.status === "fail");
  if (failed) {
    p.log.warn("Some checks failed — okffs may not work until they're resolved. Your .env was still written.");
  }
  p.outro("Next: add okffs to your project's .mcp.json (see the README Quick start), then start Claude Code.");
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
