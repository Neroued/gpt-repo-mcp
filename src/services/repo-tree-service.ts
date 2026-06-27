import { readdir } from "node:fs/promises";
import { DEFAULT_LIMITS } from "../policies/limits.js";
import { RepoReaderError } from "../runtime/errors.js";
import { canContainIncludedPath, isExcludedByGlob, isIncludedByGlob } from "./glob-service.js";
import { IgnoreEngine } from "./ignore-engine.js";
import { PathSandbox, validateRepoPath } from "./path-sandbox.js";

export type TreeMode = "source_only" | "docs_only" | "tests_only" | "all";

export type TreeOptions = {
  path?: string;
  max_depth?: number;
  page_size?: number;
  include_files?: boolean;
  include_globs?: string[];
  exclude_globs?: string[];
  tree_mode?: TreeMode;
  respect_default_excludes?: boolean;
  include_generated?: boolean;
  include_dependencies?: boolean;
  cursor?: string;
};

export class RepoTreeService {
  private readonly ignoreEngine = new IgnoreEngine();

  constructor(private readonly root: string, private readonly sandbox: PathSandbox) {}

  async tree(options: TreeOptions) {
    const start = validateRepoPath(options.path ?? ".");
    const maxDepth = Math.min(options.max_depth ?? DEFAULT_LIMITS.max_depth, DEFAULT_LIMITS.max_depth);
    const pageSize = Math.min(options.page_size ?? DEFAULT_LIMITS.max_tree_entries, DEFAULT_LIMITS.max_tree_entries);
    const cursor = parseCursor(options.cursor);
    const includeFiles = options.include_files ?? true;
    const respectDefaultExcludes = options.respect_default_excludes ?? true;
    const modeGlobs = treeModeGlobs(options.tree_mode ?? "all");
    const includeGlobs = options.include_globs ?? [];
    const excludeGlobs = options.exclude_globs ?? [];
    const entries: Array<{ path: string; type: "file" | "directory" | "nested_repo" | "submodule"; size_bytes?: number }> = [];
    const excludedSummary: Record<string, number> = {};

    const walk = async (repoPath: string, depth: number): Promise<void> => {
      if (depth > maxDepth) {
        return;
      }

      const resolved = await this.resolveForTree(repoPath, excludedSummary);
      if (!resolved) {
        return;
      }
      const boundary = await this.sandbox.classifyBoundary(repoPath);
      if (boundary.kind !== "normal" && repoPath !== ".") {
        if (isTreePathIncluded(boundary.path, false, modeGlobs, includeGlobs, excludeGlobs, excludedSummary)) {
          entries.push({ path: boundary.path, type: boundary.kind });
        }
        return;
      }
      if (resolved.stat.isDirectory()) {
        if (repoPath !== ".") {
          if (!canTreeDescend(repoPath, modeGlobs, includeGlobs, excludeGlobs, excludedSummary)) {
            return;
          }
          if (isTreePathIncluded(repoPath, true, modeGlobs, includeGlobs, excludeGlobs, excludedSummary)) {
            entries.push({ path: repoPath, type: "directory" });
          }
        }
        const children = await readdir(resolved.absolutePath, { withFileTypes: true });
        for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
          const childRepoPath = repoPath === "." ? child.name : `${repoPath}/${child.name}`;
          if (this.ignoreEngine.isSensitiveCandidate(childRepoPath)) {
            excludedSummary.secret_candidates = (excludedSummary.secret_candidates ?? 0) + 1;
            continue;
          }
          const isDependency = isDependencyPath(childRepoPath);
          const isGenerated = isGeneratedPath(childRepoPath);
          if (isDependency && !options.include_dependencies) {
            excludedSummary.dependencies = (excludedSummary.dependencies ?? 0) + 1;
            excludedSummary.default_excludes = (excludedSummary.default_excludes ?? 0) + 1;
            continue;
          }
          if (isGenerated && !options.include_generated) {
            excludedSummary.generated = (excludedSummary.generated ?? 0) + 1;
            excludedSummary.default_excludes = (excludedSummary.default_excludes ?? 0) + 1;
            continue;
          }
          const includedByFlag = (isDependency && options.include_dependencies) || (isGenerated && options.include_generated);
          if (respectDefaultExcludes && !includedByFlag && this.ignoreEngine.isIgnored(childRepoPath)) {
            excludedSummary.default_excludes = (excludedSummary.default_excludes ?? 0) + 1;
            continue;
          }
          if (!canTreeDescend(childRepoPath, modeGlobs, includeGlobs, excludeGlobs, excludedSummary)) {
            continue;
          }
          await walk(childRepoPath, depth + 1);
        }
        return;
      }
      if (includeFiles && resolved.stat.isFile()) {
        if (isTreePathIncluded(repoPath, false, modeGlobs, includeGlobs, excludeGlobs, excludedSummary)) {
          entries.push({ path: repoPath, type: "file", size_bytes: Number(resolved.stat.size) });
        }
      }
    };

