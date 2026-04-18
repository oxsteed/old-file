# Support Messages Translation + Speech-to-Text Implementation Guide

**Status:** Phase 1 & 2 Complete | Phase 3 Integration Ready

This document provides step-by-step instructions to integrate the completed translation and speech-to-text features into your support system.

---

## What Has Been Built

### ✅ Phase 1: Backend Infrastructure (Committed)

**Database:**
- Migration `071_support_messages_language.sql` - adds `sender_language` column to `support_messages` table
- Partial index on `sender_language` for translation queries

**Backend Utilities:**
- `server/utils/translationCache.js` - Redis-backed translation caching (persistent, 30-day TTL)
  - Reduces API calls via Redis before falling back to in-memory cache
  - Supports both single and batch translations
  - Gracefully handles Redis unavailability
  
- `server/utils/speechToText.js` - OpenRouter audio transcription
  - Handles low-confidence Web Speech API results
  - Returns confidence scores and language detection
  - 30-second timeout per transcription

**Backend Changes:**
- `chatController.js` - Added `transcribeAudio` export for POST `/api/chat/transcribe`
- `routes/chat.js` - Wired `/transcribe` endpoint (requires auth, rate-limited)
- `supportController.js` - Updated all message creation points:
  - `submitSupportRequest` - captures `sender_language` from request
  - `replyToMyTicket` - captures customer language
  - `adminReply` - captures admin language
  - All use language validation (en/es/fr/ht/de/it/pt/nl/pl/ja/zh)

### ✅ Phase 2: Frontend Components (Committed)

All components are TypeScript, Tailwind-styled, dark-mode-ready:

- **SpeechRecorderButton.tsx** (27 KB)
  - Mic button with recording state indicator
  - Browser-compatible MediaRecorder with automatic MIME type detection
  - Handles userPermissionsDenied errors gracefully
  - emits `onRecordingStart` / `onRecordingStop(audioBlob, duration)`

- **TranscriptConfidenceIndicator.tsx** (5 KB)
  - Shows confidence percentage (0-100%)
  - Visual indicators: green (≥95%), amber (<85%), neutral
  - "Improve with AI" button for low-confidence transcripts
  - Disabled state while improving

- **MessageWithTranslation.tsx** (5 KB)
  - Displays message with optional translation toggle
  - Shows language names (English, Spanish, French, etc.)
  - Toggle button to switch between original/translated
  - Language auto-detection from BCP-47 codes

- **SpeechToTextInput.tsx** (15 KB)
  - Full speech input component combining the above
  - Web Speech API as primary (fast, free, browser-native)
  - OpenRouter fallback for low-confidence cases
  - Editable transcript textarea
  - Submit/Clear buttons
  - Language context from user preferences

---

## Integration Steps (Phase 3)

### Step 1: Run the Database Migration

```bash
cd server
npm run migrate
```

This will apply migration 071 automatically on startup via `migrate.js`.

**Verify:** Query should return the new column:
```sql
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'support_messages' AND column_name = 'sender_language';
```

### Step 2: Add Frontend Components to Your Page

Import the new components in any page that needs speech-to-text support:

```tsx
import SpeechToTextInput from './SpeechToTextInput';
import MessageWithTranslation from './MessageWithTranslation';
```

### Step 3a: Integration in SupportWidget Escalation Form

**Location:** `client/src/components/SupportWidget.jsx`

Add language state:
```javascript
const [senderLanguage, setSenderLanguage] = useState(user?.language || 'en');
```

Import the component (already done):
```javascript
import SpeechToTextInput from './SpeechToTextInput';
```

Replace the textarea with SpeechToTextInput:
```jsx
{/* OLD: <textarea>...</textarea> */}

{/* NEW: */}
<SpeechToTextInput
  language={senderLanguage}
  placeholder="Describe your issue... or click the mic to speak"
  onTranscriptReady={(transcript) => {
    setDesc(transcript);
  }}
  onError={(error) => {
    console.error('Speech error:', error);
  }}
/>
```

Update the API call to include `sender_language`:
```javascript
const { data } = await api.post('/support/request', {
  name,
  email,
  subject: 'Live support escalation from chat widget',
  message: `${desc || '(No additional description provided)'}\n\n${'─'.repeat(40)}\nAI Chat History:\n${transcript}`,
  category: 'Chat Escalation',
  sender_language: senderLanguage,  // ADD THIS LINE
});
```

