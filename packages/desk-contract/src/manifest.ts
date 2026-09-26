/**
 * How a desk presents itself and how its team works a turn.
 *
 * The app that hosts desks is the same for every desk: a scene with Sparky, a
 * row with the team and a turn engine. What changes from desk to desk is
 * written here, by the desk: its line, its first questions, its screens, the
 * rules every member of the team keeps, and what each role does in each kind
 * of turn. The desk owns this text; the app runs it and adds the facts.
 */

import { z } from "zod";

export const DeskStarterSchema = z
  .object({
    text: z.string().trim().min(1).max(120),
    /** A few words under the question: what the desk will do with it. */
    tag: z.string().trim().min(1).max(60),
    /** The kind of turn this question runs. Left out, the question is plain chat with Sparky. */
    turn: z.enum(["analyze", "advise", "order"]).optional(),
  })
  .strict();

const RolePrompt = z.string().trim().min(1).max(1200);

/** What each role does in one kind of turn. */
export const DeskRolePromptsSchema = z
  .object({ scout: RolePrompt, risk: RolePrompt, trader: RolePrompt, auditor: RolePrompt })
  .strict();

export const DeskManifestSchema = z
  .object({
    /** One line under the desk's name: "Tokenized stocks on Robinhood Chain". */
    tagline: z.string().trim().min(1).max(120),
    starters: z.array(DeskStarterSchema).max(6),
    /** The desk's own screens, in the order the app shows them. */
    screens: z.array(z.enum(["market", "portfolio", "history", "trader"])).max(6),
    /** What every member of the team keeps in every turn on this desk. */
    rules: z.string().trim().min(1).max(1600),
    /**
     * The most one order may spend, in the market's quote asset. Checks on the
     * team's answers use it; a desk that leaves it out gets no size check.
     */
    maxOrder: z.number().positive().max(1_000_000).optional(),
    /**
     * Where the desk trades, named as the team should name it: "Uniswap on
     * Robinhood Chain". An answer that names another venue is flagged; a desk
     * that leaves this out gets no venue check.
     */
    venues: z.array(z.string().trim().min(1).max(64)).min(1).max(8).optional(),
    /** A kind of turn the desk leaves out is one it does not run. */
    turns: z
      .object({
        analyze: DeskRolePromptsSchema.optional(),
        advise: DeskRolePromptsSchema.optional(),
        order: DeskRolePromptsSchema.optional(),
      })
      .strict(),
  })
  .strict();

export type DeskStarter = z.infer<typeof DeskStarterSchema>;
export type DeskRolePrompts = z.infer<typeof DeskRolePromptsSchema>;
export type DeskManifest = z.infer<typeof DeskManifestSchema>;
export type DeskTurnKind = keyof DeskManifest["turns"];
