/** Model sources available to this app, and validation of the person's choice. */

import { AiRegistry, AnthropicProvider, ChatgptProvider, LocalAiProvider, PerkosAiProvider, XaiProvider, type ProviderHealth } from "@perkos/ai";

import { anthropicKey } from "./anthropicKey";
import { chatgptAuth } from "./chatgpt";
import { sessions } from "./session";
import { xaiAuth } from "./xai";

import type { ModelChoice } from "./settings";

export interface ModelSource {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  models: string[];
}

export function defaultRegistry(): AiRegistry {
  return new AiRegistry([
    new LocalAiProvider(),
    new XaiProvider({ token: () => xaiAuth.accessToken() }),
    new AnthropicProvider({ apiKey: () => anthropicKey.load() }),
    new ChatgptProvider({ token: () => chatgptAuth.accessToken() }),
    // Offered only to a wallet with PerkOS LLM access; PerkOS's API checks it on every request.
    new PerkosAiProvider({
      token: async () => (await sessions.current())?.accessToken ?? null,
      ...(process.env.PERKOS_API_URL ? { baseUrl: process.env.PERKOS_API_URL } : {}),
    }),
  ]);
}

export async function listSources(registry: AiRegistry): Promise<ModelSource[]> {
  const sources = await Promise.all(
    registry.list().map(async (p): Promise<ModelSource | null> => {
      const health: ProviderHealth = await p.health().catch(() => ({ ok: false, detail: `${p.label} did not answer.` }));
      // A source this person cannot use at all stays off the list.
      if (health.offered === false) return null;
      const models = health.ok ? await p.models().catch(() => []) : [];
      return { id: p.id, label: p.label, ok: health.ok, detail: health.detail, models: models.map((m) => m.id) };
    }),
  );
  return sources.filter((s): s is ModelSource => s !== null);
}

/** The choice when the provider is answering and offers that model; otherwise an error message. */
export async function validateChoice(registry: AiRegistry, choice: ModelChoice): Promise<ModelChoice | { error: string }> {
  const provider = registry.get(choice.provider);
  if (!provider) return { error: `Unknown model source: ${choice.provider}` };
  const health = await provider.health().catch(() => ({ ok: false, detail: `${provider.label} did not answer.` }));
  if (!health.ok) return { error: health.detail };
  const models = await provider.models().catch(() => []);
  if (!models.some((m) => m.id === choice.model)) return { error: `${provider.label} does not offer ${choice.model}` };
  return { provider: choice.provider, model: choice.model };
}
