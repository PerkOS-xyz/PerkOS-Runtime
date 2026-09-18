import { loadSettings } from "../../../lib/settingsStore";
import { getPerkosIdToken, perkosRequest, PerkosApiError } from "../../../lib/perkosApi";

// GET  /api/perkos/billing -> el estado de la cuenta, tal como lo vive la persona.
// POST /api/perkos/billing -> reclama la concesion de bienvenida (idempotente) y
//                             devuelve el estado ya actualizado.
//
// `hoursRemaining` de la API cuenta horas de AGENTE; un desk de cuatro consume
// cuatro por cada hora de reloj. Aqui se expone `deskHours`, que es lo que la
// cabecera muestra, para que nadie vuelva a pintar la cifra cuadruplicada.

type Me = {
  creditsUsd: number;
  exempt?: boolean;
  grantsUsd?: number;
  paymentsUsd?: number;
  usage?: { agentCount?: number };
  infra: {
    allowed: boolean;
    reason: string;
    hoursRemaining: number | null;
    deskHoursRemaining?: number | null;
    rateUsdPerDeskHour?: number;
    rateUsdPerTeamHour?: number;
  };
};

function shape(r: Me) {
  const agents = Number(r.usage?.agentCount ?? 0) || 0;
  const deskHours =
    r.infra.deskHoursRemaining ??
    (r.infra.hoursRemaining === null
      ? null
      : agents > 0
        ? r.infra.hoursRemaining / agents
        : r.infra.hoursRemaining);
  return {
    creditsUsd: r.creditsUsd,
    deskHours,
    agents,
    rateUsdPerDeskHour: r.infra.rateUsdPerDeskHour ?? (r.infra.rateUsdPerTeamHour ?? 0) * Math.max(1, agents),
    allowed: r.infra.allowed,
    reason: r.infra.reason,
    exempt: Boolean(r.exempt),
    grantsUsd: Number(r.grantsUsd ?? 0) || 0,
    paymentsUsd: Number(r.paymentsUsd ?? 0) || 0
  };
}

async function me(): Promise<Response> {
  const s = await loadSettings();
  if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
  const t = await getPerkosIdToken(s.wallet);
  if (!t) return Response.json({ error: "perkos_session_required" }, { status: 401 });
  const r = await perkosRequest<Me>("/billing/me", { idToken: t.idToken, timeoutMs: 15_000 });
  return Response.json(shape(r));
}

function failed(e: unknown): Response {
  if (e instanceof PerkosApiError) {
    return Response.json({ error: e.code ?? "billing_failed", detail: e.message }, { status: e.status });
  }
  return Response.json({ error: "billing_failed", detail: (e as Error).message }, { status: 502 });
}

export async function GET() {
  try {
    return await me();
  } catch (e) {
    return failed(e);
  }
}

export async function POST() {
  try {
    const s = await loadSettings();
    if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
    const t = await getPerkosIdToken(s.wallet);
    if (!t) return Response.json({ error: "perkos_session_required" }, { status: 401 });
    // Idempotente en la API: pedirla en cada entrada no regala dos veces.
    const g = await perkosRequest<{ granted: boolean; amountUsd: number; reason?: string }>("/billing/welcome", {
      idToken: t.idToken,
      method: "POST",
      body: "{}",
      timeoutMs: 15_000
    });
    const state = await me();
    const body = (await state.json()) as Record<string, unknown>;
    return Response.json({ ...body, granted: g.granted, grantedUsd: g.amountUsd, grantReason: g.reason ?? null });
  } catch (e) {
    return failed(e);
  }
}
