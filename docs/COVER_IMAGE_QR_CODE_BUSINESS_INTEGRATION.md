# Business Profile Cover Image & QR Code Integration

## Overview

This extends the cover image and QR code features to business profiles, mirroring the helper profile implementation.

**What's Added:**
- `cover_image_url` column to businesses table (Migration 178)
- Business-specific QR code generator utility
- Business profile image controller
- Business profile image routes
- Same UI components (reused from helper implementation)

## What's the Same

The UI components are identical and work for both helpers and businesses:
- `CoverImageUpload.jsx`
- `QRCodeDisplay.jsx`
- `ProfileHeader.jsx`

The only difference is the backend endpoints and URL generation.

## Backend Changes

### Migration 178: `business_profile_cover_image.sql`
Adds `cover_image_url VARCHAR(2048)` to businesses table

### New Utility: `businessQRCodeGenerator.js`
Mirrors helper QR code generation but for businesses:
- `buildBusinessProfileURL()` - Creates `/business/:id` URLs
- `generateBusinessProfileQRCode()` - Generate QR for business
- `generateBusinessQRCodeSizes()` - Generate multiple sizes

### New Controller: `businessProfileImageController.js`
Same functions as helper controller but for businesses:
- `uploadCoverImage()` - PUT `/api/business-profile/cover-image`
- `deleteCoverImage()` - DELETE `/api/business-profile/cover-image`
- `generateQRCode()` - GET `/api/business-profile/:businessId/qr-code`
- `generateMultiSizeQRCode()` - GET `/api/business-profile/:businessId/qr-code/multi-size`
- `getBusinessProfileWithCover()` - GET `/api/business-profile/:businessId/public`

### New Routes: `businessProfileImages.js`
Registered at `/api/business-profile`

## Integration Steps

### Phase 1: Backend (15 minutes)

#### Step 1.1: Apply Migration
```bash
# Run migrations:
npm run migrate
# Verify: SELECT * FROM businesses LIMIT 1; should show cover_image_url
```

#### Step 1.2: Verify New Files Exist
- `server/utils/businessQRCodeGenerator.js`
- `server/controllers/businessProfileImageController.js`
- `server/routes/businessProfileImages.js`

#### Step 1.3: Register Routes
In `server/index.js`, add around line 100:
```javascript
const businessProfileImageRoutes = require('./routes/businessProfileImages');
app.use('/api/business-profile', businessProfileImageRoutes);
```

**Verify:** Restart server, test:
```bash
curl http://localhost:5000/api/business-profile/test-id/qr-code
# Should return QR code JSON or 404 (business not found)
```

### Phase 2: Frontend (25 minutes)

#### Step 2.1: Add to Business Profile Page
Edit: `client/src/pages/BusinessProfilePage.jsx`

**Add imports:**
```typescript
import ProfileHeader from '../components/profile/ProfileHeader';
```

**Add cover image to page header:**
```jsx
<ProfileHeader
  helperId={businessId}
  helperName={businessData?.business_name}
  coverImageUrl={businessData?.coverImageUrl}
/>
```

(Note: `helperId` parameter name is reused; it works for both)

**Verify:** Business profile now shows cover image + QR badge

#### Step 2.2: Add to Business Edit/Settings Page
Edit: `client/src/pages/BusinessHubPage.jsx` or settings page

**Add imports:**
```typescript
import CoverImageUpload from '../components/profile/CoverImageUpload';
```

**Add to edit form:**
```jsx
<CoverImageUpload
  currentCoverUrl={businessData?.coverImageUrl}
  onUploadSuccess={(url) => {
    setBusinessData(prev => ({
      ...prev,
      coverImageUrl: url
    }));
  }}
  onError={(error) => {
    toast.error(error);
  }}
/>
```

**Verify:** Business settings now has cover image upload

#### Step 2.3: Add QR Code Display (Optional)
Edit: `client/src/pages/BusinessDashboard.jsx`

**Add import:**
```typescript
import QRCodeDisplay from '../components/profile/QRCodeDisplay';
```

**Add to dashboard:**
```jsx
<div className="dashboard-qr-section">
  <h3>Share Your Business</h3>
  <QRCodeDisplay
    helperId={businessId}
    helperName={businessData?.business_name}
  />
</div>
```

(Note: Component uses `helperId` parameter name; works for both types)

**Verify:** Business dashboard has QR section

### Phase 3: API Integration (10 minutes)

#### Step 3.1: Update Business Profile API
If `GET /api/businesses/:id` doesn't return `coverImageUrl`, update:

**File:** `server/controllers/businessController.js`

```javascript
// In SELECT, add:
b.cover_image_url as coverImageUrl,

// In response transform:
coverImageUrl: business.cover_image_url,
```

