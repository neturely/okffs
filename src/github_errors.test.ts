import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeGitHubError, isPrCreateRaceError, describeFetchError, isNetworkRequestError } from "./github_errors.js";

const apiError = (status: number, body: unknown) =>
  new Error(`GitHub API error ${status}: ${JSON.stringify(body)}`);

test("summarizeGitHubError extracts the top-level message", () => {
  assert.equal(summarizeGitHubError(apiError(404, { message: "Not Found" })), "404 Not Found");
});

test("summarizeGitHubError appends 422 errors[] entry messages", () => {
  const err = apiError(422, {
    message: "Validation Failed",
    errors: [{ resource: "PullRequest", code: "custom", message: "A pull request already exists for a:b." }],
  });
  assert.equal(
    summarizeGitHubError(err),
    "422 Validation Failed (A pull request already exists for a:b.)"
  );
});

test("summarizeGitHubError renders resource.field.code when an entry has no message", () => {
  const err = apiError(422, {
    message: "Validation Failed",
    errors: [{ resource: "PullRequest", field: "head", code: "invalid" }],
  });
  assert.equal(summarizeGitHubError(err), "422 Validation Failed (PullRequest.head.invalid)");
});

test("summarizeGitHubError joins multiple errors[] entries and accepts string entries", () => {
  const err = apiError(422, {
    message: "Validation Failed",
    errors: ["first problem", { message: "second problem" }],
  });
  assert.equal(summarizeGitHubError(err), "422 Validation Failed (first problem; second problem)");
});

test("summarizeGitHubError ignores an empty or malformed errors[]", () => {
  assert.equal(
    summarizeGitHubError(apiError(422, { message: "Validation Failed", errors: [] })),
    "422 Validation Failed"
  );
  assert.equal(
    summarizeGitHubError(apiError(422, { message: "Validation Failed", errors: [{}, null, ""] })),
    "422 Validation Failed"
  );
});

test("summarizeGitHubError falls back to the raw string for unknown shapes", () => {
  assert.equal(summarizeGitHubError(new Error("boom")), "boom");
  assert.equal(summarizeGitHubError("plain string"), "plain string");
  assert.equal(summarizeGitHubError(new Error("GitHub API error 500: not json")), "500 not json");
});

test("isPrCreateRaceError matches the classic 'no commits between' 422", () => {
  assert.equal(
    isPrCreateRaceError('GitHub API error 422: {"message":"No commits between develop and 1-x"}'),
    true
  );
});

test("isPrCreateRaceError matches a Validation Failed 422 with an invalid head field", () => {
  const msg =
    'GitHub API error 422: {"message":"Validation Failed","errors":[{"resource":"PullRequest","field":"head","code":"invalid"}]}';
  assert.equal(isPrCreateRaceError(msg), true);
});

test("isPrCreateRaceError does NOT match permanent 422s or other statuses", () => {
  const exists =
    'GitHub API error 422: {"message":"Validation Failed","errors":[{"resource":"PullRequest","code":"custom","message":"A pull request already exists."}]}';
  assert.equal(isPrCreateRaceError(exists), false);
  assert.equal(isPrCreateRaceError("GitHub API error 404: not found"), false);
  assert.equal(
    isPrCreateRaceError('GitHub API error 403: {"message":"no commits between? nope"}'),
    false
  );
});

const fetchFailed = (cause?: unknown) => Object.assign(new TypeError("fetch failed"), { cause });

test("describeFetchError appends the undici cause code and message", () => {
  const cause = Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" });
  assert.equal(describeFetchError(fetchFailed(cause)), "fetch failed (UND_ERR_SOCKET: other side closed)");
});

test("describeFetchError does not repeat a code already in the cause message", () => {
  const cause = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
  assert.equal(describeFetchError(fetchFailed(cause)), "fetch failed (read ECONNRESET)");
});

test("describeFetchError handles a code-only cause and a missing cause", () => {
  assert.equal(describeFetchError(fetchFailed({ code: "ETIMEDOUT" })), "fetch failed (ETIMEDOUT)");
  assert.equal(describeFetchError(fetchFailed()), "fetch failed");
  assert.equal(describeFetchError("boom"), "boom");
});

test("describeFetchError names an AbortSignal timeout", () => {
  const err = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  assert.equal(describeFetchError(err), "timed out (The operation was aborted due to timeout)");
});

test("isNetworkRequestError matches timedFetch failures, not HTTP errors", () => {
  assert.equal(isNetworkRequestError("GitHub request to https://api.github.com/x failed: fetch failed"), true);
  assert.equal(isNetworkRequestError("GitHub API error 502: Bad Gateway"), false);
  assert.equal(isNetworkRequestError("GitHub API error 422: {\"message\":\"x failed: y\"}"), false);
});
