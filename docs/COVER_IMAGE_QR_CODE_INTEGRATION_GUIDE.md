# Cover Image & QR Code Feature Integration Guide

## Overview

This guide documents the implementation of two complementary features for helper profiles:

1. **Cover Image Upload** - Helpers can upload a background/cover image (1200x400 recommended)
2. **QR Code Display** - A QR code pointing to the helper's public profile, generated on-the-fly

## Architecture

### Database Schema (Migration 177)

**New Column:**
```sql
ALTER TABLE helper_profiles ADD COLUMN cover_image_url VARCHAR(2048);
```

- Single cover image URL per helper
- Stored as S3 URL
- Nullable (not required)

### Backend Implementation

#### Controller: `helperProfileImageController.js`

**Key Functions:**

1. **`uploadCoverImage()`** - PUT `/api/helper-profile/cover-image`
   - Accepts multipart file upload
   - Validates file type (JPEG, PNG, WebP)
   - Validates file size (max 5MB)
   - Uploads to S3
   - Deletes old cover if exists
   - Returns new cover URL

2. **`deleteCoverImage()`** - DELETE `/api/helper-profile/cover-image`
   - Removes cover image URL from database
   - Flags old image for deletion from S3

3. **`generateQRCode()`** - GET `/api/helper-profile/:helperId/qr-code`
   - Generates QR code on-the-fly (no storage)
   - Encodes helper profile URL
   - Query params: `size` (small/medium/large or custom px), `format` (dataurl/buffer/svg)
   - Returns as data URL, PNG buffer, or SVG

4. **`generateMultiSizeQRCode()`** - GET `/api/helper-profile/:helperId/qr-code/multi-size`
   - Generates 3 sizes at once (150px, 300px, 500px)
   - Useful for admin dashboard or bulk operations

5. **`getHelperProfileWithCover()`** - GET `/api/helper-profile/:helperId/public`
   - Fetches helper profile with cover image URL
   - Public endpoint (no auth required)

#### Utility: `qrCodeGenerator.js`

**Key Functions:**

- `generateQRCodeDataURL()` - Generate as base64 data URL (browser-ready)
- `generateQRCodeBuffer()` - Generate as PNG buffer (for downloads)
- `generateQRCodeSVG()` - Generate as SVG string (scalable)
- `buildHelperProfileURL()` - Construct profile URL for QR encoding
- `generateHelperProfileQRCode()` - Wrapper that handles all formats
- `generateQRCodeSizes()` - Generate multiple sizes at once
- `validateURL()` - Validate URL before encoding

**Dependencies:**
```json
{
  "qrcode": "^1.5.3"
}
```

Install: `npm install qrcode`

### Routes

All routes automatically integrated via registration in server/index.js:

```javascript
// Add to server/index.js around line 100
const helperProfileImageRoutes = require('./routes/helperProfileImages');
app.use('/api/helper-profile', helperProfileImageRoutes);
```

**Endpoints:**

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| PUT | `/api/helper-profile/cover-image` | Required | Upload/update cover |
| DELETE | `/api/helper-profile/cover-image` | Required | Delete cover |
| GET | `/api/helper-profile/:id/qr-code?size=medium&format=dataurl` | Public | Generate QR code |
| GET | `/api/helper-profile/:id/qr-code/multi-size` | Public | Generate 3 sizes |
| GET | `/api/helper-profile/:id/public` | Public | Get profile with cover |

## Frontend Implementation

### Component 1: ProfileHeader.jsx

**Purpose:** Displays cover image with QR code overlay in top-right corner

**Usage:**
```jsx
import ProfileHeader from '../components/profile/ProfileHeader';

<ProfileHeader
  helperId={helperId}
  helperName={helperName}
  coverImageUrl={coverImageUrl}
/>
```

**Features:**
- Shows cover image or placeholder
- QR code badge in top-right (always visible on hover)
- QR code overlay with download & share buttons (on hover)
- Lazy loads QR code (only when needed)
- Mobile responsive (QR always visible on small screens)
- Responsive aspect ratios: 3:1 desktop, 2:1 tablet, 16:9 mobile

