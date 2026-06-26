import { execFileSync } from "node:child_process";

// All git calls pass arguments as an array via execFileSync, so no shell is
// involved — values like branch names or commit messages (which can originate
// from issue body text or user input) can never be interpreted as commands.

/** Run a git command with arguments passed as an array. Throws on failure. */
export function git(args: string[]): void {
  execFileSync("git", args, { stdio: "ignore" });
}

/** Run a git command and return its trimmed stdout. Throws on failure. */
export function gitOutput(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** Current branch name, or null if it can't be determined. */
export function currentBranch(): string | null {
  try {
    return gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch {
    return null;
  }
}
