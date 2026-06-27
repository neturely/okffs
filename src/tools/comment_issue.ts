import { z } from "zod";
import { addIssueComment, owner, repo } from "../github.js";

export const name = "comment_issue";

export const description =
  "Post a comment to a GitHub issue. Use after committing to a working branch to log what was done.";

export const inputSchema = z.object({
  issue_number: z.number().int().positive(),
  comment: z.string().describe("Comment body to post to the issue"),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  // Note: commenting intentionally does not trigger CHANGELOG updates — it is
  // too frequent to be a meaningful changelog event. create_pull_request is the
  // single source of auto-changelog entries.
  await addIssueComment(input.issue_number, input.comment);

  return {
    content: [
      {
        type: "text" as const,
        text: `Comment posted to issue #${input.issue_number}.\nhttps://github.com/${owner}/${repo}/issues/${input.issue_number}`,
      },
    ],
  };
}
