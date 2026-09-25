/** Model sources available to this app, and validation of the person's choice. */

import { AiRegistry, LocalAiProvider, XaiProvider } from "@perkos/ai";

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
  return new AiRegistry([new LocalAiProvider(), new XaiProvider({ token: () => xaiAuth.accessToken() })]);
}

export async function listSources(registry: AiRegistry): Promise<ModelSource[]> {
  return Promise.all(
    registry.list().map(async (p) => {
      const health = await p.health().catch(() => ({ ok: false, detail: `${p.label} did not answer.` }));
      const models = health.ok ? await p.models().catch(() => []) : [];
      return { id: p.id, label: p.label, ok: health.ok, detail: health.detail, models: models.map((m) => m.id) };
    }),
  );
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
