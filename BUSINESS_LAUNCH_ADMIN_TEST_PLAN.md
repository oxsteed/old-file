# Business Launch Admin System — Test Plan

This document outlines comprehensive test scenarios for the newly implemented Business Launch admin notes and messaging system.

## System Overview

The Business Launch Admin system provides admins with:
- **Tabbed Detail Interface** for managing business launch requests
- **Internal Notes** for admin-only documentation
- **Custom Messaging** to communicate with clients via email
- **Message Templates** for common communications
- **Audit Trail** of all admin actions

## Test Environment Setup

### Prerequisites
1. PostgreSQL database with migration 104 applied
2. Node.js 18+ backend server running
3. React frontend development server running
4. Admin user account with authentication
5. At least one business launch request in the database

### Test Data
- Sample request: Create via `/business-launch-intake` form
- Admin account: Ensure `role = 'admin'` in database
- Email delivery: Configure RESEND_API_KEY in `.env`

## Test Scenarios

### 1. Admin Dashboard Access

**Test 1.1: Navigate to Business Launch Admin**
- [ ] Login as admin user
- [ ] Sidebar shows "Business Launch" link
- [ ] Click link navigates to `/admin/consulting/business-launch`
- [ ] Page loads request table with filters
- [ ] Request list displays correctly

**Test 1.2: Filter Requests**
- [ ] Status filter shows pending, contacted, kickoff_scheduled, in_progress, completed, cancelled
- [ ] Package filter shows foundation, launch, accelerator
- [ ] Urgency filter shows exploring, two_weeks, asap
- [ ] State filter shows available US states
- [ ] Filters are chainable (e.g., pending + CA state)
- [ ] Clear Filters button resets all filters

**Test 1.3: Pagination**
- [ ] Table shows 20 requests per page (if 20+ exist)
- [ ] Previous/Next buttons navigate between pages
- [ ] Page indicator shows "Page X of Y"
- [ ] Clicking request row opens detail modal

### 2. Detail Modal — Overview Tab

**Test 2.1: Modal Opens**
- [ ] Click request row → modal opens
- [ ] Modal is centered on screen with overlay
- [ ] Modal has close (X) button and Close button at bottom
- [ ] Clicking overlay does NOT close modal

**Test 2.2: Overview Tab Content**
- [ ] Request name (first_name + last_name) displays in header
- [ ] Status badge shows current status with correct color
- [ ] Package and price display (e.g., "Foundation $750")
- [ ] Contact Information section shows:
  - [ ] Email
  - [ ] Phone (or "—" if missing)
  - [ ] Referral Source (or "—" if missing)
- [ ] Business Details section shows:
  - [ ] Skill Description
  - [ ] Target Market
  - [ ] Operating State (or "—" if missing)
  - [ ] Current Phase X / 25
  - [ ] Business Name (if business_name_decided = true)
- [ ] Setup Items section displays as colored badges
- [ ] Timestamp shows submission date

### 3. Detail Modal — Internal Notes Tab

**Test 3.1: Add Note**
- [ ] Click Notes tab
- [ ] "Add Internal Note" section visible
- [ ] Textarea placeholder shows "Add a private note (only visible to admins)..."
- [ ] Enter note text → "Add Note" button active
- [ ] Click "Add Note" → loading state shows "Adding..."
- [ ] Toast success shows "Note added successfully"
- [ ] Note appears in list below

**Test 3.2: Note Display**
- [ ] Each note shows:
  - [ ] Creator name (from users table)
  - [ ] Timestamp (locale-formatted)
  - [ ] Full note text
  - [ ] Delete button (red text)
- [ ] Notes ordered by created_at DESC (newest first)
- [ ] Multiple notes can be added to same request

**Test 3.3: Delete Note**
- [ ] Click Delete button on a note
- [ ] Confirm dialog shows "Delete this note?"
- [ ] Cancel → note remains
- [ ] Confirm → loading state, toast success "Note deleted successfully"
- [ ] Note removed from list immediately
- [ ] Only note creator or super_admin can delete (test both paths)

