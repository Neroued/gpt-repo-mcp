import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";
import { SymbolLocationSchema } from "./symbol.contract.js";

export const OutlineFileInputSchema = RepoInputSchema.extend({
  path: z.string().min(1),
  max_symbols: z.number().int().positive().optional()
});

export const OutlineFileResultSchema = z.object({
  path: z.string(),
  language: z.string().optional(),
  total_lines: z.number().int().nonnegative(),
  includes: z.array(z.object({
    line: z.number().int().positive(),
    value: z.string()
  })),
  namespaces: z.array(SymbolLocationSchema),
  classes: z.array(SymbolLocationSchema),
  functions: z.array(SymbolLocationSchema),
  methods: z.array(SymbolLocationSchema),
  cuda_kernels: z.array(SymbolLocationSchema),
  templates: z.array(SymbolLocationSchema),
  todos: z.array(SymbolLocationSchema),
  symbols: z.array(SymbolLocationSchema),
  truncated: z.boolean(),
  warnings: z.array(z.string()).default([])
});

export type OutlineFileInput = z.infer<typeof OutlineFileInputSchema>;
