/**
 * Reads the desk turn route's stream: one `data: <json>` frame per event,
 * frames separated by a blank line. A frame can arrive split over two reads,
 * or several can arrive in one, so the reader keeps what is left over.
 *
 * No React and no Node imports: the hook reads with it, and tests feed it
 * text directly.
 */

import type { TurnEvent } from "../lib/turnRecord";

const STEPS = new Set<TurnEvent["step"]>(["open", "wake", "working", "phase", "start", "reply", "failure", "done", "error"]);

const isEvent = (v: unknown): v is TurnEvent =>
  typeof v === "object" && v !== null && typeof (v as { step?: unknown }).step === "string" && STEPS.has((v as { step: TurnEvent["step"] }).step);

/** One frame as an event, or null for a comment, an empty frame or anything that is not a turn event. */
export function parseFrame(frame: string): TurnEvent | null {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data.trim()) return null;
  try {
    const value: unknown = JSON.parse(data);
    return isEvent(value) ? value : null;
  } catch {
    return null;
  }
}

export class TurnFrames {
  private buffer = "";

  /** Adds text as it arrives; returns the events of the frames it completed. */
  push(text: string): TurnEvent[] {
    this.buffer = (this.buffer + text).replace(/\r\n/g, "\n");
    const out: TurnEvent[] = [];
    for (let cut = this.buffer.indexOf("\n\n"); cut >= 0; cut = this.buffer.indexOf("\n\n")) {
      const event = parseFrame(this.buffer.slice(0, cut));
      this.buffer = this.buffer.slice(cut + 2);
      if (event) out.push(event);
    }
    return out;
  }

  /** The last frame once the stream has ended, when it had no blank line after it. */
  flush(): TurnEvent[] {
    const rest = this.buffer;
    this.buffer = "";
    const event = parseFrame(rest);
    return event ? [event] : [];
  }
}
