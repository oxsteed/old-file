# React Query Integration Guide

## Phase 1 Status: Infrastructure Complete, Component Integration Pattern Established

### What's Done
1. ✅ Added `@tanstack/react-query` to `client/package.json`
2. ✅ Created `QueryClient` with sensible defaults in `App.jsx`
3. ✅ Wrapped `<Router>` with `<QueryClientProvider>`
4. ✅ Created comprehensive hook library: `client/src/hooks/useBusinessHub.js`
   - Query key builders for all entities
   - 7 query hooks (businesses, analytics, invoices, tax, goals, team, profile)
   - 14 mutation hooks with automatic query invalidation

### What Remains for Phase 1

**BusinessHubPage Refactoring Pattern:**

#### Before (Current Pattern with useState):
```javascript
const [analytics, setAnalytics] = useState(null);
const [analyticsLoading, setAnalyticsLoading] = useState(false);

const loadOverview = useCallback(async () => {
  if (!bizId) return;
  setAnalyticsLoading(true);
  try { setAnalytics(await getAnalytics(bizId)); }
  catch { toast.error(...); }
  finally { setAnalyticsLoading(false); }
}, [bizId, t]);

useEffect(() => {
  if (tab === 'overview') loadOverview();
}, [bizId, tab, loadOverview]);
```

#### After (React Query Pattern):
```javascript
import { useBusinessAnalytics, useBusinessInvoices, ... } from '../hooks/useBusinessHub';

const analyticsQuery = useBusinessAnalytics(bizId);
const invoicesQuery = useBusinessInvoices(bizId);
const taxQuery = useBusinessTax(bizId);

// Use directly:
{analyticsQuery.isLoading && <p>Loading...</p>}
{analyticsQuery.error && <p>Error: {analyticsQuery.error.message}</p>}
{analyticsQuery.data && <OverviewTab analytics={analyticsQuery.data} />}
```

**Benefits:**
- Automatic background refetching
- Deduplication (same query called twice only fetches once)
- Stale-while-revalidate UX
- Automatic garbage collection
- Request deduplication across components

### Integration Steps for BusinessHubPage

1. **Remove old imports**: Delete all manual API calls from imports
2. **Add hook imports**: Import all needed hooks from `useBusinessHub.js`
3. **Replace useState data patterns**: Replace 8 useState data/loading pairs with React Query hooks
4. **Keep modal state**: useState for form/modal state (these are UI-only, not API)
5. **Update mutation handlers**: Wrap mutation calls in React Query mutations

### Example Integration: Invoices Tab

**Before:**
```javascript
const [invoiceData, setInvoiceData] = useState(null);
const [invoicesLoading, setInvoicesLoading] = useState(false);

const loadInvoices = useCallback(async () => {
  if (!bizId) return;
  setInvoicesLoading(true);
  try { setInvoiceData(await listInvoices(bizId)); }
  catch { toast.error('Failed to load invoices'); }
  finally { setInvoicesLoading(false); }
}, [bizId, t]);

// Handler:
async function handleSaveInvoice() {
  // ... validation ...
  try {
    await createInvoice(bizId, payload);
    toast.success('Invoice created');
    closeModal();
    await loadInvoices(); // Manual refresh
  } catch (e) { setFormErr(e.message); }
}
```

**After:**
```javascript
const invoicesQuery = useBusinessInvoices(bizId);
const createInvoiceMutation = useCreateInvoice(bizId);

// Handler:
async function handleSaveInvoice() {
  // ... validation ...
  createInvoiceMutation.mutate(payload, {
    onSuccess: () => {
      toast.success('Invoice created');
      closeModal();
      // Query automatically invalidates and refetches!
    },
    onError: (e) => {
      setFormErr(e.response?.data?.error || 'Failed to save');
    },
  });
}

// Rendering:
{invoicesQuery.isLoading && <p>Loading...</p>}
{invoicesQuery.error && <p>Error</p>}
{invoicesQuery.data && <InvoicesTab data={invoicesQuery.data} />}
```

### Refactoring Checklist

- [ ] Remove 8 useState data patterns (analytics, invoiceData, taxData, goals, members, invitations, managedBiz, vortexTokens)
- [ ] Import React Query hooks from useBusinessHub
- [ ] Replace `loadOverview()`, `loadInvoices()`, `loadTax()`, `loadGoals()`, `loadTeam()` with hook calls
- [ ] Update `handleAddBiz()` to use `useCreateBusiness()` mutation
- [ ] Update `handleSaveInvoice()` to use `useCreateInvoice()` or `useUpdateInvoice()`
- [ ] Update `handleMarkInvoicePaid()` to use `useMarkInvoicePaid()`
- [ ] Update `handleDeleteInvoice()` to use `useDeleteInvoice()`
- [ ] Update `handleRefreshTax()` to use `useRefreshTax()`
- [ ] Update `handleMarkTaxPaid()` to use `useMarkTaxPaid()`
- [ ] Update `handleSaveGoal()` to use `useCreateGoal()` or `useUpdateGoal()`
- [ ] Update `handleDeleteGoal()` to use `useDeleteGoal()`
- [ ] Update `handleInviteMember()` to use `useInviteMember()`
- [ ] Update `handleRevokeMember()` to use `useRevokeMember()`
- [ ] Update `handleGenerateToken()` to use `useGenerateVortexToken()`
- [ ] Update `handleRevokeToken()` to use `useRevokeVortexToken()`
- [ ] Update `handleSaveProfile()` to use `useUpdateBusiness()` and `useUploadBusinessPhotos()`
- [ ] Remove all `useEffect` hooks that were just calling `loadX()` functions
- [ ] Test all tabs: Overview, Invoices, Tax, Goals, Team, Profile

### Hook Usage Reference

```javascript
// Query hooks (automatically fetch and cache)
const { data, isLoading, error } = useBusinesses();
const { data: analytics } = useBusinessAnalytics(bizId);
const { data: invoices } = useBusinessInvoices(bizId);
const { data: tax } = useBusinessTax(bizId);
const { data: goals } = useBusinessGoals(bizId);
const { data, isLoading } = useBusinessTeam(bizId); // Returns: { members, invitations, managedBiz, vortexTokens }
const { data: profile } = useBusinessProfileEditor(bizId);

// Mutation hooks (for create/update/delete)
const createBiz = useCreateBusiness();
const updateBiz = useUpdateBusiness(bizId);
const uploadPhotos = useUploadBusinessPhotos(bizId);

// Usage:
createBiz.mutate(formData, {
  onSuccess: (newBiz) => {
    toast.success('Business created!');
    // Query cache automatically updates
  },
  onError: (error) => {
    setFormErr(error.response?.data?.error);
  },
});
```

## Why React Query

1. **Reduces Boilerplate**: No more useState/useEffect for every API call
2. **Automatic Caching**: Duplicate requests return cached data instantly
3. **Background Sync**: Data refreshes automatically when tab regains focus
4. **Optimistic Updates**: Mutations can update UI instantly before server response
5. **Built-in Error Handling**: Automatic retry with exponential backoff
6. **Developer Tools**: React Query DevTools show all cache state in real time

## Next Steps

After BusinessHubPage integration:
1. Integrate hooks into MessagesPage, ConversationPage
2. Integrate hooks into Dashboard, HelperDashboard
3. Integrate hooks into JobListPage, JobDetailPage
4. Run full test suite to verify no regressions

---

**Estimated Time for BusinessHubPage Refactoring: 2-3 hours**
- Most time spent replacing mutation handlers and updating rendering logic
- No architectural changes, purely refactoring existing patterns to React Query equivalents
