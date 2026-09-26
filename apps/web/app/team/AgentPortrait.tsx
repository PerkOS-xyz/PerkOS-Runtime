"use client";

import { useId } from "react";

import { RING } from "./AgentAvatar";
import { portraitSrc } from "./agentPortraits";
import { AGENT_STATES, roleConfig, sphereAccent, type AgentAvatarState } from "./avatarIdentity";

/**
 * A desk agent as its character head, lit from behind in its role's color and
 * wearing the same state ring, motion and dimming as the sphere, so a person
 * reads "asleep", "thinking" or "failed" the same way on every desk.
 */
export function AgentPortrait({ role, state = "idle", size = 48, label, seat }: { role: string; state?: AgentAvatarState; size?: number; label?: string; seat?: number }) {
  const uid = useId().replace(/[:]/g, "");
  const st = AGENT_STATES[state];
  const ring = st.ring ? RING[st.ring] : null;
  const name = label ?? roleConfig(role).label;
  return (
    <span
      className="agent-avatar agent-portrait"
      data-role={role}
      data-state={state}
      data-mode={st.mode}
      role="img"
      aria-label={`${name}, ${state}`}
      style={{ width: size, height: size, color: sphereAccent(role, seat) }}
    >
      <svg viewBox="0 0 1000 1000" width={size} height={size} aria-hidden>
        <defs>
          <filter id={`ap-blur-${uid}`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="60" />
          </filter>
        </defs>
        <circle className="as-glow" cx="500" cy="560" r="300" fill="currentColor" opacity="0.55" filter={`url(#ap-blur-${uid})`} />
        {/* The art is 6:5, so it sits a little low inside the ring, the way a head rests. */}
        <image href={portraitSrc(role)} x="80" y="170" width="840" height="700" preserveAspectRatio="xMidYMid meet" />
        {ring ? (
          <g className="aa-ring" style={{ color: ring.color }}>
            <circle cx="500" cy="500" r="440" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="34" />
            <circle cx="500" cy="500" r="440" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" strokeDasharray={ring.dash} />
          </g>
        ) : null}
      </svg>
    </span>
  );
}