**Test 3.4: Validation**
- [ ] Empty note → click Add → toast error "Please enter a note"
- [ ] Whitespace-only note → same error
- [ ] Very long note (>4000 chars) should save without issues

### 4. Detail Modal — Messages Tab

**Test 4.1: Template Selection**
- [ ] Click Messages tab
- [ ] "Send Message to Client" section visible
- [ ] Dropdown shows "— Create Custom Message —" as default
- [ ] Dropdown lists all 4 templates:
  - [ ] Kickoff Preparation
  - [ ] Post-Kickoff Follow-up
  - [ ] Setup Component Complete
  - [ ] Pre-Launch Checklist
- [ ] Selecting template hides custom message fields

**Test 4.2: Custom Message Path**
- [ ] Keep template dropdown on "Create Custom Message"
- [ ] Subject input field visible
- [ ] Message (HTML) textarea visible
- [ ] Enter subject (e.g., "Your Business Launch Update")
- [ ] Enter message HTML (e.g., "<p>Hello {{first_name}},</p><p>Your setup is complete!</p>")
- [ ] Click "Send Message"

**Test 4.3: Template Path**
- [ ] Select a template from dropdown
- [ ] Custom message fields disappear
- [ ] Click "Send Message" → sends template content
- [ ] Message goes to client email with template subject

**Test 4.4: Send Message**
- [ ] Click "Send Message" → loading state "Sending..."
- [ ] Toast success "Message sent successfully"
- [ ] Message appears in "Message History" below
- [ ] Fields reset (custom message cleared, template reset to default)

**Test 4.5: Message History**
- [ ] Each message shows:
  - [ ] Subject (bold)
  - [ ] Creator name + timestamp
  - [ ] Status badge (green for "sent", red for "failed")
  - [ ] Error message (if status = "failed")
- [ ] Messages ordered by created_at DESC (newest first)
- [ ] Multiple messages from same request show in list

**Test 4.6: Validation**
- [ ] Empty subject → toast error "Please fill in subject and message"
- [ ] Empty message → same error
- [ ] Subject only, no message → same error
- [ ] Long message (>4000 chars) should send without issues

### 5. Integration Tests

**Test 5.1: Status Update Within Modal**
- [ ] Existing status dropdown visible in Overview
- [ ] Select new status → API call triggers
- [ ] Toast shows "Status updated successfully"
- [ ] `onStatusUpdate` callback triggers (request list reloads)
- [ ] Modal stays open
- [ ] Status badge in header updates

**Test 5.2: Modal Close**
- [ ] Click Close button → modal closes
- [ ] Click overlay outside modal → modal stays open (design choice)
- [ ] Use browser back button → modal closes
- [ ] Request table still shows with same filters applied

**Test 5.3: Multiple Admins**
- [ ] Admin A adds note
- [ ] Admin B opens same request
- [ ] Admin B sees Admin A's note with correct name
- [ ] Admin B can add their own note
- [ ] Timestamps and creator attribution correct for each

**Test 5.4: Admin Authorization**
- [ ] Regular admin can add notes and messages
- [ ] Regular admin can delete own notes
- [ ] Regular admin cannot delete other admin's notes
- [ ] Super admin can delete any note
- [ ] Super admin cannot delete notes from non-admin routes

### 6. Email Delivery Tests

**Test 6.1: Message Email Sent**
- [ ] Send custom message to request
- [ ] Check client email inbox
- [ ] Email received with subject from message
- [ ] Email body contains message HTML
- [ ] Email from address is configured sender

**Test 6.2: Template Email Sent**
- [ ] Select template and send
- [ ] Email received with template subject
- [ ] Email body contains template content
- [ ] Variable placeholders ({{first_name}}, etc.) handled correctly

**Test 6.3: Email Failure Handling**
- [ ] Send message to invalid email
- [ ] After timeout, status changes to "failed"
- [ ] Error message displays reason (network, invalid address, etc.)
- [ ] Admin can see error in message history

### 7. i18n Tests (Multilingual)

