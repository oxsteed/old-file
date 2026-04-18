# Remaining Phases Implementation Guide

Phases 2-5 for completing the codebase enhancement initiative.

---

## Phase 2: Frontend Component Refactoring

**Objective**: Reduce re-renders and bundle size by breaking monolithic components into smaller, memoized sub-components.

### Why Memoization Matters

Currently, when any state changes in Dashboard, the entire component re-renders including all tabs, sections, and modals. React.memo() allows child components to skip re-render if their props haven't changed.

**Impact**: Estimated 40-60% reduction in render cycles on pages with multiple sections.

### Components to Refactor (Priority Order)

#### 1. Dashboard.jsx (2000+ LOC) → Dashboard/*
```
client/src/pages/Dashboard/
├── Dashboard.jsx (orchestrator, <100 LOC)
├── MoneySection.jsx (memoized, 300 LOC)
├── GoalsSection.jsx (memoized, 200 LOC)
├── PersonalCareSection.jsx (memoized, 250 LOC)
├── CarCareSection.jsx (memoized, 250 LOC)
├── PlannedNeedsSection.jsx (memoized, 150 LOC)
├── modals/
│   ├── AddMoneyModal.jsx
│   ├── AddGoalModal.jsx
│   ├── AddPersonalCareModal.jsx
│   ├── AddCarCareModal.jsx
│   └── AddPlannedNeedModal.jsx
└── utils.js (formatters, memoizable constants)
```

**Memoization Pattern**:
```javascript
const MoneySection = React.memo(
  ({ expenses, onAdd, onEdit, onDelete, loading }) => {
    // Component logic
    return <div>...</div>;
  },
  (prevProps, nextProps) => {
    // Shallow comparison
    return (
      prevProps.expenses === nextProps.expenses &&
      prevProps.loading === nextProps.loading
    );
  }
);
```

#### 2. HelperDashboard.jsx (1600+ LOC) → HelperDashboard/*
```
client/src/pages/HelperDashboard/
├── HelperDashboard.jsx (orchestrator)
├── JobsTab.jsx (memoized)
├── BidsTab.jsx (memoized)
├── ToolsTab.jsx (memoized)
├── SkillsTab.jsx (memoized)
├── CarCareTab.jsx (memoized)
├── ProductsTab.jsx (memoized)
└── modals/
    ├── AddJobModal.jsx
    ├── AddToolModal.jsx
    ├── AddSkillModal.jsx
    └── AddProductModal.jsx
```

#### 3. BusinessHubPage.jsx (2000+ LOC) → BusinessHubPage/*
```
client/src/pages/BusinessHubPage/
├── BusinessHubPage.jsx (orchestrator)
├── OverviewTab.jsx (memoized)
├── InvoicesTab.jsx (memoized)
├── TaxTab.jsx (memoized)
├── GoalsTab.jsx (memoized)
├── TeamTab.jsx (memoized)
├── ProfileTab.jsx (memoized)
└── modals/ (invoice, goal, member invite modals)
```

#### 4. JobDetailPage.jsx → JobDetailPage/*
```
client/src/pages/JobDetailPage/
├── JobDetailPage.jsx (main layout)
├── JobDescription.jsx (memoized)
├── BidsList.jsx (memoized, uses React.memo on BidCard)
├── BidCard.jsx (memoized, one per bid)
├── JobActions.jsx (memoized, owner-only actions)
└── ReviewSection.jsx (memoized)
```

### Implementation Checklist

- [ ] Extract MoneySection from Dashboard
- [ ] Extract GoalsSection from Dashboard
- [ ] Extract PersonalCareSection from Dashboard
- [ ] Extract CarCareSection from Dashboard
- [ ] Extract PlannedNeedsSection from Dashboard
- [ ] Extract modals into separate files
- [ ] Add React.memo to each section
- [ ] Verify no regressions in Dashboard
- [ ] Repeat for HelperDashboard
- [ ] Repeat for BusinessHubPage
- [ ] Repeat for JobDetailPage
- [ ] Run test suite: `npm test`
- [ ] Check bundle size: `vite build --report`

### Expected Outcomes

