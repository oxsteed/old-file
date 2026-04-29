import { useState } from 'react';
import { Send } from 'lucide-react';

export default function TicketCreationModal({ onClose, onSubmit }) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: 'general',
    priority: 'normal',
    email: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.title.trim()) {
      setError('Title is required');
      return;
    }
    if (!formData.description.trim()) {
      setError('Description is required');
      return;
    }

    setLoading(true);
    try {
      await onSubmit(formData);
    } catch (err) {
      setError(err.message || 'Failed to create ticket');
    }
    setLoading(false);
  };

  return (
    <div className="widget-modal-overlay">
      <div className="widget-modal-content">
        <h3 className="widget-modal-title">Create Support Ticket</h3>

        <form onSubmit={handleSubmit} className="widget-form">
          <div className="widget-form-group">
            <label htmlFor="title" className="widget-label">Subject *</label>
            <input
              id="title"
              type="text"
              name="title"
              value={formData.title}
              onChange={handleChange}
              placeholder="What do you need help with?"
              maxLength={100}
              className="widget-input"
              required
            />
            <span className="widget-char-count">{formData.title.length}/100</span>
          </div>

          <div className="widget-form-group">
            <label htmlFor="description" className="widget-label">Description *</label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Please provide details about your issue..."
              maxLength={1000}
              rows={4}
              className="widget-input widget-textarea"
              required
            />
            <span className="widget-char-count">{formData.description.length}/1000</span>
          </div>

          <div className="widget-form-row">
            <div className="widget-form-group">
              <label htmlFor="category" className="widget-label">Category</label>
              <select
                id="category"
                name="category"
                value={formData.category}
                onChange={handleChange}
                className="widget-input"
              >
                <option value="general">General</option>
                <option value="billing">Billing</option>
                <option value="technical">Technical</option>
                <option value="account">Account</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="widget-form-group">
              <label htmlFor="priority" className="widget-label">Priority</label>
              <select
                id="priority"
                name="priority"
                value={formData.priority}
                onChange={handleChange}
                className="widget-input"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div className="widget-form-group">
            <label htmlFor="email" className="widget-label">Email (optional)</label>
            <input
              id="email"
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="your@email.com"
              className="widget-input"
            />
          </div>

          {error && <div className="widget-error-message">{error}</div>}

          <div className="widget-modal-actions">
            <button
              type="button"
              onClick={onClose}
              className="widget-button secondary"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="widget-button primary"
              disabled={loading}
            >
              {loading ? (
                <span>Creating...</span>
              ) : (
                <>
                  <Send size={16} />
                  Create Ticket
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
