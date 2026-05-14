# OxSteed - Quick Testing Checklist
**Printable Format - Check off features as you test**

---

## AUTHENTICATION (10 items)
- [ ] User registration with email
- [ ] Email verification OTP
- [ ] Phone OTP verification (Twilio)
- [ ] Login with email + password
- [ ] Password reset
- [ ] Logout (invalidates session)
- [ ] Auto token refresh (on 401)
- [ ] Account deactivation
- [ ] Edit profile (name, email, phone)
- [ ] Avatar upload

---

## JOBS (25 items)
- [ ] Create job draft
- [ ] Post job publicly
- [ ] Select category + skills
- [ ] Set budget/hours/timeline
- [ ] Geocoding location (auto lookup)
- [ ] Upload job images
- [ ] Browse/search jobs
- [ ] Filter by category
- [ ] Filter by skill
- [ ] Filter by budget range
- [ ] Filter by radius (5/10/25/50/100 mi)
- [ ] Filter by country
- [ ] Sort (newest, oldest, nearest, bids)
- [ ] View job details
- [ ] View location map
- [ ] Start job (customer)
- [ ] Complete job (helper)
- [ ] Cancel job (triggers 10% fee)
- [ ] Reschedule appointment
- [ ] View job timeline
- [ ] Planned Needs creation
- [ ] Planned Needs auto-publish
- [ ] Life Pulse indicator
- [ ] Sinking fund breakdown
- [ ] Job expiry (60 days)

---

## BIDDING (10 items)
- [ ] Place bid on job
- [ ] Enter amount + hours + message
- [ ] View my bids (all statuses)
- [ ] Filter bids (pending/accepted/rejected/withdrawn)
- [ ] Withdraw bid
- [ ] Accept bid (customer)
- [ ] Reject bid (customer)
- [ ] Duplicate bid prevention
- [ ] View bid timeline
- [ ] Bid status flow (pending → accepted → appointment)

---

## CALENDAR & APPOINTMENTS (20 items)
- [ ] Week view (7 days hourly)
- [ ] Day view (hourly slots)
- [ ] Agenda view (list format)
- [ ] Mini calendar (sidebar)
- [ ] Color-coded legend (confirmed/pending/in-progress/available/busy)
- [ ] Current time indicator (red line)
- [ ] Auto-scroll to now
- [ ] Block time (helper)
- [ ] Set recurring availability
- [ ] View availability slots
- [ ] Book helper directly (no job posting)
- [ ] Automatic appointment from bid acceptance
- [ ] Reschedule appointment
- [ ] Accept reschedule request
- [ ] Decline reschedule request
- [ ] 24h reminder notification
- [ ] 2h reminder notification
- [ ] Same day reminder notification
- [ ] Confirmation window (1-168 hours)
- [ ] Stale reminder cleanup on reschedule

---

## PAYMENTS (15 items)
- [ ] Create payment intent
- [ ] Idempotency (safe retries)
- [ ] Stripe Card Element
- [ ] Stripe Payment Element
- [ ] 3D Secure (if required)
- [ ] Authorize payment
- [ ] Capture payment
- [ ] Manual capture escrow (Tier 3)
- [ ] Refund payment
- [ ] Automatic refund on job cancel
- [ ] Payment history view
- [ ] Filter by status (pending/completed/failed/refunded)
- [ ] Transaction fee display
- [ ] Platform fee calculation
- [ ] Cancellation fee (10% capped $100)

---

## HELPER DIRECTORY (20 items)
- [ ] View helper profile (public)
- [ ] Avatar + cover image display
- [ ] Verification badges
- [ ] Overall rating + reviews
- [ ] Response time display
- [ ] Jobs completed count
- [ ] Hourly rate (min-max)
- [ ] Profile QR code
- [ ] Copy profile link
- [ ] Share profile (Web Share API)
- [ ] Report helper
- [ ] Search by name
- [ ] Filter by skill
- [ ] Filter by category
- [ ] Filter by license type
- [ ] Filter by location/radius
- [ ] Filter by country
- [ ] Sort (name/newest/rating/jobs)
- [ ] View helper skills list
- [ ] View helper services

---

## REVIEWS & RATINGS (8 items)
- [ ] View reviews on profile
- [ ] Filter reviews by rating
- [ ] View reviewer name/date/text
- [ ] Mark review helpful
- [ ] Report review
- [ ] Edit own review (if allowed)
- [ ] Delete own review (if allowed)
- [ ] Rating system (1-5 stars)