- Dashboard render time: ~500ms → ~200ms (60% improvement)
- HelperDashboard render time: ~400ms → ~150ms
- BusinessHubPage render time: ~600ms → ~250ms
- Bundle size: Minimal (refactoring, not new code)
- User experience: Smoother tab switching, faster interactions

---

## Phase 3: Query Performance Testing in CI

**Objective**: Prevent performance regressions by tracking query execution times in the test suite.

### Files to Create/Modify

#### 1. New Test File: `server/__tests__/queryPerformance.test.js`

```javascript
describe('Query Performance Baselines', () => {
  describe('Single-Record Lookups (<50ms)', () => {
    test('getJob by ID completes in <50ms', async () => {
      const start = Date.now();
      const result = await db.query('SELECT * FROM jobs WHERE id = $1', [testJobId]);
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(50);
      expect(result.rows.length).toBe(1);
    });

    test('getUser by ID completes in <50ms', async () => {
      const start = Date.now();
      const result = await db.query('SELECT * FROM users WHERE id = $1', [testUserId]);
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(50);
    });
  });

  describe('List Queries (<100ms)', () => {
    test('getJobs list (10 results) completes in <100ms', async () => {
      const start = Date.now();
      const result = await db.query('SELECT * FROM jobs LIMIT 10');
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });

    test('getConversations LATERAL join completes in <100ms', async () => {
      const start = Date.now();
      const result = await db.query(`
        SELECT c.*, m.content as last_message 
        FROM conversations c
        LEFT JOIN LATERAL (
          SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
        ) m ON true
        WHERE c.customer_id = $1 OR c.helper_id = $1
        LIMIT 20
      `, [testUserId]);
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });
  });

  describe('Aggregate Queries (<200ms)', () => {
    test('getDashboardSummary aggregates complete in <200ms', async () => {
      const start = Date.now();
      // Test all dashboard aggregate queries in parallel
      const [summary, pulse, stats] = await Promise.all([
        db.query('SELECT COUNT(*) as job_count FROM jobs WHERE client_id = $1', [testUserId]),
        db.query('SELECT SUM(amount) as total FROM payments WHERE payer_id = $1', [testUserId]),
        db.query('SELECT * FROM dashboard_cache WHERE user_id = $1', [testUserId]),
      ]);
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(200);
    });
  });

  describe('Complex Queries with Joins (<300ms)', () => {
    test('getJobPayment with nested joins completes in <300ms', async () => {
      const start = Date.now();
      const result = await db.query(`
        SELECT p.*, j.title, u.first_name, u.email
        FROM payments p
        JOIN jobs j ON j.id = p.job_id
        JOIN users u ON u.id = p.payee_id
        WHERE p.job_id = $1
      `, [testJobId]);
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(300);
    });
  });
});
```

#### 2. EXPLAIN ANALYZE Test Harness: `server/__tests__/queryPlans.test.js`

```javascript
describe('Query Plan Analysis (Index Usage)', () => {
  test('getConversations should use index on (customer_id, helper_id)', async () => {
    const result = await db.query(`
      EXPLAIN ANALYZE
      SELECT * FROM conversations WHERE customer_id = $1 OR helper_id = $1
    `, [testUserId]);
    
    const planText = result.rows.map(r => r['QUERY PLAN']).join('\n');
    expect(planText).toContain('Index Scan');
    expect(planText).not.toContain('Seq Scan on conversations');
  });

  test('getJobs with filters should not do sequential scan', async () => {
    const result = await db.query(`
      EXPLAIN ANALYZE
      SELECT * FROM jobs WHERE status = $1 AND client_id = $2 LIMIT 20
    `, ['active', testUserId]);
    
    const planText = result.rows.map(r => r['QUERY PLAN']).join('\n');
    expect(planText).not.toContain('Seq Scan');
  });

  test('getDashboardSummary should use hash agg for GROUP BY', async () => {
    const result = await db.query(`
      EXPLAIN ANALYZE
      SELECT category, COUNT(*) as count, SUM(amount) as total
      FROM expenses
      WHERE user_id = $1
      GROUP BY category
    `, [testUserId]);
    
    const planText = result.rows.map(r => r['QUERY PLAN']).join('\n');
    expect(planText).toContain('HashAggregate');
  });
});
```

