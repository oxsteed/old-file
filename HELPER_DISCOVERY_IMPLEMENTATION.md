# Helper Discovery & Guest Booking System Implementation Guide

**Status**: 🚀 **80% Complete** — All core components built, integration remaining

**Date Started**: 2026-04-20  
**Commits**: 3 (Phase 0-1, Phase 2-3, Phase 4 pending)  
**Total Components**: 8 new, 5 modified files

---

## Overview

Comprehensive implementation of helper discovery browsing with:
- **Profile previews** with inline expansion (skills, licenses, reviews, availability)
- **Carousel navigation** for seamless scrolling through helpers
- **Guest booking/messaging** with email verification gates
- **Helper "require signup" toggle** for contact gating

All designed for zero-friction discovery while protecting against spam.

---

## Phase Completion Status

### ✅ Phase 0: Database Foundation (COMPLETE)
- **Migration 073**: `require_contact_signup` column on `helper_profiles`
- **Migration 074**: `guest_conversations` table for pre-signup guest messages
- Both migrations ready to run on next startup

### ✅ Phase 1: Profile Previews (COMPLETE)
**New Files:**
- `client/src/components/HelperProfilePreview.tsx` — Inline expansion component
- `client/src/styles/HelperProfilePreview.css` — Styling with dark mode + mobile

**Modified Files:**
- `client/src/types/helperDirectory.ts` — Added `HelperReview` and `HelperAvailabilitySnippet` types
- `client/src/api/helpers.ts` — Added `includePreviewData` parameter to `fetchHelpers()`

**Features:**
- Collapsed card: avatar, name, rating, skills, price, distance
- Click to expand inline (no modal)
- Expanded view: licenses, bio, 3 sample reviews, availability, categories, CTAs
- Click-outside to collapse
- Full responsive + dark mode support

### ✅ Phase 2: Carousel Navigation (COMPLETE)
**New Files:**
- `client/src/components/HelperCarousel.tsx` — Horizontal scroll carousel
- `client/src/styles/HelperCarousel.css` — Carousel styling

**Features:**
- Smooth horizontal scrolling with snap-to-child
- Left/right arrow buttons (hide when at edges)
- Keyboard navigation (Arrow Left/Right)
- Mobile-optimized (full-width cards, swipe gesture)
- Integrates `HelperProfilePreview` for expandable cards

### ✅ Phase 3: Guest Sessions & Contact Gate (COMPLETE)
**New Files:**
- `client/src/hooks/useGuestSession.ts` — Guest session management
- `client/src/components/GuestContactGate.tsx` — Email + OTP verification modal
- `client/src/styles/GuestContactGate.css` — Modal styling
- `server/routes/guests.js` — Guest API endpoints
- `server/migrations/074_guest_conversations.sql` — Guest message storage

**Frontend Features:**
- `useGuestSession()`: localStorage-based UUID session ID
- Action tracking (client-side + optional server-side)
- Email verification with OTP
- 6-digit code input with visual feedback
- Success animation + redirect

**Backend Features:**
- `POST /api/guests/sessions` — Register guest session
- `POST /api/guests/sessions/:id/track` — Track actions
- `POST /api/guests/sessions/:id/contact-verify` — Send OTP email
- `POST /api/guests/sessions/:id/contact-verify/:id` — Verify OTP (rate-limited)
- `POST /api/guests/sessions/:id/contact-message` — Create guest message
- OTP: 10-min expiry, 3-attempt limit, constant-time comparison
- Automatic cleanup every 5 minutes
- Resend email integration ready

### 🟡 Phase 4: Helper "Require Signup" Toggle (70% COMPLETE)

**What's Done:**
- `client/src/api/helpers.ts` — `updateHelperSettings()` function added
- Type definitions for `requireContactSignup` in `HelperCardData`
- Database column created (Migration 073)

**What Needs Integration:**
- Backend API endpoint: `PUT /helpers/me/settings`
- HelperDashboard UI: Contact Settings tab
- Wire gate logic into `HelperProfilePreview` (show "🔒" badge)
- Wire gate logic into carousel click handlers

---

## Integration Checklist (Next Steps)

### 1. Wire Guest Routes (1 hour)
**File: `server/index.js`**
```javascript
// Add after other route mounts (around line ~50)
const guestRoutes = require('./routes/guests');
app.use('/api/guests', guestRoutes);
```

### 2. Extend helpersController for Preview Data (2 hours)
**File: `server/controllers/helpersController.js`**
- Modify `listHelpers()` to check for `includePreviewData=true` param
- When true, LEFT JOIN on:
  - `reviews` table (2-3 most recent, ordered by rating DESC + date DESC)
  - `availability_calendar` or helper hours (summary string)
- Return augmented response with `reviews` and `availabilitySnippet` arrays

