"use client";

import { Embers } from "../desks/Embers";

/** Embers rising behind the screens that come before a desk; a desk brings its own. */
export function ScreenAmbient() {
  return (
    <div className="screen-ambient" aria-hidden>
      <Embers />
    </div>
  );
}
