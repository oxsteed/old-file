# Industry-Specific Profile Templates
## Making OxSteed Work for Any Business Type

---

## The Problem with One-Size-Fits-All

Current design assumes:
- Service-based (hourly or flat fee)
- Single location
- No inventory
- No reservations
- No menu/pricing tiers

**Reality:**
- 🔧 **Plumber** - Project-based, emergency availability critical
- ✂️ **Barber** - Appointment slots, staff availability, portfolio (looks)
- 🍽️ **Restaurant** - Menu, reservations, location, capacity, hours (lunch/dinner)
- 🏨 **Hotel** - Rooms, amenities, booking calendar, rates, reviews
- 🏪 **Retail** - Inventory, locations, product catalog, hours
- 💇 **Salon** - Staff profiles, services, appointment slots, before/afters
- 🍕 **Food Delivery** - Menu items, delivery zones, ratings, speed

Each needs a **completely different public profile layout and data structure**.

---

## Solution: Industry Templates System

### Phase 1: Define Industry Categories

```
INDUSTRIES = {
  // Service Professionals (current focus)
  'service': {
    label: 'Local Service Professional',
    examples: 'Plumber, Electrician, Handyman',
    features: ['services', 'gallery', 'hours', 'team', 'policies'],
    profileLayout: 'service-professional'
  },
  
  // Personal Services
  'salon': {
    label: 'Salon / Spa',
    examples: 'Hair Salon, Barber, Nail Salon',
    features: ['services', 'staff-profiles', 'gallery', 'hours', 'availability', 'pricing-tiers'],
    profileLayout: 'salon-and-spa'
  },
  
  // Food & Beverage
  'restaurant': {
    label: 'Restaurant / Cafe',
    examples: 'Restaurant, Cafe, Bistro',
    features: ['menu', 'hours', 'cuisine-types', 'reservations', 'delivery', 'reviews'],
    profileLayout: 'restaurant'
  },
  
  'food-delivery': {
    label: 'Food Delivery',
    examples: 'Takeout, Meal Prep, Catering',
    features: ['menu', 'delivery-zones', 'hours', 'reviews', 'ratings'],
    profileLayout: 'food-delivery'
  },
  
  // Hospitality
  'hotel': {
    label: 'Hotel / Accommodation',
    examples: 'Hotel, Vacation Rental, Hostel',
    features: ['rooms', 'amenities', 'booking-calendar', 'photos', 'reviews', 'rates'],
    profileLayout: 'hotel-accommodation'
  },
  
  // Retail
  'retail': {
    label: 'Retail Store',
    examples: 'Boutique, Shop, Store',
    features: ['products', 'inventory', 'hours', 'locations', 'promotions', 'photos'],
    profileLayout: 'retail-store'
  },
  
  // Fitness & Wellness
  'fitness': {
    label: 'Fitness / Wellness',
    examples: 'Gym, Yoga Studio, Personal Trainer',
    features: ['classes', 'memberships', 'schedule', 'trainers', 'facilities', 'reviews'],
    profileLayout: 'fitness-wellness'
  }
}
```

---

## Database Schema: Industry-Agnostic Core

### Base Business Table (Universal)