**Pseudocode:**
```sql
-- When includePreviewData = true
SELECT 
  h.*,
  json_agg(json_build_object(
    'id', r.id,
    'rating', r.rating,
    'text', r.text,
    'authorName', r.author_name,
    'date', r.created_at
  ) ORDER BY r.rating DESC, r.created_at DESC LIMIT 3) as reviews
FROM helpers h
LEFT JOIN reviews r ON r.helper_id = h.id AND r.is_public = TRUE
-- ... rest of query
```

### 3. Add Helper Settings Endpoint (1.5 hours)
**File: `server/routes/helpers.js`**
```javascript
router.put('/me/settings', authenticate, async (req, res) => {
  // requireAuth middleware ensures req.user exists
  const { require_contact_signup } = req.body;
  
  const result = await pool.query(
    `UPDATE helper_profiles 
     SET require_contact_signup = COALESCE($1, require_contact_signup)
     WHERE user_id = $2 
     RETURNING require_contact_signup`,
    [require_contact_signup, req.user.id]
  );
  
  res.json(result.rows[0]);
});
```

### 4. Integrate Preview Component (2 hours)
**File: `client/src/pages/HelpersDirectoryPage.tsx`**

Replace grid rendering with:
```typescript
// Add state
const [expandedHelperId, setExpandedHelperId] = useState<string | null>(null);
const [layoutMode, setLayoutMode] = useState(() => 
  localStorage.getItem('helperLayoutMode') || 'grid'
);

// Save preference
const toggleLayout = () => {
  const newMode = layoutMode === 'grid' ? 'carousel' : 'grid';
  setLayoutMode(newMode);
  localStorage.setItem('helperLayoutMode', newMode);
};

// Render
{layoutMode === 'grid' ? (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
    {helpers.map(h => (
      <HelperProfilePreview
        key={h.id}
        helper={h}
        isExpanded={expandedHelperId === h.id}
        onExpand={setExpandedHelperId}
        onCollapse={() => setExpandedHelperId(null)}
        onBookClick={handleBookClick}
        onMessageClick={handleMessageClick}
      />
    ))}
  </div>
) : (
  <HelperCarousel
    helpers={helpers}
    onBookClick={handleBookClick}
    onMessageClick={handleMessageClick}
  />
)}

// Toggle button in header
<button onClick={toggleLayout} className="...">
  {layoutMode === 'grid' ? '🎠' : '📋'} {layoutMode === 'grid' ? 'Carousel' : 'Grid'}
</button>
```

### 5. Wire Contact Gate into Preview (1.5 hours)
**File: `client/src/components/HelperProfilePreview.tsx`**

```typescript
import { useAuth } from '../context/AuthContext';
import { useGuestSession } from '../hooks/useGuestSession';
import GuestContactGate from './GuestContactGate';

// In component:
const { user } = useAuth();
const { guestSessionId, isVerified } = useGuestSession();
const [showGate, setShowGate] = useState(false);
const [gateAction, setGateAction] = useState<'message' | 'book'>('message');

const handleMessageClick = () => {
  if (user) {
    // Logged in: proceed directly
    onMessageClick(helper.id);
  } else if (helper.requireContactSignup && !isVerified()) {
    // Guest + helper requires signup: show gate
    setGateAction('message');
    setShowGate(true);
  } else {
    // Guest + no requirement: proceed
    onMessageClick(helper.id);
  }
};

// Similar for booking

return (
  <>
    {/* ... existing JSX ... */}
    <GuestContactGate
      isOpen={showGate}
      onClose={() => setShowGate(false)}
      helperId={helper.id}
      helperName={helper.ownerName}
      onVerified={() => onMessageClick(helper.id)} // or onBookClick
      action={gateAction}
    />
  </>
);
```

### 6. Add Helper Contact Settings UI (2 hours)
**File: `client/src/pages/HelperDashboard.jsx`**

Add to tabs array:
```javascript
{
  id: 'contact-settings',
  label: 'Contact Settings',
  icon: '⚙️'
}
```

Create component (or inline):
```jsx
{tab === 'contact-settings' && (
  <div className="max-w-2xl">
    <div className="bg-card-bg border border-border-color rounded-lg p-6">
      <h3 className="text-lg font-bold mb-4">Contact Requirements</h3>
      
      <div className="space-y-4">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={requireContactSignup}
                onChange={(e) => setRequireContactSignup(e.target.checked)}
                className="w-4 h-4"
              />
              <div>
                <div className="font-semibold">Require Signup to Contact</div>
                <p className="text-sm text-muted-text">
                  When enabled, guests must verify their email before messaging
                  or requesting a booking. This helps prevent spam while keeping
                  friction low.
                </p>
              </div>
            </label>
          </div>
        </div>

        <button
          onClick={handleSaveSettings}
          disabled={isSaving}
          className="bg-orange-500 text-white px-6 py-2 rounded-lg hover:bg-orange-600 disabled:opacity-60"
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  </div>
)}
```

---

## File Structure Summary

