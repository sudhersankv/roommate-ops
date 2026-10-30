// Messages nobody addressed to Roomie don't keep their text in traces (audit B4). The pipeline opens a "roomie message"
// span (and its "gate" child) with the line as input before the Gate decides; when the Gate stays quiet, this processor
// swaps that input for its length as the span ends. Spans are written when they start and updated when they end
// (PostgresStore's batch-with-updates), so the ended span's input replaces the stored one.
import type { AnySpan, SpanOutputProcessor } from "@mastra/core/observability";

export const ROOT_SPAN = "roomie message";
export const GATE_SPAN = "gate";
export const NOT_KEPT = "(not addressed to Roomie: text not kept)";

type Out = { replied?: boolean; silent?: boolean; greeting?: unknown; speak?: boolean } | null | undefined;

const lengthOf = (v: unknown) => (typeof v === "string" ? v.length : 0);

/**
 * Whether an ended span belongs to a message Roomie didn't act on: the Gate span said `speak: false`, or the root span
 * ended without the agent (no reply, or only the day's greeting). A `silent` root means the agent did read it.
 */
export function isUnaddressed(span: { name: string; endTime?: Date; output?: unknown }): boolean {
  if (!span.endTime) return false;
  const out = span.output as Out;
  if (span.name === GATE_SPAN) return out?.speak === false;
  if (span.name === ROOT_SPAN) return !!out && !out.silent && (out.replied === false || out.greeting !== undefined);
  return false;
}

/** Replaces the input text of an unaddressed message's spans in place (keeps the Gate's flags). Returns the span. */
export function redactUnaddressed<S extends { name: string; endTime?: Date; output?: unknown; input?: unknown }>(span: S): S {
  if (!isUnaddressed(span)) return span;
  const input = (span.input ?? {}) as Record<string, unknown>;
  if (span.name === ROOT_SPAN) span.input = { text: NOT_KEPT, chars: lengthOf(input.text) };
  else span.input = { ...input, latest: NOT_KEPT, chars: lengthOf(input.latest) };
  return span;
}

export class UnaddressedTextFilter implements SpanOutputProcessor {
  name = "roomie-unaddressed-text";
  process(span?: AnySpan): AnySpan | undefined {
    return span ? redactUnaddressed(span) : span;
  }
  async shutdown(): Promise<void> {}
}
