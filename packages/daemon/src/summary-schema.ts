import { z } from "zod";

export const summarySchema = z
  .object({
    state_summary: z.string().min(1),
    open_items: z.array(z.string()),
    next_steps: z.array(z.string()),
    decisions: z.array(z.string()),
    key_files: z.array(z.string()),
    blocked: z.boolean(),
    blocked_reason: z.string().nullable(),
  })
  .strict();

export type StructuredSummary = z.infer<typeof summarySchema>;
