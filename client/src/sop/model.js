/**
 * model.js - Visual SOP library data model.
 *
 * A Guide is a self-contained, visual, step-by-step walkthrough for one task.
 * Areas group guides by product surface. Handbooks order guides into
 * role-based reading lists.
 *
 * Guide BODY content is English-only by design (content workers author it in
 * English and each guide card carries an "English" badge). UI chrome strings
 * (search, filters, buttons, modal labels) live in the `sop` i18n namespace.
 *
 * This module is pure data + validation (no React, no DOM) so the
 * coverage-audit worker and the Node test harness can use it directly.
 */

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** Audiences a guide can target. Subset used per guide. */
export const AUDIENCES = ['customer', 'helper', 'business', 'restaurant', 'logistics'];

/** Roles a handbook can belong to. */
export const HANDBOOK_ROLES = ['customer', 'helper', 'business', 'restaurant', 'logistics'];

/** Guide availability states. */
export const AVAILABILITY = ['supported', 'conditional'];

/** Process-map node types. */
export const PROCESS_NODE_TYPES = ['step', 'decision', 'terminal', 'blocked'];

/** Screenshot viewport kinds. */
export const SCREENSHOT_VIEWPORTS = ['desktop', 'mobile'];

/** Source reference kinds. */
export const SOURCE_TYPES = ['route', 'screen', 'handler', 'flag', 'permission'];

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate one guide against the SOP data model.
 *
 * @param {object} guide - the guide to validate.
 * @param {object} [options]
 * @param {Array<object>} [options.guides=[]] - registry guides used to resolve
 *   relatedGuides and prerequisite guideId references.
 * @returns {string[]} list of human-readable errors; empty when valid.
 */
