import api from './axios';

export const consultingActionItemsApi = {
  // Get action items for a session
  getSessionActionItems: (sessionId) => {
    return api.get(`/consulting/sessions/${sessionId}/action-items`);
  },

  // Create action item
  createActionItem: (sessionId, payload) => {
    return api.post(`/consulting/sessions/${sessionId}/action-items`, {
      title: payload.title,
      description: payload.description,
      dueDate: payload.dueDate,
      priority: payload.priority,
      assignedToType: payload.assignedToType,
      clientVisible: payload.clientVisible
    });
  },

  // Update action item
  updateActionItem: (sessionId, itemId, payload) => {
    return api.put(`/consulting/sessions/${sessionId}/action-items/${itemId}`, payload);
  },

  // Delete action item
  deleteActionItem: (sessionId, itemId) => {
    return api.delete(`/consulting/sessions/${sessionId}/action-items/${itemId}`);
  },

  // Mark action item as complete
  completeActionItem: (sessionId, itemId) => {
    return api.patch(`/consulting/sessions/${sessionId}/action-items/${itemId}/complete`);
  },
};

export default consultingActionItemsApi;