#### 3. Update `package.json` scripts

```json
{
  "scripts": {
    "test": "jest",
    "test:perf": "jest --testPathPattern=queryPerformance",
    "test:plans": "jest --testPathPattern=queryPlans",
    "test:all": "jest && npm run test:perf && npm run test:plans"
  }
}
```

#### 4. GitHub Actions Workflow Addition

Add to `.github/workflows/test.yml`:

```yaml
- name: Run query performance tests
  run: cd server && npm run test:perf
  continue-on-error: true

- name: Run query plan analysis
  run: cd server && npm run test:plans
  continue-on-error: true

- name: Upload performance baseline
  uses: actions/upload-artifact@v3
  with:
    name: performance-baseline
    path: server/performance-baseline.json
```

### Baseline Thresholds

| Query Type | Threshold | Example |
|-----------|-----------|---------|
| Single record lookup | < 50ms | `SELECT * FROM users WHERE id = ?` |
| List queries (10-100 items) | < 100ms | `SELECT * FROM jobs LIMIT 20` |
| Aggregates (sums, counts) | < 200ms | `SELECT COUNT(*), SUM() FROM ...` |
| Complex joins | < 300ms | 4+ table JOIN with WHERE clauses |

### Implementation Steps

1. Create `server/__tests__/queryPerformance.test.js` with baseline tests
2. Create `server/__tests__/queryPlans.test.js` with EXPLAIN ANALYZE tests
3. Run baseline: `npm run test:perf` (should all pass)
4. Add to GitHub Actions workflow
5. Future: If a query regression is detected, the test fails and alerts the developer
6. Run full test suite: `npm test` (all 82 tests + perf tests)

---

## Phase 4: Multi-Business UI Context

**Objective**: Surface business context in customer-facing views so they know which business/representative they're interacting with.

### Components to Update

#### 1. Create BusinessContext

File: `client/src/context/BusinessContext.jsx`

```javascript
import React, { createContext, useCallback, useState } from 'react';

export const BusinessContext = createContext(null);

export function BusinessContextProvider({ children }) {
  const [selectedBusinessId, setSelectedBusinessId] = useState(() => 
    localStorage.getItem('selectedBusinessId') || null
  );

  const handleSelectBusiness = useCallback((businessId) => {
    setSelectedBusinessId(businessId);
    localStorage.setItem('selectedBusinessId', businessId);
  }, []);

  return (
    <BusinessContext.Provider value={{ selectedBusinessId, handleSelectBusiness }}>
      {children}
    </BusinessContext.Provider>
  );
}

export function useBusinessContext() {
  const context = React.useContext(BusinessContext);
  if (!context) throw new Error('useBusinessContext requires BusinessContextProvider');
  return context;
}
```

#### 2. Update App.jsx

Wrap Router with BusinessContextProvider:

```javascript
<Router>
  <BusinessContextProvider>
    <QueryClientProvider client={queryClient}>
      {/* rest of providers */}
    </QueryClientProvider>
  </BusinessContextProvider>
</Router>
```

#### 3. Update MessagesPage.jsx

Display business context in conversation headers:

```javascript
import { useBusinessContext } from '../context/BusinessContext';

export default function MessagesPage() {
  const { selectedBusinessId } = useBusinessContext();

  return (
    // In conversation header:
    {conversation.business_id && (
      <span className="msg-business-badge">
        via {businesses.find(b => b.id === conversation.business_id)?.business_name}
      </span>
    )}
  );
}
```

#### 4. Update ConversationPage.jsx

Show business context in header:

```javascript
// In header:
{conversation?.business_id && (
  <div className="conv-header-business">
    <small>via {businessName}</small>
  </div>
)}
```

#### 5. Update JobDetailPage.jsx

Show business when helper bids from multiple businesses:

```javascript
{currentUserIsHelper && user.helper_profiles?.length > 1 && (
  <div className="bid-form-business">
    <label>Bidding as:</label>
    <select value={selectedBusiness} onChange={e => setSelectedBusiness(e.target.value)}>
      {user.helper_profiles.map(hp => (
        <option key={hp.id} value={hp.id}>{hp.business_name}</option>
      ))}
    </select>
  </div>
)}
```

