# Business Hub Integration Guide

**Updated**: May 15, 2026  
**Status**: Ready for Integration

---

## Quick Start

### 1. Update Main Business Hub Page

Replace or extend `client/src/pages/BusinessHubPage.jsx` to use the new `BusinessHubComplete` component:

```jsx
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { BusinessHubComplete } from '../components/businessHub/BusinessHubComplete';
import { PageMeta } from '../components/PageMeta';

export function BusinessHubPage() {
  const { businessId } = useParams();

  return (
    <>
      <PageMeta 
        title="Business Hub" 
        description="Manage your business, services, and customers"
      />
      <BusinessHubComplete businessId={businessId} />
    </>
  );
}
```

### 2. Routing Setup

Add route to `client/src/App.jsx`:

```jsx
import { BusinessHubPage } from './pages/BusinessHubPage';

// In your routes:
<Route 
  path="/business/:businessId/hub" 
  element={<BusinessHubPage />} 
/>
```

### 3. Navigation Link

Add to navbar or business dashboard:

```jsx
<Link to={`/business/${businessId}/hub`} className="nav-link">
  Business Hub
</Link>
```

---

## Component Imports

### For Direct Component Usage

If you want to use individual components outside the hub:

```jsx
// Import components
import { PricingRulesManager } from './components/businessHub/PricingRulesManager';
import { BusinessAnalyticsTab } from './components/businessHub/BusinessAnalyticsTab';
import { CustomerLoyaltyManager } from './components/businessHub/CustomerLoyaltyManager';
import { BusinessIntegrations } from './components/businessHub/BusinessIntegrations';
import { AppointmentCalendarView } from './components/businessHub/AppointmentCalendarView';
import { BusinessServicesTab } from './components/businessHub/BusinessServicesTab';

// Use individually
export function CustomDashboard({ businessId }) {
  return (
    <div>
      <PricingRulesManager businessId={businessId} />
      <BusinessAnalyticsTab businessId={businessId} />
    </div>
  );
}
```

---

## CSS Integration

### Option A: Import in Component Files
CSS is already imported at the top of each component:

```jsx
import '../../styles/PricingRulesManager.css';
import '../../styles/BusinessAnalyticsTab.css';
// etc...
```

### Option B: Global Stylesheet
Create `client/src/styles/businessHub.css` and import all:

```css
/* Combined Business Hub Styles */
@import './PricingRulesManager.css';
@import './BusinessAnalyticsTab.css';
@import './CustomerLoyaltyManager.css';
@import './BusinessIntegrations.css';
@import './BusinessHubComplete.css';
@import './AppointmentCalendarView.css';
```

Then import once in your main app:
```jsx
import './styles/businessHub.css';
```

---

## API Endpoint Implementation

### Checklist for Backend Team

Each component requires specific endpoints. Implement in order of priority:

#### Priority 1: Core Services & Appointments
- [ ] `GET /api/businesses/{businessId}/services`
- [ ] `POST /api/businesses/{businessId}/services`
- [ ] `PUT /api/businesses/{businessId}/services/{serviceId}`
- [ ] `DELETE /api/businesses/{businessId}/services/{serviceId}`
- [ ] `GET /api/businesses/{businessId}/appointments`
- [ ] `PUT /api/businesses/{businessId}/appointments/{appointmentId}/status`

#### Priority 2: Pricing Rules
- [ ] `GET /api/businesses/{businessId}/pricing-rules`
- [ ] `POST /api/businesses/{businessId}/pricing-rules`
- [ ] `PUT /api/businesses/{businessId}/pricing-rules/{ruleId}`
- [ ] `DELETE /api/businesses/{businessId}/pricing-rules/{ruleId}`
- [ ] `POST /api/businesses/{businessId}/pricing/calculate` (for price calculation)

#### Priority 3: Analytics
- [ ] `GET /api/businesses/{businessId}/analytics?range=30d`
- [ ] `GET /api/businesses/{businessId}/analytics/export?format=csv`

#### Priority 4: Loyalty
- [ ] `GET /api/businesses/{businessId}/loyalty-tiers`
- [ ] `POST /api/businesses/{businessId}/loyalty-tiers`
- [ ] `PUT /api/businesses/{businessId}/loyalty-tiers/{tierId}`
- [ ] `DELETE /api/businesses/{businessId}/loyalty-tiers/{tierId}`
- [ ] `GET /api/businesses/{businessId}/loyalty/tier/{tierId}/customers`