---

## BUSINESS HUB (20 items)
- [ ] Create business profile
- [ ] Edit business name/description
- [ ] Upload logo + cover photo
- [ ] Set category + service area
- [ ] Add phone/email/website/social
- [ ] Dashboard overview
- [ ] Revenue/jobs/team stats
- [ ] Currency display (location-based)
- [ ] Add team members
- [ ] Invite team via email
- [ ] Manage team permissions
- [ ] Remove team member
- [ ] Add/edit/delete services
- [ ] View invoices
- [ ] Create invoices
- [ ] Download invoice PDF
- [ ] Set business goals
- [ ] Goal progress tracking
- [ ] Analytics tab
- [ ] AI Profile tab

---

## PROFILE TEMPLATES (10 items)
- [ ] Browse 30+ templates
- [ ] View template categories (Home/Creative/Health/etc)
- [ ] Template preview modal
- [ ] Search templates
- [ ] Activate template
- [ ] Free 1-year trial on signup
- [ ] Monthly pricing ($0.99/month)
- [ ] Trial expiry display
- [ ] Switch between templates
- [ ] View on public profile

---

## AI PROFILE (8 items)
- [ ] Add AI knowledge (≤8000 chars)
- [ ] AI Profile preview page
- [ ] AI knowledge in chat context
- [ ] Sync knowledge to businesses
- [ ] Edit AI knowledge
- [ ] Delete AI knowledge
- [ ] AI expands in chat (skills, FAQs, availability)
- [ ] Profile AI expansion (helper + business)

---

## PROFILE COVER & QR (6 items)
- [ ] Upload cover image
- [ ] Cover image validation
- [ ] Cover display on public profile
- [ ] Sync cover to business
- [ ] QR code generation
- [ ] QR code download (PNG)

---

## MESSAGING (15 items)
- [ ] Send direct message
- [ ] View conversation list
- [ ] View message thread
- [ ] Message timestamp + sender avatar
- [ ] Read/unread status
- [ ] Archive conversation
- [ ] Block user
- [ ] Delete message
- [ ] Edit message
- [ ] Reply with quoting
- [ ] Message search
- [ ] Message notifications
- [ ] Browser push notifications
- [ ] Email notification
- [ ] Mention user (if available)

---

## SUPPORT WIDGET (12 items)
- [ ] Floating launcher button
- [ ] Unread badge
- [ ] Create new ticket
- [ ] View ticket history
- [ ] Live chat with support
- [ ] Ticket details page
- [ ] Close/reopen ticket
- [ ] Ticket filtering
- [ ] Message polling (5s)
- [ ] Agent status indicator
- [ ] Rate limiting on messages
- [ ] Accessibility (ARIA/keyboard nav)

---

## SUPPORT TICKETS (8 items)
- [ ] Create support ticket
- [ ] Select category + priority
- [ ] Ticket number/ID
- [ ] Reply to ticket
- [ ] Close ticket
- [ ] Reopen ticket
- [ ] View ticket list
- [ ] Email confirmation

---

## MARKETPLACE (20 items)
- [ ] Browse marketplace products
- [ ] View product images
- [ ] Product name/description/price
- [ ] Product rating + reviews
- [ ] Stock quantity display
- [ ] Add to cart
- [ ] Quick view product
- [ ] View cart
- [ ] Update quantity in cart
- [ ] Remove item from cart
- [ ] Clear cart
- [ ] Cart summary (subtotal/tax/shipping/total)
- [ ] Apply discount code
- [ ] Enter shipping address
- [ ] Select shipping method
- [ ] Tax calculation display
- [ ] Confirm order
- [ ] Order confirmation page
- [ ] Order confirmation email
- [ ] View orders list

---

## ORDERS (10 items)
- [ ] Order details page
- [ ] Order items list
- [ ] Order total breakdown
- [ ] Order status tracking (pending → paid → shipped → completed)
- [ ] Payment method display
- [ ] Shipping address display
- [ ] Tracking number
- [ ] Cancel order (if pending)
- [ ] Order history pagination
- [ ] Order search

---

## DISCOUNT CODES (8 items)
- [ ] Apply promo code in checkout
- [ ] Code validation
- [ ] Percentage discount
- [ ] Fixed amount discount
- [ ] Min/max order constraints
- [ ] Category eligibility
- [ ] Product eligibility
- [ ] Expiration date validation

