import { lazy } from 'react';

// Maps taskDestination.component names from GET /api/businesses/attention to
// lazily-loaded workflow components. Route-type destinations ({ type: 'route' })
// are handled by AttentionTaskView directly (message + "Open full page").
//
// To register a new workflow: add the component name emitted by the backend
// here and describe its required props in getTaskComponentProps.

const loaders = {
  RestaurantCreditManager: () => import('../../pages/food/RestaurantCreditManager.jsx'),
};

const cache = new Map();

export function getTaskComponent(name) {
  if (!name || !loaders[name]) return null;
  if (!cache.has(name)) cache.set(name, lazy(loaders[name]));
  return cache.get(name);
}

// Props the registry knows how to derive from an attention item. Returns null
// when required data is missing so the caller can fall back to the
// route-only message instead of rendering a broken workflow.
export function getTaskComponentProps(name, task) {
  if (name === 'RestaurantCreditManager') {
    if (task?.restaurantId == null) return null;
    return { restaurant: { id: task.restaurantId } };
  }
  return {};
}

export function isTaskComponentRegistered(name) {
  return Boolean(name && loaders[name]);
}
