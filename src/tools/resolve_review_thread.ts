import { z } from "zod";
import { resolveReviewThread } from "../github.js";
import { config } from "../config.js";

export const name = "resolve_review_thread";

export const description =
  "Mark an inline PR review thread as resolved. Pass the thread_id from list_pr_review_comments. Gated by OKFFS_RESOLVE_THREADS: when that env var is not 'true', this tool declines and leaves the thread open for the user to read and resolve manually.";

export const inputSchema = z.object({
  thread_id: z
    .string()
    .describe("The review thread id to resolve (from list_pr_review_comments)"),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  if (!config.resolveThreads) {
    return {
      content: [
        {
          type: "text" as const,
          text:
            "Not resolving — OKFFS_RESOLVE_THREADS is not enabled. The thread is left open for you to read and resolve on GitHub. Set OKFFS_RESOLVE_THREADS=true to allow okffs to resolve threads automatically.",
        },
      ],
    };
  }

  await resolveReviewThread(input.thread_id);
  return {
    content: [{ type: "text" as const, text: `Resolved review thread ${input.thread_id}.` }],
  };
}
