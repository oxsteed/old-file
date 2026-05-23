import api from './axios';

const ROOT = '/internal/workspaces';

export async function getInternalWorkspaceCatalog() {
  const { data } = await api.get(`${ROOT}/catalog`);
  return data.data;
}

export async function getInternalWorkspaceDashboard(workspace, params = {}) {
  const { data } = await api.get(`${ROOT}/${workspace}`, { params });
  return data.data;
}
