import { createHash } from "node:crypto";
import { DEFAULT_LIMITS } from "../policies/limits.js";
import { RepoReaderError } from "../runtime/errors.js";
import { FileClassifier } from "./file-classifier.js";
import { IgnoreEngine, isPublicEnvTemplatePath } from "./ignore-engine.js";
import { PathSandbox } from "./path-sandbox.js";
import { SecretScanner } from "./secret-scanner.js";
import { readFilePrefix } from "./bounded-read.js";

export type FetchFileOptions = {
  path: string;
  start_line?: number;
  end_line?: number;
  max_lines?: number;
  max_bytes?: number;
  override_default_excludes?: boolean;
};

export class FileReader {
  private readonly ignoreEngine = new IgnoreEngine();
  private readonly classifier = new FileClassifier(this.ignoreEngine);
  private readonly secretScanner = new SecretScanner();

  constructor(private readonly sandbox: PathSandbox) {}

  async read(options: FetchFileOptions) {
    const resolved = await this.sandbox.resolve(options.path);
    if (!resolved.stat.isFile()) {
      throw new RepoReaderError("UNSUPPORTED_FILE_TYPE", `Not a regular file: ${resolved.repoPath}`);
    }

    const warnings: string[] = [];
    if (this.ignoreEngine.isIgnored(resolved.repoPath) && !options.override_default_excludes) {
      throw new RepoReaderError("DEFAULT_EXCLUDE_BLOCKED", `Path is excluded by default: ${resolved.repoPath}`);
    }
    if (this.ignoreEngine.isIgnored(resolved.repoPath) && options.override_default_excludes) {
      warnings.push(`Read default-excluded path with override: ${resolved.repoPath}`);
    }
    if (this.ignoreEngine.isSensitiveCandidate(resolved.repoPath)) {
      throw new RepoReaderError("SECRET_CANDIDATE_BLOCKED", `Secret candidate blocked: ${resolved.repoPath}`);
    }

    const maxBytes = Math.min(options.max_bytes ?? DEFAULT_LIMITS.max_bytes_per_file, DEFAULT_LIMITS.max_bytes_per_file);
    const { buffer: content, truncated } = await readFilePrefix(resolved.absolutePath, maxBytes);
    if (truncated) {
      throw new RepoReaderError("SIZE_LIMIT_EXCEEDED", `File exceeds max_bytes: ${resolved.repoPath}`);
    }
    const classification = await this.classifier.classify(resolved.repoPath, resolved.absolutePath);
    if (classification.is_binary) {
      throw new RepoReaderError("BINARY_FILE_REJECTED", `Binary file blocked: ${resolved.repoPath}`);
    }

    const rawText = content.toString("utf8");
    if (isPublicEnvTemplatePath(resolved.repoPath) && this.secretScanner.hasSecretValue(rawText)) {
      throw new RepoReaderError("SECRET_CANDIDATE_BLOCKED", `Secret candidate blocked: ${resolved.repoPath}`);
    }
    const redacted = this.secretScanner.redact(rawText);
    const lines = redacted.text.split(/\r?\n/);
    const startLine = options.start_line ?? 1;
    if (options.end_line !== undefined && options.end_line < startLine) {
      throw new RepoReaderError("VALIDATION_ERROR", "end_line must be greater than or equal to start_line.");
    }
    const requestedMaxLines = options.max_lines ?? DEFAULT_LIMITS.default_fetch_lines;
    const maxLinesApplied = Math.min(requestedMaxLines, DEFAULT_LIMITS.max_fetch_lines);
    if (requestedMaxLines > DEFAULT_LIMITS.max_fetch_lines) {
      warnings.push(`MAX_LINES_CAPPED:${DEFAULT_LIMITS.max_fetch_lines}`);
    }
    const maxEndLine = startLine + maxLinesApplied - 1;
    const requestedEndLine = options.end_line ?? maxEndLine;
    const endLine = Math.min(requestedEndLine, maxEndLine);
    const selected = lines.slice(startLine - 1, endLine).join("\n");
    const boundedEndLine = Math.min(endLine, lines.length);
    const hasMore = boundedEndLine < lines.length;

    return {
      path: resolved.repoPath,
      language: classification.language,
      size_bytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
      total_lines: lines.length,
      start_line: startLine,
      end_line: boundedEndLine,
      truncated: hasMore,
      has_more: hasMore,
      next_start_line: hasMore ? boundedEndLine + 1 : undefined,
      max_lines_applied: maxLinesApplied,
      text: selected,
      redactions: redacted.redactions,
      warnings
    };
  }
}
