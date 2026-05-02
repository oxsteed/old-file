/**
 * Static sample profile used only in admin template previews.
 * Shape matches ProfileTemplateRenderer / helper profile pages.
 */
export const DEMO_TEMPLATE_PROFILE_DATA = {
  helper: {
    id: '00000000-0000-4000-8000-000000000001',
    businessName: 'Preview Services LLC',
    ownerName: 'Alex Morgan',
    tagline: 'Quality work you can count on.',
    bio: 'This is sample bio text for admin preview only. It shows how paragraphs and spacing look in each profile template before you set pricing.',
    avatar: '',
    coverImage: '',
    rating: 4.9,
    reviewCount: 127,
    jobsCompleted: 340,
    memberSince: '2022-01-15',
    verified: true,
    responseTime: '< 1 hour',
    responseRate: 98,
    badges: [
      { id: 'b1', label: 'Top Rated', icon: 'star', variant: 'top_rated' },
      { id: 'b2', label: 'Licensed', icon: 'shield', variant: 'verified' },
    ],
    categories: ['General'],
    city: 'Chicago',
    state: 'IL',
    allowGuestContact: true,
  },
  services: [
    {
      id: 's1',
      name: 'Standard service',
      description: 'Example line item so service cards render realistically.',
      price: 85,
      priceUnit: 'hour',
      popular: true,
      category: 'General',
    },
    {
      id: 's2',
      name: 'Premium package',
      description: 'Second row to show grid rhythm in the template.',
      price: 220,
      priceUnit: 'flat',
      category: 'General',
    },
  ],
  gallery: [
    {
      id: 'g1',
      url: 'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=600&q=60',
      alt: 'Sample work',
    },
    {
      id: 'g2',
      url: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=600&q=60',
      alt: 'Sample project',
    },
  ],
  reviews: [
    {
      id: 'r1',
      authorName: 'Jamie K.',
      rating: 5,
      content: 'Excellent work and communication. Would hire again.',
    },
    {
      id: 'r2',
      authorName: 'Riley P.',
      rating: 5,
      content: 'Professional from start to finish.',
    },
  ],
  faqs: [
    {
      id: 'f1',
      question: 'Do you offer free estimates?',
      answer: 'Yes. Estimates are complimentary within our normal service area.',
    },
    {
      id: 'f2',
      question: 'What areas do you serve?',
      answer: 'Metro area and nearby suburbs, typically within 25 miles.',
    },
  ],
  bizId: null,
  phone: '(555) 010-0199',
  website: 'https://example.com',
};
