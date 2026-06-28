import { z } from "zod";
import { getPullRequestReview } from "../github.js";

export const name = "list_pr_review_comments";

export const description =
  "Fetch review feedback for a pull request: inline review comment threads (each with comment ids, file/line, author, body, and resolved/unresolved state) plus overall review summaries. Use this to read PR review comments before addressing them. Typical workflow: read with this tool, fix the code for the valid comments, commit/push with commit_and_update, reply to each addressed thread with reply_to_review_comment, post an overall summary with comment_issue (PRs accept issue comments), and — only if OKFFS_RESOLVE_THREADS is enabled — mark threads resolved with resolve_review_thread.";

export const inputSchema = z.object({
  pr_number: z.number().int().positive().describe("The pull request number"),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  const { threads, reviews } = await getPullRequestReview(input.pr_number);

  const unresolved = threads.filter((t) => !t.isResolved);
  const resolved = threads.filter((t) => t.isResolved);

  const parts: string[] = [
    `PR #${input.pr_number}: ${threads.length} review thread(s) (${unresolved.length} unresolved), ${reviews.length} review summary(ies).`,
  ];

  const renderThread = (t: (typeof threads)[number]) => {
    const lines: string[] = [
      `[${t.isResolved ? "resolved" : "UNRESOLVED"}] thread_id: ${t.id}`,
    ];
    t.comments.forEach((c, i) => {
      const loc = c.path ? `${c.path}${c.line ? `:${c.line}` : ""}` : "(general)";
      const label = i === 0 ? "comment" : "reply";
      lines.push(`  • ${label} id:${c.id}  ${loc}  by ${c.author}`);
      lines.push(`    ${c.body.replace(/\n/g, "\n    ")}`);
    });
    return lines.join("\n");
  };

  if (unresolved.length > 0) {
    parts.push(`\n## Unresolved threads\n${unresolved.map(renderThread).join("\n\n")}`);
  }
  if (resolved.length > 0) {
    parts.push(`\n## Resolved threads\n${resolved.map(renderThread).join("\n\n")}`);
  }
  if (reviews.length > 0) {
    parts.push(
      `\n## Review summaries\n${reviews
        .map((r) => `[${r.author}] ${r.state}\n${r.body}`)
        .join("\n\n---\n\n")}`
    );
  }
  if (threads.length === 0 && reviews.length === 0) {
    parts.push("\nNo review comments or summaries found.");
  }

  return { content: [{ type: "text" as const, text: parts.join("\n") }] };
}
