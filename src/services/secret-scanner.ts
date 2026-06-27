import { SECRET_VALUE_PATTERN } from "../policies/secret-patterns.js";

export type Redaction = {
  line: number;
  start_column: number;
  end_column: number;
  kind: string;
  confidence: "high";
  reason: string;
};

export type RedactionResult = {
  text: string;
  redactions: Redaction[];
};

type SecretSpan = {
  start: number;
  end: number;
  kind: string;
  reason: string;
};

const PEM_PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const SECRET_ASSIGNMENT_PATTERN = /\b([A-Za-z0-9_]*(?:API_KEY|ACCESS_KEY|AUTH_TOKEN|TOKEN|SECRET|PASSWORD|PRIVATE_KEY)[A-Za-z0-9_]*)[ \t]*=[ \t]*("[^"\r\n]*"|'[^'\r\n]*'|[^\s;#]+)/gi;
const STANDALONE_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{8,}\b/g;

export class SecretScanner {
  hasSecretValue(text: string): boolean {
    return findSecretSpans(text).length > 0;
  }

  redact(text: string): RedactionResult {
    const spans = findSecretSpans(text);
    if (spans.length === 0) {
      return { text, redactions: [] };
    }

    let cursor = 0;
    let redacted = "";
    for (const span of spans) {
      redacted += text.slice(cursor, span.start);
      redacted += "[REDACTED_SECRET]";
      cursor = span.end;
    }
    redacted += text.slice(cursor);

    return {
      text: redacted,
      redactions: spans.map((span) => toRedaction(text, span))
    };
  }

  redactText(text: string): string {
    return this.redact(text).text;
  }
}

function findSecretSpans(text: string): SecretSpan[] {
  const spans: SecretSpan[] = [];
  collectRegexSpans(text, PEM_PRIVATE_KEY_PATTERN, spans, "pem_private_key", "PEM private key block");
  collectRegexSpans(text, STANDALONE_KEY_PATTERN, spans, "openai_api_key", "OpenAI-style API key");
  collectAssignmentSpans(text, spans);

  SECRET_VALUE_PATTERN.lastIndex = 0;
  let legacyMatch: RegExpExecArray | null;
  while ((legacyMatch = SECRET_VALUE_PATTERN.exec(text)) !== null) {
    const match = legacyMatch[0];
    if (isPlaceholderSecret(match)) {
      continue;
    }
    if (match.startsWith("sk-")) {
      spans.push({
        start: legacyMatch.index,
        end: legacyMatch.index + match.length,
        kind: "openai_api_key",
        reason: "OpenAI-style API key"
      });
    }
  }

  return mergeSpans(spans);
}

function collectRegexSpans(text: string, pattern: RegExp, spans: SecretSpan[], kind: string, reason: string): void {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (isPlaceholderSecret(match[0])) {
      continue;
    }
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      kind,
      reason
    });
  }
}

function collectAssignmentSpans(text: string, spans: SecretSpan[]): void {
  SECRET_ASSIGNMENT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SECRET_ASSIGNMENT_PATTERN.exec(text)) !== null) {
    const value = match[2];
    if (!isHighConfidenceSecretValue(value)) {
      continue;
    }
    const valueOffset = match[0].lastIndexOf(value);
    const start = match.index + valueOffset;
    spans.push({
      start,
      end: start + value.length,
      kind: "secret_assignment",
      reason: `High-confidence secret value assigned to ${match[1]}`
    });
  }
}

function isHighConfidenceSecretValue(value: string): boolean {
  const unquoted = value.replace(/^["']|["']$/g, "");
  if (isPlaceholderSecret(unquoted)) {
    return false;
  }
  const normalized = unquoted.toLowerCase();
  if (
    normalized.includes("placeholder") ||
    normalized.includes("example") ||
    normalized.includes("public") ||
    normalized.includes("dummy") ||
    normalized.includes("test")
  ) {
    return false;
  }
  if (/^sk-[a-z0-9_-]{8,}$/i.test(unquoted)) {
    return true;
  }
  if (unquoted.length < 12) {
    return false;
  }
  return /[A-Za-z]/.test(unquoted) && /[-_0-9]/.test(unquoted);
}

function mergeSpans(spans: SecretSpan[]): SecretSpan[] {
  const sorted = spans
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: SecretSpan[] = [];
  for (const span of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && span.start < previous.end) {
      if (span.end > previous.end) {
        previous.end = span.end;
      }
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}

function toRedaction(text: string, span: SecretSpan): Redaction {
  const prefix = text.slice(0, span.start);
  const line = prefix.split(/\r?\n/).length;
  const lastNewline = Math.max(prefix.lastIndexOf("\n"), prefix.lastIndexOf("\r"));
  const startColumn = span.start - lastNewline;
  return {
    line,
    start_column: startColumn,
    end_column: startColumn + span.end - span.start,
    kind: span.kind,
    confidence: "high",
    reason: span.reason
  };
}

function isPlaceholderSecret(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("[redacted_secret]") ||
    normalized.includes("replace-me") ||
    normalized.includes("your-api-key-here") ||
    normalized.includes("<openai_api_key>") ||
    normalized === "sk-..." ||
    normalized.endsWith("=sk-...")
  );
}
