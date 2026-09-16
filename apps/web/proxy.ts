import { NextResponse, type NextRequest } from "next/server";
import { guard } from "./app/lib/guard";

// Toda la API local pasa por la puerta (ver app/lib/guard.ts). Las rutas con
// efectos la llaman ademas por su cuenta, por si el proxy se salta.
export function proxy(request: NextRequest) {
  return guard(request) ?? NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
