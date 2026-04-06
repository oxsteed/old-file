import type { HelperProfileData } from '../types/helperProfile';

export const mockHelperProfileData: HelperProfileData = {
  // ── Helper / Business ──────────────────────────────────────────────────────
  helper: {
    id: 'h-001',
    businessName: 'Martinez Home & Garden Services',
    ownerName: 'Carlos Martinez',
    tagline: 'Your trusted neighbor for home care, landscaping & repairs.',
    bio: `With over 12 years of hands-on experience serving the Austin area, I treat every home like my own. Whether it's a quick fix or a full seasonal overhaul, I bring the same level of care and professionalism to every job. Licensed, insured, and background checked — your peace of mind is my first priority.`,
    avatar:
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face',
    coverImage:
      'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1400&h=500&fit=crop',
    rating: 4.9,
    reviewCount: 127,
    jobsCompleted: 312,
    memberSince: '2019-03-12',
    verified: true,
    responseTime: '< 1 hour',
    responseRate: 98,
    badges: [
      { id: 'b1', label: 'Background Checked', icon: 'shield-check', variant: 'verified' },
      { id: 'b2', label: 'Top Rated', icon: 'star', variant: 'top_rated' },
      { id: 'b3', label: 'Fast Responder', icon: 'zap', variant: 'fast_responder' },
      { id: 'b4', label: 'Licensed & Insured', icon: 'award', variant: 'trusted' },
    ],
    categories: ['Landscaping', 'Home Repair', 'Cleaning', 'Painting'],
  },

  // ── Services ───────────────────────────────────────────────────────────────
  services: [
    {
      id: 's1',
      name: 'Lawn Mowing & Edging',
      description:
        'Full-service lawn care including mowing, edging, blowing, and debris cleanup.',
      price: 65,
      priceUnit: 'flat',
      duration: '1–2 hrs',
      popular: true,
      category: 'Landscaping',
    },
    {
      id: 's2',
      name: 'Garden & Flower Bed Maintenance',
      description:
        'Weeding, pruning, mulching, and seasonal planting for flower beds and gardens.',
      price: 45,
      priceUnit: 'hour',
      duration: 'Varies',
      category: 'Landscaping',
    },
    {
      id: 's3',
      name: 'Interior House Painting',
      description:
        'Professional painting for rooms, trim, and ceilings. Prep, primer, and cleanup included.',
      price: 350,
      priceUnit: 'starting_at',
      duration: '1–2 days',
      category: 'Painting',
    },
    {
      id: 's4',
      name: 'Handyman Repairs',
      description:
        'Furniture assembly, minor plumbing, drywall patching, fixture installation, and more.',
      price: 75,
      priceUnit: 'hour',
      category: 'Home Repair',
    },
    {
      id: 's5',
      name: 'Deep Home Cleaning',
      description:
        'Top-to-bottom cleaning including appliances, baseboards, windows, and cabinet interiors.',
      price: 180,
      priceUnit: 'flat',
      duration: '4–6 hrs',
      category: 'Cleaning',
    },
    {
      id: 's6',
      name: 'Pressure Washing',
      description:
        'Driveways, sidewalks, patios, decks, and exterior walls. Quote based on area size.',
      price: 0,
      priceUnit: 'quote',
      category: 'Home Repair',
    },
  ],

  // ── Gallery ────────────────────────────────────────────────────────────────
  gallery: [
    {
      id: 'g1',
      url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&h=400&fit=crop',
      alt: 'Beautifully manicured lawn after mowing and edging',
      caption: 'Lawn & edging service — Pflugerville, TX',
      type: 'photo',
    },
    {
      id: 'g2',
      url: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=600&h=400&fit=crop',
      alt: 'Garden flower bed after seasonal maintenance',
      caption: 'Spring garden refresh — Cedar Park, TX',
      type: 'photo',
    },
    {
      id: 'g3',
      url: 'https://images.unsplash.com/photo-1562259949-e8e7689d7828?w=600&h=400&fit=crop',
      alt: 'Freshly painted interior bedroom walls',
      caption: 'Interior painting — master bedroom & trim',
      type: 'photo',
    },
    {
      id: 'g4',
      url: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=600&h=400&fit=crop',
      alt: 'Handyman work in progress on kitchen fixtures',
      caption: 'Handyman — kitchen fixture install',
      type: 'photo',
    },
    {
      id: 'g5',
      url: 'https://images.unsplash.com/photo-1527515637462-cff94ebb81f8?w=600&h=400&fit=crop',
      alt: 'Pressure washing a residential driveway',
      caption: 'Pressure wash — driveway & walkway',
      type: 'photo',
    },
    {
      id: 'g6',
      url: 'https://images.unsplash.com/photo-1584622781564-1d987f7333c1?w=600&h=400&fit=crop',
      alt: 'Sparkling clean home interior after deep clean',
      caption: 'Deep clean — move-in ready result',
      type: 'photo',
    },
  ],

  // ── Hours ──────────────────────────────────────────────────────────────────
  hours: [
    { day: 'Monday', open: '7:00 AM', close: '6:00 PM', closed: false },
    { day: 'Tuesday', open: '7:00 AM', close: '6:00 PM', closed: false },
    { day: 'Wednesday', open: '7:00 AM', close: '6:00 PM', closed: false },
    { day: 'Thursday', open: '7:00 AM', close: '6:00 PM', closed: false },
    { day: 'Friday', open: '7:00 AM', close: '5:00 PM', closed: false },
    { day: 'Saturday', open: '8:00 AM', close: '3:00 PM', closed: false },
    { day: 'Sunday', open: '', close: '', closed: true },
  ],

  // ── Location ───────────────────────────────────────────────────────────────
  location: {
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    serviceRadius: 25,
    radiusUnit: 'miles',
    servesRemotely: false,
  },

  // ── Policies ───────────────────────────────────────────────────────────────
  policies: [
    {
      id: 'p1',
      title: 'Cancellation',
      content:
        'Free cancellation up to 24 hours before the scheduled job. Cancellations within 24 hours may incur a 50% charge. No-shows are billed at the full rate.',
      icon: 'calendar-x',
    },
    {
      id: 'p2',
      title: 'Payment',
      content:
        'Payment is processed securely through OxSteed after job completion. All major cards, Apple Pay, and Google Pay accepted. Tips are appreciated but never expected.',
      icon: 'credit-card',
    },
    {
      id: 'p3',
      title: 'Satisfaction Guarantee',
      content:
        'If you are not fully satisfied, contact me within 24 hours and I will return to make it right at no additional charge. Your satisfaction is guaranteed.',
      icon: 'shield-check',
    },
    {
      id: 'p4',
      title: 'Insurance & Liability',
      content:
        "Fully insured with $1M general liability coverage. All work is backed by OxSteed's platform protection. See OxSteed's guarantee for full coverage details.",
      icon: 'shield',
    },
  ],

  // ── Reviews ────────────────────────────────────────────────────────────────
  reviews: [
    {
      id: 'r1',
      authorName: 'Jennifer T.',
      authorAvatar:
        'https://images.unsplash.com/photo-1494790108755-2616b612b47c?w=80&h=80&fit=crop&crop=face',
      rating: 5,
      date: '2025-03-18',
      serviceUsed: 'Lawn Mowing & Edging',
      content:
        'Carlos is absolutely fantastic. Showed up on time, did a thorough job, and my yard looks better than ever. He even noticed a broken sprinkler head and flagged it without charging extra. Booking monthly from now on.',
      helpfulCount: 14,
      helperReply: {
        content:
          'Thank you Jennifer! It was a pleasure. Looking forward to keeping your lawn looking great all season!',
        date: '2025-03-19',
      },
      verified: true,
    },
    {
      id: 'r2',
      authorName: 'Marcus W.',
      rating: 5,
      date: '2025-02-28',
      serviceUsed: 'Handyman Repairs',
      content:
        'Hired Carlos to assemble furniture, hang shelving, and fix a leaky faucet. He handled everything quickly and professionally. Quality of work is excellent and pricing is very fair.',
      helpfulCount: 8,
      verified: true,
    },
    {
      id: 'r3',
      authorName: 'Priya S.',
      authorAvatar:
        'https://images.unsplash.com/photo-1532170579297-281918c8ae72?w=80&h=80&fit=crop&crop=face',
      rating: 5,
      date: '2025-01-15',
      serviceUsed: 'Deep Home Cleaning',
      content:
        'The deep clean was incredibly thorough. I was moving in and needed the place spotless. Carlos went above and beyond — even cleaned inside the oven and the window tracks. Highly recommend.',
      helpfulCount: 22,
      verified: true,
    },
    {
      id: 'r4',
      authorName: 'David R.',
      rating: 4,
      date: '2024-12-10',
      serviceUsed: 'Interior House Painting',
      content:
        'Great paint job on our living room and hallway. Took a bit longer than estimated but the quality was worth it. Very clean work — no drips, crisp edges. Would hire again.',
      helpfulCount: 5,
      helperReply: {
        content:
          'Thanks David! The extra time was for the trim detail work — glad you appreciate it.',
        date: '2024-12-11',
      },
      verified: true,
    },
  ],

  // ── FAQs ───────────────────────────────────────────────────────────────────
  faqs: [
    {
      id: 'f1',
      question: 'Do you bring your own supplies and equipment?',
      answer:
        'Yes — I bring all equipment and supplies needed for lawn care, cleaning, and most handyman jobs. For painting, I supply all tools; you choose the paint brand and color, or I can source it for a materials fee.',
    },
    {
      id: 'f2',
      question: 'Are you available for recurring service?',
      answer:
        'Absolutely. I offer weekly, bi-weekly, and monthly recurring plans for lawn care and home cleaning. Recurring clients get priority scheduling and a 10% loyalty discount.',
    },
    {
      id: 'f3',
      question: 'How do I pay?',
      answer:
        'All payments are handled securely through OxSteed after the job is marked complete. You are only charged the agreed amount — no surprise fees. Any add-ons discovered on-site are always discussed before work begins.',
    },
    {
      id: 'f4',
      question: 'What areas do you serve?',
      answer:
        'I serve all of Austin and surrounding areas within 25 miles — including Cedar Park, Round Rock, Pflugerville, Buda, and Kyle. Outside that range? Reach out; I may still be able to help.',
    },
    {
      id: 'f5',
      question: 'What if something goes wrong or I am not satisfied?',
      answer:
        "Contact me within 24 hours and I'll return to make it right at no extra charge. My work is guaranteed and OxSteed's platform protection has you covered for any disputes.",
    },
  ],

  // ── Chat Session ───────────────────────────────────────────────────────────
  chatSession: {
    id: 'chat-001',
    destination: 'helper',
    status: 'ai_assistant',
    helperStatus: 'ai_assistant',
    oxsteedStatus: 'live',
    typing: null,
    timeline: [
      {
        id: 'e0',
        itemType: 'system',
        eventType: 'session_start',
        content: 'Chat opened with Martinez Home & Garden Services',
        timestamp: '2025-04-06T10:00:00Z',
      },
      {
        id: 'm1',
        itemType: 'message',
        authorType: 'helper_ai',
        content:
          "Hi there! I'm the AI assistant for Martinez Home & Garden Services. How can I help you today? I can answer questions, check availability, or get you started with a booking.",
        timestamp: '2025-04-06T10:00:05Z',
      },
      {
        id: 'm2',
        itemType: 'message',
        authorType: 'user',
        content:
          "Hi! I'm interested in weekly lawn mowing service. Do you have availability starting this week?",
        timestamp: '2025-04-06T10:02:30Z',
      },
      {
        id: 'm3',
        itemType: 'message',
        authorType: 'helper_ai',
        content:
          'Great choice! Weekly lawn mowing is $65/visit for most standard lots. Carlos currently has availability Tuesday and Thursday mornings this week. Would either of those work for you?',
        timestamp: '2025-04-06T10:02:45Z',
      },
      {
        id: 'e1',
        itemType: 'booking_event',
        eventType: 'quote_sent',
        content: 'Quote sent — Weekly Lawn Mowing · $65/visit',
        timestamp: '2025-04-06T10:02:50Z',
        metadata: { service: 'Lawn Mowing & Edging', price: 65, frequency: 'weekly' },
      },
      {
        id: 'm4',
        itemType: 'message',
        authorType: 'user',
        content: 'Thursday morning works great. Can we lock that in?',
        timestamp: '2025-04-06T10:04:10Z',
      },
      {
        id: 'e2',
        itemType: 'handoff',
        eventType: 'human_takeover',
        content: 'Carlos has joined the conversation.',
        timestamp: '2025-04-06T10:05:00Z',
      },
      {
        id: 'm5',
        itemType: 'message',
        authorType: 'helper_human',
        content:
          "Hey! This is Carlos. Thursday 8 AM works perfectly. I'll send over a booking confirmation now. See you then!",
        timestamp: '2025-04-06T10:05:22Z',
      },
      {
        id: 'e3',
        itemType: 'booking_event',
        eventType: 'booking_confirmed',
        content: 'Booking confirmed — Thu, Apr 10 · 8:00 AM · Lawn Mowing & Edging',
        timestamp: '2025-04-06T10:05:30Z',
        metadata: { date: '2025-04-10', time: '8:00 AM', service: 'Lawn Mowing & Edging' },
      },
    ],
  },
};