**Verify:** `curl http://localhost:5000/api/businesses/[id]` returns `coverImageUrl`

#### Step 3.2: Update Business Discover API
If `GET /api/discover` returns business cards, add cover image:

```javascript
// In SELECT:
b.cover_image_url

// In response:
coverImageUrl: business.cover_image_url,
```

## Testing Checklist

### Business Cover Image Tests
- [ ] Business owner uploads cover image
- [ ] Cover displays on public business profile
- [ ] Cover displays on business discover cards
- [ ] Delete cover image works
- [ ] Invalid files rejected
- [ ] File size limit enforced

### Business QR Code Tests
- [ ] QR badge appears on business profile
- [ ] QR overlay shows on hover
- [ ] QR encodes `/business/:id` URL
- [ ] QR scans correctly
- [ ] Download button works
- [ ] Share button works
- [ ] Size selector changes QR
- [ ] API returns correct business ID

### Integration Tests
- [ ] Business profile page shows cover + QR
- [ ] Business settings page has upload form
- [ ] Business dashboard has QR display
- [ ] Mobile responsive layout works
- [ ] Dark mode styling correct
- [ ] Components reuse between helpers/businesses

## API Examples

```bash
# Upload business cover image
curl -X PUT http://localhost:5000/api/business-profile/cover-image \
  -H "Authorization: Bearer $TOKEN" \
  -F "image=@/path/to/image.jpg"

# Generate business QR code
curl "http://localhost:5000/api/business-profile/business-uuid/qr-code?size=medium"

# Delete business cover
curl -X DELETE http://localhost:5000/api/business-profile/cover-image \
  -H "Authorization: Bearer $TOKEN"

# Get business profile with cover
curl "http://localhost:5000/api/business-profile/business-uuid/public"
```

## Key Differences from Helpers

| Feature | Helpers | Businesses |
|---------|---------|-----------|
| Table | `helper_profiles` | `businesses` |
| Profile URL | `/helpers/:id` | `/business/:id` |
| Upload endpoint | `/api/helper-profile/cover-image` | `/api/business-profile/cover-image` |
| QR code endpoint | `/api/helper-profile/:id/qr-code` | `/api/business-profile/:id/qr-code` |
| QR generator util | `qrCodeGenerator.js` | `businessQRCodeGenerator.js` |
| Controller | `helperProfileImageController.js` | `businessProfileImageController.js` |
| Auth check | User ID (helper_id) | User ID (owner of business) |

## UI Component Reuse

All three components are generic and work for both:
- Parameter names are `helperId` and `helperName` (legacy naming)
- Components don't care if it's a helper or business
- QR codes automatically point to correct URL via backend

```jsx
// Works for helpers:
<ProfileHeader helperId={helperId} coverImageUrl={helperCoverUrl} />

// Works for businesses:
<ProfileHeader helperId={businessId} coverImageUrl={businessCoverUrl} />

// Backend returns correct URL:
// Helper: /helpers/:helperId
// Business: /business/:businessId
```

## Database Schema

### Helper Profiles
```sql
ALTER TABLE helper_profiles ADD cover_image_url VARCHAR(2048);
CREATE INDEX idx_helper_profiles_cover_image_url ON helper_profiles(cover_image_url);
```

### Business Profiles
```sql
ALTER TABLE businesses ADD cover_image_url VARCHAR(2048);
CREATE INDEX idx_businesses_cover_image_url ON businesses(cover_image_url);
```

Both identical structure - just on different tables.

## Files Created

- `server/migrations/178_business_profile_cover_image.sql`
- `server/utils/businessQRCodeGenerator.js`
- `server/controllers/businessProfileImageController.js`
- `server/routes/businessProfileImages.js`

**Reused from Helper Implementation:**
- `client/src/components/profile/ProfileHeader.jsx` (works for both)
- `client/src/components/profile/CoverImageUpload.jsx` (works for both)
- `client/src/components/profile/QRCodeDisplay.jsx` (works for both)
- All CSS files (work for both)
- i18n keys (work for both)

## Summary

✅ **Business Cover Images**
- Single image per business
- Same S3 storage as helpers
- Same upload interface
- Same delete functionality

✅ **Business QR Codes**
- On-the-fly generation
- Points to `/business/:id`
- Same size options as helpers
- Same download/share options

✅ **Component Reuse**
- Three components work for both helpers and businesses
- No duplicate code needed
- Same UX for both user types

Ready to integrate! Follow Phase 1-3 in order.

## Quick Summary for Users

Businesses now get the same cool features as helpers:
1. Upload a cover image to make their profile stand out
2. Get a QR code that points to their business profile
3. Share the QR code on cards, flyers, social media, etc.
4. Download the QR code as PNG
5. Mobile-friendly interface

Everything reuses the existing components - just with different endpoints and URLs!
