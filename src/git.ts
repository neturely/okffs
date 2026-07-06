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

/**
 * Push an empty init commit to `branchName` so it diverges from base and GitHub
 * will accept a (draft) PR for it. Fetches, checks the branch out, commits
 * `chore: init branch for #N`, and pushes — always restoring the caller's
 * original branch afterward (even on failure). Throws if any step through the
 * push fails, so callers can decide whether to proceed or surface an error.
 *
 * Shared by create_issue's OKFFS_AUTO_PR flow and create_pull_request's
 * allow_empty backfill (#205) so the "diverge an empty branch" behaviour lives
 * in exactly one place.
 */
export function pushEmptyInitCommit(branchName: string, issueNumber: number): void {
  const previousBranch = currentBranch();
  try {
    git(["fetch", "origin"]);
    git(["checkout", branchName]);
    git(["commit", "--allow-empty", "-m", `chore: init branch for #${issueNumber}`]);
    git(["push", "origin", branchName]);
  } finally {
    // Always restore the caller's original branch, even if a step above failed.
    if (previousBranch && previousBranch !== branchName) {
      try {
        git(["checkout", previousBranch]);
      } catch (err) {
        console.warn("[okffs] Failed to restore branch:", err instanceof Error ? err.message : err);
      }
    }
  }
}