**Test 7.1: English Locale**
- [ ] All UI text in English
- [ ] Buttons: "Add Note", "Send Message", "Delete"
- [ ] Toasts: "Note added successfully", "Message sent successfully"

**Test 7.2: Spanish Locale (ES)**
- [ ] Change to Spanish in settings
- [ ] Modal re-renders in Spanish
- [ ] Buttons: "Agregar Nota", "Enviar Mensaje", "Eliminar"
- [ ] Toasts: "Nota agregada exitosamente", "Mensaje enviado exitosamente"

**Test 7.3: French Locale (FR)**
- [ ] Change to French in settings
- [ ] Modal re-renders in French
- [ ] Buttons: "Ajouter une note", "Envoyer un message", "Supprimer"
- [ ] Toasts: "Note ajoutée avec succès", "Message envoyé avec succès"

**Test 7.4: Haitian Creole Locale (HT)**
- [ ] Change to Haitian Creole in settings
- [ ] Modal re-renders in Haitian Creole
- [ ] Buttons: "Ajoute Nòt", "Voye Mesaj", "Efase"
- [ ] Toasts: "Nòt ajoute avèk siksè", "Mesaj voye avèk siksè"

### 8. Performance Tests

**Test 8.1: Large Note Count**
- [ ] Request with 100+ notes
- [ ] Modal opens without lag
- [ ] Notes load and display correctly
- [ ] Adding/deleting notes still responsive

**Test 8.2: Large Message Count**
- [ ] Request with 50+ messages
- [ ] Message history loads without lag
- [ ] Sending new message is responsive

**Test 8.3: Request List Performance**
- [ ] Load page with 1000+ requests
- [ ] Initial load < 3 seconds
- [ ] Pagination smooth
- [ ] Filtering responsive

### 9. Edge Cases

**Test 9.1: Missing Data**
- [ ] Request without phone number → shows "—"
- [ ] Request without setup items → "Setup Items (0)" with empty grid
- [ ] Request without referral source → shows "—"
- [ ] Message delivery failure → status = "failed", error message displays

**Test 9.2: Special Characters**
- [ ] Note with emoji → displays correctly
- [ ] Note with HTML tags → displays as plain text (not rendered)
- [ ] Note with quotes/apostrophes → no SQL injection
- [ ] Message with special chars → emails correctly

**Test 9.3: Concurrent Actions**
- [ ] Admin A adds note while Admin B sends message → no race condition
- [ ] Modal stays open during async operations
- [ ] Multiple send clicks doesn't duplicate messages

### 10. Security Tests

**Test 10.1: Authorization**
- [ ] Non-admin user cannot access `/admin/consulting/business-launch`
- [ ] Non-admin user cannot POST to `/requests/:id/notes`
- [ ] Regular admin cannot delete other admin's notes
- [ ] Invalid JWT token blocked with 401

**Test 10.2: Data Protection**
- [ ] Internal notes (is_internal=true) never visible to clients
- [ ] Only admins can send custom messages
- [ ] Client email not exposed in UI
- [ ] Password/sensitive fields never logged

## Regression Tests

### Existing Features Still Work
- [ ] Request table filtering
- [ ] Status update (from table or modal)
- [ ] Pagination
- [ ] Search by email
- [ ] Request timeline/history
- [ ] No data loss from previous requests

## Success Criteria

✅ **All tests pass without errors**
✅ **No console errors in browser or server logs**
✅ **Email delivery working (check spam folder)**
✅ **All 4 languages display correctly**
✅ **Admin can manage 100+ requests efficiently**
✅ **Performance acceptable (< 2s load times)**

## Known Limitations

- Email templates don't currently support variable substitution (e.g., {{first_name}})
- Message templates are hardcoded (future: make them admin-configurable)
- No message read receipts (one-way communication)
- Notes are permanent (no edit capability, only delete)

## Next Steps After Testing

1. If all tests pass: merge PR and deploy to staging
2. If issues found: fix and re-test affected scenarios
3. Once staging verified: deploy to production
4. Monitor email delivery success rate in production
5. Gather admin feedback for future improvements