#### 6. Update NotificationCenter.jsx

Include business context in notifications:

```javascript
{/* Notification item with business context */}
{notification.business_id && (
  <small className="notif-business">via {notification.business_name}</small>
)}
```

### CSS Updates

Add to relevant stylesheets:

```css
.msg-business-badge {
  display: inline-block;
  background: rgba(99, 102, 241, 0.1);
  color: #818cf8;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.85rem;
  margin-left: 0.5rem;
}

.conv-header-business {
  color: var(--muted-text);
  font-size: 0.85rem;
  margin-top: 0.25rem;
}

.bid-form-business {
  background: rgba(99, 102, 241, 0.05);
  padding: 1rem;
  border-radius: 0.5rem;
  margin-bottom: 1rem;
}
```

### Implementation Checklist

- [ ] Create `client/src/context/BusinessContext.jsx`
- [ ] Update `client/src/App.jsx` to wrap with BusinessContextProvider
- [ ] Update MessagesPage conversation headers
- [ ] Update ConversationPage header
- [ ] Update JobDetailPage bid form
- [ ] Update NotificationCenter notifications
- [ ] Add CSS styles for business context badges
- [ ] Test messaging flow with multi-business helper
- [ ] Test notifications display business correctly
- [ ] Verify localStorage persistence across sessions

---

## Phase 5: API Versioning Client Integration

**Objective**: Prepare client for API v2 by implementing version detection and fallback handling.

### Files to Create

#### 1. API Version Utility: `client/src/utils/apiVersion.js`

```javascript
export const API_VERSION = process.env.VITE_API_VERSION || 'v1';

export function getApiVersionHeader() {
  return {
    'API-Version': API_VERSION,
    'X-Client-Version': import.meta.env.VITE_APP_VERSION || '1.0.0',
  };
}

export function parseApiVersionFromResponse(response) {
  return response.headers['api-version'] || 'v1';
}

export function isVersionMismatch(error) {
  return error?.response?.status === 426; // Upgrade Required
}

export function isFallbackRequired(error) {
  // Returns true if client should retry with v1
  return (
    error?.response?.status === 505 || // HTTP Version Not Supported
    error?.message?.includes('API version')
  );
}
```

#### 2. Feature Detection: `client/src/utils/featureDetection.js`

```javascript
import api from '../api/axios';

const FEATURE_FLAGS = {
  'multi-business': 'v2',
  'token-revocation': 'v2',
  'api-versioning': 'v2',
  'payment-escrow': 'v2',
  'query-caching': 'v2',
};

export async function detectServerVersion() {
  try {
    const response = await api.get('/api/health');
    return response.data.api_version || 'v1';
  } catch (error) {
    console.warn('Failed to detect server version, defaulting to v1');
    return 'v1';
  }
}

export async function supportsFeature(featureName) {
  const version = await detectServerVersion();
  const requiredVersion = FEATURE_FLAGS[featureName];
  
  if (!requiredVersion) return true; // Unknown feature, assume supported
  
  return version === requiredVersion || version.startsWith(requiredVersion);
}

export function getFeatureGate(featureName) {
  const requiredVersion = FEATURE_FLAGS[featureName];
  return {
    name: featureName,
    required: requiredVersion,
  };
}
```

#### 3. Axios Interceptor Update: `client/src/api/axios.js`

```javascript
import { API_VERSION, getApiVersionHeader, isVersionMismatch, isFallbackRequired } from '../utils/apiVersion';

// Request interceptor
api.interceptors.request.use((config) => {
  config.headers = { ...config.headers, ...getApiVersionHeader() };
  return config;
});

// Response interceptor
let isRetrying = false;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Don't retry if already retrying
    if (isRetrying) return Promise.reject(error);

    // Handle version mismatch
    if (isVersionMismatch(error)) {
      toast.error('API version mismatch. Please refresh the page.');
      window.location.reload();
      return Promise.reject(error);
    }

    // Handle fallback to v1
    if (isFallbackRequired(error) && API_VERSION === 'v2') {
      console.warn('API v2 failed, falling back to v1');
      isRetrying = true;
      
      try {
        const config = error.config;
        config.headers = { 
          ...config.headers, 
          'API-Version': 'v1' 
        };
        const response = await api.request(config);
        isRetrying = false;
        return response;
      } catch (fallbackError) {
        isRetrying = false;
        return Promise.reject(fallbackError);
      }
    }

    return Promise.reject(error);
  }
);
```

