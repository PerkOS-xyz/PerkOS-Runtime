/**
 * Splits a streamed reply into sentences, so speech can start with the first
 * one while the rest is still arriving.
 */
export class SentenceSplitter {
  private buffer = "";

  /** Adds streamed text; returns the sentences it completed. */
  push(piece: string): string[] {
    this.buffer += piece;
    const out: string[] = [];
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const c = this.buffer[i];
      const next = this.buffer[i + 1];
      // A line break ends a sentence; . ! ? end one only when whitespace follows,
      // so "224.27" and "BRK.B" stay whole.
      const end = c === "\n" || ((c === "." || c === "!" || c === "?") && next !== undefined && /\s/.test(next));
      if (!end) continue;
      const sentence = this.buffer.slice(start, c === "\n" ? i : i + 1).trim();
      if (sentence) out.push(sentence);
      start = i + 1;
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  /** The rest of the reply once the stream has ended. */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest ? [rest] : [];
  }
}
