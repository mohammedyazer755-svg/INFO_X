import { useMemo } from "react";
import { analyzeNumericTrend } from "../calculations/temporal.js";

export function deriveTemporalAnalysis(features) {
  return {
    piezoVal: analyzeNumericTrend(features.piezoVal, features.piezoVal.config),
    tempC: analyzeNumericTrend(features.tempC, features.tempC.config),
    tracking: {
      currentState: features.tracking.currentState,
      leftObstructionMs: features.tracking.left.currentEvent?.durationMs ?? null,
      rightObstructionMs: features.tracking.right.currentEvent?.durationMs ?? null,
      recurrent: (features.tracking.left.quality === "valid" && features.tracking.left.recurrent) || (features.tracking.right.quality === "valid" && features.tracking.right.recurrent),
      reason: "Binary event recurrence and observed durations; displacement trend unavailable.",
    },
    hall: { recurrent: features.hall.recurrent, anomalyDurationMs: features.hall.currentEvent?.durationMs ?? null,
      quality: features.hall.quality, source: features.hall.source, reason: "Supporting evidence for splice zone." },
  };
}

export function useTemporalAnalysis(features) {
  return useMemo(() => deriveTemporalAnalysis(features), [features]);
}
