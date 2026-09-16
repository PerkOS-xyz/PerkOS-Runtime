import { rememberPendingDevice, startXaiDeviceLogin } from "../../../../lib/xaiOAuth";

// Paso 1 del login por suscripcion: pide el device code.
// El cliente muestra userCode, abre verificationUriComplete en el browser del
// sistema y hace polling a /api/auth/xai/poll.
export async function POST() {
  try {
    const start = await startXaiDeviceLogin();
    await rememberPendingDevice(start.deviceCode);
    return Response.json(start);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
