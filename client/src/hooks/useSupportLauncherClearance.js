import { useLayoutEffect } from 'react';

const CONTROLS = 'a[href], button, input, select, textarea, label[for], [role="button"], [role="combobox"], [role="checkbox"], [role="switch"], [tabindex]:not([tabindex="-1"])';
const OVERLAP = 'data-pwa-control-overlap';

// Keep page actions tappable. Visibility preserves the launcher's rectangle,
// so hiding it cannot alternate between colliding and visible every frame.
// Native intersection tracking handles scroll without a JS layout scan.
export function useSupportLauncherClearance(ref, routeKey, enabled = true) {
  useLayoutEffect(() => {
    const launcher = ref.current;
    if (!enabled || !launcher || typeof IntersectionObserver === 'undefined') return undefined;
    const controls = new Set();
    const collisions = new Set();
    let intersection;
    let region;
    let frame;
    let disposed = false;
    const publish = () => {
      const blocked = [...collisions].some(element => element.isConnected);
      if (blocked && document.activeElement !== launcher) launcher.setAttribute(OVERLAP, 'true');
      else launcher.removeAttribute(OVERLAP);
    };
    const add = node => {
      if (!(node instanceof Element)) return;
      for (const element of [node, ...node.querySelectorAll(CONTROLS)]) {
        if (!element.matches(CONTROLS) || !element.closest('main') || launcher.contains(element) || controls.has(element)) continue;
        controls.add(element);
        intersection?.observe(element);
      }
    };
    const remove = node => {
      if (!(node instanceof Element)) return;
      for (const element of [node, ...node.querySelectorAll(CONTROLS)]) {
        if (!controls.delete(element)) continue;
        collisions.delete(element);
        intersection?.unobserve(element);
      }
    };
    const inspect = () => {
      frame = undefined;
      if (disposed) return;
      const rect = launcher.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      const height = window.innerHeight;
      const margin = `${-Math.max(0, rect.top - 8)}px ${-Math.max(0, width - rect.right - 8)}px ${-Math.max(0, height - rect.bottom - 8)}px ${-Math.max(0, rect.left - 8)}px`;
      if (region === margin && intersection) return;
      region = margin;
      intersection?.disconnect();
      collisions.clear();
      if (!rect.width || !rect.height) { intersection = undefined; publish(); return; }
      intersection = new IntersectionObserver(entries => {
        if (disposed) return;
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0) collisions.add(entry.target);
          else collisions.delete(entry.target);
        }
        publish();
      }, { rootMargin: margin });
      for (const element of controls) intersection.observe(element);
      publish();
    };
    const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(inspect); };
    add(document.body);
    inspect();
    const mutations = new MutationObserver(records => {
      for (const record of records) {
        record.removedNodes.forEach(remove);
        record.addedNodes.forEach(add);
      }
      publish();
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    const root = new MutationObserver(schedule);
    root.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'dir', 'lang', 'style'] });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resize?.observe(launcher);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    launcher.addEventListener('focus', publish);
    launcher.addEventListener('blur', publish);
    return () => {
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      intersection?.disconnect(); mutations.disconnect(); root.disconnect(); resize?.disconnect();
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      launcher.removeEventListener('focus', publish);
      launcher.removeEventListener('blur', publish);
      launcher.removeAttribute(OVERLAP);
    };
  }, [ref, routeKey, enabled]);
}
