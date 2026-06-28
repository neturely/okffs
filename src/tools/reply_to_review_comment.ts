import { z } from "zod";
import { replyToReviewComment } from "../github.js";

export const name = "reply_to_review_comment";

export const description =
  "Reply to an inline PR review comment thread. Pass the pull request number, the comment id (from list_pr_review_comments), and the reply body. Use after addressing a review comment to record what was changed (e.g. reference the fix commit).";

export const inputSchema = z.object({
  pr_number: z.number().int().positive().describe("The pull request number"),
  comment_id: z
    .number()
    .int()
    .positive()
    .describe("The review comment id to reply to (from list_pr_review_comments)"),
  body: z.string().describe("Reply body"),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  const reply = await replyToReviewComment(input.pr_number, input.comment_id, input.body);
  return {
    content: [
      {
        type: "text" as const,
        text: `Replied to comment #${input.comment_id} on PR #${input.pr_number}: ${reply.html_url}`,
      },
    ],
  };
}
