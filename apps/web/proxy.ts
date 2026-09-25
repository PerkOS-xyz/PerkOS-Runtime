import { NextResponse, type NextRequest } from "next/server";

import { guard } from "./app/lib/guard";

// Every local API call goes through the door (see app/lib/guard.ts). Routes
// with side effects call it again themselves, in case the proxy is skipped.
export function proxy(request: NextRequest) {
  return guard(request) ?? NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
