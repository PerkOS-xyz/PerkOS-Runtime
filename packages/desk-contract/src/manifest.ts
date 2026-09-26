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
    screens: z.array(z.enum(["market", "portfolio", "history"])).max(6),
    /** What every member of the team keeps in every turn on this desk. */
    rules: z.string().trim().min(1).max(1600),
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