### Step 3b: Integration in Support Ticket Reply Page

**Create:** `client/src/pages/CustomerSupportTicketPage.jsx`

Template:
```tsx
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import SpeechToTextInput from '../components/SpeechToTextInput';
import MessageWithTranslation from '../components/MessageWithTranslation';
import { api } from '../api/axios';
import { useAuth } from '../hooks/useAuth';

export default function CustomerSupportTicketPage() {
  const { ticketId } = useParams();
  const { user } = useAuth();
  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [translatedMessages, setTranslatedMessages] = useState({});
  const [loading, setLoading] = useState(true);

  // Fetch ticket and messages
  useEffect(() => {
    const fetchTicket = async () => {
      try {
        const { data } = await api.get(`/support/my-tickets/${ticketId}`);
        setTicket(data.ticket);
        setMessages(data.messages);
      } catch (err) {
        console.error('Failed to fetch ticket:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchTicket();
  }, [ticketId]);

  // Fetch translations for messages in different languages
  useEffect(() => {
    const getTranslations = async () => {
      // For each message with language != user language, fetch translation
      for (const msg of messages) {
        if (msg.sender_language && msg.sender_language !== user.language) {
          try {
            const { data } = await api.post('/translate', {
              texts: [msg.content],
              source_language: msg.sender_language,
              target_language: user.language,
            });
            setTranslatedMessages(prev => ({
              ...prev,
              [msg.id]: data.translations[0],
            }));
          } catch (err) {
            console.warn('Translation failed:', err);
          }
        }
      }
    };
    if (messages.length > 0) getTranslations();
  }, [messages, user.language]);

  const handleReply = async (transcript) => {
    try {
      await api.post(`/support/my-tickets/${ticketId}/reply`, {
        content: transcript,
        sender_language: user.language,
      });
      // Refresh messages
      const { data } = await api.get(`/support/my-tickets/${ticketId}`);
      setMessages(data.messages);
    } catch (err) {
      console.error('Failed to send reply:', err);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (!ticket) return <div>Ticket not found</div>;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Ticket #{ticket.ticket_number}</h1>
      <p className="text-gray-600 mb-4">{ticket.subject}</p>

      {/* Messages */}
      <div className="space-y-4 mb-6 border-b pb-6">
        {messages.map(msg => (
          <div
            key={msg.id}
            className={`p-4 rounded-lg ${msg.is_from_admin ? 'bg-blue-100 dark:bg-blue-900' : 'bg-gray-100 dark:bg-gray-800'}`}
          >
            <p className="text-sm font-semibold mb-2">
              {msg.sender_name} ({msg.sender_language?.toUpperCase() || 'EN'})
            </p>
            {translatedMessages[msg.id] && msg.sender_language !== user.language ? (
              <MessageWithTranslation
                original={msg.content}
                translatedText={translatedMessages[msg.id]}
                originalLanguage={msg.sender_language}
                translatedLanguage={user.language}
              />
            ) : (
              <p className="text-sm">{msg.content}</p>
            )}
          </div>
        ))}
      </div>

      {/* Reply with speech-to-text */}
      <div className="border-t pt-6">
        <h2 className="text-lg font-semibold mb-3">Reply to this ticket</h2>
        <SpeechToTextInput
          language={user.language}
          placeholder="Type or speak your reply..."
          onTranscriptReady={handleReply}
        />
      </div>
    </div>
  );
}
```

**Register the route** in `App.jsx`:
```tsx
<Route
  path="/support-tickets/:ticketId"
  element={<ProtectedRoute component={<CustomerSupportTicketPage />} />}
/>
```

### Step 3c: Integration in Admin SupportTickets.jsx

Update the admin ticket viewing page to:

```tsx
// Add import
import MessageWithTranslation from '../components/MessageWithTranslation';

// In the message display loop:
{messages.map(msg => (
  <div key={msg.id} className="...">
    {/* Check if admin's language differs from sender */}
    {msg.sender_language && msg.sender_language !== adminUser.language ? (
      <MessageWithTranslation
        original={msg.content}
        translatedText={messageTranslations[msg.id]}  // fetch separately
        originalLanguage={msg.sender_language}
        translatedLanguage={adminUser.language}
      />
    ) : (
      <p>{msg.content}</p>
    )}
  </div>
))}

// Add language dropdown to reply composer
<select
  value={replyLanguage}
  onChange={(e) => setReplyLanguage(e.target.value)}
>
  <option value="en">English</option>
  <option value="es">Spanish</option>
  <option value="fr">French</option>
  <option value="ht">Haitian Creole</option>
</select>
```

