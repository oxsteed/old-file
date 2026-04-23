# Chat System - Flawless 3-Tier Implementation Strategy

## OVERVIEW

**Goal:** Implement all 16 fixes across 3 tiers without introducing regressions, security issues, or performance problems.

**Key Principle:** Never code-then-test. Test-first, code-to-spec, verify at gates.

**Total Timeline:** 6 weeks (2 weeks per tier)
**Quality Standard:** Zero regressions, 100% test coverage for new code, security-verified

---

## PHASE 0: PREPARATION (3-4 days)

### 0.1 Create Master Issue Dependency Map

```
Tier 1:
├── 1.1 Increase chat height [Independent]
├── 1.2 Add Live Chat mode selector
│   ├── depends: ChatDestinationDropdown improvements
│   └── depends: Live status polling optimization
├── 1.3 Fix guest inquiry flow
│   ├── depends: Guest confirmation email
│   └── depends: Guest return mechanism (localStorage + API)
├── 1.4 Message sanitization [Independent]
└── 1.5 Rate limiting [Independent]

Tier 2:
├── 2.1 Message edit/delete persistence
│   ├── depends: PUT /messages/:id API endpoint
│   └── depends: Socket.IO broadcast handlers
├── 2.2 Read receipts
│   ├── depends: `read_at` column in DB
│   └── depends: Updated API responses
├── 2.3 Conversation search [Independent]
├── 2.4 Message pagination [Independent]
└── 2.5 Translation keys [Independent]

Tier 3: (All independent)
├── 3.1 Voice messages
├── 3.2 Conversation pinning
├── 3.3 Archiving
├── 3.4 Status caching
└── 3.5 Socket.IO optimization
```

### 0.2 Database Schema Review & Migrations

**Create migration order:**
```sql
-- Migration 091: Add read_at, edited_at to messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
CREATE INDEX idx_messages_read_at ON messages(conversation_id, read_at);

-- Migration 092: Add is_pinned, archived_at to conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX idx_conversations_pinned ON conversations(customer_id, is_pinned DESC);

-- Migration 093: Add voice message support
ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) DEFAULT 'text';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio_duration_seconds INT;

-- All migrations validated BEFORE any code changes
```

### 0.3 Create Test Fixtures

```javascript
// __tests__/fixtures/chatFixtures.js
const fixtures = {
  // Test conversations with various states
  helpers: {
    online: { id: 'h1', role: 'helper', is_listed: true, allow_live_chat: true },
    offline: { id: 'h2', role: 'helper', is_listed: true, allow_live_chat: false },
    no_live_chat: { id: 'h3', role: 'helper', is_listed: true, allow_live_chat: false },
  },
  conversations: {
    job_based: { id: 'c1', job_id: 'j1', customer_id: 'u1', helper_id: 'h1' },
    personal: { id: 'c2', job_id: null, customer_id: 'u2', helper_id: 'h2' },
    business: { id: 'c3', business_id: 'b1', customer_id: 'u3', helper_id: 'h1' },
    archived: { id: 'c4', archived_at: new Date() },
  },
  messages: {
    text: { id: 'm1', conversation_id: 'c1', content: 'Hello', message_type: 'text' },
    xss_payload: { id: 'm2', content: '<img src=x onerror="alert(1)">' },
    with_read_receipt: { id: 'm3', read_at: new Date() },
  },
};
```

### 0.4 Create Security Test Payloads

```javascript
// __tests__/security/xssPayloads.js
const XSS_PAYLOADS = [
  '<script>alert("xss")</script>',
  '<img src=x onerror="alert(1)">',
  '<svg onload="alert(1)">',
  'javascript:alert(1)',
  '<iframe src="javascript:alert(1)">',
  '<body onload="alert(1)">',
];

const SQL_INJECTION_PAYLOADS = [
  "'; DROP TABLE messages; --",
  "1' OR '1'='1",
];
```

### 0.5 Create Performance Baselines

```javascript
// benchmark.js - Run before ANY changes
const baselines = {
  listConversations: { before: 45ms },  // Measure this
  getMessages: { before: 120ms },       // Measure all endpoints
  sendMessage: { before: 350ms },
};

// After each tier, verify: no endpoint slower than baseline + 10%
```

---

## PHASE 1: TIER 1 - BLOCKING ISSUES (2 weeks)

