# Per-Route Error Boundaries Implementation Guide

## Problem

Currently, the entire OxSteed app uses a single top-level `ErrorBoundary` component. When a page component crashes, it crashes the entire application, leaving users with a blank screen and no way to recover.

## Solution

`RouteErrorBoundary.jsx` isolates errors to individual pages, so a crash on `/dashboard` doesn't affect `/messages` or other pages.

## Implementation

### 1. Import the component

```jsx
import RouteErrorBoundary from './RouteErrorBoundary';
```

### 2. Wrap critical route elements

In `client/src/App.jsx`, wrap the page component with `RouteErrorBoundary`:

**Before:**
```jsx
<Route path="/dashboard" element={<Guarded><ProtectedRoute><SmartDashboard /></ProtectedRoute></Guarded>} />
```

**After:**
```jsx
<Route path="/dashboard" element={
  <Guarded>
    <ProtectedRoute>
      <RouteErrorBoundary>
        <SmartDashboard />
      </RouteErrorBoundary>
    </ProtectedRoute>
  </Guarded>
} />
```

## Priority Routes to Wrap

**HIGH PRIORITY (complex state, most likely to crash):**
- `/dashboard` - Complex dashboards with multiple data fetches
- `/helper-dashboard` - Same
- `/planned-needs` - Timeline visualization + data transformations
- `/business-hub` - Multiple tabs with different data sources
- `/post-job` - Form with media upload + real-time validation

**MEDIUM PRIORITY (moderate complexity):**
- `/messages` - Socket.io listeners, message rendering
- `/helper/messages` - Same
- `/settings` - Multiple forms with validation
- `/disputes` - Complex state management

**LOW PRIORITY (simple, static pages):**
- `/jobs` - Read-only list
- `/about`, `/terms`, `/privacy` - Static content

## User Experience

### Before Error Boundary

```
✗ Page crashes
✗ Entire app goes blank
✗ User sees no error message
✗ No recovery option
```

### After Error Boundary

```
✓ Page crashes
✓ Friendly error UI appears
✓ "Try Again" button resets the component
✓ "Go Home" button navigates to homepage
✓ Rest of app continues working
✓ Other tabs/pages unaffected
```

## Development Notes

### Error Logging

In development, the error boundary shows:
- Error message
- Component stack trace
- Full stack dump for debugging

In production, it hides technical details to avoid confusing users.

### Recovery

The "Try Again" button resets the error state by calling `setState({ hasError: false })`, which re-mounts the component. This often resolves transient errors (network glitches, race conditions).

### Styling

The error fallback UI uses CSS variables for theming:
- `var(--app-bg)` - Background
- `var(--card-bg)` - Card background
- `var(--app-text)` - Text color
- `var(--muted-text)` - Secondary text
- `var(--border-color)` - Borders

These match the app's dark mode automatically.

## Testing

To test the error boundary locally:

```jsx
// Temporarily add a throw in a component
const DashboardTest = () => {
  throw new Error('Test error');
  return <Dashboard />;
};

// Then use it in a route
<Route path="/dashboard" element={<RouteErrorBoundary><DashboardTest /></RouteErrorBoundary>} />
```

This will trigger the error boundary and display the fallback UI.

## Implementation Checklist

- [ ] Import `RouteErrorBoundary` in `App.jsx`
- [ ] Wrap `/dashboard`
- [ ] Wrap `/helper-dashboard`
- [ ] Wrap `/planned-needs`
- [ ] Wrap `/business-hub`
- [ ] Wrap `/post-job`
- [ ] Wrap `/messages`
- [ ] Wrap `/helper/messages`
- [ ] Wrap `/settings`
- [ ] Test each route by intentionally breaking it
- [ ] Verify error fallback UI renders correctly
- [ ] Verify "Try Again" button resets the component
- [ ] Verify "Go Home" button navigates to homepage
- [ ] Verify other routes still work when one crashes
- [ ] Verify dark mode styling applies correctly

## Related Files

- `client/src/components/RouteErrorBoundary.jsx` - Error boundary component
- `client/src/App.jsx` - Routes to wrap
- `client/src/components/ErrorBoundary.tsx` - Top-level error boundary (existing, do not replace)

## Future Enhancements

1. **Error Tracking**: Send error logs to Sentry or similar service
2. **Smart Recovery**: Detect specific error types and offer targeted recovery actions
3. **Error Analytics**: Track which routes crash most frequently
4. **User Feedback**: Add "Report this error" button to submit feedback
5. **State Persistence**: Save component state before crash and restore on "Try Again"