#### Priority 5: Integrations
- [ ] `GET /api/businesses/{businessId}/integrations`
- [ ] `POST /api/businesses/{businessId}/integrations/stripe/auth`
- [ ] `POST /api/businesses/{businessId}/integrations/stripe/disconnect`
- [ ] `GET /api/businesses/{businessId}/webhooks`
- [ ] `POST /api/businesses/{businessId}/webhooks`
- [ ] `DELETE /api/businesses/{businessId}/webhooks/{webhookId}`

---

## Response Format Examples

### Pricing Rules Response
```json
GET /api/businesses/{businessId}/pricing-rules

[
  {
    "id": "rule-123",
    "type": "time_based",
    "name": "Weekend Premium",
    "description": "Higher prices on weekends",
    "priority": 1,
    "is_active": true,
    "conditions": {
      "peak_hours": "18:00-22:00"
    },
    "multiplier": 1.5,
    "discount_percent": 0,
    "fixed_price": 0
  }
]
```

### Analytics Response
```json
GET /api/businesses/{businessId}/analytics?range=30d

{
  "totalRevenue": 50000,
  "revenueChange": 12,
  "appointmentCount": 45,
  "completedAppointments": 40,
  "customerCount": 32,
  "newCustomers": 8,
  "averageRating": 4.7,
  "reviewCount": 28,
  "revenueTrend": [
    { "date": "2026-04-15", "revenue": 1500 },
    { "date": "2026-04-16", "revenue": 1750 }
  ],
  "appointmentsByStatus": [
    { "name": "Confirmed", "count": 35 },
    { "name": "Completed", "count": 40 }
  ],
  "serviceMetrics": [
    { "serviceName": "Haircut", "bookings": 20, "revenue": 15000 },
    { "serviceName": "Color", "bookings": 15, "revenue": 20000 }
  ],
  "insights": [
    {
      "message": "Revenue up 12% this month - great growth!",
      "type": "positive"
    }
  ]
}
```

### Loyalty Tiers Response
```json
GET /api/businesses/{businessId}/loyalty-tiers

[
  {
    "id": "tier-bronze",
    "tier_name": "bronze",
    "discount_percent": 5,
    "min_points": 0,
    "benefits": ["5% discount on services", "Priority support"],
    "customer_count": 45
  },
  {
    "id": "tier-silver",
    "tier_name": "silver",
    "discount_percent": 10,
    "min_points": 500,
    "benefits": ["10% discount on services", "Early booking access"],
    "customer_count": 12
  }
]
```

### Webhooks Response
```json
GET /api/businesses/{businessId}/webhooks

[
  {
    "id": "hook-123",
    "url": "https://your-api.example.com/webhooks",
    "events": ["appointment.created", "payment.received"],
    "is_active": true,
    "last_delivery_at": "2026-05-15T10:30:00Z"
  }
]
```

---

## Error Handling

All components include built-in error handling with toast notifications. Ensure API errors follow this format:

```json
{
  "success": false,
  "error": "Error message here",
  "code": "ERROR_CODE"
}
```

Components will automatically display via `react-hot-toast`:
```jsx
toast.error('Error message');
toast.success('Success message');
```

---

## State Management

Each component manages its own state using React hooks:

```jsx
const [rules, setRules] = useState([]);
const [loading, setLoading] = useState(false);
const [showForm, setShowForm] = useState(false);
```

No Redux or Context API required. Each component loads data independently via API calls.

---

## Customization Guide

### Changing Colors
All components use CSS variables. Update in `client/src/index.css`:

```css
:root {
  --brand-500: #f97316;        /* Primary orange */
  --brand-600: #ea580c;        /* Darker orange */
  --app-bg: #1a1a1a;           /* Background */
  --card-bg: #2a2a2a;          /* Card background */
  --border-color: #404040;     /* Border color */
}
```

### Modifying Tab Layout
Edit `BusinessHubComplete.jsx` to add/remove tabs:

```jsx
const TABS = [
  { id: 'overview', name: 'Overview', icon: BarChart3 },
  { id: 'services', name: 'Services', icon: Package },
  // Add new tab:
  { id: 'custom', name: 'Custom Tab', icon: CustomIcon },
];

// Then add condition in render:
{activeTab === 'custom' && <CustomComponent businessId={businessId} />}
```

### Adjusting Grid Layouts
Most components use CSS Grid. Update in respective CSS files:

```css
.grid {
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem;
}
```

---

## Dependencies

All components use existing OxSteed dependencies:

```json
{
  "react": "^18.x",
  "react-router-dom": "^6.x",
  "axios": "^1.x",
  "react-hot-toast": "^2.x",
  "lucide-react": "^0.x",
  "recharts": "^2.x"
}
```

No new dependencies required.

---

## Testing Guide

### Manual Testing Checklist

```
[ ] Navigation
  [ ] All 7 tabs load without errors
  [ ] Tab switching is smooth
  [ ] Mobile tabs show icons only
  
[ ] Pricing Rules
  [ ] Create rule with each strategy type
  [ ] Edit existing rule
  [ ] Delete rule with confirmation
  [ ] Priority ordering works
  
[ ] Analytics
  [ ] Date range selector changes data
  [ ] Charts render properly
  [ ] No console errors
  
[ ] Loyalty Tiers
  [ ] Create tier
  [ ] View customers in tier
  [ ] Edit tier benefits
  
[ ] Integrations
  [ ] Stripe OAuth flow works
  [ ] Webhooks can be added/deleted
  [ ] Copy-to-clipboard functions
  
[ ] Responsive Design
  [ ] Mobile view (< 768px) works
  [ ] Tablet view (768-1024px) works
  [ ] Desktop view (> 1024px) works
  
[ ] Dark Mode
  [ ] All colors properly visible
  [ ] Contrast meets WCAG AA
  [ ] No broken images/icons
```

### API Testing Commands

```bash
# Test Pricing Rules endpoint
curl -X GET http://localhost:5000/api/businesses/{businessId}/pricing-rules \
  -H "Authorization: Bearer {token}"

# Test Analytics endpoint
curl -X GET "http://localhost:5000/api/businesses/{businessId}/analytics?range=30d" \
  -H "Authorization: Bearer {token}"

# Test Loyalty endpoint
curl -X GET http://localhost:5000/api/businesses/{businessId}/loyalty-tiers \
  -H "Authorization: Bearer {token}"
```

---

## Performance Optimization Tips

1. **Lazy Load Charts**: Only render Recharts on tab activation
2. **API Caching**: Cache analytics data for 5 minutes
3. **Pagination**: Add pagination to customer lists if > 100
4. **Webhook Batching**: Batch webhook deliveries every 5 minutes
5. **Image Optimization**: Use WebP for business logos

---

## Troubleshooting

### Issue: Components don't load
**Solution**: Ensure all CSS files are imported
```jsx
import '../../styles/PricingRulesManager.css';
```

### Issue: API returns 404
**Solution**: Check endpoint is implemented in backend
```javascript
// Verify endpoint exists and returns correct format
GET /api/businesses/{businessId}/pricing-rules
```

### Issue: Dark mode looks broken
**Solution**: Verify CSS variables are defined
```css
:root {
  --app-bg: #1a1a1a;
  --card-bg: #2a2a2a;
}
```

### Issue: Charts not displaying
**Solution**: Ensure Recharts is installed
```bash
npm install recharts
```

---

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

CSS Grid and modern JavaScript features required.

---

## Accessibility

All components include:
- ✅ Semantic HTML (`<button>`, `<label>`, `<form>`)
- ✅ ARIA labels (`aria-label`, `aria-required`)
- ✅ Keyboard navigation (Tab, Enter, Escape)
- ✅ Color contrast (WCAG AA)
- ✅ Form validation messages
- ✅ Focus indicators

---

## Next Steps

1. **Implement API endpoints** in priority order (see checklist above)
2. **Test each component** with mock/real data
3. **Integrate into main app** via `BusinessHubPage`
4. **Update user navigation** to link to `/business/{businessId}/hub`
5. **Monitor performance** and optimize as needed

---

## Support

For issues or questions about component integration:
1. Check this guide's Troubleshooting section
2. Review component source code comments
3. Check browser console for errors
4. Verify API responses match expected format