### 1.1 Increase Chat Height

**Tests FIRST:**
```javascript
// __tests__/components/ChatPanel.test.tsx
describe('ChatPanel sizing', () => {
  test('desktop: allows 80vh max height', () => {
    const { container } = render(
      <ChatPanel session={session} variant="sidebar" className="h-full" />
    );
    const panel = container.querySelector('[role="region"]');
    const styles = window.getComputedStyle(panel.parentElement);
    expect(styles.maxHeight).toBe('min(80vh, calc(100vh - 200px))');
  });

  test('mobile: allows 90vh max height', () => {
    render(
      <ChatPanel session={session} variant="modal" />
    );
    expect(window.innerHeight).toBeGreaterThan(0);
    // Verify responsive behavior
  });

  test('timeline scrolls smoothly with 100 messages', () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      id: `m${i}`, itemType: 'message', content: `Message ${i}`
    }));
    const { container } = render(
      <ChatPanel session={{ ...session, timeline: messages }} />
    );
    const timeline = container.querySelector('[role="log"]');
    expect(timeline.scrollHeight).toBeGreaterThan(600); // Has scrollable content
  });
});
```

**Implementation:**
```typescript
// BusinessProfilePage.jsx
- Old: `style={{ minHeight: '360px', height: '440px', maxHeight: 'min(520px, 55vh)' }}`
+ New: `style={{ minHeight: '360px', maxHeight: 'min(80vh, calc(100vh - 200px))' }}`

// HelperBusinessProfilePage.tsx - same change
```

**Verification Gate:**
- ✅ All sizing tests pass
- ✅ Manual test: Desktop 1920x1080 → chat takes 80vh space
- ✅ Manual test: Mobile (375x667) → chat full height
- ✅ No console errors/warnings

---

### 1.2 Add Live Chat Mode Selector with Status

**Tests FIRST:**
```javascript
describe('ChatDestinationDropdown - Live Mode', () => {
  test('shows "LIVE" badge when helper online', () => {
    const { getByText } = render(
      <ChatDestinationDropdown
        helperStatus="live"
        destination="helper"
        helperName="John"
      />
    );
    expect(getByText(/LIVE/i)).toBeInTheDocument();
  });

  test('disables live mode when helper offline', () => {
    const { getByRole } = render(
      <ChatDestinationDropdown helperStatus="offline" destination="helper" />
    );
    const liveButton = getByRole('button', { name: /Chat with.*NOW/i });
    expect(liveButton).toBeDisabled();
  });

  test('disables live mode when allow_live_chat=false', () => {
    // Mock API response with allow_live_chat: false
    const { getByRole } = render(
      <ChatPanel session={{ allowLiveChat: false }} />
    );
    expect(getByRole('button', { name: /live/i })).toBeDisabled();
  });

  test('shows helper response time estimate in live mode', () => {
    const { getByText } = render(
      <ChatDestinationDropdown
        helperStatus="live"
        helperResponseTime="< 5 minutes"
      />
    );
    expect(getByText(/5 minutes/)).toBeInTheDocument();
  });

  test('switches mode when user clicks option', () => {
    const onChange = jest.fn();
    const { getByRole } = render(
      <ChatDestinationDropdown onChange={onChange} destination="oxsteed" />
    );
    fireEvent.click(getByRole('button', { name: /Chat with.*NOW/i }));
    expect(onChange).toHaveBeenCalledWith('helper');
  });
});
```

**Implementation (3 files):**