#### 4. App.jsx Integration

```javascript
import { useEffect } from 'react';
import { detectServerVersion } from './utils/featureDetection';

function App() {
  useEffect(() => {
    // Detect server API version on app load
    detectServerVersion().then(version => {
      console.log(`Connected to API ${version}`);
      // Could store in context/state if needed
    });
  }, []);

  // Rest of App...
}
```

#### 5. Environment Variables

Update `.env.example`:

```
# API Versioning
VITE_API_VERSION=v2
VITE_API_FALLBACK_TO_V1=true
VITE_APP_VERSION=2.0.0

# Feature Gates
VITE_FEATURE_MULTI_BUSINESS=true
VITE_FEATURE_TOKEN_REVOCATION=true
VITE_FEATURE_QUERY_CACHING=true
```

### Usage Examples

#### Conditional Feature Usage

```javascript
import { supportsFeature } from '../utils/featureDetection';

export default function PaymentFlow() {
  const [supportsEscrow, setSupportsEscrow] = useState(false);

  useEffect(() => {
    supportsFeature('payment-escrow').then(setSupportsEscrow);
  }, []);

  return supportsEscrow ? <Tier3Payment /> : <Tier1Payment />;
}
```

#### API Version-Specific Routes

```javascript
import { API_VERSION } from '../utils/apiVersion';

const endpoint = API_VERSION === 'v2' 
  ? '/api/v2/jobs' 
  : '/api/jobs';
```

#### Graceful Degradation

```javascript
async function fetchJobsWithFallback() {
  try {
    // Try v2 features first
    return await api.get('/api/jobs', {
      params: { 
        business_id: selectedBiz,
        expand: 'business,helper_profile' 
      }
    });
  } catch (error) {
    if (isFallbackRequired(error)) {
      // Fallback to v1 features
      return await api.get('/api/jobs', { params: { limit: 50 } });
    }
    throw error;
  }
}
```

### Implementation Checklist

- [ ] Create `client/src/utils/apiVersion.js`
- [ ] Create `client/src/utils/featureDetection.js`
- [ ] Update `client/src/api/axios.js` interceptors
- [ ] Add version detection to `App.jsx` on mount
- [ ] Update `.env.example` with version vars
- [ ] Add `API-Version` header to all API requests
- [ ] Test v2 → v1 fallback scenario
- [ ] Test version mismatch handling
- [ ] Add feature gate checks to v2-only features
- [ ] Document API version contract in README

### Testing API Versioning

```javascript
// Test version detection
test('detectServerVersion returns "v2"', async () => {
  const version = await detectServerVersion();
  expect(version).toBe('v2');
});

// Test fallback logic
test('API v2 failure triggers v1 fallback', async () => {
  // Mock v2 endpoint to fail
  // Verify v1 endpoint is called
});

// Test feature gates
test('supportsFeature returns true for v2 features on v2', async () => {
  const supports = await supportsFeature('multi-business');
  expect(supports).toBe(true);
});
```

---

## Summary: Remaining Work

| Phase | Complexity | Estimated Time | Priority |
|-------|-----------|-----------------|----------|
| 1: React Query Integration | High (BusinessHubPage 2000 LOC) | 3-4h | High |
| 2: Component Refactoring | Medium (Breaking into sub-components) | 4-6h | Medium |
| 3: Query Performance Testing | Low (Add test harness) | 2-3h | Medium |
| 4: Multi-Business UI Context | Low (Add context + UI updates) | 2-3h | Low |
| 5: API Versioning Integration | Low (Axios interceptors) | 1-2h | Low |

**Total Estimated Time: 12-18 hours for full completion**

All guidance, patterns, and file structures provided above. Implement in order for maximum efficiency.