    await walk(start, 0);
    entries.sort((a, b) => a.path.localeCompare(b.path));
    const pagedEntries = entries.slice(cursor, cursor + pageSize);
    const nextIndex = cursor + pagedEntries.length;
    const truncated = nextIndex < entries.length;
    return {
      entries: pagedEntries,
      excluded_summary: excludedSummary,
      truncated,
      next_cursor: truncated ? String(nextIndex) : undefined
    };
  }

  private async resolveForTree(
    repoPath: string,
    excludedSummary: Record<string, number>
  ): Promise<Awaited<ReturnType<PathSandbox["resolve"]>> | undefined> {
    try {
      return await this.sandbox.resolve(repoPath);
    } catch (error) {
      if (error instanceof RepoReaderError) {
        excludedSummary[error.code] = (excludedSummary[error.code] ?? 0) + 1;
        return undefined;
      }
      throw error;
    }
  }
}

function parseCursor(cursor?: string): number {
  if (!cursor) {
    return 0;
  }
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isGeneratedPath(repoPath: string): boolean {
  return /(^|\/)(dist|build|out|coverage)(\/|$)/.test(repoPath);
}

function isDependencyPath(repoPath: string): boolean {
  return /(^|\/)node_modules(\/|$)/.test(repoPath);
}

function treeModeGlobs(mode: TreeMode): string[] {
  if (mode === "source_only") {
    return ["src/**", "include/**", "tools/**", "tests/**", "CMakeLists.txt", "README.md"];
  }
  if (mode === "docs_only") {
    return ["README.md", "*.md", "docs/**", "**/*.md"];
  }
  if (mode === "tests_only") {
    return ["tests/**", "test/**", "__tests__/**", "**/*.test.*", "**/*.spec.*"];
  }
  return [];
}

function canTreeDescend(
  repoPath: string,
  modeGlobs: string[],
  includeGlobs: string[],
  excludeGlobs: string[],
  excludedSummary: Record<string, number>
): boolean {
  if (isExcludedByGlob(repoPath, excludeGlobs)) {
    excludedSummary.glob_excludes = (excludedSummary.glob_excludes ?? 0) + 1;
    return false;
  }
  return canContainIncludedPath(repoPath, modeGlobs) && canContainIncludedPath(repoPath, includeGlobs);
}

function isTreePathIncluded(
  repoPath: string,
  isDirectory: boolean,
  modeGlobs: string[],
  includeGlobs: string[],
  excludeGlobs: string[],
  excludedSummary: Record<string, number>
): boolean {
  if (isExcludedByGlob(repoPath, excludeGlobs)) {
    excludedSummary.glob_excludes = (excludedSummary.glob_excludes ?? 0) + 1;
    return false;
  }
  if (isDirectory) {
    return isDirectoryIncludedByGlobs(repoPath, modeGlobs) && isDirectoryIncludedByGlobs(repoPath, includeGlobs);
  }
  return isIncludedByGlob(repoPath, modeGlobs) && isIncludedByGlob(repoPath, includeGlobs);
}

function isDirectoryIncludedByGlobs(path: string, globs: string[]): boolean {
  if (globs.length === 0) {
    return true;
  }
  const normalized = `${path}/`;
  return globs.some((glob) => {
    if (isIncludedByGlob(path, [glob])) {
      return true;
    }
    const staticPrefix = glob.split("*", 1)[0];
    if (staticPrefix.length === 0) {
      return false;
    }
    return staticPrefix.startsWith(normalized) || normalized.startsWith(staticPrefix);
  });
}