```typescript
// 1. ChatPanel.tsx - Add status banner
const HelperStatusBanner: React.FC = ({ helperStatus, allowLiveChat }) => {
  const { t } = useTranslation();
  
  if (helperStatus !== 'live') {
    return <OfflineBanner />;
  }
  
  if (!allowLiveChat) {
    return <LiveChatDisabledBanner />; // Helper doesn't accept live chat
  }
  
  return (
    <div className="px-4 py-3 bg-emerald-900/30 border-b border-emerald-800/50 flex items-center gap-2">
      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      <span className="text-sm font-semibold text-emerald-200">
        {t('messages.helperIsLive')}
      </span>
      <span className="text-xs text-emerald-300/70 ml-auto">
        {t('messages.responseTime', { time: helperResponseTime })}
      </span>
    </div>
  );
};

// 2. ChatDestinationDropdown.tsx - Better labels
const ChatDestinationDropdown: React.FC<Props> = ({ destination, helperStatus, allowLiveChat }) => {
  const { t } = useTranslation();
  
  const liveOptionDisabled = helperStatus !== 'live' || !allowLiveChat;
  const aiOptionDisabled = false; // Always available
  
  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold uppercase text-gray-400">
        {t('messages.modeLabel')} {/* "Chat Mode" */}
      </label>
      <div className="flex gap-2">
        <button
          disabled={liveOptionDisabled}
          onClick={() => onChange('helper')}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            destination === 'helper'
              ? 'bg-emerald-600 text-white'
              : liveOptionDisabled
              ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            {helperStatus === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
            <span>{t('messages.liveChat')}</span>
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {helperStatus === 'live'
              ? t('messages.liveChatDesc') // "Chat with John now (live)"
              : t('messages.helperOffline') // "Helper offline"
            }
          </div>
        </button>

        <button
          onClick={() => onChange('oxsteed')}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            destination === 'oxsteed'
              ? 'bg-violet-600 text-white'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <span>{t('messages.aiAssistant')}</span>
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {t('messages.aiAssistantDesc')} {/* "AI responds anytime" */}
          </div>
        </button>
      </div>
    </div>
  );
};

// 3. getHelperProfile API - Include allow_live_chat in response
// server/controllers/helpersController.js
const formatHelperProfileResponse = (helper, profile) => {
  return {
    // ... existing fields
    allowLiveChat: profile.allow_live_chat ?? true,
    responseTimeHours: profile.response_time_hours,
  };
};
```

**Verification Gate:**
- ✅ All tests pass
- ✅ Manual: Visit helper profile, see "LIVE" badge when helper online
- ✅ Manual: Click "LIVE" button → enters live chat mode
- ✅ Manual: Helper goes offline → "LIVE" button grays out with tooltip
- ✅ Manual: Helper sets `allow_live_chat=false` → button disabled
- ✅ No regressions: existing AI mode still works
- ✅ Accessibility: keyboard navigation works for mode buttons

---

### 1.3 Fix Guest Inquiry Flow

**Tests FIRST:**
```javascript
describe('Guest Inquiry Flow', () => {
  test('guest submits inquiry → saved to DB + confirmation email sent', async () => {
    const sendEmail = jest.mock();
    
    const res = await post('/chat/sessions/guest', {
      guestName: 'Alice',
      guestEmail: 'alice@example.com',
      message: 'Can you help with plumbing?',
      helperId: 'h1',
    });
    
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledWith({
      to: 'alice@example.com',
      template: 'guest-inquiry-confirmation',
      data: { guestName: 'Alice' },
    });
  });

  test('guest can return and see helper reply', () => {
    sessionStorage.setItem('guest-token', 'abc123');
    
    const { getByText } = render(<ChatPanel isGuest={true} />);
    
    // Guest sees: "Helper replied at 2:30 PM"
    expect(getByText(/replied/i)).toBeInTheDocument();
  });

  test('guest confirmation shows what happens next', () => {
    const { getByText } = render(<ChatPanel isGuest={true} guestContactSaved={true} />);
    
    expect(getByText(/We've notified/i)).toBeInTheDocument();
    expect(getByText(/alice@example.com/i)).toBeInTheDocument();
    expect(getByText(/check back here/i)).toBeInTheDocument();
  });
});
```

**Implementation:**