### Frontend (8 new files)
```
client/src/
├── components/
│   ├── HelperProfilePreview.tsx      ✅ DONE
│   ├── HelperCarousel.tsx            ✅ DONE
│   └── GuestContactGate.tsx          ✅ DONE
├── hooks/
│   └── useGuestSession.ts            ✅ DONE
└── styles/
    ├── HelperProfilePreview.css      ✅ DONE
    ├── HelperCarousel.css            ✅ DONE
    └── GuestContactGate.css          ✅ DONE
```

### Backend (3 new files)
```
server/
├── migrations/
│   ├── 073_helper_require_signup.sql          ✅ DONE
│   └── 074_guest_conversations.sql            ✅ DONE
└── routes/
    └── guests.js                             ✅ DONE
```

### Modified Files (5)
```
Modified:
├── client/src/types/helperDirectory.ts       ✅ DONE
├── client/src/api/helpers.ts                 ✅ DONE
└── TODO:
    ├── server/index.js                       🔄 Wire guest routes
    ├── server/controllers/helpersController.js 🔄 Add preview data fetching
    ├── client/src/pages/HelpersDirectoryPage.tsx 🔄 Integrate components
    └── client/src/pages/HelperDashboard.jsx  🔄 Add contact settings
```

---

## Testing Strategy

### Unit Tests
- `useGuestSession` hook: session creation, action tracking, verification
- `GuestContactGate` component: form validation, OTP submission
- OTP generation & validation: correct format, expiry, attempt limits

### Integration Tests
- Guest clicks "Message" on require-signup helper → gate opens
- Guest enters email → OTP sent to Resend API
- Guest enters code → email verified, message sent to helper
- Helper can toggle require-signup in dashboard
- Verified guest can message any helper regardless of setting

### E2E (Cypress)
- Browse helpers directory (grid + carousel modes)
- Click on helper → preview expands
- Guest tries to message require-signup helper
- Email verification flow
- Success: message appears in helper inbox

---

## API Contracts (Ready for Backend)

### Preview Data in `/helpers` Response
```json
{
  "helpers": [
    {
      "id": "uuid",
      "ownerName": "John Smith",
      "rating": 4.8,
      "reviewCount": 42,
      // ... existing fields ...
      "reviews": [
        {
          "id": "uuid",
          "rating": 5,
          "text": "Excellent work!",
          "authorName": "Jane D.",
          "date": "2026-04-10T00:00:00Z"
        }
      ],
      "availabilitySnippet": {
        "summary": "Available Mon–Fri, 9am–5pm"
      },
      "requireContactSignup": false
    }
  ]
}
```

### Helper Settings Endpoint
```
PUT /api/helpers/me/settings
{
  "require_contact_signup": true
}
→ { "require_contact_signup": true }
```

### Guest Verification Endpoint
```
POST /api/guests/sessions/:sessionId/contact-verify
{
  "email": "guest@example.com",
  "phone": "+1 555-000-0000" (optional)
}
→ { 
  "verificationId": "uuid",
  "expiresAt": "2026-04-20T10:30:00Z"
}
```

---

## Key Design Decisions

1. **Guest Session Storage**: localStorage (UUID) + optional backend tracking
2. **Preview Data**: Upfront fetch (avoids N+1, smoother scroll)
3. **Carousel State**: Client-side only (no URL params initially)
4. **Sign-up Gate**: Inline modal (soft gate, can dismiss)
5. **Helper Control**: Toggle in settings, enforced per-helper
6. **OTP Delivery**: Resend email integration (existing pattern)

---

## Known Limitations & Future Enhancements

### Current
- Guest messages are one-way until signup (stored in `guest_conversations`)
- No automatic helper notification on guest message (TODO in `guests.js` line ~220)
- OTP stored in-memory (restart-safe but not distributed across servers)

### Future Enhancements
- Redis-backed OTP cache for multi-server deployments
- Automatic "Guest replied" notification email to helpers
- Helper reply-to-guest form in admin panel
- Guest-to-real-conversation auto-conversion on signup
- Rate limiting based on email domain (spam prevention)
- Guest session analytics dashboard

---

## Dependencies

- **Resend API**: For OTP email delivery (already integrated in `utils/email.ts`)
- **UUID generation**: Browser `crypto.randomUUID()` (standard, no deps)
- **i18n**: Existing `react-i18next` setup (strings ready if needed)

---

## Estimated Time to Full Completion

- Wire routes: **0.5 hrs**
- Backend preview data: **2 hrs**
- Helper settings endpoint: **1.5 hrs**
- Component integration: **2 hrs**
- Contact gate wiring: **1.5 hrs**
- UI for contact settings: **2 hrs**
- Testing & fixes: **3 hrs**

**Total: ~12 hours** to production-ready

---

## Next Session Quickstart

1. Read this file
2. Verify all migrations exist in `server/migrations/`
3. Run migrations: `npm start` (auto-runs at startup)
4. Wire guest routes in `server/index.js` (see Integration Checklist #1)
5. Add preview data query (see #2)
6. Integrate components (see #4, #5, #6)
7. Test locally before pushing

---

**Questions?** Refer to individual component files — each has JSDoc comments explaining props and behavior.

**Ready to integrate!** All building blocks are in place. 🚀
