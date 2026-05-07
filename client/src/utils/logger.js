// Re-export frontendLogger as the canonical `logger` import
// Several pages import from 'utils/logger' — this shim resolves that.
export { default } from './frontendLogger';