export function validateGuide(guide, { guides = [] } = {}) {
  const errors = [];
  const fail = (message) => errors.push(message);

  if (!isPlainObject(guide)) {
    return ['guide must be a plain object'];
  }

  const guideLabel = guide.id || guide.slug || '(unknown guide)';

  // --- identity ------------------------------------------------------------
  if (!isNonEmptyString(guide.id)) fail('id must be a non-empty string');
  else if (!KEBAB_CASE.test(guide.id)) fail(`id "${guide.id}" must be kebab-case`);

  if (!isNonEmptyString(guide.area)) fail(`${guideLabel}: area must be a non-empty string`);

  if (!isNonEmptyString(guide.slug)) fail(`${guideLabel}: slug must be a non-empty string`);
  else if (!KEBAB_CASE.test(guide.slug)) fail(`${guideLabel}: slug "${guide.slug}" must be kebab-case`);

  if (!isNonEmptyString(guide.title)) fail(`${guideLabel}: title must be a non-empty string`);

  // --- audiences -----------------------------------------------------------
  if (!Array.isArray(guide.audiences) || guide.audiences.length === 0) {
    fail(`${guideLabel}: audiences must be a non-empty array`);
  } else {
    for (const audience of guide.audiences) {
      if (!AUDIENCES.includes(audience)) {
        fail(`${guideLabel}: unknown audience "${audience}" (expected one of ${AUDIENCES.join(', ')})`);
      }
    }
  }

  // --- revision / availability ---------------------------------------------
  if (!Number.isInteger(guide.revision) || guide.revision < 1) {
    fail(`${guideLabel}: revision must be a positive integer`);
  }

  if (!AVAILABILITY.includes(guide.availability)) {
    fail(`${guideLabel}: availability must be one of ${AVAILABILITY.join(', ')}`);
  } else if (guide.availability === 'conditional') {
    if (!Array.isArray(guide.conditions) || guide.conditions.length === 0) {
      fail(`${guideLabel}: conditional guides must list at least one condition`);
    } else {
      guide.conditions.forEach((condition, index) => {
        if (!isNonEmptyString(condition)) fail(`${guideLabel}: conditions[${index}] must be a non-empty string`);
      });
    }
  }

  // --- narrative -----------------------------------------------------------
  if (!isNonEmptyString(guide.goal)) fail(`${guideLabel}: goal must be a non-empty string`);

  if (!Array.isArray(guide.intendedRoles) || guide.intendedRoles.length === 0) {
    fail(`${guideLabel}: intendedRoles must be a non-empty array`);
  } else {
    guide.intendedRoles.forEach((role, index) => {
      if (!isNonEmptyString(role)) fail(`${guideLabel}: intendedRoles[${index}] must be a non-empty string`);
    });
  }

  // --- prerequisites -------------------------------------------------------
  const guideIds = new Set(guides.map((entry) => entry && entry.id));
  if (!Array.isArray(guide.prerequisites)) {
    fail(`${guideLabel}: prerequisites must be an array`);
  } else {
    guide.prerequisites.forEach((prerequisite, index) => {
      const label = `${guideLabel}: prerequisites[${index}]`;
      if (!isPlainObject(prerequisite)) return fail(`${label} must be an object`);
      if (!isNonEmptyString(prerequisite.text)) fail(`${label}.text must be a non-empty string`);
      if (prerequisite.guideId != null) {
        if (!isNonEmptyString(prerequisite.guideId)) fail(`${label}.guideId must be a non-empty string`);
        else if (guides.length > 0 && !guideIds.has(prerequisite.guideId)) {
          fail(`${label}.guideId "${prerequisite.guideId}" does not resolve to a known guide`);
        }
      }
      if (prerequisite.href != null && !isNonEmptyString(prerequisite.href)) {
        fail(`${label}.href must be a non-empty string`);
      }
    });
  }

  // --- process map ---------------------------------------------------------
  const processMap = guide.processMap;
  if (!isPlainObject(processMap)) {
    fail(`${guideLabel}: processMap must be an object`);
  } else {
    const nodes = Array.isArray(processMap.nodes) ? processMap.nodes : null;
    const edges = Array.isArray(processMap.edges) ? processMap.edges : null;
    if (!nodes || nodes.length === 0) fail(`${guideLabel}: processMap.nodes must be a non-empty array`);
    if (!edges) fail(`${guideLabel}: processMap.edges must be an array`);

    const nodeIds = new Set();
    if (nodes) {
      nodes.forEach((node, index) => {
        const label = `${guideLabel}: processMap.nodes[${index}]`;
        if (!isPlainObject(node)) return fail(`${label} must be an object`);
        if (!isNonEmptyString(node.id)) return fail(`${label}.id must be a non-empty string`);
        if (nodeIds.has(node.id)) fail(`${label}.id "${node.id}" is duplicated`);
        nodeIds.add(node.id);
        if (!isNonEmptyString(node.label)) fail(`${label}.label must be a non-empty string`);
        if (!PROCESS_NODE_TYPES.includes(node.type)) {
          fail(`${label}.type must be one of ${PROCESS_NODE_TYPES.join(', ')}`);
        }
      });
    }
    if (edges) {
      edges.forEach((edge, index) => {
        const label = `${guideLabel}: processMap.edges[${index}]`;
        if (!isPlainObject(edge)) return fail(`${label} must be an object`);
        if (!isNonEmptyString(edge.from) || !nodeIds.has(edge.from)) {
          fail(`${label}.from "${edge && edge.from}" does not reference an existing node`);
        }
        if (!isNonEmptyString(edge.to) || !nodeIds.has(edge.to)) {
          fail(`${label}.to "${edge && edge.to}" does not reference an existing node`);
        }
        if (edge.label != null && !isNonEmptyString(edge.label)) {
          fail(`${label}.label must be a non-empty string when present`);
        }
      });
    }
  }

  if (!isNonEmptyString(guide.processMapText)) {
    fail(`${guideLabel}: processMapText must be a non-empty plain-text equivalent of the process map`);
  }

  // --- steps ---------------------------------------------------------------
  if (!Array.isArray(guide.steps) || guide.steps.length === 0) {
    fail(`${guideLabel}: steps must be a non-empty array`);
  } else {
    const stepIds = new Set();
    guide.steps.forEach((step, index) => {
      const label = `${guideLabel}: steps[${index}]`;
      if (!isPlainObject(step)) return fail(`${label} must be an object`);
      if (!isNonEmptyString(step.id)) return fail(`${label}.id must be a non-empty string`);
      if (stepIds.has(step.id)) fail(`${label}.id "${step.id}" is duplicated`);
      stepIds.add(step.id);
      if (!isNonEmptyString(step.title)) fail(`${label}.title must be a non-empty string`);
      if (!isNonEmptyString(step.body)) fail(`${label}.body must be a non-empty string`);
      if (!isNonEmptyString(step.expectedResult)) fail(`${label}.expectedResult must be a non-empty string`);

      if (!Array.isArray(step.screenshots) || step.screenshots.length === 0) {
        fail(`${label} must reference at least one screenshot`);
      } else {
        // Screenshot sidecar contract: guide files describe WHAT to capture
        // (screen + state + locator-based annotations) and carry no src or
        // coordinates. The capture worker publishes client/src/sop/screenshots.json
        // keyed by "<guideId>/<stepId>/<viewport>", so viewports must be
        // unique within a step.
        const viewports = new Set();
        step.screenshots.forEach((screenshot, shotIndex) => {
          const shotLabel = `${label}.screenshots[${shotIndex}]`;
          if (!isPlainObject(screenshot)) return fail(`${shotLabel} must be an object`);
          if (!SCREENSHOT_VIEWPORTS.includes(screenshot.viewport)) {
            fail(`${shotLabel}.viewport must be one of ${SCREENSHOT_VIEWPORTS.join(', ')}`);
          } else if (viewports.has(screenshot.viewport)) {
            fail(`${shotLabel}.viewport "${screenshot.viewport}" is duplicated (sidecar key is guideId/stepId/viewport)`);
          } else {
            viewports.add(screenshot.viewport);
          }
          if (screenshot.src != null) {
            fail(`${shotLabel}.src must not be set in the guide file; capture output lives in screenshots.json`);
          }
          if (!isNonEmptyString(screenshot.screen)) fail(`${shotLabel}.screen must be a non-empty string`);
          if (!isNonEmptyString(screenshot.state)) fail(`${shotLabel}.state must be a non-empty string`);
          if (!isNonEmptyString(screenshot.alt)) fail(`${shotLabel}.alt must be a non-empty string`);
          if (screenshot.caption != null && !isNonEmptyString(screenshot.caption)) {
            fail(`${shotLabel}.caption must be a non-empty string when present`);
          }
          if (screenshot.annotations != null) {
            if (!Array.isArray(screenshot.annotations)) {
              fail(`${shotLabel}.annotations must be an array`);
            } else {
              const annotationNumbers = new Set();
              screenshot.annotations.forEach((annotation, annotationIndex) => {
                const annotationLabel = `${shotLabel}.annotations[${annotationIndex}]`;
                if (!isPlainObject(annotation)) return fail(`${annotationLabel} must be an object`);
                if (!Number.isInteger(annotation.n) || annotation.n < 1) {
                  fail(`${annotationLabel}.n must be a positive integer`);
                } else if (annotationNumbers.has(annotation.n)) {
                  fail(`${annotationLabel}.n "${annotation.n}" is duplicated`);
                } else {
                  annotationNumbers.add(annotation.n);
                }
                if (!isNonEmptyString(annotation.label)) fail(`${annotationLabel}.label must be a non-empty string`);
                if (!isNonEmptyString(annotation.locator)) fail(`${annotationLabel}.locator must be a non-empty string`);
              });
            }
          }
        });
      }
    });
  }

  // --- outcome / recovery / support ----------------------------------------
  if (!isNonEmptyString(guide.confirmOutcome)) {
    fail(`${guideLabel}: confirmOutcome must be a non-empty string`);
  }

  if (!Array.isArray(guide.recovery)) {
    fail(`${guideLabel}: recovery must be an array`);
  } else {
    guide.recovery.forEach((entry, index) => {
      const label = `${guideLabel}: recovery[${index}]`;
      if (!isPlainObject(entry)) return fail(`${label} must be an object`);
      if (!isNonEmptyString(entry.problem)) fail(`${label}.problem must be a non-empty string`);
      if (!isNonEmptyString(entry.solution)) fail(`${label}.solution must be a non-empty string`);
    });
  }

  if (!isNonEmptyString(guide.supportContact)) {
    fail(`${guideLabel}: supportContact must be a non-empty string`);
  }

  // --- links ---------------------------------------------------------------
  if (!Array.isArray(guide.relatedGuides)) {
    fail(`${guideLabel}: relatedGuides must be an array`);
  } else {
    guide.relatedGuides.forEach((relatedId, index) => {
      if (!isNonEmptyString(relatedId)) {
        fail(`${guideLabel}: relatedGuides[${index}] must be a non-empty string`);
      } else if (relatedId === guide.id) {
        fail(`${guideLabel}: relatedGuides[${index}] must not reference the guide itself`);
      } else if (guides.length > 0 && !guideIds.has(relatedId)) {
        fail(`${guideLabel}: relatedGuides[${index}] "${relatedId}" does not resolve to a known guide`);
      }
    });
  }

  if (!Array.isArray(guide.siteLinks)) {
    fail(`${guideLabel}: siteLinks must be an array`);
  } else {
    guide.siteLinks.forEach((link, index) => {
      const label = `${guideLabel}: siteLinks[${index}]`;
      if (!isPlainObject(link)) return fail(`${label} must be an object`);
      if (!isNonEmptyString(link.label)) fail(`${label}.label must be a non-empty string`);
      if (!isNonEmptyString(link.href)) fail(`${label}.href must be a non-empty string`);
    });
  }

  // --- sources -------------------------------------------------------------
  if (!Array.isArray(guide.sources) || guide.sources.length === 0) {
    fail(`${guideLabel}: sources must be a non-empty array`);
  } else {
    guide.sources.forEach((source, index) => {
      const label = `${guideLabel}: sources[${index}]`;
      if (!isPlainObject(source)) return fail(`${label} must be an object`);
      if (!SOURCE_TYPES.includes(source.type)) {
        fail(`${label}.type must be one of ${SOURCE_TYPES.join(', ')}`);
      }
      if (!isNonEmptyString(source.ref)) fail(`${label}.ref must be a non-empty string`);
    });
  }

  return errors;
}

