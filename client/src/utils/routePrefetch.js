import * as Sentry from '@sentry/react';
import { isChunkLoadError } from './lazyWithRetry';

const routePromises = new Map();

function createLoader(name, importer) {
  return () => {
    if (!routePromises.has(name)) {
      const promise = importer().catch((error) => {
        routePromises.delete(name);
        throw error;
      });
      routePromises.set(name, promise);
    }
    return routePromises.get(name);
  };
}

export const routeLoaders = Object.freeze({
  logistics: createLoader('logistics', () => import('../pages/logistics/LogisticsHomePage')),
  restaurants: createLoader('restaurants', () => import('../pages/food/FoodHomePage')),
  qrGenerator: createLoader('qrGenerator', () => import('../pages/QRCodeGeneratorPage')),
  careers: createLoader('careers', () => import('../pages/CareersPage')),
  jobs: createLoader('jobs', () => import('../pages/JobListPage')),
  clientManagement: createLoader('clientManagement', () => import('../pages/ClientManagementPage')),
});

const routeByPath = [
  [/^\/logistics(?:\/|$)/, 'logistics'],
  [/^\/(?:restaurants|food)(?:\/|$)/, 'restaurants'],
  [/^\/qr-generator(?:\/|$)/, 'qrGenerator'],
  [/^\/careers(?:\/|$)/, 'careers'],
  [/^\/jobs(?:\/|$)/, 'jobs'],
  [/^\/helper\/clients(?:\/|$)/, 'clientManagement'],
];

function connectionAllowsPrefetch() {
  if (typeof navigator === 'undefined' || !navigator.onLine) return false;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!connection) return true;
  if (connection.saveData) return false;
  return !/^(2g|slow-2g)$/.test(connection.effectiveType || '');
}

function routeNameForPath(pathname) {
  const match = routeByPath.find(([pattern]) => pattern.test(pathname));
  return match ? match[1] : null;
}

export function prefetchRoute(name) {
  if (!connectionAllowsPrefetch()) return null;
  const loader = routeLoaders[name];
  if (!loader) return null;

  const promise = loader();
  promise.catch((error) => {
    // Stale chunks after a deploy are expected here; the real navigation
    // recovers through lazyWithRetry (guarded reload). Reporting them would
    // just be Sentry noise (OXSTEED-FRONTEND-1B).
    if (isChunkLoadError(error)) return;
    Sentry.withScope((scope) => {
      scope.setLevel('warning');
      scope.setTag('failure_type', 'route_prefetch');
      scope.setTag('route', name);
      scope.setExtra('message', error?.message || String(error));
      Sentry.captureMessage('Route prefetch failed');
    });
  });
  return promise;
}

export function prefetchPath(pathname) {
  const path = typeof pathname === 'string' ? pathname.split(/[?#]/, 1)[0] : '';
  const name = routeNameForPath(path);
  return name ? prefetchRoute(name) : null;
}
