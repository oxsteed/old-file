# Socket.io Real-Time Messaging - Debugging Guide

**Status:** 🔴 CRITICAL - User reports "still not working live"  
**User Impact:** Profile chat messages don't arrive in real-time; users must refresh to see new messages

---

## Quick Diagnostic Steps (Do These First)

### Step 1: Check Browser Console for Socket.io Errors
Open DevTools (F12) on the HelperConversationPage and look for:
- ✅ `[useSocket] Socket connected successfully` — Connection established
- ❌ `[useSocket] Socket disconnected` — Connection lost
- ❌ `[useSocket] Connection error` — Auth or network failure

**If you see `Connection error`, the entire chat is broken at the network level.**

### Step 2: Verify Socket.io Connection URL
In browser console, run:
```javascript
console.log('VITE_API_URL:', import.meta.env.VITE_API_URL);
```

Expected output: `https://api.oxsteed.com` or similar (NOT `http://localhost:5000` in production)

If it's wrong, Socket.io tries to connect to the wrong server.

### Step 3: Check if JWT Token Exists
In browser console, run:
```javascript
console.log('Access Token:', localStorage.getItem('accessToken'));
```

If result is `null`, authentication fails on the server side (see Step 1 Connection error).

### Step 4: Verify Conversation Room Join
In browser console, when on HelperConversationPage, look for:
```
[useConversationChat] Joining conversation room: <conversationId>
[useSocket] Emitting conversation:join for: <conversationId>
```

If you see these logs, the client is trying to join. Continue to Step 5.

### Step 5: Check Server Logs for Room Membership
When you see the logs in Step 4, check server logs for:
```
Socket joined conversation room { userId: '...', conversationId: '...' }
```