```sql
CREATE TABLE businesses (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  
  -- Universal fields
  business_name VARCHAR(255) NOT NULL,
  business_type VARCHAR(50),  -- 'salon', 'restaurant', 'plumber', etc
  industry_category VARCHAR(50) NOT NULL,  -- 'service', 'salon', 'restaurant', etc
  description TEXT,
  tagline VARCHAR(255),
  
  -- Branding (all industries)
  logo_url TEXT,
  cover_photo_url TEXT,
  color_scheme_primary VARCHAR(7),
  color_scheme_secondary VARCHAR(7),
  
  -- Location (all industries)
  address_street VARCHAR(255),
  address_city VARCHAR(100),
  address_state VARCHAR(50),
  address_zip VARCHAR(10),
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  
  -- Contact (all industries)
  phone VARCHAR(30),
  website VARCHAR(255),
  email VARCHAR(255),
  
  -- Metadata
  is_listed BOOLEAN DEFAULT TRUE,
  is_primary BOOLEAN DEFAULT FALSE,
  subscription_tier VARCHAR(20) DEFAULT 'free',  -- 'free', 'pro', 'enterprise'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Industry-Specific Tables

#### For Service Professionals (Plumber, Electrician)

```sql
CREATE TABLE services (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10,2),
  price_unit VARCHAR(20),  -- 'hour', 'flat', 'quote'
  duration VARCHAR(50),  -- '1-2 hours'
  category VARCHAR(100),
  popular BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE business_hours (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  day_of_week INT,  -- 0=Sunday, 6=Saturday
  start_time TIME,
  end_time TIME,
  is_closed BOOLEAN DEFAULT FALSE,
  seasonal_start DATE,  -- Summer hours: 2024-06-01
  seasonal_end DATE,
  notes VARCHAR(255),  -- "Lunch: 11am-2pm, Dinner: 5pm-10pm"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE policies (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  title VARCHAR(255),
  content TEXT,
  icon VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE gallery (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  url TEXT NOT NULL,
  alt TEXT,
  caption TEXT,
  gallery_type VARCHAR(50),  -- 'before-after', 'portfolio', 'team', 'facilities'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE team_members (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  user_id UUID,  -- If team member is in system
  name VARCHAR(255),
  title VARCHAR(100),
  bio TEXT,
  photo_url TEXT,
  specialties TEXT[],  -- ['plumbing', 'water heaters']
  is_visible BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### For Salons (Barber, Hair Salon)

```sql
CREATE TABLE salon_services (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  name VARCHAR(255),  -- "Men's Haircut", "Women's Perm"
  description TEXT,
  duration_minutes INT,  -- 30, 60, 90
  price DECIMAL(10,2),
  category VARCHAR(50),  -- 'haircut', 'color', 'treatment'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE salon_staff (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  name VARCHAR(255),
  specialty VARCHAR(100),  -- "Men's cuts", "Color specialist"
  photo_url TEXT,
  bio TEXT,
  years_experience INT,
  available_days INT[],  -- [1,2,3,4,5] = Mon-Fri
  rating DECIMAL(2,1),
  is_visible BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE salon_availability (
  id SERIAL PRIMARY KEY,
  staff_id INT REFERENCES salon_staff(id),
  date_slot DATE,
  time_slot TIME,
  is_available BOOLEAN DEFAULT TRUE,
  booked_by UUID  -- customer user_id if booked
);

CREATE TABLE salon_gallery_before_after (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  staff_id INT REFERENCES salon_staff(id),
  before_photo_url TEXT,
  after_photo_url TEXT,
  service_type VARCHAR(100),  -- 'haircut', 'color'
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### For Restaurants

```sql
CREATE TABLE restaurant_menu (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  category VARCHAR(100),  -- 'appetizers', 'mains', 'desserts'
  item_name VARCHAR(255),
  description TEXT,
  price DECIMAL(10,2),
  cuisine_type VARCHAR(50),  -- 'Italian', 'Thai', 'Fusion'
  is_vegetarian BOOLEAN,
  is_vegan BOOLEAN,
  is_gluten_free BOOLEAN,
  dietary_notes TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE restaurant_hours (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  day_of_week INT,
  lunch_start TIME,
  lunch_end TIME,
  dinner_start TIME,
  dinner_end TIME,
  is_closed BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE restaurant_features (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  feature VARCHAR(100),  -- 'dine-in', 'takeout', 'delivery', 'reservations'
  is_available BOOLEAN DEFAULT TRUE
);

CREATE TABLE restaurant_reviews (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  customer_id UUID,
  rating INT,  -- 1-5
  comment TEXT,
  visit_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### For Hotels

```sql
CREATE TABLE hotel_rooms (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  room_type VARCHAR(100),  -- 'Single', 'Double', 'Suite'
  description TEXT,
  price_per_night DECIMAL(10,2),
  capacity INT,  -- Number of guests
  amenities TEXT[],  -- ['WiFi', 'AC', 'Minibar']
  count_available INT,  -- How many of this room type
  photo_urls TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE hotel_amenities (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES businesses(id),
  amenity_name VARCHAR(100),  -- 'Swimming Pool', 'Gym', 'Parking'
  icon VARCHAR(50),
  description TEXT
);

CREATE TABLE hotel_booking_calendar (
  id SERIAL PRIMARY KEY,
  room_id INT REFERENCES hotel_rooms(id),
  date_available DATE,
  is_booked BOOLEAN DEFAULT FALSE,
  booking_id INT,
  guest_count INT
);
```

---

## Profile Layout Templates

### Service Professional Profile Layout

```
┌─────────────────────────────┐
│ [Logo] Business Name        │
│ "Trusted Local Plumber"     │
│ ⭐ 4.8 (45 reviews)         │
├─────────────────────────────┤
│ [Cover Photo]               │
├─────────────────────────────┤
│ SERVICES                    │
│ • Drain Cleaning ($75)      │
│ • Leak Repair ($100/hr)     │
│ • Installation (Quote)      │
├─────────────────────────────┤
│ HOURS                       │
│ Mon-Fri: 8am-5pm           │
│ Sat: 9am-3pm               │
│ Emergency: 24/7            │
├─────────────────────────────┤
│ GALLERY (Before/After)      │
│ [Portfolio photos]          │
├─────────────────────────────┤
│ TEAM                        │
│ John Smith (15 yrs exp)    │
│ Sarah Johnson (Apprentice)  │
├─────────────────────────────┤
│ POLICIES                    │
│ • 24hr cancellation         │
│ • $50 service call fee      │
│ • 1-year warranty           │
└─────────────────────────────┘
```

### Salon Profile Layout

```
┌─────────────────────────────┐
│ [Logo] Hair Salon XYZ       │
│ "Expert Cuts & Color"       │
│ ⭐ 4.9 (120 reviews)        │
├─────────────────────────────┤
│ [Cover Photo]               │
├─────────────────────────────┤
│ SERVICES                    │
│ • Men's Haircut (30min/$25) │
│ • Women's Cut (45min/$40)   │
│ • Color Treatment (2hr/$80) │
├─────────────────────────────┤
│ OUR STYLISTS                │
│ [Photo] Maria - 12 years    │
│   Specialty: Color          │
│   Rating: 4.9 ⭐            │
│   [Book Maria]              │
│                             │
│ [Photo] James - 8 years     │
│   Specialty: Men's cuts     │
│   Rating: 4.8 ⭐            │
│   [Book James]              │
├─────────────────────────────┤
│ BEFORE & AFTER              │
│ [Carousel: color work]      │
│ [Carousel: cuts]            │
├─────────────────────────────┤
│ HOURS                       │
│ Mon-Fri: 10am-7pm          │
│ Sat: 9am-5pm               │
│ Sun: Closed                 │
│ [Book Appointment]          │
└─────────────────────────────┘
```

### Restaurant Profile Layout

```
┌──────────────────────────────┐
│ [Logo] Bella's Italian        │
│ "Authentic Italian Cuisine"   │
│ ⭐ 4.7 (280 reviews)          │
│ $$ • Italian • 2.1 km away    │
├──────────────────────────────┤
│ [Cover Photo - Food]          │
├──────────────────────────────┤
│ HOURS                        │
│ Mon-Thu: 11:30am-10pm       │
│ Fri-Sat: 11:30am-11pm       │
│ Sun: 5pm-10pm               │
│ [Reserve Table]              │
├──────────────────────────────┤
│ MENU HIGHLIGHTS              │
│ APPETIZERS                   │
│ • Bruschetta ($8)           │
│ • Calamari ($12)            │
│                             │
│ MAINS                       │
│ • Spaghetti Carbonara ($16) │
│ • Osso Buco ($28)           │
│ [View Full Menu]             │
├──────────────────────────────┤
│ FEATURES                     │
│ 🍽️ Dine-in                  │
│ 📦 Takeout (15min ready)    │
│ 🚗 Delivery ($3)             │
│ 📞 Reservations available    │
├──────────────────────────────┤
│ REVIEWS                      │
│ ⭐⭐⭐⭐⭐ "Best pasta!"      │
│ "Great atmosphere, friendly"  │
│ "Worth the wait"              │
│ [See all 280 reviews]         │
└──────────────────────────────┘
```

### Hotel Profile Layout

```
┌──────────────────────────────┐
│ [Logo] Sunset Beach Resort    │
│ "Oceanfront Paradise"         │
│ ⭐ 4.8 (450 reviews)          │
│ $$$ • 5-star • Beach access   │
├──────────────────────────────┤
│ [Cover Photo - Hotel exterior]│
├──────────────────────────────┤
│ ROOM TYPES & RATES           │
│ 🛏️ Standard Room             │
│    2 guests • WiFi, AC, TV    │
│    $120/night • [Book]        │
│                              │
│ 👑 Suite Deluxe              │
│    4 guests • Ocean view      │
│    $250/night • [Book]        │
│                              │
│ 🏖️ Beachfront Villa           │
│    6 guests • Private beach   │
│    $400/night • [Book]        │
├──────────────────────────────┤
│ AMENITIES                    │
│ 🏊 Swimming Pool              │
│ 🏋️ Fitness Center             │
│ 🍽️ Restaurant & Bar           │
│ 🅿️ Free Parking               │
│ 📶 Free WiFi                  │
│ 🛎️ 24/7 Concierge             │
├──────────────────────────────┤
│ GALLERY                      │
│ [Photos: rooms, views, pool] │
├──────────────────────────────┤
│ REVIEWS & RATINGS            │
│ ⭐⭐⭐⭐⭐ "Paradise!"         │
│ "Best vacation ever"          │
│ "Worth every penny"           │
│ [See all 450 reviews]         │
└──────────────────────────────┘
```

---

## Frontend: Dynamic Profile Components

Each industry gets its own profile component:

```jsx
// ProfilePage.jsx - Dynamically loads correct layout
import ServiceProfessionalProfile from './profiles/ServiceProfessionalProfile'
import SalonProfile from './profiles/SalonProfile'
import RestaurantProfile from './profiles/RestaurantProfile'
import HotelProfile from './profiles/HotelProfile'

function BusinessProfilePage({ businessId }) {
  const business = await fetchBusiness(businessId)
  
  const PROFILE_COMPONENTS = {
    'service': ServiceProfessionalProfile,
    'salon': SalonProfile,
    'restaurant': RestaurantProfile,
    'hotel': HotelProfile,
    // ... more
  }
  
  const ProfileComponent = PROFILE_COMPONENTS[business.industry_category]
  
  return <ProfileComponent business={business} />
}
```

---

## Business Hub: Industry-Specific Tabs

Each industry shows different tabs:

### Service Professional
- Edit Profile
- Services
- Gallery
- Hours
- Team
- Policies
- Analytics

### Salon
- Edit Profile
- Services
- Staff Directory
- Before & After Gallery
- Hours & Availability
- Pricing
- Analytics

### Restaurant
- Edit Profile
- Menu Management
- Hours (Lunch/Dinner)
- Features (Dine-in/Takeout/Delivery)
- Gallery
- Reviews Management
- Analytics

### Hotel
- Edit Profile
- Rooms & Rates
- Amenities
- Booking Calendar
- Photos/Gallery
- Reviews Management
- Analytics

---

## Pro Tier Value (Now Truly Different Per Industry)

### Service Professional - $50/month
- Unlimited services
- Advanced scheduling
- Team management
- Custom branding
- Analytics

### Salon - $50/month
- Staff management
- Appointment booking system
- Before/after portfolio
- Staff individual ratings
- Custom branding
- Analytics per stylist

### Restaurant - $50/month
- Digital menu
- Reservation system
- Delivery management
- Menu item photos
- Review management
- Analytics (popular items, peak hours)

### Hotel - $50/month
- Multi-room management
- Availability calendar
- Seasonal pricing
- Amenities showcase
- Review management
- Booking analytics

---

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Add `industry_category` to businesses table
- [ ] Create base schema (services, hours, policies, gallery, team)
- [ ] Create industry-specific tables (salon_staff, restaurant_menu, hotel_rooms)

### Phase 2: Profile Templates
- [ ] Build ServiceProfessionalProfile component
- [ ] Build SalonProfile component
- [ ] Build RestaurantProfile component
- [ ] Build HotelProfile component

### Phase 3: Business Hub Industry Tabs
- [ ] Service professional tabs
- [ ] Salon tabs
- [ ] Restaurant tabs
- [ ] Hotel tabs

### Phase 4: Pro Features (Industry-Specific)
- [ ] Salon: Appointment booking system
- [ ] Restaurant: Reservation + delivery
- [ ] Hotel: Availability calendar
- [ ] All: Advanced analytics

### Phase 5: Onboarding Flow
- [ ] Industry selection on business creation
- [ ] Industry-specific setup wizard
- [ ] Template pre-fill per industry

---

## Questions

1. **Should we start with these 4 industries or expand further?**
   - Current: Service, Salon, Restaurant, Hotel
   - Future: Retail, Fitness, Events, Education, Healthcare

2. **Should one account have mixed industries?**
   - Yes - John could run both a plumbing service AND a salon

3. **Should we keep "local" focus or go national/global?**
   - Local makes sense for services/salons
   - Less critical for restaurants/hotels

4. **Do we need different pricing for different industries?**
   - Salon: Higher demand for booking system = could charge more
   - Restaurant: Reservation system valuable = could charge more
   - Service: Basic features = $50/mo
   - Hotel: Complex = could charge $75-100/mo

---

## Competitive Advantage

This makes OxSteed:
- 🎯 **Not just for handymen** - Works for salons, restaurants, hotels
- 📱 **Industry-specialized** - Each gets perfect profile for their needs
- 💰 **Justifies premium pricing** - Different value per industry
- 🌍 **Scalable across verticals** - Same platform, infinite use cases

Instead of competing with Yelp/Google (who are horizontal platforms), OxSteed becomes a **vertical-specific toolkit** where each industry gets exactly what they need.

---

## Example Revenue Impact

**John (Plumber) - $50/mo**
- Runs "Quick Fixes Plumbing"
- Gets 15 extra jobs/month = $1500 extra = ROI 30:1

**Maria (Salon Owner) - $75/mo** (premium pricing for booking system)
- Runs "Maria's Salon"
- Booking system reduces no-shows 30% = 10 extra booked clients/month
- At $50/cut = $500/mo extra = ROI 6.5:1

**Antonio (Restaurant) - $100/mo** (premium for reservations)
- Runs "Antonio's Restaurant"
- Reservation system fills 20 extra seats/week = 40 seats/month
- At $25 per person = $1000/mo extra = ROI 10:1

**Priya (Hotel) - $150/mo** (premium for availability calendar)
- Runs "Beachfront Resort"
- Booking system + management fills 5 extra rooms/month
- At $150/night = $750/mo extra = ROI 5:1

---

## Conclusion

This approach transforms OxSteed from **"marketplace for local service pros"** into **"industry-specific business management platform"**.

- ✂️ Barber gets salon features
- 🍽️ Restaurant gets reservation system
- 🏨 Hotel gets booking calendar
- 🔧 Plumber gets appointment tracking

Each industry gets exactly what they need, justified pricing, and competitive advantage.