---

## SHIPPING (6 items)
- [ ] Zone-based shipping rates
- [ ] Shipping cost calculation
- [ ] Weight surcharge
- [ ] Shipping address validation
- [ ] Multiple shipping options
- [ ] Estimated delivery date

---

## AFFILIATES (18 items)
- [ ] Create affiliate program
- [ ] Set commission rate
- [ ] Activate program
- [ ] Generate affiliate links
- [ ] Share affiliate links
- [ ] Click tracking
- [ ] Conversion tracking
- [ ] Commission calculation
- [ ] View pending commissions
- [ ] View confirmed commissions
- [ ] View paid commissions
- [ ] Monthly payout schedule
- [ ] Payout status
- [ ] Add bank account
- [ ] Add PayPal
- [ ] Add Stripe Connect
- [ ] Verify payout method
- [ ] View payout history

---

## AFFILIATE ANALYTICS (8 items)
- [ ] Daily metrics (clicks/conversions/revenue)
- [ ] Conversion funnel visualization
- [ ] Top performing products
- [ ] Revenue trend chart
- [ ] Device breakdown pie chart
- [ ] Top referrers list
- [ ] Conversion rate
- [ ] Export analytics (CSV)

---

## ADMIN - USER MANAGEMENT (12 items)
- [ ] View all users
- [ ] Search users
- [ ] View user details
- [ ] Edit user info
- [ ] Set user password
- [ ] Deactivate/reactivate user
- [ ] Suspend user (with reason)
- [ ] Add restrictions (bidding/posting/checkout)
- [ ] Lift restrictions
- [ ] View login history
- [ ] View user activity
- [ ] User restriction enforcement

---

## ADMIN - BUSINESS MANAGEMENT (12 items)
- [ ] View all businesses
- [ ] Filter by status (active/inactive/deleted)
- [ ] Filter by activity level
- [ ] Sort businesses
- [ ] Business detail page
- [ ] Add admin notes
- [ ] View business timeline
- [ ] Deactivate/reactivate business
- [ ] Flag business for review
- [ ] Delete business (soft delete)
- [ ] View business jobs
- [ ] View business team

---

## ADMIN - ORDER MANAGEMENT (8 items)
- [ ] View all orders
- [ ] Search orders
- [ ] Filter by status
- [ ] Order detail page
- [ ] Mark as shipped
- [ ] Add tracking number
- [ ] Process refund
- [ ] Cancel order

---

## ADMIN - PRODUCTS (6 items)
- [ ] View all products
- [ ] Add product
- [ ] Edit product
- [ ] Delete product
- [ ] Bulk import (CSV/JSON)
- [ ] Product stats dashboard

---

## ADMIN - TEMPLATES (6 items)
- [ ] View all templates
- [ ] Edit template pricing
- [ ] View template preview
- [ ] Grant template access
- [ ] Revoke template access
- [ ] View usage stats

---

## ADMIN - PRICING (5 items)
- [ ] View location-based pricing
- [ ] Edit pricing by country
- [ ] View pricing comparison
- [ ] Update bulk pricing
- [ ] View pricing history

---

## ADMIN - DISCOUNT CODES (5 items)
- [ ] Create discount code
- [ ] Edit discount code
- [ ] Delete discount code
- [ ] View usage stats
- [ ] Deactivate code

---

## ADMIN - MODERATION (10 items)
- [ ] View reports
- [ ] Flag content for review
- [ ] Moderate reviews
- [ ] Approve/reject reviews
- [ ] Delete inappropriate content
- [ ] Ban user
- [ ] Warn user
- [ ] View moderation history
- [ ] Create enforcement action
- [ ] Apply restrictions/suspension

---

## ADMIN - AUDIT LOGS (5 items)
- [ ] View admin actions log
- [ ] Filter by user/action/date
- [ ] View action details
- [ ] Export audit log (CSV)
- [ ] View affected resources

---

## NOTIFICATIONS (12 items)
- [ ] In-app toast notifications
- [ ] Notification type (success/error/warning/info)
- [ ] Auto-dismiss notification
- [ ] Manual dismiss
- [ ] Browser push notifications
- [ ] Web Push permission request
- [ ] Notification on message
- [ ] Notification on appointment reminder
- [ ] Notification on bid update
- [ ] Notification center
- [ ] Mark as read
- [ ] Delete notification