If this log is **missing**, the server rejected the room join request (either auth failed or user doesn't have access).

---

## Root Cause Analysis

Based on your feedback "still not working live", the issue is likely one of these (in order of probability):

### Cause 1: Socket.io Never Connects (Most Likely)
**Symptoms:**
- No `[useSocket] Socket connected successfully` message in console
- No `[useSocket] Connection error` message either (silent failure)

**Root Cause:** 
- JWT token missing or invalid
- Socket.io URL pointing to wrong server
- WebSocket port closed/blocked
- CORS misconfiguration

**Fix:**
Run this in browser console:
```javascript
// 1. Verify token exists
const token = localStorage.getItem('accessToken');
if (!token) {
  console.error('❌ NO TOKEN - Try logging out and back in');
} else {
  console.log('✅ Token present:', token.substring(0, 20) + '...');
}

// 2. Verify API URL
const apiUrl = import.meta.env.VITE_API_URL;
console.log('API URL:', apiUrl);
if (!apiUrl) {
  console.error('❌ VITE_API_URL not configured');
}

// 3. Check Socket.io Connection
const socket = window.socketInstance; // Might not be accessible globally
// You'll see connection logs above instead
```

**Resolution:**
- Ensure `.env.local` has `VITE_API_URL=https://api.oxsteed.com` (or correct backend URL)
- Clear localStorage and log out/back in to refresh token
- Check that your backend server is running and Socket.io port (5000) is accessible

---

### Cause 2: Room Join Fails (Second Most Likely)
**Symptoms:**
- ✅ `[useSocket] Socket connected successfully` appears
- ❌ No `Socket joined conversation room` in server logs
- ❌ Messages still don't arrive in real-time

**Root Cause:**
- Server's `conversation:join` handler fails permission check
- User doesn't actually have access to this conversation

**Fix:**
In browser console, verify the conversation belongs to the current user:
```javascript
// This should match the logged-in user ID
const user = JSON.parse(localStorage.getItem('user') || '{}');
console.log('Current User ID:', user.id);

// Check conversation on the current page
// HelperConversationPage has conversationId in the URL or state
const url = window.location.pathname;
console.log('URL:', url);
```

**Resolution:**
- Ensure you're logged in as the helper who owns the conversation
- Verify the conversation exists in the database and isn't deleted/archived
- Check server logs for permission errors

---

### Cause 3: Events Not Broadcast by Server (Third Most Likely)
**Symptoms:**
- ✅ Room join succeeds
- ❌ Typing indicators work (proven by seeing `user:typing` event)
- ❌ `message:new` or `profile_chat:new_message` events never arrive

**Root Cause:**
- Server fails to broadcast after message insert
- Job_id detection fails (profile chat detection broken)
- Broadcasting happens to wrong room name

**Fix:**
Send a message from HelperConversationPage and watch:
1. Check browser Network tab: POST to `/api/messages/conversations/:id` returns 201
2. Check browser Console: Look for `[useConversationChat] Received message:new event`
3. Check server logs: Look for `Broadcasting profile_chat:new_message`

**Resolution:**
- If network request succeeds (201) but no event appears: Check if socketService.init() was called on server
- If server log shows broadcast: Check client listener attachment (Step 4)

---

### Cause 4: Listener Not Attached on Client
**Symptoms:**
- ✅ Event is broadcast from server (server logs confirm)
- ❌ Client listener never fires

**Root Cause:**
- `socket.on('profile_chat:new_message', ...)` not registered when event arrives
- Race condition: event fires before listener attached
- Wrong event name or conversation ID mismatch

**Fix:**
In browser console on HelperConversationPage, run:
```javascript
// Check if useConversationChat listeners are attached
// These logs appear at lines 124, 147, 166, etc. in useConversationChat.js
// Look for: "[useConversationChat] Setting up socket listeners"
```

Check that you see:
```
[useConversationChat] Setting up socket listeners for conversation: <conversationId> { listenProfileChat: true }
[useConversationChat] Attaching profile_chat:new_message listener
```

**Resolution:**
- Listeners are correctly attached (code looks right)
- Issue is likely Cause 1-3 above, not Cause 4

---

## Complete Test Flow

Here's how to verify everything works end-to-end:

### 1. Open HelperConversationPage
- You should see multiple console logs from `useSocket` and `useConversationChat`
- Look for: `Socket connected successfully` and `Socket joined conversation room`

### 2. Send a Test Message
- Type a message and send it
- Watch the Network tab: POST should return 201 with the message ID
- Check console for: `[useConversationChat] Received message:new event`
- Check if message appears instantly (no refresh needed)

### 3. If Message Doesn't Appear Instantly
Run this in console to see what event names are being emitted by server:
```javascript
// Monkey-patch Socket.on to log all events
const socket = /* get socket instance somehow */;
const originalOn = socket.on;
socket.on = function(event, handler) {
  console.log('[ALL EVENTS]', event);
  return originalOn.call(this, event, handler);
};
```

This will show you every event the server is trying to send.

### 4. Check Server Broadcasting
Look for these logs when you send a message:
```
[MessageController] Broadcasting profile_chat:new_message
[MessageController] Broadcasting message:new
```

If these don't appear, the message insert succeeded (201) but broadcasting logic wasn't reached.

---

## Key Code Locations

| Component | Purpose | Status |
|-----------|---------|--------|
| `useSocket.js` | Creates Socket.io connection, emits `conversation:join` | ✅ Looks correct |
| `useConversationChat.js` | Attaches listeners, receives events | ✅ Looks correct |
| `messageController.js` lines 545-561 | Broadcasts `profile_chat:new_message` | ✅ Looks correct |
| `server/index.js` lines 188-210 | Handles `conversation:join`, adds socket to room | ✅ Looks correct |
| `socketService.js` | Helper that broadcasts to rooms | ✅ Looks correct |

**All code looks correct.** The issue is configuration or runtime state, not logic.

---

## Action Items (In Priority Order)

1. **Immediate:**
   - [ ] Open browser DevTools on HelperConversationPage
   - [ ] Check for `Socket connected successfully` message
   - [ ] Check for `Socket disconnected` or `Connection error` messages

2. **If Connected:**
   - [ ] Send a test message
   - [ ] Watch console for `Received message:new event` or `Received profile_chat:new_message event`
   - [ ] Check if message appears without refresh

3. **If Connection Error:**
   - [ ] Verify `VITE_API_URL` is set correctly in `.env.local`
   - [ ] Verify accessToken exists: `localStorage.getItem('accessToken')`
   - [ ] Try logging out and back in
   - [ ] Check if backend server is running (`curl https://api.oxsteed.com/api/health`)

4. **If Connected but Events Don't Arrive:**
   - [ ] Check server logs for `Broadcasting profile_chat:new_message`
   - [ ] Check if room join succeeded: `Socket joined conversation room`
   - [ ] Verify `conversation:join` event was emitted: `[useSocket] Emitting conversation:join`

5. **Report Back With:**
   - Browser console output (all `[useSocket]` and `[useConversationChat]` logs)
   - Server logs when you send a message
   - Conversation ID you're testing with
   - User ID who sent the message

---

## Known Issues & Workarounds

**WebSocket Transport Only:** 
- useSocket.js uses `transports: ['websocket']` (line 70)
- Doesn't fall back to polling if WebSocket fails
- Workaround: Add `'polling'` to transports: `transports: ['websocket', 'polling']`

**Token Refresh Race Condition:**
- If token expires while Socket.io tries to connect, auth fails
- Workaround: Add token refresh to Socket.io setup (minor enhancement)

**Room Name Mismatch:**
- Client tries to join `conv_${conversationId}`
- Server broadcasts to `conv_${conversationId}`
- These should match (they do in the code)
- Risk: If conversationId is numeric vs string, room names won't match
  - Profile chat conversationId might be numeric (from database sequence)
  - Need to ensure consistent string formatting: `String(conversationId)`

---

## Next Steps

Once you've completed the diagnostic steps above, let me know:
1. Whether Socket.io connects successfully
2. Any error messages in the browser console
3. Server logs when you send a message
4. Screenshot of the console output

This will pin down exactly where the flow is breaking.
