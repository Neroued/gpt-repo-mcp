import type { z } from "zod";
import { ChangePlanInputSchema, ChangePlanResultSchema } from "../contracts/change-plan.contract.js";
import { CleanupPathsInputSchema, CleanupPathsResultSchema } from "../contracts/cleanup.contract.js";
import { CodexReviewInputSchema, CodexReviewResultSchema, CodexTaskInputSchema, CodexTaskResultSchema, CodexTaskWriteInputSchema, CodexTaskWriteResultSchema } from "../contracts/codex-task.contract.js";
import { DecisionLogInputSchema, DecisionLogResultSchema } from "../contracts/decision.contract.js";
import { FetchFileInputSchema, FetchRegionInputSchema, FetchRegionResultSchema, FileContentSchema, ReadManyInputSchema, ReadManyResultSchema } from "../contracts/file.contract.js";
import { GitCommitInputSchema, GitCommitResultSchema, GitRecoverInputSchema, GitRecoverResultSchema, GitRestorePathsInputSchema, GitRestorePathsResultSchema, GitStageCommitInputSchema, GitStageCommitResultSchema, GitStageInputSchema, GitStageResultSchema, GitUnstageInputSchema, GitUnstageResultSchema } from "../contracts/git-operations.contract.js";
import { ChangedSinceInputSchema, ChangedSinceResultSchema, GitDiffInputSchema, GitDiffResultSchema, GitStatusInputSchema, GitStatusResultSchema } from "../contracts/git.contract.js";
import { GitReviewInputSchema, GitReviewResultSchema } from "../contracts/git-review.contract.js";
import { HandoffInputSchema, HandoffResultSchema } from "../contracts/handoff.contract.js";
import { IndexSummaryInputSchema, IndexSummaryResultSchema } from "../contracts/index.contract.js";
import { NextActionInputSchema, NextActionResultSchema } from "../contracts/next-action.contract.js";
import { LastWriteInputSchema, LastWriteResultSchema } from "../contracts/operation-receipt.contract.js";
import { OutlineFileInputSchema, OutlineFileResultSchema } from "../contracts/outline.contract.js";
import { PolicyExplainInputSchema, PolicyExplainResultSchema } from "../contracts/policy.contract.js";
import { ProjectBriefInputSchema, ProjectBriefResultSchema } from "../contracts/project.contract.js";
import { RepoInputSchema, RepoListResultSchema, RepoTreeInputSchema } from "../contracts/repo.contract.js";
import { PlanReviewInputSchema, PlanReviewResultSchema } from "../contracts/review.contract.js";
import { SearchInputSchema, SearchResponseSchema, SearchSymbolInputSchema, SearchSymbolResponseSchema } from "../contracts/search.contract.js";
import { RepoSymbolsInputSchema, RepoSymbolsResultSchema } from "../contracts/symbol.contract.js";
import { TaskInventoryInputSchema, TaskInventoryResultSchema } from "../contracts/task.contract.js";
import { RepoTreeResultSchema } from "../contracts/tree.contract.js";
import { WriteChangesInputSchema, WriteChangesResultSchema, WriteFileInputSchema, WriteFileResultSchema } from "../contracts/write.contract.js";

export type ToolName =
  | "repo_list_roots"
  | "repo_policy_explain"
  | "repo_last_write"
  | "repo_tree"
  | "repo_index_summary"
  | "repo_symbols"
  | "repo_search"
  | "repo_search_symbol"
  | "repo_outline_file"
  | "repo_fetch_file"
  | "repo_fetch_region"
  | "repo_read_many"
  | "repo_git_status"
  | "repo_changed_since"
  | "repo_git_diff"
  | "repo_git_review"
  | "repo_git_stage"
  | "repo_git_unstage"
  | "repo_git_restore_paths"
  | "repo_git_commit"
  | "repo_write_stage"
  | "repo_write_unstage"
  | "repo_write_commit"
  | "repo_write_stage_commit"
  | "repo_write_recover"
  | "repo_cleanup_paths"
  | "repo_project_brief"
  | "repo_task_inventory"
  | "repo_decision_memory"
  | "repo_change_plan"
  | "repo_next_action"
  | "repo_plan_review"
  | "repo_prepare_codex_task"
  | "repo_write_codex_task"
  | "repo_codex_review"
  | "repo_write_file"
  | "repo_write_changes"
  | "repo_write_handoff";

export type ToolContract = {
  input: z.ZodObject<z.ZodRawShape>;
  output: z.ZodObject<z.ZodRawShape>;
};