/**
 * Validate the screenshot sidecar published by the capture worker at
 * client/src/sop/screenshots.json.
 *
 * Shape: { "<guideId>/<stepId>/<viewport>": { src, width?, height?, alt,
 *   caption?, annotations: [{ n, x, y, label }] } }
 *
 * @param {object} sidecar - parsed screenshots.json content.
 * @param {object} [options]
 * @param {Array<object>} [options.guides=[]] - when provided, every sidecar
 *   key must match a real guide step screenshot target.
 * @returns {string[]} errors; empty when valid.
 */
export function validateScreenshotSidecar(sidecar, { guides = [] } = {}) {
  const errors = [];
  if (!isPlainObject(sidecar)) return ['screenshot sidecar must be a plain object'];

  const keyPattern = /^([a-z0-9]+(-[a-z0-9]+)*)\/([a-z0-9]+(-[a-z0-9]+)*)\/(desktop|mobile)$/;
  const targets = new Set();
  for (const guide of guides) {
    for (const step of guide.steps || []) {
      for (const screenshot of step.screenshots || []) {
        targets.add(`${guide.id}/${step.id}/${screenshot.viewport}`);
      }
    }
  }

  for (const [key, record] of Object.entries(sidecar)) {
    const label = `screenshots.json[${JSON.stringify(key)}]`;
    if (!keyPattern.test(key)) {
      errors.push(`${label}: key must look like <guideId>/<stepId>/<desktop|mobile>`);
      continue;
    }
    if (!isPlainObject(record)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (!isNonEmptyString(record.src)) errors.push(`${label}.src must be a non-empty string`);
    for (const dimension of ['width', 'height']) {
      const value = record[dimension];
      if (value != null && (!Number.isFinite(value) || value <= 0)) {
        errors.push(`${label}.${dimension} must be a positive number when present`);
      }
    }
    if (!isNonEmptyString(record.alt)) errors.push(`${label}.alt must be a non-empty string`);
    if (record.caption != null && !isNonEmptyString(record.caption)) {
      errors.push(`${label}.caption must be a non-empty string when present`);
    }
    if (!Array.isArray(record.annotations)) {
      errors.push(`${label}.annotations must be an array`);
    } else {
      const numbers = new Set();
      record.annotations.forEach((annotation, index) => {
        const annotationLabel = `${label}.annotations[${index}]`;
        if (!isPlainObject(annotation)) {
          errors.push(`${annotationLabel} must be an object`);
          return;
        }
        if (!Number.isInteger(annotation.n) || annotation.n < 1) {
          errors.push(`${annotationLabel}.n must be a positive integer`);
        } else if (numbers.has(annotation.n)) {
          errors.push(`${annotationLabel}.n "${annotation.n}" is duplicated`);
        } else {
          numbers.add(annotation.n);
        }
        for (const axis of ['x', 'y']) {
          const value = annotation[axis];
          if (typeof value !== 'number' || value < 0 || value > 100) {
            errors.push(`${annotationLabel}.${axis} must be a percentage number between 0 and 100`);
          }
        }
        if (!isNonEmptyString(annotation.label)) errors.push(`${annotationLabel}.label must be a non-empty string`);
      });
    }
    if (guides.length > 0 && !targets.has(key)) {
      errors.push(`${label} does not match any guide step screenshot target`);
    }
  }
  return errors;
}

/**
 * Validate a handbook record.
 *
 * @param {object} handbook
 * @returns {string[]} errors; empty when valid.
 */
export function validateHandbook(handbook) {
  const errors = [];
  if (!isPlainObject(handbook)) return ['handbook must be a plain object'];
  const label = handbook.role || '(unknown handbook)';
  if (!HANDBOOK_ROLES.includes(handbook.role)) {
    errors.push(`${label}: role must be one of ${HANDBOOK_ROLES.join(', ')}`);
  }
  if (!isNonEmptyString(handbook.title)) errors.push(`${label}: title must be a non-empty string`);
  if (!Array.isArray(handbook.guideIds)) {
    errors.push(`${label}: guideIds must be an array`);
  } else {
    const seen = new Set();
    handbook.guideIds.forEach((guideId, index) => {
      if (!isNonEmptyString(guideId)) {
        errors.push(`${label}: guideIds[${index}] must be a non-empty string`);
      } else if (seen.has(guideId)) {
        errors.push(`${label}: guideIds[${index}] "${guideId}" is duplicated`);
      } else {
        seen.add(guideId);
      }
    });
  }
  return errors;
}
