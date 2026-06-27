import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";

export const SymbolKindSchema = z.enum(["namespace", "class", "function", "method", "kernel", "template", "constant", "todo"]);

export const SymbolLocationSchema = z.object({
  path: z.string(),
  name: z.string(),
  kind: SymbolKindSchema,
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  signature: z.string().optional(),
  container: z.string().optional()
});

export const RepoSymbolsInputSchema = RepoInputSchema.extend({
  name: z.string().optional(),
  kind: z.enum(["function", "class", "method", "kernel", "any"]).optional(),
  include_globs: z.array(z.string()).optional(),
  exclude_globs: z.array(z.string()).optional(),
  max_results: z.number().int().positive().optional(),
  cursor: z.string().optional(),
  force_refresh: z.boolean().optional()
});

export const RepoSymbolsResultSchema = z.object({
  index_id: z.string(),
  symbols: z.array(SymbolLocationSchema),
  matched_count: z.number().int().nonnegative(),
  returned_count: z.number().int().nonnegative(),
  truncated: z.boolean(),
  next_cursor: z.string().optional(),
  warnings: z.array(z.string()).default([])
});

export type SymbolKind = z.infer<typeof SymbolKindSchema>;
export type SymbolLocation = z.infer<typeof SymbolLocationSchema>;