export const toolContracts = {
  repo_list_roots: {
    input: RepoInputSchema.omit({ repo_id: true }),
    output: RepoListResultSchema
  },
  repo_policy_explain: {
    input: PolicyExplainInputSchema,
    output: PolicyExplainResultSchema
  },
  repo_last_write: {
    input: LastWriteInputSchema,
    output: LastWriteResultSchema
  },
  repo_tree: {
    input: RepoTreeInputSchema,
    output: RepoTreeResultSchema
  },
  repo_index_summary: {
    input: IndexSummaryInputSchema,
    output: IndexSummaryResultSchema
  },
  repo_symbols: {
    input: RepoSymbolsInputSchema,
    output: RepoSymbolsResultSchema
  },
  repo_search: {
    input: SearchInputSchema,
    output: SearchResponseSchema
  },
  repo_search_symbol: {
    input: SearchSymbolInputSchema,
    output: SearchSymbolResponseSchema
  },
  repo_outline_file: {
    input: OutlineFileInputSchema,
    output: OutlineFileResultSchema
  },
  repo_fetch_file: {
    input: FetchFileInputSchema,
    output: FileContentSchema
  },
  repo_fetch_region: {
    input: FetchRegionInputSchema,
    output: FetchRegionResultSchema
  },
  repo_read_many: {
    input: ReadManyInputSchema,
    output: ReadManyResultSchema
  },
  repo_git_status: {
    input: GitStatusInputSchema,
    output: GitStatusResultSchema
  },
  repo_changed_since: {
    input: ChangedSinceInputSchema,
    output: ChangedSinceResultSchema
  },
  repo_git_diff: {
    input: GitDiffInputSchema,
    output: GitDiffResultSchema
  },
  repo_git_review: {
    input: GitReviewInputSchema,
    output: GitReviewResultSchema
  },
  repo_git_stage: {
    input: GitStageInputSchema,
    output: GitStageResultSchema
  },
  repo_git_unstage: {
    input: GitUnstageInputSchema,
    output: GitUnstageResultSchema
  },
  repo_git_restore_paths: {
    input: GitRestorePathsInputSchema,
    output: GitRestorePathsResultSchema
  },
  repo_git_commit: {
    input: GitCommitInputSchema,
    output: GitCommitResultSchema
  },
  repo_write_stage: {
    input: GitStageInputSchema,
    output: GitStageResultSchema
  },
  repo_write_unstage: {
    input: GitUnstageInputSchema,
    output: GitUnstageResultSchema
  },
  repo_write_commit: {
    input: GitCommitInputSchema,
    output: GitCommitResultSchema
  },
  repo_write_stage_commit: {
    input: GitStageCommitInputSchema,
    output: GitStageCommitResultSchema
  },
  repo_write_recover: {
    input: GitRecoverInputSchema,
    output: GitRecoverResultSchema
  },
  repo_cleanup_paths: {
    input: CleanupPathsInputSchema,
    output: CleanupPathsResultSchema
  },
  repo_project_brief: {
    input: ProjectBriefInputSchema,
    output: ProjectBriefResultSchema
  },
  repo_task_inventory: {
    input: TaskInventoryInputSchema,
    output: TaskInventoryResultSchema
  },
  repo_decision_memory: {
    input: DecisionLogInputSchema,
    output: DecisionLogResultSchema
  },
  repo_change_plan: {
    input: ChangePlanInputSchema,
    output: ChangePlanResultSchema
  },
  repo_next_action: {
    input: NextActionInputSchema,
    output: NextActionResultSchema
  },
  repo_plan_review: {
    input: PlanReviewInputSchema,
    output: PlanReviewResultSchema
  },
  repo_prepare_codex_task: {
    input: CodexTaskInputSchema,
    output: CodexTaskResultSchema
  },
  repo_write_codex_task: {
    input: CodexTaskWriteInputSchema,
    output: CodexTaskWriteResultSchema
  },
  repo_codex_review: {
    input: CodexReviewInputSchema,
    output: CodexReviewResultSchema
  },
  repo_write_file: {
    input: WriteFileInputSchema,
    output: WriteFileResultSchema
  },
  repo_write_changes: {
    input: WriteChangesInputSchema,
    output: WriteChangesResultSchema
  },
  repo_write_handoff: {
    input: HandoffInputSchema,
    output: HandoffResultSchema
  }
} as const satisfies Record<ToolName, ToolContract>;
