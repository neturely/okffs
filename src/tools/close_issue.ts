import { z } from "zod";
import { closeIssue } from "../github.js";

export const name = "close_issue";

export const description = "Close a GitHub issue by issue number.";

export const inputSchema = z.object({
  issue_number: z.number().int().positive().describe("The issue number to close"),
});

export async function handler(input: z.infer<typeof inputSchema>) {
  await closeIssue(input.issue_number);

  return {
    content: [{ type: "text" as const, text: `Issue #${input.issue_number} closed.` }],
  };
}
