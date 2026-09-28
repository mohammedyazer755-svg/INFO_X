import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createDroneController } from "../simulation/droneController.js";
import { NODE_REGISTRY } from "../config/nodes.js";

export function useDroneSimulation(condition, enabled = true, registry = NODE_REGISTRY, clock = null) {
  const evidence = useRef(condition);
  evidence.current = condition;
  const controller = useMemo(() => createDroneController({ registry, getCondition: () => evidence.current }), [registry]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [viewportVisible, setViewportVisible] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    if (!enabled) return;
    return controller.connect();
  }, [controller, enabled]);
  const clockScale = clock?.getScale();
  useEffect(() => { controller.setClock(clock); }, [controller, clock, clockScale]);
  useEffect(() => {
    const visibility = () => setDocumentVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    visibility();
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const preference = () => controller.setReducedMotion(Boolean(media?.matches));
    preference();
    media?.addEventListener?.("change", preference);
    return () => { document.removeEventListener("visibilitychange", visibility); media?.removeEventListener?.("change", preference); };
  }, [controller]);
  useEffect(() => { controller.setVisible(enabled && viewportVisible && documentVisible); }, [controller, enabled, viewportVisible, documentVisible]);
  const setVisible = useCallback(value => setViewportVisible(value), []);
  return { ...snapshot, setViewportVisible: setVisible, start: controller.start, pause: controller.pause, resume: controller.resume,
    returnToBase: controller.returnToBase, reset: controller.reset };
}

export function useDroneViewport(ref, setVisible) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return () => setVisible(false); }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { threshold: 0 });
    observer.observe(element);
    return () => { observer.disconnect(); setVisible(false); };
  }, [ref, setVisible]);
}
