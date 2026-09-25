import { AiProviderError, AnthropicProvider } from "@perkos/ai";

import { anthropicKey } from "../../lib/anthropicKey";
import { guard } from "../../lib/guard";

// GET -> { saved }
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json({ saved: (await anthropicKey.load()) !== null });
}

// POST { apiKey } -> { saved: true }. The key is checked against Anthropic before it is saved.
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { apiKey?: unknown };
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!/^sk-ant-[\w-]{20,}$/.test(apiKey)) {
    return Response.json({ error: "format", message: "That does not look like an Anthropic API key (sk-ant-…)." }, { status: 400 });
  }
  try {
    await new AnthropicProvider({ apiKey: async () => apiKey }).models();
  } catch (err) {
    if (err instanceof AiProviderError && err.code === "AI_ANTHROPIC_UNAUTHORIZED") {
      return Response.json({ error: "rejected", message: "Anthropic rejected this key." }, { status: 400 });
    }
    return Response.json({ error: "unreachable", message: "Could not reach Anthropic. Try again." }, { status: 502 });
  }
  await anthropicKey.save(apiKey);
  return Response.json({ saved: true });
}

// DELETE -> { saved: false }
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  await anthropicKey.clear();
  return Response.json({ saved: false });
}
