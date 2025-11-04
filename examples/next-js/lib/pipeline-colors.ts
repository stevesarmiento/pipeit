// Centralized color constants for pipeline step states

export const STEP_COLORS = {
  idle: "rgb(229, 231, 235)", // gray-200
  building: "rgb(250, 204, 21)", // yellow-400
  signing: "rgb(251, 146, 60)", // orange-400
  sending: "rgb(96, 165, 250)", // blue-400
  confirmed: "rgb(74, 222, 128)", // green-400
  failed: "rgb(248, 113, 113)", // red-400
} as const;

export const GLOW_COLORS = {
  building: "rgba(250, 204, 21, 0.3)", // yellow glow
  signing: "rgba(251, 146, 60, 0.3)", // orange glow
  sending: "rgba(96, 165, 250, 0.3)", // blue glow
  confirmed: "rgba(74, 222, 128, 0.3)", // green glow
  failed: "rgba(248, 113, 113, 0.3)", // red glow
} as const;

export const SHADOW_COLORS = {
  building: "0 0 24px rgba(250, 204, 21, 0.2)",
  signing: "0 0 24px rgba(251, 146, 60, 0.2)",
  sending: "0 0 24px rgba(96, 165, 250, 0.2)",
  confirmed: "0 0 24px rgba(74, 222, 128, 0.2)",
  failed: "0 0 24px rgba(248, 113, 113, 0.2)",
} as const;



