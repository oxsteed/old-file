import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Award,
  BookOpen,
  Car,
  CheckCircle,
  ChevronRight,
  Clock,
  Droplet,
  ExternalLink,
  Hammer,
  Leaf,
  LayoutGrid,
  LayoutList,
  MessageCircle,
  Paintbrush,
  PlayCircle,
  Search,
  Send,
  ShoppingBag,
  Smartphone,
  Thermometer,
  TrendingUp,
  User,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import './LearnModePage.css';

const COMPLETIONS_KEY  = 'oxs:learn:completions';
const APP_BANNER_KEY   = 'oxs:learn:app-banner-dismissed';
const AFFILIATE_TAG    = 'oxsteed-20';

const fmtCount = (n) => n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
const amz = (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}&tag=${AFFILIATE_TAG}`;

// ── Categories ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'all',          label: 'All',          Icon: LayoutGrid,  color: '#f97316' },
  { id: 'plumbing',     label: 'Plumbing',     Icon: Droplet,     color: '#0ea5e9' },
  { id: 'electrical',   label: 'Electrical',   Icon: Zap,         color: '#eab308' },
  { id: 'carpentry',    label: 'Carpentry',    Icon: Hammer,      color: '#8b5cf6' },
  { id: 'hvac',         label: 'HVAC',         Icon: Thermometer, color: '#14b8a6' },
  { id: 'painting',     label: 'Painting',     Icon: Paintbrush,  color: '#ec4899' },
  { id: 'car-care',     label: 'Car Care',     Icon: Car,         color: '#6366f1' },
  { id: 'landscaping',  label: 'Landscaping',  Icon: Leaf,        color: '#22c55e' },
  { id: 'maintenance',  label: 'Maintenance',  Icon: Wrench,      color: '#94a3b8' },
];

// ── Guide data ────────────────────────────────────────────────────────────────

const GUIDES = [
  // ── Plumbing ──────────────────────────────────────────────────────────────
  {
    id: 'fix-leaky-faucet',
    title: 'Fix a Leaky Faucet',
    category: 'plumbing',
    difficulty: 'Easy',
    minutes: 30,
    featured: true,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #e0f2fe, #bae6fd)',
    intro: 'A dripping faucet wastes gallons a day and usually comes down to a worn washer or O-ring — both cost under a dollar.',
    steps: [
      'Turn off the water supply valves under the sink, then open the faucet to release remaining pressure.',
      'Remove the handle by unscrewing the decorative cap and the screw underneath it.',
      'Unscrew the packing nut and pull out the stem.',
      'Inspect the rubber washer and O-ring at the bottom of the stem — replace both.',
      'Reassemble in reverse order, turn the supply valves back on, and test for drips.',
    ],
    skills: ['Shutoff valve operation', 'Basic disassembly', 'Washer replacement'],
    tools: [
      { name: 'Adjustable wrench', rent: '/tool-rentals?category=hand-tools', buy: amz('adjustable wrench') },
      { name: 'Flathead + Phillips screwdrivers', rent: '/tool-rentals?category=hand-tools', buy: amz('screwdriver set') },
      { name: 'Faucet repair kit (washers + O-rings)', rent: null, buy: amz('faucet repair kit washers o-rings') },
    ],
    hireHref: '/post-job?category=plumbing',
    toolsHref: '/tool-rentals?category=plumbing',
    xp: 10,
  },
  {
    id: 'unclog-drain',
    title: 'Unclog a Drain',
    category: 'plumbing',
    difficulty: 'Easy',
    minutes: 20,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #dbeafe, #bfdbfe)',
    intro: 'Most slow drains are a hair-and-soap buildup in the trap — no chemicals needed, just the right tool and a little patience.',
    steps: [
      'Remove the drain stopper (usually lifts out or unscrews).',
      'Insert a drain snake or zip-it tool at least 12 inches and pull out debris.',
      'Run hot water for 30 seconds to flush loosened buildup.',
      'If still slow, place a bucket under the P-trap, unscrew the slip-joint nuts, clean the trap, and reinstall.',
      'Test the drain and inspect all trap connections for leaks.',
    ],
    skills: ['Drain snake use', 'P-trap removal', 'Slip-joint fittings'],
    tools: [
      { name: 'Drain snake or zip-it tool', rent: null, buy: amz('drain snake clog remover') },
      { name: 'Bucket', rent: null, buy: amz('utility bucket') },
      { name: 'Tongue-and-groove pliers', rent: '/tool-rentals?category=hand-tools', buy: amz('tongue groove pliers') },
    ],
    hireHref: '/post-job?category=plumbing',
    toolsHref: '/tool-rentals?category=plumbing',
    xp: 10,
  },
  {
    id: 'fix-running-toilet',
    title: 'Fix a Running Toilet',
    category: 'plumbing',
    difficulty: 'Medium',
    minutes: 45,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #e0f2fe, #7dd3fc)',
    intro: 'A toilet that runs after flushing is almost always the flapper or fill valve — both are cheap and beginner-friendly to replace.',
    steps: [
      'Lift the tank lid and listen: hissing = fill valve issue; water running into bowl = flapper.',
      'To fix the flapper: shut off the supply, flush to empty, unhook the old flapper, snap on the new one.',
      'To fix the fill valve: shut off the supply, flush to empty, unscrew the lock nut at the base, twist in the new valve.',
      'Set the water level to about 1 inch below the overflow tube.',
      'Turn the water back on, let the tank fill, and confirm the running has stopped.',
    ],
    skills: ['Toilet tank anatomy', 'Flapper replacement', 'Fill valve replacement'],
    tools: [
      { name: 'Universal flapper', rent: null, buy: amz('universal toilet flapper') },
      { name: 'Fill valve kit', rent: null, buy: amz('toilet fill valve replacement') },
      { name: 'Adjustable wrench', rent: '/tool-rentals?category=hand-tools', buy: amz('adjustable wrench') },
    ],
    hireHref: '/post-job?category=plumbing',
    toolsHref: '/tool-rentals?category=plumbing',
    xp: 25,
  },

  // ── Electrical ────────────────────────────────────────────────────────────
  {
    id: 'replace-light-switch',
    title: 'Replace a Light Switch',
    category: 'electrical',
    difficulty: 'Easy',
    minutes: 15,
    featured: false,
    video_url: null,
    license_note: 'This guide covers a standard single-pole switch in jurisdictions where homeowner electrical work is permitted. Check your local code — some states require a licensed electrician even for minor repairs.',
    gradient: 'linear-gradient(135deg, #fefce8, #fef08a)',
    intro: 'Swapping a standard single-pole switch is one of the safest electrical tasks — as long as you confirm the circuit is off first.',
    steps: [
      'Turn off the circuit breaker that controls the switch. Confirm power is off with a non-contact voltage tester.',
      'Unscrew the cover plate and pull the switch out of the box.',
      'Photograph the wiring before disconnecting anything.',
      'Transfer wires to the new switch: black to brass, marked-white to brass, bare copper to green.',
      'Push the switch back in, screw it down, replace the cover plate, and restore power.',
    ],
    skills: ['Breaker shutoff', 'Voltage testing', 'Basic wiring connections'],
    tools: [
      { name: 'Non-contact voltage tester', rent: null, buy: amz('non contact voltage tester') },
      { name: 'Flathead + Phillips screwdrivers', rent: '/tool-rentals?category=hand-tools', buy: amz('screwdriver set') },
      { name: 'Replacement light switch', rent: null, buy: amz('single pole light switch') },
    ],
    hireHref: '/post-job?category=electrical',
    toolsHref: '/tool-rentals?category=electrical',
    xp: 10,
  },
  {
    id: 'install-ceiling-fan',
    title: 'Install a Ceiling Fan',
    category: 'electrical',
    difficulty: 'Medium',
    minutes: 90,
    featured: false,
    video_url: null,
    license_note: 'Check that your existing ceiling box is fan-rated before starting. A non-rated box can fail under the fan\'s dynamic load. If in doubt, replace the box first or hire an electrician.',
    gradient: 'linear-gradient(135deg, #fefce8, #fde047)',
    intro: 'Installing a fan is manageable if the existing box is fan-rated. If you\'re replacing a light fixture, verify the box before lifting anything.',
    steps: [
      'Turn off the circuit breaker. Confirm no power with a voltage tester. Verify the ceiling box is fan-rated.',
      'Install the mounting bracket over the box per the fan\'s instructions.',
      'Assemble the motor and canopy on the ground, then hang from the bracket hook.',
      'Connect wiring: black to black, white to white, bare to bare. Blue wire (if present) connects to the light kit or a separate switch.',
      'Attach blades and the light kit. Restore power and test all speeds and the light.',
    ],
    skills: ['Fan-rated box identification', 'Wire connections', 'Blade installation'],
    tools: [
      { name: 'Non-contact voltage tester', rent: null, buy: amz('non contact voltage tester') },
      { name: 'Drill + bits', rent: '/tool-rentals?category=power-tools', buy: null },
      { name: 'Ladder (6 ft minimum)', rent: '/tool-rentals?category=access', buy: null },
    ],
    hireHref: '/post-job?category=electrical',
    toolsHref: '/tool-rentals?category=electrical',
    xp: 25,
  },
  {
    id: 'reset-gfci',
    title: 'Reset a GFCI Outlet',
    category: 'electrical',
    difficulty: 'Easy',
    minutes: 5,
    featured: true,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fefce8, #fef9c3)',
    intro: 'GFCI outlets protect against shock in wet areas. When one trips, it can cut power to several outlets downstream — the tripped outlet is often in a different room.',
    steps: [
      'Find the outlet with TEST and RESET buttons — it may not be in the same room as the dead outlet.',
      'Check for moisture or visible damage before touching anything.',
      'Press the RESET button firmly until it clicks. Power should restore immediately.',
      'Test with a lamp or outlet tester to confirm.',
      'If the outlet trips again right away, stop and call an electrician — there\'s an underlying fault.',
    ],
    skills: ['GFCI identification', 'Circuit tracing', 'Knowing when to stop'],
    tools: [
      { name: 'Outlet tester', rent: null, buy: amz('outlet circuit tester') },
    ],
    hireHref: '/post-job?category=electrical',
    toolsHref: '/tool-rentals?category=electrical',
    xp: 10,
  },

  // ── HVAC ──────────────────────────────────────────────────────────────────
  {
    id: 'replace-hvac-filter',
    title: 'Replace Your HVAC Filter',
    category: 'hvac',
    difficulty: 'Easy',
    minutes: 10,
    featured: true,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdfa, #99f6e4)',
    intro: 'A clogged filter makes your system work harder, raises your energy bill, and shortens the unit\'s life. Replace it every 1–3 months.',
    steps: [
      'Find the filter slot — typically on the return air vent or at the air handler unit.',
      'Note the size printed on the old filter frame before buying a replacement.',
      'Turn off the thermostat. Slide out the old filter and note the airflow direction arrow.',
      'Slide in the new filter with the arrow pointing toward the unit (away from the return duct).',
      'Write the install date on the frame with a marker, then turn the thermostat back on.',
    ],
    skills: ['Filter sizing', 'Airflow direction', 'Maintenance schedule'],
    tools: [
      { name: 'Pleated HVAC filter (match your size)', rent: null, buy: amz('HVAC air filter pleated') },
      { name: 'Permanent marker', rent: null, buy: amz('permanent marker sharpie') },
    ],
    hireHref: '/post-job?category=hvac',
    toolsHref: '/tool-rentals?category=hvac',
    xp: 10,
  },
  {
    id: 'clean-condensate-drain',
    title: 'Clear Your AC Condensate Drain',
    category: 'hvac',
    difficulty: 'Easy',
    minutes: 20,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdfa, #5eead4)',
    intro: 'A clogged condensate drain causes water to back up into the drain pan and can shut down your AC or cause ceiling damage. Takes 5 minutes to prevent.',
    steps: [
      'Turn off the AC at the thermostat.',
      'Find the condensate drain line — usually a white PVC pipe near the air handler leading outside.',
      'Locate the clean-out cap and remove it.',
      'Pour 1 cup of distilled white vinegar into the opening. Wait 30 minutes.',
      'Flush with water, then restore power and confirm no water backs up at the drain pan.',
    ],
    skills: ['Condensate system basics', 'Preventive AC maintenance'],
    tools: [
      { name: 'Distilled white vinegar', rent: null, buy: amz('distilled white vinegar gallon') },
      { name: 'Wet/dry vacuum (for severe clogs)', rent: '/tool-rentals?category=cleaning', buy: null },
    ],
    hireHref: '/post-job?category=hvac',
    toolsHref: '/tool-rentals?category=hvac',
    xp: 10,
  },

  // ── Carpentry ─────────────────────────────────────────────────────────────
  {
    id: 'patch-drywall',
    title: 'Patch a Drywall Hole',
    category: 'carpentry',
    difficulty: 'Medium',
    minutes: 60,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f5f3ff, #ddd6fe)',
    intro: 'A fist-sized hole can be made invisible with the right patch and two thin coats of compound — the key is feathering the edges, not building them up.',
    steps: [
      'Cut the damaged area into a clean square with a drywall saw.',
      'Cut a drywall patch slightly larger than the hole; score it to leave a paper-backing flap for bonding.',
      'Apply joint compound around the hole, press the patch in place using the paper flap.',
      'Apply a thin first coat feathered 4–6 inches beyond the patch edges. Let dry completely.',
      'Sand lightly, apply a second thin coat feathered even wider, sand again, then prime and paint.',
    ],
    skills: ['Drywall cutting', 'Mud application', 'Feathering technique', 'Surface prep'],
    tools: [
      { name: 'Drywall repair patch', rent: null, buy: amz('drywall repair patch kit') },
      { name: 'Joint compound (pre-mixed)', rent: null, buy: amz('joint compound pre mixed') },
      { name: '4" and 8" putty knives', rent: '/tool-rentals?category=painting', buy: amz('putty knife set drywall') },
      { name: 'Sanding sponge', rent: null, buy: amz('drywall sanding sponge') },
    ],
    hireHref: '/post-job?category=carpentry',
    toolsHref: '/tool-rentals?category=painting',
    xp: 25,
  },
  {
    id: 'install-door-handle',
    title: 'Replace a Door Handle',
    category: 'carpentry',
    difficulty: 'Easy',
    minutes: 30,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f5f3ff, #c4b5fd)',
    intro: 'Most door handles use standard sizing — the new set includes a template that makes this a clean swap with no measuring.',
    steps: [
      'Remove the existing handle by unscrewing the mounting screws on the interior rose plate.',
      'Pull both sides out and unscrew the latch from the door edge.',
      'Use the included template to confirm the hole sizing matches your door.',
      'Insert the new latch and secure with edge screws.',
      'Thread the exterior handle through and align the interior handle. Tighten the mounting screws.',
    ],
    skills: ['Door hardware sizing', 'Latch alignment', 'Rose plate mounting'],
    tools: [
      { name: 'Phillips screwdriver or drill', rent: '/tool-rentals?category=power-tools', buy: amz('cordless screwdriver') },
      { name: 'Replacement door handle set', rent: null, buy: amz('interior door handle set') },
    ],
    hireHref: '/post-job?category=carpentry',
    toolsHref: '/tool-rentals?category=carpentry',
    xp: 10,
  },

  // ── Painting ──────────────────────────────────────────────────────────────
  {
    id: 'paint-a-wall',
    title: 'Prep and Paint a Room Wall',
    category: 'painting',
    difficulty: 'Medium',
    minutes: 180,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fdf2f8, #fbcfe8)',
    intro: 'Good prep determines the result — patching, sanding, and taping matter more than the paint itself.',
    steps: [
      'Patch nail holes and dings with spackling. Sand smooth when dry.',
      'Wipe walls with a damp cloth to remove dust and grease. Let dry fully.',
      'Apply painter\'s tape along trim, outlets, and edges. Lay a drop cloth.',
      'Cut in edges with an angled brush: corners, tape lines, ceiling edge.',
      'Roll the main wall area in a W pattern with a 3/8" nap roller. Apply two coats, letting the first dry between coats.',
    ],
    skills: ['Surface prep', 'Cutting in', 'Rolling technique', 'Two-coat application'],
    tools: [
      { name: 'Paint roller and tray', rent: '/tool-rentals?category=painting', buy: amz('paint roller tray set') },
      { name: '2" angled brush', rent: null, buy: amz('angled paint brush 2 inch') },
      { name: 'Painter\'s tape', rent: null, buy: amz("painter's tape blue") },
      { name: 'Drop cloth', rent: null, buy: amz('canvas drop cloth') },
    ],
    hireHref: '/post-job?category=painting',
    toolsHref: '/tool-rentals?category=painting',
    xp: 25,
  },

  // ── Car Care ──────────────────────────────────────────────────────────────
  {
    id: 'change-oil',
    title: 'Change Your Engine Oil',
    category: 'car-care',
    difficulty: 'Medium',
    minutes: 45,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #eef2ff, #c7d2fe)',
    intro: 'An oil change is the highest-leverage maintenance task you own — wrong intervals cost engines. Getting comfortable doing it yourself saves money every 5,000 miles.',
    steps: [
      'Look up the correct oil spec (e.g. 5W-30) and filter for your year/make/model.',
      'Warm the engine 2 minutes, turn it off. Jack up the car and set it on jack stands.',
      'Place a drain pan under the drain plug, remove the plug, and let the oil drain fully (5–10 min).',
      'Remove the old oil filter with a filter wrench. Lightly coat the new filter gasket with fresh oil, hand-tighten.',
      'Reinstall the drain plug, fill from the top, check level with the dipstick, run the engine briefly, and check for leaks.',
    ],
    skills: ['Jack and stand safety', 'Oil spec lookup', 'Filter replacement', 'Drain plug torque'],
    tools: [
      { name: 'Floor jack and jack stands', rent: '/tool-rentals?category=automotive', buy: null },
      { name: 'Oil filter wrench', rent: '/tool-rentals?category=automotive', buy: amz('oil filter wrench') },
      { name: 'Drain pan', rent: null, buy: amz('oil drain pan') },
      { name: 'Correct oil + filter for your vehicle', rent: null, buy: amz('motor oil 5w30') },
    ],
    hireHref: '/post-job?category=car-care',
    toolsHref: '/tool-rentals?category=automotive',
    xp: 25,
  },
  {
    id: 'replace-wipers',
    title: 'Replace Windshield Wipers',
    category: 'car-care',
    difficulty: 'Easy',
    minutes: 10,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #eef2ff, #e0e7ff)',
    intro: 'Streaking wipers are a safety issue. Replacing them takes 10 minutes and no tools — just the right size for your car.',
    steps: [
      'Look up the correct blade size for your driver and passenger sides (they\'re often different).',
      'Lift the wiper arm away from the windshield until it locks raised.',
      'Press the tab where the blade meets the arm and slide the old blade off.',
      'Hook the new blade onto the arm and press until it clicks.',
      'Gently lower the arm back to the glass. Repeat for the other side.',
    ],
    skills: ['Blade sizing', 'Hook-style connector', 'Safe arm handling'],
    tools: [
      { name: 'Replacement wiper blades (check your vehicle size)', rent: null, buy: amz('windshield wiper blades') },
    ],
    hireHref: '/post-job?category=car-care',
    toolsHref: '/tool-rentals?category=automotive',
    xp: 10,
  },

  // ── Landscaping ───────────────────────────────────────────────────────────
  {
    id: 'mulch-garden-bed',
    title: 'Mulch a Garden Bed',
    category: 'landscaping',
    difficulty: 'Easy',
    minutes: 120,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdf4, #bbf7d0)',
    intro: 'Mulch suppresses weeds, retains moisture, and regulates soil temperature — 3 to 4 inches is the sweet spot.',
    steps: [
      'Clear the bed of weeds, pulling from the root. Cutting them leaves regrowth.',
      'Edge the bed with a flat spade to create a clean border.',
      'Optionally lay cardboard or landscape fabric for extra weed suppression.',
      'Spread mulch to a 3–4 inch even depth using a rake.',
      'Keep mulch 2–3 inches away from plant stems and tree trunks to prevent rot.',
    ],
    skills: ['Weed removal', 'Bed edging', 'Mulch depth control'],
    tools: [
      { name: 'Flat spade for edging', rent: '/tool-rentals?category=landscaping', buy: amz('flat spade edger') },
      { name: 'Garden rake', rent: '/tool-rentals?category=landscaping', buy: amz('garden rake') },
      { name: 'Wheelbarrow', rent: '/tool-rentals?category=landscaping', buy: null },
      { name: 'Bagged or bulk mulch', rent: null, buy: amz('garden mulch bag') },
    ],
    hireHref: '/post-job?category=landscaping',
    toolsHref: '/tool-rentals?category=landscaping',
    xp: 10,
  },

  // ── Maintenance ───────────────────────────────────────────────────────────
  {
    id: 'caulk-bathtub',
    title: 'Recaulk a Bathtub',
    category: 'maintenance',
    difficulty: 'Easy',
    minutes: 30,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f8fafc, #e2e8f0)',
    intro: 'Cracked or moldy caulk lets water into the wall. Removing the old bead and applying a fresh one is quick and worth doing every few years.',
    steps: [
      'Use a caulk remover tool or utility knife to cut and pull out all the old caulk.',
      'Clean the joint thoroughly with rubbing alcohol. Let it dry completely — even overnight.',
      'Fill the tub with water before caulking; this pre-stresses the joint so it won\'t crack in use.',
      'Apply a thin, continuous bead of tub-and-tile silicone caulk along the joint.',
      'Wet your finger and smooth the bead in one pass. Remove tape immediately. Let cure 24–48 hours before use.',
    ],
    skills: ['Caulk removal', 'Surface prep', 'Bead application', 'Wet smoothing'],
    tools: [
      { name: 'Caulk remover tool', rent: null, buy: amz('caulk remover tool') },
      { name: 'Tub-and-tile silicone caulk', rent: null, buy: amz('tub tile silicone caulk white') },
      { name: 'Rubbing alcohol', rent: null, buy: amz('isopropyl alcohol 91%') },
    ],
    hireHref: '/post-job',
    toolsHref: '/tool-rentals',
    xp: 10,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const DIFFICULTY_COLOR = { Easy: '#22c55e', Medium: '#f97316', Hard: '#ef4444' };
const DIFFICULTY_XP    = { Easy: 10, Medium: 25, Hard: 50 };

function normalize(str) { return String(str || '').toLowerCase(); }

function getPersona(user) {
  if (!user) return 'guest';
  if (user.role === 'consultant') return 'consultant';
  if (user.is_business_owner || user.has_business) return 'business';
  if (user.is_helper) return 'helper';
  return 'customer';
}

const HERO = {
  guest: {
    title: 'Learn. Do. Earn.',
    sub: 'Step-by-step guides for home repair and car care — every skill you build connects to the tools, kits, and Helpers you need to finish the job.',
    cta: null,
  },
  customer: {
    title: 'Learn. Do. Earn.',
    sub: 'Every guide you complete builds real skill. When you\'re ready, list yourself as a Helper and turn what you know into income.',
    cta: { label: 'Become a Helper', href: '/join?mode=helper' },
  },
  helper: {
    title: 'Upskill. Grow. Earn more.',
    sub: 'Every guide you complete can be added to your Helper profile as a verified skill. More skills means more jobs, more reviews, and a higher Pulse score.',
    cta: { label: 'View your skill profile', href: '/helper-profile/skills' },
  },
  consultant: {
    title: 'Share what you know.',
    sub: 'Your expertise has real value. Submit a guide, build your reputation, and earn attribution when your content helps others succeed.',
    cta: { label: 'Submit a Guide', href: null }, // null → opens submit modal
  },
  business: {
    title: 'Train your team.',
    sub: 'Use these guides to onboard new hires, set skills standards for your crew, and build a library of trade knowledge your business depends on.',
    cta: { label: 'Manage your team', href: '/business-hub' },
  },
};

// schema.org/HowTo structured data for all guides (SEO — Priority 10)
const HOWTO_LD = GUIDES.map((g) => ({
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: g.title,
  description: g.intro,
  totalTime: `PT${g.minutes}M`,
  step: g.steps.map((text, i) => ({
    '@type': 'HowToStep',
    position: i + 1,
    text,
  })),
  tool: g.tools.map((t) => ({ '@type': 'HowToTool', name: t.name })),
}));

// ── UGC submit form state ─────────────────────────────────────────────────────

const EMPTY_SUBMISSION = {
  title: '', category: 'plumbing', difficulty: 'Easy', estimated_minutes: 30,
  intro: '', steps: ['', ''], skills: [''], video_url: '', license_note: '',
  tools: [{ name: '', buy_url: '', rent_url: '' }],
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function LearnModePage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery]                 = useState(searchParams.get('q') || '');
  const [activeCategory, setActiveCategory] = useState('all');
  const [expandedId, setExpandedId]       = useState(null);
  const [viewMode, setViewMode]           = useState('list');
  const [completions, setCompletions]     = useState({});
  const [completing, setCompleting]       = useState(null);

  // App banner (Priority 13)
  const [showAppBanner, setShowAppBanner] = useState(false);

  // UGC submit modal (Priority 11)
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitForm, setSubmitForm]         = useState(EMPTY_SUBMISSION);
  const [submitting, setSubmitting]         = useState(false);
  const [submitSuccess, setSubmitSuccess]   = useState(false);
  const [submitError, setSubmitError]       = useState('');

  // Social proof stats (Priority 8)
  const [guideStats, setGuideStats] = useState({});  // { [guide_id]: { completions, views } }

  // Badges + XP toast + helper prompt
  const [badges, setBadges]           = useState([]);          // ['plumbing', 'electrical', ...]
  const [xpToast, setXpToast]         = useState(null);        // { xp, badge } | null
  const [helperPrompt, setHelperPrompt] = useState(null);      // { guideTitle, skill } | null
  const xpToastTimer = useRef(null);

  const listRef    = useRef(null);
  const viewedRef  = useRef(new Set()); // guides already view-tracked this session

  const persona    = useMemo(() => getPersona(user), [user]);
  const hero       = HERO[persona] || HERO.guest;
  const categoryMap = useMemo(() => Object.fromEntries(CATEGORIES.map((c) => [c.id, c])), []);

  // ── Effects ──────────────────────────────────────────────────────────────────

  // Inject HowTo JSON-LD (Priority 10)
  useEffect(() => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(HOWTO_LD);
    document.head.appendChild(script);
    return () => { try { document.head.removeChild(script); } catch {} };
  }, []);

  // App banner — show on mobile, once per session (Priority 13)
  useEffect(() => {
    const dismissed = localStorage.getItem(APP_BANNER_KEY);
    if (!dismissed && window.innerWidth < 768) setShowAppBanner(true);
  }, []);

  // Fetch guide stats for social proof (Priority 8) — public, no auth needed
  useEffect(() => {
    api.get('/api/learn/stats')
      .then(({ data }) => { if (data.stats) setGuideStats(data.stats); })
      .catch(() => {});
  }, []);

  // Fetch earned badges (authenticated only)
  useEffect(() => {
    if (!user) return;
    api.get('/api/learn/badges')
      .then(({ data }) => { if (Array.isArray(data.badges)) setBadges(data.badges.map((b) => b.category)); })
      .catch(() => {});
  }, [user]);

  // Cleanup XP toast timer on unmount
  useEffect(() => () => { if (xpToastTimer.current) clearTimeout(xpToastTimer.current); }, []);

  // Load completions: localStorage first, then server if authenticated
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(COMPLETIONS_KEY) || '{}');
      setCompletions(stored);
    } catch {}

    if (user) {
      api.get('/api/learn/completions')
        .then(({ data }) => {
          const serverMap = {};
          (data.completions || []).forEach((c) => { serverMap[c.guide_id] = c.completed_at; });
          setCompletions((prev) => ({ ...prev, ...serverMap }));
        })
        .catch(() => {});
    }
  }, [user]);

  // ── Derived state ────────────────────────────────────────────────────────────

  const filteredGuides = useMemo(() => {
    const q = normalize(query);
    return GUIDES.filter((g) => {
      const matchesCat = activeCategory === 'all' || g.category === activeCategory;
      if (!matchesCat) return false;
      if (!q) return true;
      return (
        normalize(g.title).includes(q) ||
        normalize(g.intro).includes(q) ||
        normalize(g.category).includes(q) ||
        g.skills.some((s) => normalize(s).includes(q)) ||
        g.steps.some((s) => normalize(s).includes(q))
      );
    });
  }, [query, activeCategory]);

  // Dynamic featured: top-3 by DB completion count, fallback to static featured flag
  const featuredGuides = useMemo(() => {
    const hasStats = Object.keys(guideStats).length > 0;
    if (hasStats) {
      return [...GUIDES]
        .sort((a, b) => (guideStats[b.id]?.completions ?? 0) - (guideStats[a.id]?.completions ?? 0))
        .slice(0, 3);
    }
    return GUIDES.filter((g) => g.featured);
  }, [guideStats]);
  const showFeatured   = !query && activeCategory === 'all';
  const completedCount = Object.keys(completions).length;
  const totalGuides    = GUIDES.length;

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const fireXpToast = useCallback((xp, badge) => {
    if (xpToastTimer.current) clearTimeout(xpToastTimer.current);
    setXpToast({ xp, badge });
    xpToastTimer.current = setTimeout(() => setXpToast(null), 4000);
  }, []);

  const handleComplete = useCallback(async (guideId) => {
    if (completions[guideId]) return;
    setCompleting(guideId);

    const guide = GUIDES.find((g) => g.id === guideId);
    const xp    = DIFFICULTY_XP[guide?.difficulty] ?? 10;
    const next  = { ...completions, [guideId]: Date.now() };
    setCompletions(next);
    localStorage.setItem(COMPLETIONS_KEY, JSON.stringify(next));

    let badgeAwarded = null;
    if (user) {
      try {
        const { data } = await api.post('/api/learn/completions', {
          guide_id: guideId,
          difficulty: guide?.difficulty ?? 'Easy',
        });
        if (data.badge_awarded) {
          badgeAwarded = data.badge_awarded;
          setBadges((prev) => prev.includes(badgeAwarded) ? prev : [...prev, badgeAwarded]);
        }
      } catch {}
    }

    fireXpToast(xp, badgeAwarded);

    // Helper post-completion prompt — suggest adding skill to profile
    if (persona === 'helper' && guide?.skills?.length) {
      setHelperPrompt({ guideTitle: guide.title, skill: guide.skills[0] });
    }

    setCompleting(null);
  }, [completions, user, persona, fireXpToast]);

  const handleCategoryClick = (id) => {
    setActiveCategory(id);
    setExpandedId(null);
    setQuery('');
    setSearchParams({}, { replace: true });
  };

  const handleSearch = (e) => {
    e.preventDefault();
    const trimmed = query.trim();
    setSearchParams(trimmed ? { q: trimmed } : {}, { replace: true });
    setExpandedId(null);
  };

  const toggleGuide = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
    // Fire view event once per guide per session (Priority 8)
    if (!viewedRef.current.has(id)) {
      viewedRef.current.add(id);
      api.post('/api/learn/views', { guide_id: id }).catch(() => {});
    }
  };

  // AI step prompt (Priority 7) — opens the Ask AI widget with guide context
  const handleAskAI = useCallback((guide, stepIndex, stepText) => {
    const prefill = `I'm following the "${guide.title}" guide (step ${stepIndex + 1}): "${stepText.slice(0, 120)}"${stepText.length > 120 ? '…' : ''}. I have a question about this step.`;
    window.dispatchEvent(new CustomEvent('oxsteed:open-support', {
      detail: { prefill, guide_id: guide.id, step: stepIndex + 1 },
    }));
  }, []);

  const dismissAppBanner = () => {
    setShowAppBanner(false);
    localStorage.setItem(APP_BANNER_KEY, '1');
  };

  // UGC submit handlers (Priority 11)
  const handleSubmitField = (field, value) =>
    setSubmitForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmitStep = (i, value) => {
    const steps = [...submitForm.steps];
    steps[i] = value;
    setSubmitForm((prev) => ({ ...prev, steps }));
  };

  const handleSubmitSkill = (i, value) => {
    const skills = [...submitForm.skills];
    skills[i] = value;
    setSubmitForm((prev) => ({ ...prev, skills }));
  };

  const handleSubmitGuide = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError('');
    try {
      await api.post('/api/learn/submissions', {
        ...submitForm,
        estimated_minutes: parseInt(submitForm.estimated_minutes, 10),
        steps:  submitForm.steps.filter(Boolean),
        skills: submitForm.skills.filter(Boolean),
        tools:  submitForm.tools.filter((t) => t.name.trim()),
      });
      setSubmitSuccess(true);
    } catch (err) {
      setSubmitError(err?.response?.data?.message || 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const activeCategoryLabel = activeCategory === 'all'
    ? 'All'
    : (categoryMap[activeCategory]?.label ?? activeCategory);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <PageShell>
      <PageMeta
        title="Learn to DIY — Home Repair, Car Care & Trade Skills | OxSteed"
        description="Step-by-step guides for fixing faucets, patching drywall, changing oil, and more. Every guide includes tool lists, skill tracking, and a direct path to hire a local Helper."
      />

      <div className="lrn-page">

        {/* ── Mobile app banner (Priority 13) ─────────────────────────────── */}
        {showAppBanner && (
          <div className="lrn-app-banner" role="banner">
            <Smartphone size={20} aria-hidden="true" />
            <span>Get offline access to all guides — <strong>Download the OxSteed app</strong></span>
            <a
              href="https://apps.apple.com/app/oxsteed"
              target="_blank"
              rel="noopener noreferrer"
              className="lrn-app-banner-btn"
            >
              App Store
            </a>
            <button
              type="button"
              className="lrn-app-banner-close"
              onClick={dismissAppBanner}
              aria-label="Dismiss app banner"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <div className={`lrn-hero lrn-hero--${persona}`}>
          <div className="lrn-hero-body">
            <p className="lrn-hero-eyebrow">Learn Mode</p>
            <h1 className="lrn-hero-title">{hero.title}</h1>
            <p className="lrn-hero-sub">{hero.sub}</p>
            <div className="lrn-hero-actions">
              {hero.cta && (
                hero.cta.href ? (
                  <Link to={hero.cta.href} className="lrn-hero-cta">{hero.cta.label} →</Link>
                ) : (
                  <button
                    type="button"
                    className="lrn-hero-cta"
                    onClick={() => { setSubmitForm(EMPTY_SUBMISSION); setSubmitSuccess(false); setShowSubmitModal(true); }}
                  >
                    {hero.cta.label} →
                  </button>
                )
              )}
              {/* UGC submit button — helpers and consultants only (Priority 11) */}
              {user && (user.is_helper || user.role === 'consultant') && (
                <button
                  type="button"
                  className="lrn-hero-submit-btn"
                  onClick={() => { setSubmitForm(EMPTY_SUBMISSION); setSubmitSuccess(false); setShowSubmitModal(true); }}
                >
                  + Submit a Guide
                </button>
              )}
            </div>
          </div>
          <div className="lrn-ladder">
            {['Learn a skill', 'Do it yourself', 'List as a service', 'Grow your business'].map((step, i) => (
              <span key={step} className="lrn-ladder-step">
                <span className="lrn-ladder-num">{i + 1}</span>
                {step}
              </span>
            ))}
          </div>
        </div>

        {/* ── Progress strip ────────────────────────────────────────────────── */}
        {completedCount > 0 && (
          <div className="lrn-progress-strip">
            <div className="lrn-progress-left">
              <CheckCircle size={16} aria-hidden="true" />
              <span>{completedCount} of {totalGuides} guides completed</span>
            </div>
            <div className="lrn-progress-bar-wrap" role="progressbar" aria-valuenow={completedCount} aria-valuemax={totalGuides}>
              <div className="lrn-progress-bar" style={{ width: `${(completedCount / totalGuides) * 100}%` }} />
            </div>
            <span className="lrn-progress-xp">
              +{Object.keys(completions).reduce((sum, id) => {
                const g = GUIDES.find((g) => g.id === id);
                return sum + (g ? DIFFICULTY_XP[g.difficulty] ?? 0 : 0);
              }, 0)} XP earned
            </span>
          </div>
        )}

        {/* ── Earned badges ─────────────────────────────────────────────────── */}
        {badges.length > 0 && (
          <div className="lrn-badges-row" aria-label="Earned skill badges">
            <Award size={14} className="lrn-badges-icon" aria-hidden="true" />
            <span className="lrn-badges-label">Badges:</span>
            {badges.map((cat) => {
              const c = CATEGORIES.find((x) => x.id === cat);
              return (
                <span key={cat} className="lrn-badge-chip" style={{ '--badge-color': c?.color ?? '#f97316' }}>
                  {c && <c.Icon size={11} aria-hidden="true" />}
                  {c?.label ?? cat}
                </span>
              );
            })}
          </div>
        )}

        {/* ── Helper post-completion prompt ──────────────────────────────────── */}
        {helperPrompt && (
          <div className="lrn-helper-prompt" role="status">
            <CheckCircle size={16} aria-hidden="true" />
            <span>
              <strong>{helperPrompt.guideTitle}</strong> completed!
              Add <em>{helperPrompt.skill}</em> to your Helper profile?
            </span>
            <Link to="/helper-profile/skills" className="lrn-helper-prompt-cta">Add skill →</Link>
            <button
              type="button"
              className="lrn-helper-prompt-close"
              onClick={() => setHelperPrompt(null)}
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* ── Search ────────────────────────────────────────────────────────── */}
        <form className="lrn-search" onSubmit={handleSearch}>
          <Search size={18} className="lrn-search-icon" aria-hidden="true" />
          <input
            type="search"
            className="lrn-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search guides… (faucet, drywall, oil change)"
            aria-label="Search guides"
          />
          {query && (
            <button type="button" className="lrn-search-clear" onClick={() => {
              setQuery(''); setSearchParams({}, { replace: true });
            }} aria-label="Clear search">
              <X size={16} />
            </button>
          )}
        </form>

        {/* ── Featured guides ───────────────────────────────────────────────── */}
        {showFeatured && (
          <section className="lrn-section">
            <h2 className="lrn-section-label">
              <TrendingUp size={14} aria-hidden="true" />
              Start Here
            </h2>
            <div className="lrn-featured-grid">
              {featuredGuides.map((guide) => {
                const cat  = categoryMap[guide.category];
                const done = Boolean(completions[guide.id]);
                return (
                  <button
                    key={guide.id}
                    type="button"
                    className={`lrn-featured-card${done ? ' is-done' : ''}`}
                    style={{ background: guide.gradient }}
                    onClick={() => {
                      setActiveCategory(guide.category);
                      setExpandedId(guide.id);
                      setTimeout(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                    }}
                  >
                    {done && <CheckCircle size={18} className="lrn-featured-check" aria-label="Completed" />}
                    <span className="lrn-featured-cat" style={{ color: cat?.color }}>
                      {cat && <cat.Icon size={14} aria-hidden="true" />}
                      {cat?.label}
                    </span>
                    <span className="lrn-featured-name">{guide.title}</span>
                    <span className="lrn-featured-meta">
                      <span style={{ color: DIFFICULTY_COLOR[guide.difficulty] }}>{guide.difficulty}</span>
                      <span>·</span>
                      <Clock size={12} aria-hidden="true" />
                      <span>{guide.minutes} min</span>
                      {(guideStats[guide.id]?.completions ?? 0) > 0 && (
                        <>
                          <span>·</span>
                          <span className="lrn-stat-count">
                            {fmtCount(guideStats[guide.id].completions)} done
                          </span>
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Category grid ─────────────────────────────────────────────────── */}
        <section className="lrn-section">
          <h2 className="lrn-section-label">Browse by Category</h2>
          <div className="lrn-categories">
            {CATEGORIES.map(({ id, label, Icon, color }) => {
              const isActive = activeCategory === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={`lrn-cat-btn${isActive ? ' is-active' : ''}`}
                  style={isActive ? { background: color, borderColor: color, color: '#fff' } : { '--cat-color': color }}
                  onClick={() => handleCategoryClick(id)}
                  aria-pressed={isActive}
                >
                  <Icon size={20} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Guide list ────────────────────────────────────────────────────── */}
        <section className="lrn-section" ref={listRef}>
          <div className="lrn-list-header">
            <h2 className="lrn-section-label">
              {activeCategoryLabel} Guides
              <span className="lrn-count">({filteredGuides.length})</span>
            </h2>
            <div className="lrn-view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                className={viewMode === 'list' ? 'is-active' : ''}
                onClick={() => setViewMode('list')}
                aria-pressed={viewMode === 'list'}
                title="List view"
              >
                <LayoutList size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={viewMode === 'grid' ? 'is-active' : ''}
                onClick={() => setViewMode('grid')}
                aria-pressed={viewMode === 'grid'}
                title="Grid view"
              >
                <LayoutGrid size={16} aria-hidden="true" />
              </button>
            </div>
          </div>

          {filteredGuides.length === 0 ? (
            <div className="lrn-empty">
              <p>No guides match "{query}".</p>
              <button type="button" onClick={() => { setQuery(''); setActiveCategory('all'); setSearchParams({}, { replace: true }); }}>
                Clear filters
              </button>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="lrn-grid">
              {filteredGuides.map((guide) => {
                const cat  = categoryMap[guide.category];
                const done = Boolean(completions[guide.id]);
                return (
                  <button
                    key={guide.id}
                    type="button"
                    className={`lrn-grid-card${done ? ' is-done' : ''}`}
                    onClick={() => { setViewMode('list'); setExpandedId(guide.id); }}
                  >
                    <div className="lrn-grid-thumb" style={{ background: guide.gradient }}>
                      {done && <span className="lrn-grid-done-badge" aria-label="Completed"><CheckCircle size={16} /></span>}
                      {guide.video_url && <span className="lrn-grid-video-badge" aria-label="Has video"><PlayCircle size={16} /></span>}
                      <span className="lrn-grid-cat-icon" style={{ color: cat?.color }}>{cat && <cat.Icon size={22} aria-hidden="true" />}</span>
                    </div>
                    <div className="lrn-grid-body">
                      <span className="lrn-grid-cat-label" style={{ color: cat?.color }}>{cat?.label}</span>
                      <span className="lrn-grid-name">{guide.title}</span>
                      <span className="lrn-grid-meta">
                        <span style={{ color: DIFFICULTY_COLOR[guide.difficulty] }} className="lrn-difficulty">{guide.difficulty}</span>
                        <span className="lrn-meta-sep" aria-hidden="true" />
                        <Clock size={12} aria-hidden="true" />
                        <span>{guide.minutes} min</span>
                        {(guideStats[guide.id]?.completions ?? 0) > 0 && (
                          <>
                            <span className="lrn-meta-sep" aria-hidden="true" />
                            <span className="lrn-stat-count">{fmtCount(guideStats[guide.id].completions)} done</span>
                          </>
                        )}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <ul className="lrn-guide-list">
              {/* "Coming soon" card for thin categories */}
              {activeCategory !== 'all' && filteredGuides.length < 3 && !query && (() => {
                const cat = categoryMap[activeCategory];
                return (
                  <li key="coming-soon" className="lrn-coming-soon-card" aria-hidden="true">
                    {cat && <cat.Icon size={20} style={{ color: cat.color }} aria-hidden="true" />}
                    <span>More {cat?.label ?? activeCategory} guides coming soon</span>
                  </li>
                );
              })()}
              {filteredGuides.map((guide) => {
                const cat        = categoryMap[guide.category];
                const isExpanded = expandedId === guide.id;
                const done       = Boolean(completions[guide.id]);
                return (
                  <li key={guide.id} className="lrn-guide-item">
                    <button
                      type="button"
                      className={`lrn-guide-row${isExpanded ? ' is-open' : ''}`}
                      onClick={() => toggleGuide(guide.id)}
                      aria-expanded={isExpanded}
                    >
                      <span
                        className="lrn-guide-icon"
                        style={{ background: cat ? `${cat.color}18` : '#f1f5f9', color: cat?.color ?? '#64748b' }}
                        aria-hidden="true"
                      >
                        {cat && <cat.Icon size={18} />}
                      </span>
                      <span className="lrn-guide-text">
                        <span className="lrn-guide-name">
                          {guide.title}
                          {guide.video_url && <PlayCircle size={13} className="lrn-video-badge" aria-label="Has video" />}
                        </span>
                        <span className="lrn-guide-meta">
                          <span className="lrn-difficulty" style={{ color: DIFFICULTY_COLOR[guide.difficulty] }}>{guide.difficulty}</span>
                          <span className="lrn-meta-sep" aria-hidden="true" />
                          <Clock size={13} aria-hidden="true" />
                          <span>{guide.minutes} min</span>
                          {(guideStats[guide.id]?.completions ?? 0) > 0 && (
                            <span className="lrn-stat-count">{fmtCount(guideStats[guide.id].completions)} done</span>
                          )}
                          {done && (
                            <span className="lrn-done-chip" aria-label="Completed">
                              <CheckCircle size={12} /> Done
                            </span>
                          )}
                        </span>
                      </span>
                      <ChevronRight size={18} className={`lrn-chevron${isExpanded ? ' is-open' : ''}`} aria-hidden="true" />
                    </button>

                    {isExpanded && (
                      <div className="lrn-guide-detail">
                        {/* Video */}
                        {guide.video_url ? (
                          <div className="lrn-video-wrap">
                            <iframe src={guide.video_url} title={`Video: ${guide.title}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
                          </div>
                        ) : (
                          <div className="lrn-video-placeholder">
                            <PlayCircle size={28} aria-hidden="true" />
                            <span>Video guide coming soon</span>
                          </div>
                        )}

                        <p className="lrn-guide-intro">{guide.intro}</p>

                        {/* License callout */}
                        {guide.license_note && (
                          <div className="lrn-license-note" role="note">
                            <AlertTriangle size={15} aria-hidden="true" />
                            <span>{guide.license_note}</span>
                          </div>
                        )}

                        <div className="lrn-detail-grid">
                          {/* Steps */}
                          <div className="lrn-detail-steps">
                            <h3 className="lrn-detail-heading">Steps</h3>
                            <ol className="lrn-steps">
                              {guide.steps.map((step, i) => (
                                <li key={i}>
                                  <span className="lrn-step-num">{i + 1}</span>
                                  <span className="lrn-step-body">
                                    {step}
                                    {/* Ask AI about this step (Priority 7) */}
                                    <button
                                      type="button"
                                      className="lrn-ask-ai-btn"
                                      onClick={() => handleAskAI(guide, i, step)}
                                      title="Ask AI about this step"
                                      aria-label={`Ask AI about step ${i + 1}`}
                                    >
                                      <MessageCircle size={12} aria-hidden="true" />
                                      Ask AI
                                    </button>
                                  </span>
                                </li>
                              ))}
                            </ol>

                            {/* Completion */}
                            {done ? (
                              <div className="lrn-completed-badge">
                                <CheckCircle size={18} aria-hidden="true" />
                                Guide completed · +{DIFFICULTY_XP[guide.difficulty] ?? 0} XP earned
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="lrn-complete-btn"
                                onClick={() => handleComplete(guide.id)}
                                disabled={completing === guide.id}
                              >
                                {completing === guide.id ? 'Saving…' : '✓ Mark as Complete'}
                              </button>
                            )}
                          </div>

                          {/* Side panels */}
                          <div className="lrn-detail-side">
                            <div className="lrn-detail-panel">
                              <h3 className="lrn-detail-heading">Skills you'll learn</h3>
                              <div className="lrn-skill-chips">
                                {guide.skills.map((s) => <span key={s} className="lrn-chip">{s}</span>)}
                              </div>
                            </div>

                            <div className="lrn-detail-panel">
                              <h3 className="lrn-detail-heading">
                                <ShoppingBag size={14} aria-hidden="true" />
                                Tools &amp; materials
                              </h3>
                              <ul className="lrn-tool-list">
                                {guide.tools.map((tool) => (
                                  <li key={tool.name} className="lrn-tool-row">
                                    <span className="lrn-tool-name">{tool.name}</span>
                                    <span className="lrn-tool-links">
                                      {tool.buy && (
                                        <a href={tool.buy} target="_blank" rel="noopener noreferrer" className="lrn-tool-buy" aria-label={`Buy ${tool.name} on Amazon`}>
                                          Buy <ExternalLink size={11} aria-hidden="true" />
                                        </a>
                                      )}
                                      {tool.rent && (
                                        <Link to={tool.rent} className="lrn-tool-rent">Rent</Link>
                                      )}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>

                            {/* Persona CTA */}
                            <div className="lrn-detail-ctas">
                              {persona === 'helper' ? (
                                <>
                                  <p className="lrn-cta-label"><User size={13} aria-hidden="true" />You know this skill</p>
                                  <Link to="/helper-profile/skills" className="lrn-cta-primary">Add to your profile →</Link>
                                  <Link to={guide.hireHref} className="lrn-cta-secondary">Post a job in this category</Link>
                                </>
                              ) : persona === 'customer' ? (
                                <>
                                  <p className="lrn-cta-label"><User size={13} aria-hidden="true" />Rather not DIY?</p>
                                  <Link to={guide.hireHref} className="lrn-cta-primary">Find a local Helper →</Link>
                                  <Link to={guide.toolsHref} className="lrn-cta-secondary">Rent the tools</Link>
                                </>
                              ) : (
                                <>
                                  <p className="lrn-cta-label"><User size={13} aria-hidden="true" />Need help?</p>
                                  <Link to={guide.hireHref} className="lrn-cta-primary">Find a local Helper →</Link>
                                  <Link to="/join?mode=helper" className="lrn-cta-secondary">Offer this as a service</Link>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Skills-to-income banner */}
                        {!done && (
                          <div className="lrn-income-banner">
                            <BookOpen size={16} aria-hidden="true" />
                            <span>
                              {persona === 'helper'
                                ? 'Complete this guide and add it to your Helper profile as a verified skill.'
                                : 'Complete enough guides in a category and you can list yourself as a Helper — turning what you learn into income.'}
                            </span>
                            <Link to={persona === 'helper' ? '/helper-profile/skills' : '/join?mode=helper'}>
                              {persona === 'helper' ? 'Go to your profile' : 'See how it works'}
                            </Link>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

      </div>

      {/* ── XP toast ──────────────────────────────────────────────────────── */}
      {xpToast && (
        <div className="lrn-xp-toast" role="status" aria-live="polite">
          <CheckCircle size={16} aria-hidden="true" />
          <span>+{xpToast.xp} XP earned!</span>
          {xpToast.badge && (
            <>
              <span className="lrn-xp-toast-sep">·</span>
              <Award size={14} aria-hidden="true" />
              <span className="lrn-xp-toast-badge">
                {CATEGORIES.find((c) => c.id === xpToast.badge)?.label ?? xpToast.badge} badge unlocked!
              </span>
            </>
          )}
        </div>
      )}

      {/* ── UGC Submit Modal (Priority 11) ─────────────────────────────────── */}
      {showSubmitModal && (
        <div className="lrn-modal-overlay" role="dialog" aria-modal="true" aria-label="Submit a guide">
          <div className="lrn-modal">
            <div className="lrn-modal-header">
              <h2 className="lrn-modal-title">Submit a Guide</h2>
              <button type="button" className="lrn-modal-close" onClick={() => setShowSubmitModal(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>

            {submitSuccess ? (
              <div className="lrn-modal-success">
                <CheckCircle size={40} aria-hidden="true" />
                <h3>Guide submitted!</h3>
                <p>Your guide is under review. We'll let you know once it's approved and published.</p>
                <button type="button" className="lrn-cta-primary" onClick={() => setShowSubmitModal(false)}>Done</button>
              </div>
            ) : (
              <form className="lrn-modal-form" onSubmit={handleSubmitGuide}>
                <div className="lrn-modal-row">
                  <label className="lrn-modal-label">Guide title *
                    <input className="lrn-modal-input" type="text" maxLength={200} required
                      value={submitForm.title}
                      onChange={(e) => handleSubmitField('title', e.target.value)}
                      placeholder="e.g. Replace a Bathroom Faucet"
                    />
                  </label>
                </div>

                <div className="lrn-modal-row lrn-modal-row--cols">
                  <label className="lrn-modal-label">Category *
                    <select className="lrn-modal-input" value={submitForm.category}
                      onChange={(e) => handleSubmitField('category', e.target.value)}>
                      {CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="lrn-modal-label">Difficulty *
                    <select className="lrn-modal-input" value={submitForm.difficulty}
                      onChange={(e) => handleSubmitField('difficulty', e.target.value)}>
                      {['Easy', 'Medium', 'Hard'].map((d) => <option key={d}>{d}</option>)}
                    </select>
                  </label>
                  <label className="lrn-modal-label">Est. minutes *
                    <input className="lrn-modal-input" type="number" min={1} max={1440} required
                      value={submitForm.estimated_minutes}
                      onChange={(e) => handleSubmitField('estimated_minutes', e.target.value)}
                    />
                  </label>
                </div>

                <div className="lrn-modal-row">
                  <label className="lrn-modal-label">Intro (1–2 sentences) *
                    <textarea className="lrn-modal-input lrn-modal-textarea" rows={3} maxLength={2000} required
                      value={submitForm.intro}
                      onChange={(e) => handleSubmitField('intro', e.target.value)}
                      placeholder="What this guide covers and why it matters."
                    />
                  </label>
                </div>

                <div className="lrn-modal-row">
                  <p className="lrn-modal-label" style={{ marginBottom: '.5rem' }}>Steps * (min 2)</p>
                  {submitForm.steps.map((step, i) => (
                    <div key={i} className="lrn-modal-step-row">
                      <span className="lrn-step-num">{i + 1}</span>
                      <input className="lrn-modal-input" type="text" maxLength={500}
                        value={step}
                        onChange={(e) => handleSubmitStep(i, e.target.value)}
                        placeholder={`Step ${i + 1}`}
                      />
                      {submitForm.steps.length > 2 && (
                        <button type="button" className="lrn-modal-remove" onClick={() => {
                          const steps = submitForm.steps.filter((_, j) => j !== i);
                          setSubmitForm((prev) => ({ ...prev, steps }));
                        }}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                  {submitForm.steps.length < 20 && (
                    <button type="button" className="lrn-modal-add-btn"
                      onClick={() => setSubmitForm((prev) => ({ ...prev, steps: [...prev.steps, ''] }))}>
                      + Add step
                    </button>
                  )}
                </div>

                <div className="lrn-modal-row">
                  <p className="lrn-modal-label" style={{ marginBottom: '.5rem' }}>Skills you'll learn *</p>
                  <div className="lrn-modal-skills-row">
                    {submitForm.skills.map((skill, i) => (
                      <div key={i} className="lrn-modal-skill-item">
                        <input className="lrn-modal-input" type="text" maxLength={80}
                          value={skill}
                          onChange={(e) => handleSubmitSkill(i, e.target.value)}
                          placeholder="e.g. Shutoff valve operation"
                        />
                        {submitForm.skills.length > 1 && (
                          <button type="button" className="lrn-modal-remove" onClick={() => {
                            const skills = submitForm.skills.filter((_, j) => j !== i);
                            setSubmitForm((prev) => ({ ...prev, skills }));
                          }}>
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                    {submitForm.skills.length < 10 && (
                      <button type="button" className="lrn-modal-add-btn"
                        onClick={() => setSubmitForm((prev) => ({ ...prev, skills: [...prev.skills, ''] }))}>
                        + Add skill
                      </button>
                    )}
                  </div>
                </div>

                <div className="lrn-modal-row">
                  <label className="lrn-modal-label">Video URL (optional)
                    <input className="lrn-modal-input" type="url" maxLength={500}
                      value={submitForm.video_url}
                      onChange={(e) => handleSubmitField('video_url', e.target.value)}
                      placeholder="https://www.youtube.com/embed/..."
                    />
                  </label>
                </div>

                <div className="lrn-modal-row">
                  <label className="lrn-modal-label">License / permit note (optional)
                    <textarea className="lrn-modal-input lrn-modal-textarea" rows={2} maxLength={1000}
                      value={submitForm.license_note}
                      onChange={(e) => handleSubmitField('license_note', e.target.value)}
                      placeholder="e.g. Electrical work may require a licensed electrician in some states."
                    />
                  </label>
                </div>

                {submitError && (
                  <div className="lrn-modal-error" role="alert">
                    <AlertTriangle size={14} aria-hidden="true" /> {submitError}
                  </div>
                )}

                <div className="lrn-modal-footer">
                  <button type="button" className="lrn-cta-secondary" onClick={() => setShowSubmitModal(false)}>Cancel</button>
                  <button type="submit" className="lrn-modal-submit-btn" disabled={submitting}>
                    <Send size={15} aria-hidden="true" />
                    {submitting ? 'Submitting…' : 'Submit for review'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
