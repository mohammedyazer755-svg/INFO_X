# Prototype condition modules

These deterministic rules are prototype condition indicators, not trained predictions or confirmed fault diagnoses. Configure weights, penalties, node assignments and the illustrative four-node, 2.4 km layout in `../config/conditionConfig.js`. The layout remains labelled as demo even when observations come from hardware; its locations need site configuration.

Mechanical and thermal scores require the qualified Phase 4 window (at least ten valid samples across thirty seconds). Levels establish a base score; rising trends, sustained rises and threshold duration reduce it. Reasons include observed values and units. Tracking can immediately indicate a fresh active obstruction; event-frequency scoring waits for thirty seconds of observation. Raw critical threshold indicators remain visible during collection and regardless of the fused average.

The shared bands are 80–100 Normal/Low, 60–<80 Watch/Moderate, 40–<60 Warning/High, 20–<40 High Risk/Very High and 0–<20 Critical/Critical. Trend direction is a separate property.

Fusion normalizes configured weights over eligible, fresh modules in the selected context. Hardware and demo/manual observations never contribute to the same index. Missing or ineligible modules are excluded with coverage reasons; an empty selection returns null. Vision and Energy remain unavailable until integrated. Hall is separate supporting evidence for the splice zone and contributes no integrity percentage or sixth module score.

Corroboration requires overlapping observation windows, aligned latest timestamps and configured compatible locations. Rising vibration plus rising temperature requests 15 anomaly points; tracking events plus rising vibration requests 10. When rules share module evidence, only the stronger rule contributes; both explanations remain visible. Total contribution is capped at twenty points. This is rule-based corroboration, not statistical cross-correlation.

Recommendations prioritize individual critical evidence, corroborated indicators, other elevated modules and incomplete coverage. They name configured inspection locations and retain contributing evidence. They never dispatch commands or assert that incomplete coverage means all conditions are normal. Collection and analysis use the existing provider/store lifecycle and freshness clock, without adding ESP32 polling.