**Styling:**
- Orange QR badge (#f97316)
- Smooth hover transitions
- White QR code container with shadow
- Small action buttons (download, share)

### Component 2: CoverImageUpload.jsx

**Purpose:** Allows helpers to upload/update their cover image

**Usage:**
```jsx
import CoverImageUpload from '../components/profile/CoverImageUpload';

<CoverImageUpload
  currentCoverUrl={currentCoverUrl}
  onUploadSuccess={(url) => { /* handle */ }}
  onError={(error) => { /* handle */ }}
/>
```

**Features:**
- Drag & drop support
- Click to select file
- Preview before upload
- File validation (type, size)
- Upload progress feedback
- Delete button on preview
- Success/error messages
- Recommended dimensions (1200x400)

**Validation:**
- Types: JPEG, PNG, WebP
- Max size: 5MB
- Recommended: 1200x400px (3:1 ratio)

### Component 3: QRCodeDisplay.jsx

**Purpose:** Dedicated QR code display with controls

**Usage:**
```jsx
import QRCodeDisplay from '../components/profile/QRCodeDisplay';

<QRCodeDisplay
  helperId={helperId}
  helperName={helperName}
/>
```

**Features:**
- Generates QR code on-the-fly
- Size selector (small/medium/large)
- Download as PNG
- Copy profile link
- Share via Web Share API (with clipboard fallback)
- Real-time regeneration on size change
- Loading and error states

**Styling:**
- Clean card layout
- 3-button action row
- Size selector with icons
- Info box with usage tips

## Integration Steps

### Phase 1: Backend Setup (20 minutes)

#### Step 1.1: Apply Migration
```bash
# Migration file is ready:
# server/migrations/177_helper_profile_cover_image.sql

# Run migrations:
npm run migrate
```

Verify: `SELECT * FROM helper_profiles LIMIT 1;` should show `cover_image_url` column.

#### Step 1.2: Install QR Code Package
```bash
npm install qrcode
```

#### Step 1.3: Register Routes
In `server/index.js`, add around line 100:
```javascript
const helperProfileImageRoutes = require('./routes/helperProfileImages');
app.use('/api/helper-profile', helperProfileImageRoutes);
```

**Verify:** Restart server, test:
```bash
curl http://localhost:5000/api/helper-profile/test-id/qr-code
# Should return QR code JSON or 404 (helper not found)
```

### Phase 2: Frontend Components (30 minutes)

#### Step 2.1: Verify Component Files
All files should exist:
```
client/src/components/profile/
  ProfileHeader.jsx + .css
  CoverImageUpload.jsx + .css
  QRCodeDisplay.jsx + .css
```

Check for syntax errors:
```bash
cd client && npm run build 2>&1 | grep -i "profile\|cover\|qr"
```

#### Step 2.2: Add to Helper Profile Page
Edit: `client/src/pages/HelperBusinessProfilePage.tsx`

**Add imports:**
```typescript
import ProfileHeader from '../components/profile/ProfileHeader';
```

**Add cover image to page header** (replace any existing cover/banner):
```jsx
<ProfileHeader
  helperId={helperId}
  helperName={`${helperData?.first_name} ${helperData?.last_name}`}
  coverImageUrl={helperProfileData?.coverImageUrl}
/>
```

**Verify:** Public profile now shows cover image + QR badge

#### Step 2.3: Add to Edit Profile Tab
Edit: `client/src/pages/EditProfileTab.jsx` (or dashboard edit page)

**Add import:**
```typescript
import CoverImageUpload from '../components/profile/CoverImageUpload';
```

**Add to edit form** (near top of profile edit):
```jsx
<CoverImageUpload
  currentCoverUrl={helperProfileData?.coverImageUrl}
  onUploadSuccess={(url) => {
    // Update local state
    setHelperProfileData(prev => ({
      ...prev,
      coverImageUrl: url
    }));
  }}
  onError={(error) => {
    // Show error toast
    toast.error(error);
  }}
/>
```

**Verify:** Edit profile now has cover image upload section

#### Step 2.4: Add QR Code Display (Optional - Dashboard)
Edit: `client/src/pages/HelperDashboard.jsx` or similar

**Add import:**
```typescript
import QRCodeDisplay from '../components/profile/QRCodeDisplay';
```

**Add to dashboard:**
```jsx
<div className="dashboard-qr-section">
  <h3>Share Your Profile</h3>
  <QRCodeDisplay
    helperId={userId}
    helperName={helperData?.first_name}
  />
</div>
```

**Verify:** Dashboard has QR code section with download/share buttons

### Phase 3: Translations (20 minutes)

Add to `client/src/locales/en.json`:

```json
{
  "profile": {
    "coverImage": {
      "title": "Profile Cover Image",
      "subtitle": "Upload a background image for your profile header",
      "dragOrClick": "Drag and drop your image here, or click to select",
      "formats": "Supported formats: JPEG, PNG, WebP",
      "maxSize": "Maximum file size: 5MB",
      "selected": "Selected file",
      "uploading": "Uploading your image...",
      "uploadSuccess": "Cover image uploaded successfully!",
      "uploadFailed": "Failed to upload cover image",
      "deleteSuccess": "Cover image deleted",
      "deleteFailed": "Failed to delete cover image",
      "confirmDelete": "Are you sure you want to delete your cover image?",
      "noImageYet": "No cover image yet. Add one to make your profile stand out!",
      "recommended": "Recommended size",
      "dimensions": "1200 × 400 pixels (3:1 ratio)",
      "tip": "Use a clear, professional image that represents your business or services."
    },
    "qrCode": {
      "title": "Profile QR Code",
      "subtitle": "Share your profile with a QR code",
      "selectSize": "Select QR code size",
      "sizeSmall": "Small",
      "sizeMedium": "Medium",
      "sizeLarge": "Large",
      "download": "Download",
      "downloadTooltip": "Download QR code as PNG",
      "copyLink": "Copy Link",
      "copied": "Copied!",
      "copyLinkTooltip": "Copy your profile URL",
      "share": "Share",
      "shareTooltip": "Share your profile",
      "shareTitle": "{{name}}'s Profile on OxSteed",
      "shareText": "Check out my profile and services on OxSteed",
      "generating": "Generating QR code...",
      "generationFailed": "Failed to generate QR code",
      "downloadFailed": "Failed to download QR code",
      "howToUse": "How to Use",
      "howToUseDesc": "Share this QR code on business cards, flyers, social media, or anywhere you want to direct people to your profile.",
      "tip": "The QR code is generated dynamically, so it always points to your current profile."
    }
  }
}
```

Translate to ES/FR/HT and add to respective locale files.

### Phase 4: API Updates (Optional)

If helper profile API (`GET /api/helpers/:id`) doesn't return `coverImageUrl`, update:

**File:** `server/controllers/helpersController.js`

```javascript
// In the SELECT statement, add:
h.cover_image_url as coverImageUrl,

// In response transformation:
coverImageUrl: helper.cover_image_url,
```

**Verify:** `curl http://localhost:5000/api/helpers/[id]` returns `coverImageUrl`

## Data Flow Diagram

```
UPLOAD FLOW:
Helper clicks Edit Profile
  ↓
CoverImageUpload component shown
  ↓
Helper selects file (drag or click)
  ↓
Validation (type, size)
  ↓
Preview shown
  ↓
PUT /api/helper-profile/cover-image (multipart)
  ↓
Server uploads to S3
  ↓
Updates helper_profiles.cover_image_url
  ↓
Returns new URL
  ↓
Component shows success message
  ↓
Helper profile updated

VIEW FLOW:
Customer views helper profile
  ↓
ProfileHeader component renders
  ↓
Shows cover image (or placeholder)
  ↓
QR badge shows in top-right
  ↓
On hover: QR overlay appears
  ↓
GET /api/helper-profile/:id/qr-code?size=small
  ↓
Server generates QR code (on-the-fly)
  ↓
Returns data URL
  ↓
QR displays with download/share buttons
  ↓
Customer can download QR or share profile link
```

## Testing Checklist

### Upload Tests
- [ ] Upload valid JPEG image
- [ ] Upload valid PNG image
- [ ] Verify preview shows before upload
- [ ] Verify success message appears
- [ ] Verify cover shows on public profile
- [ ] Upload invalid file type (should error)
- [ ] Upload oversized file (should error)
- [ ] Delete cover image
- [ ] Upload new cover after deletion

### QR Code Tests
- [ ] QR badge visible on profile
- [ ] QR overlay appears on hover (desktop)
- [ ] QR overlay visible on mobile
- [ ] QR code displays correctly
- [ ] Download button works
- [ ] Downloaded file is valid PNG
- [ ] Share button works (or copies link)
- [ ] Copy link button works
- [ ] Size selector changes QR size
- [ ] QR encodes correct profile URL
- [ ] QR scans correctly with phone camera

### Integration Tests
- [ ] Public profile shows cover image
- [ ] Edit dashboard shows upload section
- [ ] QR code generates for any helper ID
- [ ] Components responsive on mobile/tablet
- [ ] Dark mode CSS variables correct
- [ ] i18n keys render without errors
- [ ] Error messages display correctly

### API Tests
```bash
# Upload cover image
curl -X PUT http://localhost:5000/api/helper-profile/cover-image \
  -H "Authorization: Bearer $TOKEN" \
  -F "image=@/path/to/image.jpg"

# Generate QR code
curl "http://localhost:5000/api/helper-profile/helper-uuid/qr-code?size=medium"

# Generate multiple sizes
curl "http://localhost:5000/api/helper-profile/helper-uuid/qr-code/multi-size"

# Delete cover
curl -X DELETE http://localhost:5000/api/helper-profile/cover-image \
  -H "Authorization: Bearer $TOKEN"
```

## Performance Considerations

### QR Code Generation
- **On-the-fly**: QR codes are generated when requested, not stored
- **Caching**: Browser caches QR for a session
- **Size**: QR code is ~1-2KB as data URL
- **Time**: Generation takes 10-50ms (unnoticeable)

### Cover Image
- **S3 Storage**: Images stored on AWS S3, served via CloudFront CDN
- **Size**: 5MB limit per image
- **Optimization**: Consider image compression on upload (future feature)
- **Cleanup**: Old images should be deleted from S3 (currently flagged, not auto-deleted)

### Recommendations
1. Add image compression on upload (future)
2. Implement S3 image deletion background job
3. Cache QR codes in Redis if high traffic (future)
4. Add image optimization (WebP conversion, resizing) on upload

## Troubleshooting

### QR Code Not Generating
- **Check**: Helper ID is valid and exists
- **Check**: Profile URL is correct (`APP_URL` env var set)
- **Check**: `qrcode` npm package installed
- **Solution**: Restart server, clear browser cache

### Cover Image Upload Fails
- **Check**: File is correct type (JPEG/PNG/WebP)
- **Check**: File size < 5MB
- **Check**: S3 credentials configured (`AWS_S3_BUCKET`, etc.)
- **Check**: Server has permission to write to S3
- **Solution**: Check server logs for detailed error

### Cover Image Not Showing on Profile
- **Check**: API returns `coverImageUrl`
- **Check**: URL is valid S3 link
- **Check**: S3 bucket is publicly readable
- **Check**: CloudFront CDN configured (if using)
- **Solution**: Check browser network tab for 404/403

### i18n Keys Missing
- **Check**: All keys added to en.json
- **Check**: All keys translated to es/fr/ht
- **Check**: JSON is valid (use `JSON.parse()` validator)
- **Solution**: Check browser console for i18n errors

## Known Limitations

1. **QR Code Storage**: Currently not stored, generated on-demand. Could cache in Redis for high-traffic sites.
2. **Image Compression**: Large images not compressed on upload. Consider WebP conversion.
3. **S3 Cleanup**: Old cover images not auto-deleted from S3.
4. **Multiple QR Sizes**: Currently generate individually. Could batch generate all sizes.
5. **Custom QR Styling**: QR codes are standard black/white. Could support custom colors (future).

## Files Created

- `server/migrations/177_helper_profile_cover_image.sql`
- `server/utils/qrCodeGenerator.js`
- `server/controllers/helperProfileImageController.js`
- `server/routes/helperProfileImages.js`
- `client/src/components/profile/ProfileHeader.jsx` + `.css`
- `client/src/components/profile/CoverImageUpload.jsx` + `.css`
- `client/src/components/profile/QRCodeDisplay.jsx` + `.css`
- `docs/COVER_IMAGE_QR_CODE_INTEGRATION_GUIDE.md` (this file)
- `docs/COVER_IMAGE_QR_CODE_I18N_KEYS.json`

## Summary

✅ **Cover Image Upload**
- Single image per helper
- S3 storage
- Drag & drop interface
- Preview before upload
- Delete option

✅ **QR Code Generation**
- On-the-fly generation (no storage)
- Multiple size options
- Download as PNG
- Share via Web Share API
- Profile link copy

✅ **UI/UX**
- Profile header with cover image
- QR badge + overlay
- Upload form in dashboard
- Standalone QR display
- Full mobile responsiveness
- Dark mode support

Ready to integrate! Follow Phase 1-4 in order.
