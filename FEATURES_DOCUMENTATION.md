# OxSteed - Complete Features Documentation
**Last Updated:** 2026-05-14  
**Version:** Comprehensive Testing Checklist

---

## TABLE OF CONTENTS
1. [Authentication & User Management](#authentication--user-management)
2. [Job Management](#job-management)
3. [Bidding System](#bidding-system)
4. [Calendar & Appointments](#calendar--appointments)
5. [Payments & Stripe Integration](#payments--stripe-integration)
6. [Helper Directory & Discovery](#helper-directory--discovery)
7. [Business Hub & Business Management](#business-hub--business-management)
8. [Profile System](#profile-system)
9. [Messaging & Support](#messaging--support)
10. [Marketplace & E-Commerce](#marketplace--e-commerce)
11. [Affiliates & Commissions](#affiliates--commissions)
12. [Admin & Moderation](#admin--moderation)
13. [Notifications & Preferences](#notifications--preferences)
14. [Compliance & Legal](#compliance--legal)
15. [Internationalization](#internationalization)

---

## AUTHENTICATION & USER MANAGEMENT

### Registration & Login
- [ ] User registration with email verification
- [ ] Phone-based OTP verification (Twilio)
- [ ] Social login (if configured)
- [ ] Password reset via email link
- [ ] Login with email + password
- [ ] Refresh token mechanism (15m access token, 7d refresh token)
- [ ] Logout (invalidates session server-side)
- [ ] "Remember me" functionality
- [ ] Multiple user roles: Customer, Helper, Business Owner, Admin, Super Admin

### User Profile Management
- [ ] Edit user profile (name, photo, email, phone)
- [ ] Display name customization
- [ ] Avatar upload
- [ ] Profile photo upload to S3
- [ ] Password change
- [ ] Email change with verification
- [ ] Phone number change
- [ ] Account deactivation / deletion
- [ ] View account restrictions (if suspended)

### Identity Verification
- [ ] Didit identity verification workflow
- [ ] Identity status display
- [ ] Reverification process
- [ ] Background check integration (Checkr)
- [ ] Background check status tracking
- [ ] Verification documents storage
- [ ] Data export (GDPR)

### Session Management
- [ ] Session invalidation on logout
- [ ] Session tracking (store in `sessions` table)
- [ ] Concurrent session handling
- [ ] Token revocation
- [ ] Token auto-refresh on 401
- [ ] Duplicate refresh request deduplication

---

## JOB MANAGEMENT

### Job Creation & Publishing
- [ ] Create job draft
- [ ] Post job publicly
- [ ] Select job category
- [ ] Enter job description (4000 char max)
- [ ] Set job budget/cost
- [ ] Set estimated hours (0-480)
- [ ] Set location (city, state, ZIP, country)
- [ ] Auto-geocoding of job location
- [ ] Select job skills (multi-select)
- [ ] Set job timeline
- [ ] Upload job images
- [ ] Job preview before publishing
- [ ] Job recurrence (one-time, weekly, monthly, etc.)
- [ ] Planned Needs feature (recurring job scheduling)
- [ ] Publish to marketplace

### Job Browsing & Search
- [ ] Browse all published jobs
- [ ] Search jobs by keyword
- [ ] Filter by category
- [ ] Filter by skill
- [ ] Filter by budget range
- [ ] Filter by location (radius search: 5/10/25/50/100 mi)
- [ ] Filter by country
- [ ] Sort by: newest, oldest, nearest, most bids
- [ ] "Use my location" geolocation button
- [ ] Active filter tags display
- [ ] Clear all filters
- [ ] Pagination (limit=100, offset)
- [ ] Job distance calculation
- [ ] View job details page

### Job Details
- [ ] Job title + description
- [ ] Job images gallery
- [ ] Location map display
- [ ] Budget breakdown
- [ ] Estimated hours
- [ ] Job skills list
- [ ] Job status (draft, published, matched, negotiating, accepted, in_progress, completed, cancelled, closed)
- [ ] Posting date + last updated
- [ ] Helper information (if assigned)
- [ ] Helper avatar + name
- [ ] Helper rating + reviews
- [ ] Schedule information (if booked)
- [ ] Cancellation reason (if cancelled)
- [ ] Bid count
- [ ] Bid list (if customer)
- [ ] View all bids from helper

### Job Lifecycle Management
- [ ] Start job (customer action)
- [ ] Complete job (helper action)
- [ ] Cancel job (customer action - triggers 10% fee capped at $100)
- [ ] Reschedule appointment
- [ ] View job timeline
- [ ] Job status history
- [ ] Automatic job expiry (60 days)
- [ ] Close completed job
- [ ] Mark job as urgent

### Planned Needs / Recurring Jobs
- [ ] Create planned need
- [ ] Set due date
- [ ] Set lead time (days before due date)
- [ ] Enable auto-publish feature
- [ ] Set category (for the auto-published job)
- [ ] View planned needs list
- [ ] Life Pulse indicator (healthy/watch/at risk)
- [ ] Trend analysis (vs prior 90 days)
- [ ] Coverage percentage
- [ ] Sinking fund breakdown
- [ ] View suggested helpers
- [ ] Pause/resume planned need
- [ ] Edit planned need
- [ ] Delete planned need
- [ ] Complete planned need
- [ ] View auto-published jobs from planned need
- [ ] Calendar view of planned needs

---

## BIDDING SYSTEM

### Creating Bids
- [ ] Browse jobs and place bid
- [ ] Enter bid amount (required, > $0, ≤ $10M)
- [ ] Enter estimated hours (0-480)
- [ ] Add bid message (≤ 2000 chars)
- [ ] View job details while bidding
- [ ] Submit bid

### Managing Bids
- [ ] View my bids list (paginated, limit=100)
- [ ] Filter bids by status: pending, accepted, rejected, withdrawn
- [ ] View bid details (job, amount, hours, message)
- [ ] Withdraw bid
- [ ] Accept bid (from helper perspective)
- [ ] Reject bid
- [ ] Counter-offer on bid (if available)
- [ ] Bid timeline

### Bid Status Flow
- [ ] Pending (after creation)
- [ ] Accepted (customer selected)
- [ ] Rejected (customer declined)
- [ ] Withdrawn (helper canceled)
- [ ] Converted to appointment (after acceptance)

### Duplicate Bid Prevention
- [ ] System prevents duplicate bids on same job
- [ ] Error message if attempting duplicate

---

## CALENDAR & APPOINTMENTS

### Calendar Views
- [ ] Week view (7 days, hourly slots)
- [ ] Day view (selected day, hourly slots)
- [ ] Agenda view (list format)
- [ ] Mini calendar (month grid in sidebar)
- [ ] Today circle indicator
- [ ] Selected date highlight
- [ ] Color-coded event legend

### Calendar Events
- [ ] Confirmed appointments (orange #f97316)
- [ ] Booking requests (pending)
- [ ] In-progress jobs
- [ ] Completed jobs
- [ ] Available time blocks
- [ ] Busy time blocks
- [ ] Current time indicator (red line)
- [ ] Auto-scroll to current time

### Appointment Scheduling
- [ ] Book helper directly (without job posting)
- [ ] Select time slot from availability
- [ ] Confirm booking details
- [ ] Add notes to appointment
- [ ] Optional confirmation window (1-168 hours)
- [ ] Automatic appointment creation from accepted bid
- [ ] Set appointment source (user/ai_chat)

### Availability Management (Helper)
- [ ] View helper availability
- [ ] Block time (create busy block)
- [ ] Set recurring availability
- [ ] Edit availability block
- [ ] Delete availability block
- [ ] Bulk upload availability
- [ ] View appointment slots

### Reschedule Appointments
- [ ] Initiate reschedule request
- [ ] Select new time slot
- [ ] Add reschedule reason
- [ ] Respond to reschedule (accept/decline)
- [ ] Automatic reminder adjustment on reschedule
- [ ] Stale reminder cleanup (old reminders cancelled)

### Booking Requests
- [ ] View incoming booking requests
- [ ] Accept booking request
- [ ] Decline booking request
- [ ] Confirmation required (optional)
- [ ] Pending request timeout
- [ ] Automatic confirmation after confirmation_hours

### Reminders
- [ ] 24 hour reminder (notification)
- [ ] 2 hour reminder (notification)
- [ ] Same day reminder (notification)
- [ ] Automatic reminder firing
- [ ] Reminder status tracking (pending, sent, failed)

### Calendar Sidebar Features
- [ ] Block Time CTA button (orange pill)
- [ ] Mini calendar navigation
- [ ] Event legend (color key)
- [ ] Mobile responsive layout

---

## PAYMENTS & STRIPE INTEGRATION

### Payment Intent Creation
- [ ] Create payment intent
- [ ] Idempotency key support (retry-safe)
- [ ] Client secret generation
- [ ] Return client secret for frontend confirmation
- [ ] Store payment intent details in DB

### Payment Processing
- [ ] Stripe Card Element integration
- [ ] Stripe Payment Element integration
- [ ] CVV verification
- [ ] 3D Secure (if required)
- [ ] Confirm payment on frontend
- [ ] Authorize payment (hold funds)
- [ ] Capture payment (charge funds)
- [ ] Refund payment
- [ ] Payment status tracking

### Escrow System (Tier 3)
- [ ] Manual capture for escrow (capture_method: 'manual')
- [ ] Fund authorization at checkout
- [ ] Fund capture on job completion
- [ ] Automatic refund if job cancelled
- [ ] Escrow status tracking

### Payment Plans
- [ ] One-time payment
- [ ] Subscription payment (recurring)
- [ ] Payment method storage
- [ ] Saved payment methods
- [ ] Set default payment method

### Payment Fees
- [ ] Platform fee calculation
- [ ] Transaction fee display
- [ ] Total price calculation
- [ ] Cancellation fee (10% capped $100 on job cancel)

### Payment History
- [ ] View payment history
- [ ] Filter by status (pending, completed, failed, refunded)
- [ ] Payment date display
- [ ] Payment amount display
- [ ] Payment description
- [ ] Transaction ID

### Stripe Webhooks
- [ ] payment_intent.succeeded
- [ ] payment_intent.payment_failed
- [ ] charge.refunded
- [ ] customer.subscription.created
- [ ] customer.subscription.updated
- [ ] customer.subscription.deleted
- [ ] invoice.payment_succeeded
- [ ] invoice.payment_failed
- [ ] invoice.upcoming

### Refunds & Chargebacks
- [ ] Issue refund request
- [ ] Automatic refund on job cancellation
- [ ] Refund reason tracking
- [ ] Refund status display
- [ ] Chargeback dispute notification

---

## HELPER DIRECTORY & DISCOVERY

### Helper Profiles
- [ ] View helper profile (public)
- [ ] Helper avatar + cover image
- [ ] Helper name + business name
- [ ] Helper bio/description
- [ ] Helper location + service area
- [ ] Service area map (Leaflet + OpenStreetMap)
- [ ] Verification badges (identity, background check)
- [ ] Overall rating + star count
- [ ] Review count
- [ ] Response time (hours)
- [ ] Jobs completed count
- [ ] Hourly rate display (min-max)
- [ ] Profile QR code
- [ ] Copy profile link
- [ ] Share profile button
- [ ] Report helper option
- [ ] Contact via chat / messages

### Helper Search & Filter
- [ ] Browse helpers directory
- [ ] Search by helper name
- [ ] Search by skill
- [ ] Filter by category
- [ ] Filter by license type
- [ ] Filter by insurance type
- [ ] Filter by location
- [ ] Filter by radius (5/10/25/50/100 mi)
- [ ] Filter by country
- [ ] Sort by: name, newest, oldest, most jobs, most recently active, rating
- [ ] View active filter tags
- [ ] Clear all filters
- [ ] Pagination

### Helper Skills
- [ ] View helper skills list
- [ ] Skill expertise level (beginner, intermediate, expert)
- [ ] Years of experience per skill
- [ ] Hourly rate per skill (if available)
- [ ] Skill certifications

### Helper Services
- [ ] Service name + description
- [ ] Service pricing (hourly or flat rate)
- [ ] Service duration estimate
- [ ] Service images/gallery

### Helper Reviews & Ratings
- [ ] View reviews on profile
- [ ] Filter reviews by rating
- [ ] View reviewer name + avatar
- [ ] Review date
- [ ] Review text
- [ ] Review rating (1-5 stars)
- [ ] Review helpful count
- [ ] Mark review helpful/unhelpful
- [ ] Report review

### Helper FAQs
- [ ] View FAQ list
- [ ] FAQ question + answer
- [ ] Edit FAQ (if owner)
- [ ] Delete FAQ (if owner)
- [ ] Add new FAQ (if owner)

### Helper Policies
- [ ] Cancellation policy
- [ ] Refund policy
- [ ] Response time policy
- [ ] Other custom policies

---

## BUSINESS HUB & BUSINESS MANAGEMENT

### Business Profile Management
- [ ] Create business profile
- [ ] Edit business name
- [ ] Edit business description
- [ ] Upload business logo
- [ ] Upload business cover photo
- [ ] Set business category
- [ ] Set service area (location + radius)
- [ ] Set business phone
- [ ] Set business hours
- [ ] Edit business location
- [ ] Add business email
- [ ] Link business website
- [ ] Add social media links

### Business Dashboard
- [ ] Overview tab (revenue, jobs, team stats)
- [ ] Invoices tab
- [ ] Tax settings tab
- [ ] Goals tab
- [ ] AI Profile tab (profile AI settings)
- [ ] Analytics loading + error states
- [ ] Currency display (location-based)
- [ ] Revenue chart
- [ ] Jobs posted count
- [ ] Active team members count
- [ ] Recent activity timeline

### Business Team Management
- [ ] Add team members
- [ ] Invite team members via email
- [ ] View team member list
- [ ] Manage team member roles
- [ ] Remove team member
- [ ] Team member permissions
- [ ] View invited team members
- [ ] Cancel invitation
- [ ] Resend invitation

### Business Services
- [ ] Add service
- [ ] Edit service
- [ ] Delete service
- [ ] Service name, description, pricing
- [ ] Upload service images

### Business Invoices
- [ ] View invoice list
- [ ] Filter invoices by status
- [ ] Download invoice PDF
- [ ] Send invoice to customer
- [ ] Create custom invoice
- [ ] Invoice template selection

### Business Goals
- [ ] Set business goals
- [ ] Goal target amount
- [ ] Goal timeline
- [ ] Goal progress tracking
- [ ] Edit goal
- [ ] Delete goal

### Business Analytics (Future)
- [ ] Revenue dashboard
- [ ] Customer acquisition cost
- [ ] Customer lifetime value
- [ ] Conversion rate tracking
- [ ] Service profitability analysis

---

## PROFILE SYSTEM

### Profile Templates
- [ ] Browse 30+ profile templates
- [ ] Template categories: Home, Creative, Health, Care, Events, Beauty, Tech
- [ ] Template preview
- [ ] Activate template
- [ ] Free 1-year trial on signup
- [ ] View template pricing ($0.99/month)
- [ ] Template access management

### Profile Template Features
- [ ] Template selector modal
- [ ] Category filter
- [ ] Search templates
- [ ] Preview before activation
- [ ] Start free trial
- [ ] Monthly subscription model only (lifetime removed)
- [ ] Trial expiry display
- [ ] Locked templates indication

### Profile Customization
- [ ] Active template display on public profile
- [ ] Template-specific sections
- [ ] Profile sections (About, Services, Gallery, etc.)
- [ ] Edit profile sections
- [ ] Add profile images
- [ ] Profile preview

### AI Knowledge / AI Profile
- [ ] Add AI knowledge (≤ 8000 chars)
- [ ] AI knowledge for helper profile
- [ ] AI knowledge for business profile
- [ ] AI Profile preview page
- [ ] AI context in chat (includes profile knowledge)
- [ ] AI profile expansion (skills, FAQs, products, availability summary)
- [ ] Sync AI knowledge across owner helper + businesses

### Profile Cover Image
- [ ] Upload cover image
- [ ] Cover image validation (format, size)
- [ ] Cover display on public profile
- [ ] Sync cover to business profile
- [ ] Delete cover image

### Profile QR Code
- [ ] QR code generation (encodes public profile URL)
- [ ] QR code display on profile
- [ ] QR code download (PNG, 64-512px)
- [ ] QR code in og:image (SEO prerender)

### Public Profile Display
- [ ] Helper public profile page (/helpers/:id)
- [ ] Business public profile page (/business/:id)
- [ ] Profile share controls
- [ ] Copy link to clipboard
- [ ] Web Share API
- [ ] Public display name (with preference)
- [ ] Unified discover page (mixed helpers + businesses)

---

## MESSAGING & SUPPORT

### Direct Messaging
- [ ] Send message to another user
- [ ] View conversation list
- [ ] View message thread
- [ ] Pagination of messages
- [ ] Message timestamp
- [ ] Sender avatar
- [ ] Message read/unread status
- [ ] Mark conversation read
- [ ] Archive conversation
- [ ] Block user (prevent future messages)
- [ ] Delete message (soft delete)
- [ ] Edit message (if allowed)
- [ ] Reply to message (quoting)
- [ ] Message search

### Support Widget
- [ ] Floating support launcher button
- [ ] Unread badge on launcher
- [ ] Support widget panel
- [ ] Create new ticket
- [ ] View ticket history
- [ ] Live chat with support
- [ ] View ticket details
- [ ] Close ticket
- [ ] Reopen ticket
- [ ] Ticket filtering
- [ ] Message polling (5 seconds)
- [ ] Agent status indicator
- [ ] Rate limiting on messages
- [ ] Accessibility features (ARIA labels, keyboard nav)

### Support Tickets
- [ ] Create support ticket
- [ ] Ticket title + description
- [ ] Select category
- [ ] Set priority (low, medium, high, critical)
- [ ] Email confirmation of ticket
- [ ] Ticket number/ID
- [ ] Ticket status (open, in_progress, resolved)
- [ ] View ticket history
- [ ] Reply to ticket
- [ ] Close ticket
- [ ] Reopen ticket
- [ ] View support ticket list

### Live Chat
- [ ] Real-time chat with support agent
- [ ] Message history
- [ ] Agent availability indicator
- [ ] Agent typing indicator
- [ ] Message sent/delivered/read indicators
- [ ] Quick reply templates (if agent)
- [ ] Chat transcript download (future)

### Support Knowledge Base
- [ ] Search KB articles
- [ ] KB article categories
- [ ] View KB article
- [ ] Mark article helpful
- [ ] View related articles
- [ ] Contact support from KB

### Notifications
- [ ] New message notification
- [ ] Message preview in notification
- [ ] Notification sound (if enabled)
- [ ] Browser notification
- [ ] In-app notification toast
- [ ] Dismiss notification
- [ ] Notification history

### Email Preferences
- [ ] Email frequency selector (real-time, daily, weekly, off)
- [ ] Category-based email opt-in/out
- [ ] Email digest compilation
- [ ] One-click unsubscribe from email
- [ ] Unsubscribe token per user

### SMS Notifications
- [ ] SMS opt-in
- [ ] Phone number verification (OTP)
- [ ] OTP input and verification
- [ ] SMS notifications for events:
  - Order created
  - Payment confirmed
  - Order shipped
  - Order cancelled
  - Order refunded
- [ ] SMS delivery tracking
- [ ] SMS history view

---

## MARKETPLACE & E-COMMERCE

### Shopping Cart
- [ ] Add product to cart
- [ ] View cart
- [ ] Update quantity
- [ ] Remove item from cart
- [ ] Clear cart
- [ ] Cart summary (subtotal, tax, shipping, total)
- [ ] Cart persistence (localStorage)
- [ ] Shared cart feature
- [ ] Share cart with link
- [ ] View shared cart
- [ ] Add to cart from shared link

### Checkout
- [ ] Stripe Payment Element integration
- [ ] Enter payment details
- [ ] Apply discount/promo code
- [ ] Shipping address entry
- [ ] Shipping method selection
- [ ] Tax calculation
- [ ] Order summary review
- [ ] Confirm order
- [ ] Payment processing
- [ ] Order confirmation page
- [ ] Order confirmation email

### Orders
- [ ] View orders list
- [ ] Filter by status (pending, paid, completed, cancelled)
- [ ] Order details page
- [ ] Order items list
- [ ] Order total breakdown
- [ ] Order status tracking (pending → paid → shipped → completed)
- [ ] Order date
- [ ] Payment method used
- [ ] Shipping address
- [ ] Shipping status
- [ ] Tracking number
- [ ] Cancel order (if pending)
- [ ] Order history pagination
- [ ] Order search

### Products
- [ ] Browse marketplace products
- [ ] Product image gallery
- [ ] Product name + description
- [ ] Product price
- [ ] Product category
- [ ] Product rating
- [ ] Product reviews
- [ ] Stock quantity display
- [ ] Add to cart
- [ ] Quick view product details
- [ ] Product specifications

### Discount Codes / Promo Codes
- [ ] Apply discount code in checkout
- [ ] Discount code validation
- [ ] Percentage discount
- [ ] Fixed amount discount
- [ ] Min/max order value constraints
- [ ] Category-level eligibility
- [ ] Product-level eligibility
- [ ] Usage limits
- [ ] Expiration date validation
- [ ] Display discount savings

### Shipping
- [ ] Zone-based shipping rates
- [ ] Shipping cost calculation
- [ ] Weight surcharge
- [ ] Per-item charges
- [ ] Shipping address validation
- [ ] Multiple shipping options
- [ ] Estimated delivery date
- [ ] Tracking information

### Taxes
- [ ] Automatic tax calculation
- [ ] US state tax rates
- [ ] International VAT/GST support
- [ ] Tax display in checkout
- [ ] Tax breakdown in order

---

## AFFILIATES & COMMISSIONS

### Affiliate Program Management
- [ ] Create affiliate program
- [ ] Program type selection (Home Depot, Amazon, custom)
- [ ] Commission rate setting
- [ ] Program activation
- [ ] View program details
- [ ] Edit program settings
- [ ] Affiliate link generation
- [ ] Share affiliate links

### Affiliate Tracking
- [ ] Click tracking on affiliate links
- [ ] Conversion tracking
- [ ] Order attribution
- [ ] Click source tracking
- [ ] Visitor session tracking
- [ ] Device breakdown analytics

### Commissions
- [ ] Commission calculation
- [ ] Pending commissions list
- [ ] Confirmed commissions list
- [ ] Paid commissions list
- [ ] Commission amount display
- [ ] Commission status tracking
- [ ] Commission date range

### Affiliate Analytics
- [ ] Daily metrics (clicks, conversions, revenue)
- [ ] Conversion funnel visualization
- [ ] Top performing products
- [ ] Revenue trend chart
- [ ] Device breakdown pie chart
- [ ] Top referrers list
- [ ] Average order value
- [ ] Conversion rate calculation
- [ ] Export analytics (CSV)

### Affiliate Payouts
- [ ] Monthly payout schedule
- [ ] Payout status (pending, processed, failed)
- [ ] Payout method selection (bank account, PayPal, Stripe Connect)
- [ ] Payout amount calculation
- [ ] View payout history
- [ ] Payout details page
- [ ] Manual payout initiation
- [ ] Payout receipt/confirmation
- [ ] Tax reporting

### Payout Methods
- [ ] Add bank account
- [ ] Add PayPal account
- [ ] Add Stripe Connect account
- [ ] Verify payout method
- [ ] Delete payout method
- [ ] Set default payout method

---

## ADMIN & MODERATION

### Admin Dashboard
- [ ] Admin home page
- [ ] Key metrics display
- [ ] Recent activity feed
- [ ] Quick stats cards
- [ ] Navigation to admin sections

### User Management (Admin)
- [ ] View all users
- [ ] Search users by email/name
- [ ] Filter users by status
- [ ] View user details
- [ ] Edit user information
- [ ] Set user password
- [ ] Deactivate/reactivate user
- [ ] Suspend user (with reason)
- [ ] Add user restrictions (bidding, job posting, checkout)
- [ ] Lift restrictions
- [ ] View user login history
- [ ] View user activity

### Business Management (Admin)
- [ ] View all businesses
- [ ] Filter by status (active, inactive, deleted)
- [ ] Filter by activity level
- [ ] Sort businesses (name, created date, jobs posted)
- [ ] Business detail page
- [ ] Edit business information
- [ ] Add admin notes (≤2000 chars)
- [ ] View business timeline
- [ ] Deactivate/reactivate business
- [ ] Flag business for review
- [ ] Delete business (soft delete)
- [ ] View business jobs
- [ ] View business team members

### Job Management (Admin)
- [ ] View all jobs
- [ ] Search jobs
- [ ] Filter by status
- [ ] Filter by date range
- [ ] Job detail page
- [ ] View bids on job
- [ ] View payments
- [ ] Cancel job
- [ ] Flag job for review
- [ ] Delete job

### Order Management (Admin)
- [ ] View all orders
- [ ] Search orders
- [ ] Filter by status (pending, paid, shipped, completed, cancelled)
- [ ] Order detail page
- [ ] View order items
- [ ] View customer info
- [ ] Mark order as shipped
- [ ] Add tracking number
- [ ] Process refund
- [ ] Cancel order
- [ ] View order timeline

### Products Management (Admin)
- [ ] View all marketplace products
- [ ] Add product
- [ ] Edit product
- [ ] Delete product
- [ ] Set product price
- [ ] Manage product images
- [ ] Set affiliate URL
- [ ] Bulk product import (CSV/JSON)
- [ ] Product stats dashboard

### Pricing Overrides (Admin)
- [ ] View location-based pricing
- [ ] Edit pricing by country
- [ ] PPP (Purchasing Power Parity) pricing
- [ ] View pricing comparison (min/max/avg by currency)
- [ ] Update bulk pricing
- [ ] Sync prices to Stripe
- [ ] View pricing history

### Discount Code Management (Admin)
- [ ] Create discount code
- [ ] Edit discount code
- [ ] Delete discount code
- [ ] View code usage stats
- [ ] Set code constraints
- [ ] View active codes
- [ ] Deactivate code

### Templates Management (Admin)
- [ ] View all templates
- [ ] Edit template pricing
- [ ] View template preview
- [ ] Grant template access to users
- [ ] Revoke template access
- [ ] View access grants
- [ ] View template usage stats
- [ ] Edit template details

### Moderation
- [ ] View reports
- [ ] Flag content for review
- [ ] Moderate reviews
- [ ] Approve/reject reviews
- [ ] Delete inappropriate content
- [ ] Ban user
- [ ] Warn user
- [ ] View moderation history
- [ ] Moderation queue

### Enforcement Actions
- [ ] Create enforcement action
- [ ] Select action type (warning, restriction, suspension)
- [ ] Apply restrictions
- [ ] Set suspension duration
- [ ] View enforcement history
- [ ] Deactivate enforcement action
- [ ] Appeal enforcement action
- [ ] View appeals

### Audit Logs
- [ ] View admin actions log
- [ ] Filter by user
- [ ] Filter by action type
- [ ] Filter by date range
- [ ] View action details
- [ ] Export audit log (CSV)
- [ ] View affected resources

### Settings (Admin)
- [ ] General settings
- [ ] Email settings
- [ ] SMS settings
- [ ] Notification settings
- [ ] Integration settings
- [ ] Automation rules
- [ ] Working hours

---

## NOTIFICATIONS & PREFERENCES

### In-App Notifications
- [ ] Toast notifications
- [ ] Notification message
- [ ] Notification type (success, error, warning, info)
- [ ] Auto-dismiss after delay
- [ ] Manual dismiss
- [ ] Notification sound
- [ ] Notification count badge

### Browser Notifications
- [ ] Web Push notifications
- [ ] Request permission
- [ ] Push notification on new message
- [ ] Push notification on appointment reminder
- [ ] Push notification on bid update
- [ ] Click notification to navigate

### Notification Center
- [ ] View all notifications
- [ ] Notification timeline
- [ ] Mark as read
- [ ] Mark all as read
- [ ] Delete notification
- [ ] Filter notifications

### Email Notifications
- [ ] Account creation welcome email
- [ ] Password reset email
- [ ] Email verification OTP
- [ ] Password change confirmation
- [ ] Login notification (if suspicious)
- [ ] Job posting confirmation
- [ ] Bid notification
- [ ] Appointment reminder
- [ ] Payment confirmation
- [ ] Order confirmation
- [ ] Refund notification
- [ ] Message notification
- [ ] Support ticket update
- [ ] Transactional emails

### SMS Notifications
- [ ] Registration verification code
- [ ] Password reset code
- [ ] Login verification (if enabled)
- [ ] Appointment reminder
- [ ] Order status updates
- [ ] Payment confirmation
- [ ] Message notification
- [ ] Support ticket update

### Notification Preferences
- [ ] Email frequency (real-time, daily, weekly, off)
- [ ] SMS opt-in/out
- [ ] Phone number verification
- [ ] Notification category toggles
- [ ] Do Not Disturb hours
- [ ] Notification language preference
- [ ] Unsubscribe from all marketing emails
- [ ] Re-subscribe to emails

---

## COMPLIANCE & LEGAL

### Terms of Service
- [ ] Static Terms page
- [ ] Table of contents with anchors
- [ ] Search functionality
- [ ] Smooth scroll navigation
- [ ] Multilingual support (EN/ES/FR/HT)
- [ ] Printable version
- [ ] Updated date display

### Privacy Policy
- [ ] Static Privacy page
- [ ] 13 sections (collection, usage, sharing, security, etc.)
- [ ] Table of contents
- [ ] Search functionality
- [ ] Multilingual support
- [ ] Printable version
- [ ] Data handling explanations

### Cookie Consent
- [ ] Cookie consent banner
- [ ] Accept all / customize options
- [ ] Essential cookies (always enabled)
- [ ] Analytics cookies (Google Analytics 4)
- [ ] Marketing cookies (Meta Pixel)
- [ ] Cookie preferences storage
- [ ] One-click unsubscribe option
- [ ] Privacy policy link in banner

### Data Privacy & GDPR
- [ ] Data export (JSON format)
- [ ] Data deletion request
- [ ] Account deletion (soft delete)
- [ ] Personal data download
- [ ] 180-day message retention
- [ ] Automatic message deletion after 180 days
- [ ] Legal hold (bypass auto-deletion)
- [ ] Compliance hold support

### User Restrictions & Enforcement
- [ ] Bidding restrictions
- [ ] Job posting restrictions
- [ ] Checkout restrictions
- [ ] Account suspension (with expiry)
- [ ] Account restriction (with expiry)
- [ ] Restriction reason display
- [ ] Expiry date display
- [ ] Appeal restriction

---

## INTERNATIONALIZATION

### Supported Languages
- [ ] English (EN)
- [ ] Spanish (ES)
- [ ] French (FR)
- [ ] Haitian Creole (HT)

### Language Switching
- [ ] Language selector in navbar
- [ ] Language toggle button
- [ ] Persist language choice (localStorage)
- [ ] Default language detection
- [ ] Theme-aware styling per language

### Translated Content
- [ ] All UI strings translated
- [ ] Navigation labels translated
- [ ] Form labels translated
- [ ] Button text translated
- [ ] Error messages translated
- [ ] Toast notifications translated
- [ ] Email templates translated
- [ ] Legal content translated
- [ ] Category taxonomy translated
- [ ] Namespace coverage: ~4,690 leaf keys per locale

### Language-Specific Features
- [ ] Currency localization (USD, EUR, GBP, CAD, MXN, BRL, INR)
- [ ] Date format localization
- [ ] Number format localization
- [ ] Right-to-left support (future)
- [ ] Pluralization rules
- [ ] Context-specific translations

---

## ADDITIONAL FEATURES

### Search & Discovery
- [ ] Global search (jobs, helpers, products)
- [ ] Search suggestions
- [ ] Search history (if saved)
- [ ] Trending searches

### Dark Mode
- [ ] Dark mode toggle
- [ ] Light mode toggle
- [ ] System preference detection
- [ ] Persistent theme storage (localStorage)
- [ ] Dark mode CSS variables
- [ ] App-specific dark palette
- [ ] Homepage distinct palette (warm earth tones)

### Responsive Design
- [ ] Mobile-optimized layout
- [ ] Tablet-optimized layout
- [ ] Desktop layout
- [ ] Touch-friendly buttons
- [ ] Mobile navigation drawer
- [ ] Responsive tables
- [ ] Responsive grids

### Accessibility
- [ ] ARIA labels on interactive elements
- [ ] Semantic HTML
- [ ] Keyboard navigation
- [ ] Focus indicators
- [ ] Color contrast (WCAG AA)
- [ ] Alt text on images
- [ ] Form validation messages
- [ ] Screen reader support
- [ ] Skip to content link

### Performance
- [ ] Lazy loading of images
- [ ] Database query pagination
- [ ] Caching strategies
- [ ] Debounced search
- [ ] Optimized bundle size
- [ ] Code splitting

### Error Handling
- [ ] Error boundaries (component level)
- [ ] Graceful fallbacks
- [ ] User-friendly error messages
- [ ] Error logging
- [ ] Retry mechanisms
- [ ] Offline fallback page

### API & Integration
- [ ] Stripe payment integration
- [ ] Stripe webhooks
- [ ] AWS S3 file storage
- [ ] Twilio SMS integration
- [ ] Resend email integration
- [ ] Didit identity verification
- [ ] Checkr background checks
- [ ] OpenRouter AI integration
- [ ] Socket.IO real-time messaging
- [ ] Google Analytics 4 (consent-gated)
- [ ] Meta Pixel (consent-gated)

### Background Jobs / Cron
- [ ] Calendar notification reminders (24h, 2h, same-day)
- [ ] Planned Needs auto-publish scheduler
- [ ] Template expiry job (1-year trial expiration)
- [ ] Message retention cleanup (180-day auto-delete)
- [ ] Affiliate commission batch processing
- [ ] Email digest compilation (daily/weekly)
- [ ] Consulting no-show follow-up
- [ ] Consulting post-session follow-up
- [ ] Affiliate commission calculation

### Rate Limiting
- [ ] General API rate limit (100 req / 15 min / IP)
- [ ] Auth endpoint rate limit (15 req / 15 min / IP)
- [ ] Strict operations rate limit (5 req / hour / IP)
- [ ] SMS verification rate limit (5 attempts / hour)
- [ ] Message sending rate limit (per conversation)

### File Uploads
- [ ] Job image upload
- [ ] Profile photo upload
- [ ] Business logo upload
- [ ] Business cover photo upload
- [ ] Product image upload
- [ ] Document upload (W-9, background checks)
- [ ] File validation (type, size)
- [ ] S3 storage with CDN URLs

---

## TESTING NOTES

### High Priority Test Areas
1. Authentication (register, login, refresh, logout)
2. Job lifecycle (create, bid, accept, complete, cancel)
3. Payments (create intent, capture, refund)
4. Calendar & appointments (schedule, reschedule, reminders)
5. Marketplace checkout (cart, payment, order confirmation)
6. Accessibility (keyboard nav, screen reader, focus)

### Medium Priority Test Areas
1. Helper discovery & search filters
2. Business hub analytics
3. Planned Needs auto-publish
4. Profile templates
5. Support widget
6. Admin moderation features
7. Notifications & email preferences

### Known Environment Constraints
- [ ] Jest tests require Node.js setup (not available in current environment)
- [ ] Database required for full integration testing
- [ ] Manual testing recommended before deployment
- [ ] Load testing not completed (production readiness: 49%)

### Critical Pre-Production Items
- [ ] Monitoring & alerting setup (Datadog/Sentry/Logtail)
- [ ] Database backup & restoration testing
- [ ] Incident response runbooks
- [ ] Load testing (100+ concurrent users)
- [ ] Deployment & rollback procedures

---

**Document Version:** 1.0  
**Last Generated:** 2026-05-14  
**Scope:** Comprehensive feature inventory for testing purposes  
**Status:** COMPLETE - Ready for testing