```javascript
// 1. Create guest token system (JWT that can be stored in localStorage)
// server/utils/guestToken.js
const crypto = require('crypto');

function createGuestToken(guestEmail, guestName, helperId) {
  const payload = {
    email: guestEmail,
    name: guestName,
    helperId: helperId,
    createdAt: Date.now(),
  };
  
  // Sign token so guest can't forge emails
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });
  return token;
}

// 2. Update guestProfileChatSession endpoint
// server/controllers/chatController.js - guestProfileChatSession
async function guestProfileChatSession(req, res) {
  const { guestName, guestEmail, message, helperId, businessId } = req.body;
  
  // 1. Validate guest email
  // 2. Save to guest_profile_chat_inbound
  const inquiry = await pool.query(
    `INSERT INTO guest_profile_chat_inbound (helper_id, business_id, guest_name, guest_email, message)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [helperId, businessId || null, guestName, guestEmail, message]
  );
  
  // 3. Create guest token (so they can return)
  const token = createGuestToken(guestEmail, guestName, helperId);
  
  // 4. Send confirmation email to guest
  await sendEmail({
    to: guestEmail,
    template: 'guest-inquiry-confirmation',
    data: {
      guestName,
      helperId,
      inquiryId: inquiry.rows[0].id,
      returnUrl: `/helpers/${helperId}?guest-token=${token}`,
      responseTimeEstimate: helperProfile.response_time_hours,
    },
  });
  
  // 5. Notify helper via socket + email
  socketService.broadcastToUser(helperId, 'new_guest_inquiry', {
    from: guestName,
    email: guestEmail,
    message,
  });
  
  await sendEmail({
    to: helperProfile.email,
    template: 'new-guest-inquiry',
    data: { guestName, guestEmail, message },
  });
  
  return res.json({
    status: 'saved',
    token, // Client stores this
    inquiryId: inquiry.rows[0].id,
  });
}

// 3. Front-end: Guest token persistence + return flow
// client/src/components/helperProfile/chat/ChatPanel.tsx
useEffect(() => {
  // On mount: check for guest token in URL
  const params = new URLSearchParams(window.location.search);
  const guestToken = params.get('guest-token');
  
  if (guestToken) {
    try {
      const decoded = jwt.decode(guestToken);
      setIsGuestReturning(true);
      setGuestEmail(decoded.email);
      setGuestName(decoded.name);
      
      // Load previous replies from this guest's inquiry
      loadGuestInquiryReplies(decoded.email);
    } catch (e) {
      // Token invalid/expired
    }
  }
  
  // Also check localStorage for guest token (allow returning w/o URL)
  const savedToken = localStorage.getItem('oxs:guest-token');
  if (savedToken) {
    try {
      const decoded = jwt.decode(savedToken);
      setIsGuestReturning(true);
    } catch (e) {
      localStorage.removeItem('oxs:guest-token');
    }
  }
}, []);

// On successful guest submission: save token
const handleGuestSubmit = async (text) => {
  const res = await api.post('/chat/sessions/guest', {
    guestName,
    guestEmail,
    message: text,
    helperId,
  });
  
  // Store token so guest can return
  localStorage.setItem('oxs:guest-token', res.data.token);
  
  // Show confirmation
  setGuestConfirmed({
    email: guestEmail,
    name: guestName,
    returnUrl: `${window.location.origin}/helpers/${helperId}?guest-token=${res.data.token}`,
  });
};

