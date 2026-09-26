"use client";

import { useId } from "react";

import { RING } from "./AgentAvatar";
import { AGENT_STATES, roleConfig, sphereAccent, type AgentAvatarState } from "./avatarIdentity";

/**
 * A desk agent as a lit sphere in its role's color, with the same state ring,
 * motion and dimming as the avatar. It stands in for each role until that
 * role has its portrait.
 */
export function AgentSphere({ role, state = "idle", size = 48, label, seat }: { role: string; state?: AgentAvatarState; size?: number; label?: string; seat?: number }) {
  const uid = useId().replace(/[:]/g, "");
  const st = AGENT_STATES[state];
  const ring = st.ring ? RING[st.ring] : null;
  const name = label ?? roleConfig(role).label;
  return (
    <span
      className="agent-avatar agent-sphere"
      data-role={role}
      data-state={state}
      data-mode={st.mode}
      role="img"
      aria-label={`${name}, ${state}`}
      style={{ width: size, height: size, color: sphereAccent(role, seat) }}
    >
      <svg viewBox="0 0 1000 1000" width={size} height={size} aria-hidden>
        <defs>
          <radialGradient id={`as-lit-${uid}`} cx="36%" cy="30%" r="72%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="34%" stopColor="#ffffff" stopOpacity="0.14" />
            <stop offset="58%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`as-shade-${uid}`} cx="42%" cy="36%" r="68%">
            <stop offset="52%" stopColor="#03040a" stopOpacity="0" />
            <stop offset="100%" stopColor="#03040a" stopOpacity="0.66" />
          </radialGradient>
          <filter id={`as-blur-${uid}`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="46" />
          </filter>
        </defs>
        <circle className="as-glow" cx="500" cy="530" r="320" fill="currentColor" filter={`url(#as-blur-${uid})`} />
        <circle cx="500" cy="500" r="320" fill="currentColor" />
        <circle cx="500" cy="500" r="320" fill={`url(#as-shade-${uid})`} />
        <circle cx="500" cy="500" r="320" fill={`url(#as-lit-${uid})`} />
        <ellipse cx="398" cy="356" rx="84" ry="50" transform="rotate(-32 398 356)" fill="#ffffff" opacity="0.5" />
        <circle cx="500" cy="500" r="320" fill="none" stroke="#ffffff" strokeOpacity="0.2" strokeWidth="6" />
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