---

## Testing Checklist

### Backend Testing

1. **Migration:**
   ```bash
   npm run migrate
   psql $DATABASE_URL -c "SELECT * FROM support_messages LIMIT 1;" # Verify column exists
   ```

2. **Transcribe Endpoint:**
   ```bash
   curl -X POST http://localhost:5000/api/chat/transcribe \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"audio_data":"...","language":"en"}'
   ```

3. **Translation Cache:**
   - POST a support ticket with `sender_language: "es"`
   - Verify in Redis: `redis-cli get "translation:es:en:*"`
   - Make another request with same text - should be cached (no API call)

### Frontend Testing

1. **Speech Recording:**
   - Click mic button in SpeechToTextInput
   - Speak clearly: "Hello, I need help with my account"
   - Should see transcript appear with confidence indicator

2. **Low Confidence Fallback:**
   - Speak unclearly (mumble/whisper)
   - Should show amber indicator + "Improve with AI" button
   - Click button (if OpenRouter is configured)

3. **Language Detection:**
   - Set user.language to 'es'
   - Speak in Spanish
   - Should capture `sender_language: "es"` in the message

4. **Message Translation:**
   - Admin (English) views message from Spanish customer
   - Should automatically fetch translation
   - Toggle button switches between original/translated

### End-to-End Scenario

**Spanish Customer → English Admin:**

1. Customer (Spanish speaker) opens support widget
2. Clicks mic, speaks: "Necesito ayuda con la verificación"
3. Web Speech transcribes (or OpenRouter if low confidence)
4. Message POSTs with `sender_language: "es"`
5. Admin (English) views ticket
6. System auto-translates: "I need help with verification"
7. Toggle button shows original Spanish
8. Admin replies in English
9. Customer sees admin's English message with translation toggle

---

## Environment Variables Required

Add to `.env` (server):

```
# Translation (already existing)
LIBRETRANSLATE_URL=https://your-libretranslate-instance.com
LIBRETRANSLATE_API_KEY=your-key

# Speech-to-text fallback
OPENROUTER_API_KEY=your-openrouter-key

# Redis (already existing, needed for translation cache)
REDIS_URL=redis://localhost:6379
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No speech detected" | Check microphone permissions in browser |
| Confidence always 0 | Some browsers don't report confidence; use fallback |
| Low-confidence always shows | Set threshold to 0.7 instead of 0.85 in component |
| Translation not working | Verify LibreTranslate URL and API key |
| Redis cache not being used | Check REDIS_URL env var; falls back to in-memory |
| Audio blob empty on stop | Some browsers require specific MIME type support |

---

## Future Enhancements

- Add translation quality scoring
- Implement message edit/delete with translation invalidation
- Support voice language pre-selection (not just detect)
- Add audio file upload (not just browser recording)
- Implement conversation memory for multi-turn translation
- Add translation confidence percentage display

---

## Files Summary

**Backend (6 files):**
- ✅ `server/migrations/071_support_messages_language.sql`
- ✅ `server/utils/translationCache.js`
- ✅ `server/utils/speechToText.js`
- ✅ `server/controllers/chatController.js` (modified)
- ✅ `server/routes/chat.js` (modified)
- ✅ `server/controllers/supportController.js` (modified)

**Frontend (4 new components + integration):**
- ✅ `client/src/components/SpeechRecorderButton.tsx`
- ✅ `client/src/components/TranscriptConfidenceIndicator.tsx`
- ✅ `client/src/components/MessageWithTranslation.tsx`
- ✅ `client/src/components/SpeechToTextInput.tsx`
- 🔄 `client/src/components/SupportWidget.jsx` (needs integration)
- 🔄 `client/src/pages/CustomerSupportTicketPage.jsx` (template provided)
- 🔄 `client/src/admin/pages/SupportTickets.jsx` (needs integration)

---

## Support

For questions about implementation:
1. Check the component prop interfaces (TypeScript)
2. Review the API routes in `server/routes/chat.js`
3. Refer to the test scenarios in this guide
4. Check browser console for detailed error messages