// 4. Update HelperInboxPage to show guest inquiries
// server/controllers/messageController.js - Add to getGuestInquiries
async function getGuestInquiries(req, res) {
  const userId = req.user.id;
  
  const { rows: inquiries } = await pool.query(
    `SELECT 
       id, guest_name, guest_email, message, created_at,
       (SELECT COUNT(*) FROM messages m 
        WHERE m.conversation_id = (
          SELECT id FROM conversations 
          WHERE customer_id IS NULL AND helper_id = $1 AND job_id IS NULL
        )) as reply_count
     FROM guest_profile_chat_inbound
     WHERE helper_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );
  
  return res.json({ inquiries });
}
```

**Verification Gate:**
- ✅ All tests pass
- ✅ Manual: Guest submits inquiry → confirmation email received
- ✅ Manual: Guest returns via email link → sees previous messages
- ✅ Manual: Guest returns via localStorage → same experience
- ✅ Manual: Helper sees inquiry in inbox
- ✅ Manual: Helper replies → guest gets email notification
- ✅ No GDPR violations: guest data properly handled

---

### 1.4 Message Sanitization

**Tests FIRST:**
```javascript
describe('Message Sanitization - XSS Prevention', () => {
  test.each(XSS_PAYLOADS)('blocks XSS payload: %s', (payload) => {
    const sanitized = sanitizeMessage(payload);
    expect(sanitized).not.toContain('<script>');
    expect(sanitized).not.toContain('onerror=');
    expect(sanitized).not.toContain('onload=');
  });

  test('preserves safe markdown formatting', () => {
    const input = 'Check **this** out: https://example.com';
    const sanitized = sanitizeMessage(input);
    
    expect(sanitized).toContain('<strong>this</strong>');
    expect(sanitized).toContain('href="https://example.com"');
  });

  test('escapes SQL-injection-like strings in text', () => {
    const input = "'; DROP TABLE messages; --";
    const sanitized = sanitizeMessage(input);
    
    // Should display as plain text, not execute
    expect(sanitized).toContain("&#x27;");
  });
});
```

**Implementation:**

```javascript
// server/utils/messageSanitizer.js
const DOMPurify = require('isomorphic-dompurify');
const marked = require('marked');

function sanitizeMessage(rawText) {
  // 1. Parse markdown safely (convert **bold** to <strong>)
  const htmlFromMarkdown = marked.parse(rawText, {
    breaks: true,
    gfm: true,
  });
  
  // 2. Use DOMPurify to remove any malicious HTML/attributes
  const config = {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'a', 'ul', 'ol', 'li', 'code', 'pre'],
    ALLOWED_ATTR: ['href', 'title', 'target'],
    KEEP_CONTENT: true,
  };
  
  const clean = DOMPurify.sanitize(htmlFromMarkdown, config);
  
  return clean;
}

// Store clean HTML in database
// messageController.js - sendMessage
async function sendMessage(req, res) {
  const { conversationId, text } = req.body;
  
  const sanitizedContent = sanitizeMessage(text);
  
  const { rows } = await pool.query(
    `INSERT INTO messages (conversation_id, sender_id, content, message_type)
     VALUES ($1, $2, $3, 'text')
     RETURNING *`,
    [conversationId, req.user.id, sanitizedContent],
  );
  
  // Broadcast sanitized content
  socketService.broadcastToConversation(conversationId, 'message:new', {
    id: rows[0].id,
    content: sanitizedContent, // Safe to render
  });
}

// Client-side: Just render (no additional escaping needed since DB stores clean HTML)
// MessageBubble.tsx
<div className="prose prose-sm">
  {/* DOMPurify output is already safe */}
  <div dangerouslySetInnerHTML={{ __html: message.content }} />
</div>
```

**Install dependency:**
```bash
npm install isomorphic-dompurify marked
```

**Verification Gate:**
- ✅ All XSS tests pass
- ✅ Security: Test with OWASP Top 10 payloads
- ✅ Manual: Send message with `<img src=x onerror="alert(1)">` → renders as text, no alert
- ✅ Manual: Send message with markdown → renders with formatting but no scripts
- ✅ Database audit: Query 100 random messages, verify no raw HTML tags
- ✅ Performance: Sanitization < 5ms per message

---

### 1.5 Rate Limiting

**Tests FIRST:**
```javascript
describe('Rate Limiting - Chat Endpoints', () => {
  test('POST /messages limited to 10/minute per conversation', async () => {
    const conversationId = 'c1';
    
    // Send 10 messages - should succeed
    for (let i = 0; i < 10; i++) {
      const res = await post(`/messages/conversations/${conversationId}`, { text: `msg ${i}` });
      expect(res.status).toBe(200);
    }
    
    // 11th message - should be rate limited
    const res = await post(`/messages/conversations/${conversationId}`, { text: 'msg 11' });
    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Too many requests');
  });

  test('POST /chat/profile-message limited to 5/minute per user', async () => {
    // Similar test: send 5 → success, 6 → 429
  });

  test('Rate limits are per-user, not per-IP', async () => {
    // Verify authenticated users are limited independently
  });
});
```

**Implementation:**

```javascript
// middleware/chatRateLimiter.js
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const redis = require('../utils/redis');

// Per-conversation message limiter: 10 messages per minute
const conversationMessageLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:conv-msg:',
  }),
  keyGenerator: (req, res) => {
    // Key: user_id:conversation_id
    return `${req.user?.id || req.ip}:${req.params.conversationId}`;
  },
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests
  message: { error: 'Too many messages. Please wait before sending more.' },
  skip: (req) => req.user?.role === 'admin', // Admins bypass
});

// Per-user profile chat limiter: 5 per minute
const profileChatLimiter = rateLimit({
  store: new RedisStore({
    client: redis,
    prefix: 'rl:profile-chat:',
  }),
  keyGenerator: (req, res) => {
    return req.user?.id || req.ip;
  },
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many chat messages. Please wait.' },
  skip: (req) => req.user?.role === 'admin',
});

// server/routes/messages.js
router.post('/conversations/:conversationId', authenticate, conversationMessageLimiter, sendMessage);

// server/routes/chat.js
router.post('/profile-message', profileChatLimiter, profileChatMessage);
```

**Verification Gate:**
- ✅ All tests pass
- ✅ Manual: Send 10 messages → 11th returns 429
- ✅ Manual: Different users can each send 10 messages (not shared limit)
- ✅ Manual: Redis key cleanup verified (keys expire)
- ✅ Load test: 100 concurrent users, rate limiter performs < 10ms overhead

---

## TIER 1 FINAL VERIFICATION

Before moving to Tier 2:

```bash
# 1. All tests pass
npm test -- --testPathPattern='chat|messages'

# 2. No console errors
npm run lint

# 3. All endpoints still work
npm run test:integration

# 4. Security scan
npm audit

# 5. Performance unchanged
npm run benchmark

# 6. Manual smoke test
- [ ] Desktop: chat box size correct
- [ ] Desktop: live mode selector visible
- [ ] Guest: can submit inquiry
- [ ] Message with XSS payload: renders as text
- [ ] Send 11 messages: 11th blocked
```

---

## PHASE 2: TIER 2 (2 weeks)

[Similar detailed test-first approach for each of the 5 issues]

### 2.1 Message Edit/Delete
### 2.2 Read Receipts
### 2.3 Conversation Search
### 2.4 Message Pagination
### 2.5 Translation Keys

---

## PHASE 3: TIER 3 (2 weeks)

[Similar approach for nice-to-have features]

---

## CROSS-CUTTING VERIFICATION STRATEGY

### After Each Tier: Run Full Suite

```bash
# Unit tests
npm test -- --coverage

# Integration tests (with real DB)
npm run test:integration

# Security tests
npm run test:security

# Performance regression tests
npm run benchmark:compare

# E2E tests (Cypress/Playwright)
npm run test:e2e

# Accessibility tests
npm run test:a11y

# Manual QA checklist
- [ ] Desktop (Chrome, Firefox, Safari)
- [ ] Mobile (iOS Safari, Chrome Android)
- [ ] Tablet
- [ ] Slow network (throttle in DevTools)
- [ ] With screen reader (VoiceOver/NVDA)
```

### Database Validation Before Deploy

```sql
-- Verify schema changes applied
SELECT * FROM information_schema.columns 
WHERE table_name = 'messages' 
AND column_name IN ('read_at', 'edited_at');

-- Verify indexes created
SELECT * FROM pg_indexes 
WHERE tablename = 'messages' 
AND indexname LIKE 'idx_%';

-- Verify data integrity
SELECT COUNT(*) FROM messages 
WHERE content IS NULL OR content = '';  -- Should be 0

-- Verify no breaking changes
EXPLAIN ANALYZE SELECT * FROM messages 
WHERE conversation_id = 'xyz' 
ORDER BY created_at DESC LIMIT 50;  -- Should use index
```

---

## KEY PRINCIPLES FOR FLAWLESS EXECUTION

1. **Test-First Always** - Never write code before tests exist
2. **Incremental Commits** - Small, reviewable PRs (1 issue per PR)
3. **Staging Environment** - Test everything in staging before main
4. **Feature Flags** - Use flags for risky changes (gradual rollout)
5. **Monitoring** - Deploy metrics dashboard before shipping
6. **Documentation** - Update docs as you code, not after
7. **Peer Review** - Every PR reviewed by 2 people
8. **Regression Testing** - Automated tests catch breaking changes
9. **Performance Budgets** - Reject changes that slow down chat
10. **Rollback Plan** - Know how to revert every change in 60 seconds

---

## ESTIMATED TEAM REQUIREMENTS

To execute flawlessly with zero regressions:

| Role | Time | Notes |
|------|------|-------|
| Senior Backend Dev | 3 weeks | API, DB, Socket.IO changes |
| Frontend Dev | 3 weeks | UI components, state management |
| QA/Test Engineer | 2 weeks | Test automation, security testing |
| DevOps | 1 week | Migrations, monitoring, rollback |
| PM/Designer | 0.5 week | Clarify requirements, UX review |

**Total: ~4 people × 3 weeks = 12 person-weeks**
**Or: 1 senior full-stack dev × 6 weeks (with external QA)**

