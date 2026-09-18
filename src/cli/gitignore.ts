// .gitignore coverage for .env files (#313). Pure over the file's text so it is
// unit-testable; the wizard/configure tool read+write the file around it.
//
// A site's .env (finance/.env) holds the same class of secrets as the root
// one, so the ignore rule must be DEPTH-AGNOSTIC: a bare `.env` (or `**/.env`,
// `*.env`) matches at any depth; an anchored `/.env` only covers the root.

const COVERING = new Set([".env", "**/.env", "*.env", "**/*.env", ".env*", "**/.env*"]);

/** Whether `content` already ignores .env files at every depth. */
export function gitignoreCoversEnv(content: string): boolean {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"))
    .some((l) => COVERING.has(l));
}

/** Whether `content` ignores only the ROOT .env (an anchored rule) — worth calling out. */
export function gitignoreAnchoredEnvOnly(content: string): boolean {
  if (gitignoreCoversEnv(content)) return false;
  return content.split("\n").some((l) => l.trim() === "/.env");
}

/** Append a depth-agnostic `.env` rule (idempotent). */
export function appendEnvIgnore(content: string): string {
  if (gitignoreCoversEnv(content)) return content;
  const base = content.length === 0 ? "" : content.replace(/\s+$/, "") + "\n\n";
  return `${base}# okffs: .env files hold tokens — ignored at every depth (root and app directories)\n.env\n`;
}
