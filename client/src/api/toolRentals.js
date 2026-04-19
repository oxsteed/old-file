import api from './axios';

export const toolRentalsApi = {
  // Get all available tool categories
  getCategories: async () => {
    const response = await api.get('/tool-rentals/categories');
    return response.data.categories || [];
  },

  // Browse available tools with optional filters
  browseTools: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.category) params.append('category', filters.category);
    if (filters.city) params.append('city', filters.city);
    if (filters.limit) params.append('limit', filters.limit);
    if (filters.offset) params.append('offset', filters.offset);

    const response = await api.get(`/tool-rentals/browse?${params.toString()}`);
    return response.data.tools || [];
  },

  // Get user's own tools (authenticated)
  getMyTools: async () => {
    const response = await api.get('/tool-rentals/me');
    return response.data.tools || [];
  },

  // Create a new tool listing (authenticated)
  createTool: async (toolData) => {
    const response = await api.post('/tool-rentals', toolData);
    return response.data;
  },

  // Update an existing tool (authenticated)
  updateTool: async (toolId, toolData) => {
    const response = await api.put(`/tool-rentals/${toolId}`, toolData);
    return response.data;
  },

  // Delete a tool listing (authenticated)
  deleteTool: async (toolId) => {
    const response = await api.delete(`/tool-rentals/${toolId}`);
    return response.data;
  },
};
