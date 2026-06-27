import { z } from "zod";
import { RepoInputSchema } from "./repo.contract.js";

export const LanguageStatSchema = z.object({
  language: z.string(),
  files: z.number().int().nonnegative(),
  loc: z.number().int().nonnegative()
});

export const IndexedFileSchema = z.object({
  path: z.string(),
  language: z.string().optional(),
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string().optional(),
  mtime_ms: z.number().nonnegative(),
  loc: z.number().int().nonnegative(),
  is_source: z.boolean(),
  is_test: z.boolean(),
  is_doc: z.boolean()
});

export const CMakeTargetSchema = z.object({
  name: z.string(),
  kind: z.string(),
  path: z.string(),
  line: z.number().int().positive()
});

export const IndexSummaryInputSchema = RepoInputSchema.extend({
  force_refresh: z.boolean().optional()
});

export const IndexSummaryResultSchema = z.object({
  index_id: z.string(),
  cache_hit: z.boolean(),
  indexed_at: z.string(),
  file_count: z.number().int().nonnegative(),
  source_files_count: z.number().int().nonnegative(),
  test_files_count: z.number().int().nonnegative(),
  doc_files_count: z.number().int().nonnegative(),
  kernel_files_count: z.number().int().nonnegative(),
  language_stats: z.array(LanguageStatSchema),
  largest_files: z.array(IndexedFileSchema),
  recently_modified_files: z.array(IndexedFileSchema),
  cmake_targets: z.array(CMakeTargetSchema),
  warnings: z.array(z.string()).default([])
});

export type LanguageStat = z.infer<typeof LanguageStatSchema>;
export type IndexedFile = z.infer<typeof IndexedFileSchema>;
export type CMakeTarget = z.infer<typeof CMakeTargetSchema>;
