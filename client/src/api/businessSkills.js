import api from './axios';

// List business's required skills
export async function listBusinessSkills(businessId, { page = 1, limit = 50 } = {}) {
  const response = await api.get(`/businesses/${businessId}/skills`, {
    params: { page, limit },
  });
  return response.data;
}

// Add skill to business
export async function addBusinessSkill(businessId, { skillId, isRequired = true, minYearsExperience } = {}) {
  const response = await api.post(`/businesses/${businessId}/skills`, {
    skillId,
    isRequired,
    minYearsExperience,
  });
  return response.data;
}

// Update business skill requirement
export async function updateBusinessSkill(businessId, skillId, { isRequired, minYearsExperience } = {}) {
  const response = await api.put(`/businesses/${businessId}/skills/${skillId}`, {
    isRequired,
    minYearsExperience,
  });
  return response.data;
}

// Remove skill from business
export async function removeBusinessSkill(businessId, skillId) {
  const response = await api.delete(`/businesses/${businessId}/skills/${skillId}`);
  return response.data;
}

// Search available skills for business (for autocomplete)
export async function searchSkillsForBusiness(businessId, { q = '', limit = 20 } = {}) {
  const response = await api.get(`/businesses/${businessId}/skills/search`, {
    params: { q, limit },
  });
  return response.data;
}
