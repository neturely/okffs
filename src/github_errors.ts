// Pure helpers for interpreting GitHub API errors. Kept dependency-free (no
// import of github.ts, which resolves token/repo at import time) so they can be
// unit-tested without a configured environment (#271).

/**
 * Turn a thrown request() error ("GitHub API error 422: {json body}") into a
 * concise, human message — "<status> <github message> (<detail>; …)" — by
 * extracting GitHub's `message` field from the JSON body instead of dumping the
 * whole raw response. For a 422 the top-level message is often just
 * "Validation Failed" with the actual reason in the `errors[]` array, so each
 * entry's `message` (or its `resource`/`field`/`code` triple when there's no
 * message) is appended in parentheses (#247, #271). Falls back to the raw
 * string when it doesn't match the known shape.
 */
export function summarizeGitHubError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.match(/^GitHub (?:API|GraphQL) error (\d+): ([\s\S]*)$/);
  if (!m) return raw;
  const [, status, body] = m;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.message === "string" && parsed.message.trim()) {
      const details = Array.isArray(parsed.errors)
        ? parsed.errors
            .map((e: unknown) => {
              if (typeof e === "string") return e.trim();
              if (e && typeof e === "object") {
                const entry = e as { message?: unknown; resource?: unknown; field?: unknown; code?: unknown };
                if (typeof entry.message === "string" && entry.message.trim()) return entry.message.trim();
                const triple = [entry.resource, entry.field, entry.code].filter(
                  (v): v is string => typeof v === "string" && v !== ""
                );
                if (triple.length) return triple.join(".");
              }
              return "";
            })
            .filter(Boolean)
        : [];
      const suffix = details.length ? ` (${details.join("; ")})` : "";
      return `${status} ${parsed.message.trim()}${suffix}`;
    }
  } catch {
    /* body isn't JSON — fall through to the trimmed raw form */
  }
  return `${status} ${body}`.trim();
}

/**
 * Is this thrown-error message the push→POST indexing race behind #247 — a PR
 * POST rejected 422 because GitHub hasn't finished indexing a commit pushed
 * moments earlier? Two known presentations:
 *  - "No commits between <base> and <head>" (the classic body), and
 *  - a bare "Validation Failed" whose errors[] marks the `head` field invalid
 *    (the just-pushed branch/sha isn't visible to the API yet) (#271).
 * Other 422s (e.g. "A pull request already exists") are permanent and must NOT
 * be retried, so this deliberately stays narrow rather than matching all 422s.
 */
export function isPrCreateRaceError(msg: string): boolean {
  if (!/error 422/.test(msg)) return false;
  if (/no commits between/i.test(msg)) return true;
  return /"field":\s*"head"/.test(msg) && /"code":\s*"invalid"/.test(msg);
}

/**
 * Describe a thrown fetch() error. Node's fetch (undici) throws a generic
 * TypeError "fetch failed" and hides the real reason on `err.cause` — e.g.
 * ECONNRESET, UND_ERR_SOCKET "other side closed", UND_ERR_CONNECT_TIMEOUT — so
 * the cause is appended: "fetch failed (UND_ERR_SOCKET: other side closed)".
 * An AbortSignal.timeout abort is named as a timeout (#345).
 */
export function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.name === "TimeoutError") return `timed out (${err.message})`;
  const cause = (err as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return err.message;
  const { code, message } = cause as { code?: unknown; message?: unknown };
  const codeStr = typeof code === "string" && code ? code : "";
  const msgStr = typeof message === "string" ? message.trim() : "";
  let detail = msgStr;
  if (codeStr && !msgStr.includes(codeStr)) detail = msgStr ? `${codeStr}: ${msgStr}` : codeStr;
  return detail ? `${err.message} (${detail})` : err.message;
}

/**
 * Is this thrown-error message a network-level failure — the request never got
 * an HTTP response ("GitHub request to <url> failed: …", from timedFetch) —
 * rather than a GitHub 4xx/5xx ("GitHub API error <status>: …")? Only these
 * are candidates for the PR-create network retry (#345).
 */
export function isNetworkRequestError(msg: string): boolean {
  return /^GitHub request to \S+ failed:/.test(msg);
}
