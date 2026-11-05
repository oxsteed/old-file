import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useCookieConsentContext } from "../context/CookieConsentContext";
import { useTranslation } from "react-i18next";
import {
  appendBounded,
  takeBatch,
  routeTemplate,
  uuidv7,
  safeProps,
  readSession,
  touchSession,
} from "./tracker.mjs";
// PWA startup budget (2026-11-05): the three registries below total ~66KB
// (elementKeys alone is ~59KB) and were statically imported, so they rode
// the startup bundle. They load on demand after mount instead; tracking
// stays gated on the /api/activity/config fetch anyway, which resolves
// after the local chunk load, so no events are lost. Until they resolve,
// track() is a no-op and no page.view fires.
import { TrackingContext, useTrack } from "./useTrack";
import { getCsrfToken } from "../api/csrfToken";
export { useTrack };
export default function ActivityTracker({ children }) {
  const { user } = useAuth();
  const { preferences } = useCookieConsentContext();
  const { i18n } = useTranslation();
  const [registries, setRegistries] = useState(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      import("./eventProps.json"),
      import("./routes.json"),
      import("./elementKeys.json"),
    ])
      .then(([eventPropsMod, routesMod, elementKeysMod]) => {
        if (!active) return;
        setRegistries({
          eventProps: eventPropsMod.default,
          routes: routesMod.default,
          elementKeys: elementKeysMod.default,
        });
      })
      .catch(() => {
        /* Registries stay unloaded; track() stays a no-op. */
      });
    return () => {
      active = false;
    };
  }, []);
  const namedKeys = useMemo(
    () => new Set(registries?.elementKeys ?? []),
    [registries],
  );
  const location = useLocation(),
    queue = useRef([]),
    config = useRef(null),
    session = useRef(null);
  const metadata = useRef({});
  const flush = useCallback(() => {
    if (!config.current?.enabled || !queue.current.length) return;
    const events = takeBatch(queue.current, metadata.current);
    queue.current = queue.current.slice(events.length);
    if (!events.length) return;
    // Keep analytics independent of auth refresh and the application request queue.
    // Pentest fix: this raw fetch bypasses the shared axios instance, so
    // it attaches the CSRF token itself for cookie sessions.
    const csrfToken = getCsrfToken();
    const headers = { "Content-Type": "application/json", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) };
    fetch("/api/activity/batch", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify({ ...metadata.current, events }),
      keepalive: true,
    }).catch(() => {});
  }, []);
  const track = useCallback(
    (name, props) => {
      if (!config.current?.enabled || !registries) return;
      props = safeProps(name, props, registries.eventProps, registries.routes);
      if (!props) return;
      // Session id lives in sessionStorage with 30-minute idle rotation
      // (spec 5.2); touchSession persists it and never throws.
      session.current = touchSession(window.sessionStorage);
      metadata.current.session = session.current;
      queue.current = appendBounded(queue.current, {
        event_id: uuidv7(),
        name,
        schema_ver: 1,
        occurred_at: new Date().toISOString(),
        props,
      });
      if (queue.current.length >= 20) flush();
    },
    [flush, registries],
  );
  useEffect(() => {
    let active = true;
    config.current = null;
    queue.current = [];
    const refresh = async () => {
      // Stop collecting during every refresh; stale permission is never assumed.
      config.current = null;
      queue.current = [];
      try {
        const response = await fetch("/api/activity/config", {
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "X-Growth-GPC": navigator.globalPrivacyControl === true ? "1" : "0",
          },
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!active) return;
        config.current = data;
        const route = registries
          ? routeTemplate(window.location.pathname, registries.routes)
          : null;
        if (data.enabled && route) track("page.view", { route });
        // No persistent device id is required by this signed-in-only implementation.
      } catch {
        /* Collection stays off. */
      }
    };
    refresh();
    const timer = setInterval(refresh, 600000);
    window.addEventListener("growth-consent-changed", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("growth-consent-changed", refresh);
      config.current = null;
      queue.current = [];
    };
  }, [user?.id, preferences?.timestamp, track]);
  useEffect(() => {
    metadata.current = {
      surface: "web",
      app_version: "1.0.0",
      locale: (i18n.resolvedLanguage || "en").split("-")[0],
      session:
        readSession(window.sessionStorage) || session.current || uuidv7(),
    };
    session.current = metadata.current.session;
  }, [i18n.resolvedLanguage]);
  useEffect(() => {
    if (!registries) return;
    const route = routeTemplate(location.pathname, registries.routes);
    if (route) track("page.view", { route });
  }, [location.pathname, track, registries]);
  useEffect(() => {
    const capture = (event) => {
      if (!config.current?.enabled || !registries) return;
      const route = routeTemplate(window.location.pathname, registries.routes);
      if (!route) return;
      const element =
        event.target instanceof Element
          ? event.target.closest(
              'a,button,[role="button"],[role="tab"],input[type="checkbox"],input[type="radio"],input[type="submit"],[data-track],form',
            )
          : null;
      if (!element || element.closest("[data-track-private]")) return;
      const destination =
        element.closest("a[href]")?.getAttribute("href") || "";
      if (
        /\/(?:admin|credit|wallet|payments?|messages?|support|disputes?|statements?|auth|login|password)(?:[/?#]|$)/i.test(
          destination,
        )
      )
        return;
      const key = element.getAttribute("data-track");
      const tag = element.tagName.toLowerCase();
      track(
        event.type === "submit"
          ? "ui.submit"
          : element.getAttribute("role") === "tab"
            ? "ui.tab"
            : "ui.click",
        {
          route,
          element_key: namedKeys.has(key) ? key : "unlabeled",
          component: ["a", "button", "input", "form"].includes(tag)
            ? tag
            : "other",
        },
      );
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("click", capture, true);
    document.addEventListener("submit", capture, true);
    document.addEventListener("visibilitychange", hidden);
    const timer = setInterval(flush, 5000);
    return () => {
      clearInterval(timer);
      document.removeEventListener("click", capture, true);
      document.removeEventListener("submit", capture, true);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [track, flush]);
  return (
    <TrackingContext.Provider value={track}>
      {children}
    </TrackingContext.Provider>
  );
}
