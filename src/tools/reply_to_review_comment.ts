import { z } from "zod";
import { replyToReviewComment, getPullRequestReview, resolveReviewThread } from "../github.js";
import { config } from "../config.js";

export const name = "reply_to_review_comment";

export const description =
  "Reply to an inline PR review comment thread. Pass the pull request number, the comment id (from list_pr_review_comments), and the reply body. Use after addressing a review comment to record what was changed (e.g. reference the fix commit). " +
  "IMPORTANT: a reply does NOT resolve the thread — the thread stays open until you resolve it. The full loop is list_pr_review_comments → reply_to_review_comment → resolve_review_thread; even when OKFFS_RESOLVE_THREADS=true, resolving is a separate, explicit act (this tool leaves the thread open unless you ask it to resolve). To reply and resolve an addressed thread in one call, pass resolve: true (still gated by OKFFS_RESOLVE_THREADS). Prefer this tool over raw `gh api .../replies`, which skips the resolve path and silently leaves threads unresolved despite OKFFS_RESOLVE_THREADS=true.";

export const inputSchema = z.object({
  pr_number: z.number().int().positive().describe("The pull request number"),
  comment_id: z
    .number()
    .int()
    .positive()
    .describe("The review comment id to reply to (from list_pr_review_comments)"),
  body: z.string().describe("Reply body"),
  resolve: z
    .boolean()
    .optional()
    .describe(
      "When true, also resolve this comment's thread after replying (reply + resolve in one call). Honours the OKFFS_RESOLVE_THREADS gate: when that env var isn't 'true', the reply is still posted but the thread is left open and the response says so. Use ONLY when the reply signals the thread is addressed — not when the reply asks a question or pushes back, which should stay open."
    ),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  const reply = await replyToReviewComment(input.pr_number, input.comment_id, input.body);
  const lines = [
    `Replied to comment #${input.comment_id} on PR #${input.pr_number}: ${reply.html_url}`,
  ];

  if (input.resolve) {
    if (!config.resolveThreads) {
      lines.push(
        "Not resolving the thread — OKFFS_RESOLVE_THREADS is not enabled, so the reply is posted but the thread is left open for you to resolve on GitHub. Set OKFFS_RESOLVE_THREADS=true to allow reply+resolve in one call."
      );
    } else {
      try {
        // The reply endpoint works off a comment id; resolving needs the thread
        // node id, so map comment → thread via the PR's review threads.
        const { threads } = await getPullRequestReview(input.pr_number);
        const thread = threads.find((t) => t.comments.some((c) => c.id === input.comment_id));
        if (!thread) {
          lines.push(
            `Could not find the thread for comment #${input.comment_id} to resolve — the reply was posted; resolve it manually if needed.`
          );
        } else if (thread.isResolved) {
          lines.push(`Thread ${thread.id} was already resolved.`);
        } else {
          await resolveReviewThread(thread.id);
          lines.push(`Resolved thread ${thread.id}.`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lines.push(`Reply posted, but resolving the thread failed: ${msg}`);
      }
    }
  }

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}
