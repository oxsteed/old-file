// Admin API client — re-exports the main configured axios instance.
// The instance already has baseURL='/api', JWT auth interceptors, and
// auto-refresh logic, so all admin calls go through the same pipeline.
export { default } from '../../api/axios';