---

## EMAIL & SMS PREFERENCES (10 items)
- [ ] Email frequency selector (real-time/daily/weekly/off)
- [ ] Category-based opt-in/out
- [ ] One-click unsubscribe
- [ ] SMS opt-in/out
- [ ] Phone verification (OTP)
- [ ] OTP input validation
- [ ] SMS order notifications
- [ ] SMS payment confirmation
- [ ] SMS shipment notification
- [ ] Notification history view

---

## LEGAL & COMPLIANCE (10 items)
- [ ] View Terms of Service
- [ ] View Privacy Policy
- [ ] Cookie consent banner
- [ ] Accept all cookies
- [ ] Customize cookie preferences
- [ ] Cookie persistence
- [ ] Data export (JSON)
- [ ] Data deletion request
- [ ] Account deletion (soft delete)
- [ ] 180-day message retention

---

## INTERNATIONALIZATION (8 items)
- [ ] Language selector (EN/ES/FR/HT)
- [ ] Language toggle button
- [ ] Persist language choice
- [ ] Translated UI strings
- [ ] Translated error messages
- [ ] Translated email
- [ ] Date/number localization
- [ ] Category taxonomy translated

---

## DARK MODE (5 items)
- [ ] Dark mode toggle
- [ ] Light mode toggle
- [ ] System preference detection
- [ ] Persistent theme storage
- [ ] App-specific dark palette

---

## RESPONSIVE DESIGN (8 items)
- [ ] Mobile layout
- [ ] Tablet layout
- [ ] Desktop layout
- [ ] Touch-friendly buttons
- [ ] Mobile navigation drawer
- [ ] Responsive tables
- [ ] Responsive grids
- [ ] Viewport meta tag

---

## ACCESSIBILITY (10 items)
- [ ] ARIA labels
- [ ] Semantic HTML
- [ ] Keyboard navigation (Tab/Shift+Tab)
- [ ] Focus indicators
- [ ] Color contrast (WCAG AA)
- [ ] Alt text on images
- [ ] Form validation messages
- [ ] Screen reader support
- [ ] Skip to content link
- [ ] Error announcements

---

## FILE UPLOADS (8 items)
- [ ] Job image upload
- [ ] Profile photo upload
- [ ] Business logo upload
- [ ] Business cover upload
- [ ] Product image upload
- [ ] Document upload
- [ ] File validation (type/size)
- [ ] S3 storage + CDN URLs

---

## PERFORMANCE & ERROR HANDLING (10 items)
- [ ] Lazy loading of images
- [ ] Query pagination
- [ ] Debounced search
- [ ] Error boundaries (component level)
- [ ] Graceful fallbacks
- [ ] User-friendly error messages
- [ ] Error logging
- [ ] Retry mechanisms
- [ ] Offline fallback
- [ ] Loading indicators

---

## BACKGROUND JOBS (9 items)
- [ ] Calendar reminders (24h/2h/same-day)
- [ ] Planned Needs auto-publish
- [ ] Template expiry (1-year trial)
- [ ] Message retention cleanup (180-day)
- [ ] Affiliate commission batch
- [ ] Email digest compilation
- [ ] Consulting follow-ups
- [ ] Notification processing
- [ ] Rate limiting (Redis/in-memory)

---

## INTEGRATIONS (9 items)
- [ ] Stripe payments (API key)
- [ ] Stripe webhooks
- [ ] AWS S3 storage
- [ ] Twilio SMS
- [ ] Resend email
- [ ] Didit identity verification
- [ ] Checkr background checks
- [ ] OpenRouter AI
- [ ] Socket.IO real-time

---

## OPTIONAL ANALYTICS (5 items)
- [ ] Google Analytics 4 (consent-gated)
- [ ] Meta Pixel (consent-gated)
- [ ] Sentry error tracking
- [ ] Performance monitoring
- [ ] Usage analytics

---

**TESTING SUMMARY**

Total Features: **400+**

Features Tested: _____ / _____

Critical Issues Found: _____

Medium Issues Found: _____

Minor Issues Found: _____

Ready for Production: [ ] YES [ ] NO

**Tester Name:** ________________  
**Date:** ________________  
**Notes:** 
```
_________________________________
_________________________________
_________________________________
```

---

**Document Version:** 1.0  
**Status:** READY FOR TESTING  
**Print-Friendly Format**
