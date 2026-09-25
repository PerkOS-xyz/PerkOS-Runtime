/**
 * Which model answers, and saying so.
 *
 * Runtime can reach several: one on the person's machine, one on their own
 * cloud account, one on PerkOS. The rule is that the person's choice wins, and
 * that a fallback is never silent. Someone who picked the model on their
 * laptop and gets an answer from a cloud has to be told, in the same breath as
 * the answer, or the choice was decoration.
 */

import { AiProviderError, type AiProvider, type ProviderHealth } from "./types.ts";

export interface Pick {
  provider: AiProvider;
  health: ProviderHealth;
  /** True when this is not what was asked for. */
  fellBack: boolean;
  /** Why the preferred one was not used, for the screen to show as it is. */
  reason?: string;
}

export class AiRegistry {
  /** In the order they are tried when the preferred one cannot answer. */
  private readonly providers: AiProvider[];

  constructor(providers: AiProvider[]) {
    this.providers = providers;
  }

  list(): AiProvider[] {
    return [...this.providers];
  }

  get(id: string): AiProvider | undefined {
    return this.providers.find((p) => p.id === id);
  }

  /** Health of every provider, for the landing to draw the choice honestly. */
  async healthAll(): Promise<Array<{ id: string; label: string; health: ProviderHealth }>> {
    return Promise.all(
      this.providers.map(async (p) => ({ id: p.id, label: p.label, health: await p.health().catch(() => ({ ok: false, detail: `${p.label} did not answer.` })) })),
    );
  }

  /**
   * The provider that will answer. The preferred one is asked first; the rest
   * are tried in order only if it cannot. Throws when none can, because an
   * empty answer with no explanation is worse than an error.
   */
  async pick(preferredId?: string): Promise<Pick> {
    const preferred = preferredId ? this.get(preferredId) : this.providers[0];
    if (preferredId && !preferred) {
      throw new AiProviderError(`No model provider called ${preferredId}`, "AI_UNKNOWN_PROVIDER");
    }
    if (preferred) {
      const health = await preferred.health().catch(() => ({ ok: false, detail: `${preferred.label} did not answer.` }));
      if (health.ok) return { provider: preferred, health, fellBack: false };
      const other = await this.firstHealthy(preferred.id);
      if (other) return { ...other, fellBack: true, reason: health.detail };
      throw new AiProviderError(health.detail, "AI_NONE_AVAILABLE");
    }
    const any = await this.firstHealthy();
    if (any) return { ...any, fellBack: false };
    throw new AiProviderError("No model is connected yet.", "AI_NONE_AVAILABLE");
  }

  private async firstHealthy(skipId?: string): Promise<{ provider: AiProvider; health: ProviderHealth } | null> {
    for (const provider of this.providers) {
      if (provider.id === skipId) continue;
      const health = await provider.health().catch(() => ({ ok: false, detail: `${provider.label} did not answer.` }));
      if (health.ok) return { provider, health };
    }
    return null;
  }
}
