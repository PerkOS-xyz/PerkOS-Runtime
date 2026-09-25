import { NextResponse, type NextRequest } from "next/server";

import { guard } from "./app/lib/guard";

// Runs the access check (app/lib/guard.ts) on every /api request.
export function proxy(request: NextRequest) {
  return guard(request) ?? NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
