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
    tips: {
      helper: "List as 'Faucet Repair' — typical job runs $75–150. Upsell by checking the shutoff valve condition while you're under the sink.",
      business: 'Entry-level task. Assign to any maintenance staff. Slot 45 min including travel and cleanup. Keep a repair kit in every vehicle.',
    },
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
    tips: {
      helper: "Quick-win service: list as 'Drain Clearing.' Typical $80–120. Bring a snake and a zip-it to every plumbing call — it books itself.",
      business: 'Teach all maintenance hires this in the first week. Low material cost, fast turnaround, high tenant satisfaction score.',
    },
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
    tips: {
      helper: "List as 'Toilet Repair.' Typical $100–180 with parts. Replace both flapper and fill valve in one visit — saves a callback and earns better reviews.",
      business: 'Common property management repair. Stock flappers and fill valves in your supply closet. Target proficiency: first 90 days of hire.',
    },
  },
  {
    id: 'install-shower-head',
    title: 'Install a New Shower Head',
    category: 'plumbing',
    difficulty: 'Easy',
    minutes: 15,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #e0f2fe, #93c5fd)',
    intro: 'Upgrading a shower head is a 15-minute job that makes a noticeable daily difference — and no tools other than a wrench.',
    steps: [
      'Turn off the water supply to the shower (or the main shutoff).',
      'Wrap the shower arm threads with 2–3 layers of plumber\'s tape (clockwise direction).',
      'Hand-thread the new shower head onto the arm. Tighten with a wrench one quarter-turn past hand-tight — avoid over-tightening.',
      'Turn the water on and check for leaks at the connection.',
      'If it drips, add one more layer of plumber\'s tape and retighten.',
    ],
    skills: ['Thread sealing', 'Wrench use', 'Leak testing'],
    tools: [
      { name: 'Adjustable wrench or channel-lock pliers', rent: '/tool-rentals?category=hand-tools', buy: amz('adjustable wrench') },
      { name: 'Plumber\'s tape (PTFE)', rent: null, buy: amz("plumber's tape PTFE teflon") },
    ],
    hireHref: '/post-job?category=plumbing',
    toolsHref: '/tool-rentals?category=plumbing',
    xp: 10,
    tips: {
      helper: "Offer shower head upgrades as an add-on during any bathroom plumbing call. Typical $50–80 labor. Clients love a same-day visible improvement.",
      business: 'Great first-day plumbing task. Zero risk of water damage if tape is applied correctly. Include in new-hire orientation.',
    },
  },
  {
    id: 'replace-toilet-fill-valve',
    title: 'Replace a Toilet Fill Valve',
    category: 'plumbing',
    difficulty: 'Medium',
    minutes: 45,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #dbeafe, #a5f3fc)',
    intro: 'A hissing or slow-filling toilet usually means the fill valve is worn. A universal replacement takes under an hour and costs less than $15.',
    steps: [
      'Turn off the supply valve behind the toilet. Flush to empty the tank.',
      'Sponge out remaining water from the tank.',
      'Disconnect the supply line from the bottom of the tank. Unscrew the locknut holding the old fill valve and lift it out.',
      'Adjust the new fill valve height to match your tank depth. Insert it and hand-tighten the locknut from below.',
      'Reconnect the supply line. Turn on the water, set the float to fill 1 inch below the overflow tube, and flush to test.',
    ],
    skills: ['Supply valve shutoff', 'Fill valve anatomy', 'Float adjustment'],
    tools: [
      { name: 'Universal fill valve kit', rent: null, buy: amz('toilet fill valve universal') },
      { name: 'Adjustable wrench', rent: '/tool-rentals?category=hand-tools', buy: amz('adjustable wrench') },
      { name: 'Sponge or small towel', rent: null, buy: amz('utility sponge') },
    ],
    hireHref: '/post-job?category=plumbing',
    toolsHref: '/tool-rentals?category=plumbing',
    xp: 25,
    tips: {
      helper: "Bundle with a flapper swap for a complete 'Toilet Tune-Up' service — $130–180 all in. Prevents two separate callbacks.",
      business: 'Stock universal valves for every site. A running toilet can waste 200 gallons/day. Train staff to inspect during routine PM visits.',
    },
  },
  {
    id: 'fix-burst-pipe-temporary',
    title: 'Temporarily Stop a Burst Pipe',
    category: 'plumbing',
    difficulty: 'Hard',
    minutes: 30,
    featured: false,
    video_url: null,
    license_note: 'This guide covers emergency temporary repair only — not a permanent fix. Always follow up with a licensed plumber to make a proper repair.',
    gradient: 'linear-gradient(135deg, #fee2e2, #fecaca)',
    intro: 'A burst pipe can release hundreds of gallons an hour. Knowing how to stop the flow buys time until a plumber arrives and limits damage.',
    steps: [
      'Immediately shut off the main water supply valve — usually near the water meter or where the main enters the house.',
      'Open the lowest faucet in the house to drain remaining pressure from the pipes.',
      'Locate the burst or cracked section. Dry it as thoroughly as possible with rags.',
      'Apply a pipe repair clamp or silicone repair tape tightly over the damaged section — overlap by at least 2 inches on each side.',
      'Slowly restore the water supply and monitor the patch. Call a licensed plumber to make a permanent repair.',
    ],
    skills: ['Main shutoff valve location', 'Emergency pipe clamp application', 'Water damage mitigation'],
    tools: [
      { name: 'Pipe repair clamp (sized to pipe diameter)', rent: null, buy: amz('pipe repair clamp emergency') },
      { name: 'Silicone self-fusing repair tape', rent: null, buy: amz('silicone self fusing repair tape') },
      { name: 'Towels and mop', rent: null, buy: amz('mop and bucket set') },
    ],
    hireHref: '/post-job?category=plumbing',
    toolsHref: '/tool-rentals?category=plumbing',
    xp: 50,
    tips: {
      helper: "Emergency call premium applies — typical $200–400 for a temporary patch plus follow-up. Always carry assorted repair clamps. This gets 5-star reviews.",
      business: 'Print a one-page emergency protocol with main shutoff location for every property you manage. Train staff to respond within 30 minutes.',
    },
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
    tips: {
      helper: "Fast, high-margin task — typical $60–100 labor. Always carry a multi-pack of switches. Offer to upgrade to a dimmer while on site for easy upsell.",
      business: 'Safe for trained staff in permit-exempt jurisdictions. Verify local code first. Proficiency: intermediate. Always photograph wiring before disconnecting.',
    },
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
    tips: {
      helper: "List as 'Ceiling Fan Install.' Typical $100–200 labor. Spring demand spike. Most time goes to box verification and cleanup — quote 2 hours to be safe.",
      business: 'Assign to your most experienced electrical-rated staff. Always verify box rating before arrival. Keep spare fan-rated boxes in the vehicle.',
    },
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
    tips: {
      helper: 'Instant value-add on any electrical service call. Explain downstream outlets to the client — it positions you as the expert, not just a button-pusher.',
      business: 'Include GFCI reset in every maintenance check-in. Zero material cost, prevents unnecessary callouts. Train all staff regardless of role.',
    },
  },
  {
    id: 'replace-outlet',
    title: 'Replace an Electrical Outlet',
    category: 'electrical',
    difficulty: 'Medium',
    minutes: 30,
    featured: false,
    video_url: null,
    license_note: 'Outlet replacement is permitted for homeowners in most U.S. jurisdictions. Confirm your local code. Always test with a voltage tester — never assume the breaker is off.',
    gradient: 'linear-gradient(135deg, #fefce8, #fef3c7)',
    intro: 'A cracked or sparking outlet is a fire hazard. Replacing it is a straightforward job with the right safety steps.',
    steps: [
      'Turn off the circuit breaker for that outlet. Use a non-contact voltage tester to confirm no power.',
      'Unscrew the cover plate, then the outlet screws. Pull the outlet out of the box carefully.',
      'Photograph the existing wire connections. Disconnect wires from the old outlet.',
      'Connect wires to the new outlet: black to brass (hot), white to silver (neutral), bare/green to green (ground).',
      'Fold wires neatly into the box. Secure the outlet, replace the cover plate, restore power, and test with an outlet tester.',
    ],
    skills: ['Breaker shutoff', 'Voltage testing', 'Wire terminal connections', 'Hot/neutral/ground identification'],
    tools: [
      { name: 'Non-contact voltage tester', rent: null, buy: amz('non contact voltage tester') },
      { name: 'Flathead + Phillips screwdrivers', rent: '/tool-rentals?category=hand-tools', buy: amz('screwdriver set') },
      { name: 'Replacement outlet (duplex receptacle)', rent: null, buy: amz('duplex electrical outlet 15 amp') },
      { name: 'Outlet tester', rent: null, buy: amz('outlet circuit tester') },
    ],
    hireHref: '/post-job?category=electrical',
    toolsHref: '/tool-rentals?category=electrical',
    xp: 25,
    tips: {
      helper: "List as 'Outlet Replacement.' Typical $75–120 each. Offer USB outlet upgrades as a popular upsell — clients love the convenience.",
      business: 'Proficiency level: intermediate. Always replace in pairs when one is worn — prevents a second callout. Log outlet age in your property records.',
    },
  },
  {
    id: 'install-dimmer-switch',
    title: 'Install a Dimmer Switch',
    category: 'electrical',
    difficulty: 'Medium',
    minutes: 30,
    featured: false,
    video_url: null,
    license_note: 'Confirm your local code permits homeowner switch replacement. A dimmer must be matched to the bulb type (LED, CFL, or incandescent) — check the packaging.',
    gradient: 'linear-gradient(135deg, #fffbeb, #fde68a)',
    intro: 'A dimmer gives a room mood control and can cut lighting energy use by up to 20%. Match the dimmer to your bulb type or it will hum or flicker.',
    steps: [
      'Turn off the circuit breaker. Verify no power at the switch with a voltage tester.',
      'Remove the cover plate and pull out the switch. Photograph wiring.',
      'Note the dimmer\'s load capacity (usually 150W–600W) and verify it fits your bulb total.',
      'Connect the dimmer leads to the house wires: typically two black leads to hot wires, green/bare to ground. Consult the included diagram.',
      'Fold wires into the box, seat the dimmer, attach the cover, restore power, and test the full range.',
    ],
    skills: ['Load calculation', 'Multi-wire dimmer wiring', 'Bulb compatibility check'],
    tools: [
      { name: 'Non-contact voltage tester', rent: null, buy: amz('non contact voltage tester') },
      { name: 'Flathead + Phillips screwdrivers', rent: '/tool-rentals?category=hand-tools', buy: amz('screwdriver set') },
      { name: 'LED-compatible dimmer switch', rent: null, buy: amz('LED dimmer switch single pole') },
    ],
    hireHref: '/post-job?category=electrical',
    toolsHref: '/tool-rentals?category=electrical',
    xp: 25,
    tips: {
      helper: "Always upsell a dimmer when replacing a switch — add $30–50 for the upgrade. Clients get immediate value and you stay on site longer per job.",
      business: 'Good intermediate training task. Stock LED-compatible dimmers in your supply kit. Always verify bulb wattage total before purchasing.',
    },
  },
  {
    id: 'install-light-fixture',
    title: 'Replace a Light Fixture',
    category: 'electrical',
    difficulty: 'Medium',
    minutes: 60,
    featured: false,
    video_url: null,
    license_note: 'Light fixture replacement is generally permitted for homeowners without a permit. If the fixture requires new wiring runs, a licensed electrician is required.',
    gradient: 'linear-gradient(135deg, #fefce8, #fef08a)',
    intro: 'Swapping a fixture is mostly mechanical — the wiring is the same three connections every time. The challenge is weight and working overhead.',
    steps: [
      'Turn off the breaker. Confirm no power with a voltage tester at the fixture wires.',
      'Support the old fixture while you unscrew the mounting screws. Don\'t let it hang by its wires.',
      'Disconnect the three wire connections: black to black (hot), white to white (neutral), bare/green to green (ground).',
      'Attach the new fixture\'s mounting bracket to the ceiling box. Connect the matching wires with wire nuts.',
      'Tuck wires into the canopy, attach to the mounting bracket, install bulbs, restore power, and test.',
    ],
    skills: ['Overhead work safety', 'Wire nut connections', 'Fixture support during install'],
    tools: [
      { name: 'Non-contact voltage tester', rent: null, buy: amz('non contact voltage tester') },
      { name: 'Ladder (6 ft minimum)', rent: '/tool-rentals?category=access', buy: null },
      { name: 'Phillips screwdriver + wire nuts', rent: null, buy: amz('wire nuts assorted electrical') },
    ],
    hireHref: '/post-job?category=electrical',
    toolsHref: '/tool-rentals?category=electrical',
    xp: 25,
    tips: {
      helper: "List as 'Light Fixture Install.' Typical $80–150 labor. Bundle with a dimmer switch install for $130–200 total — clients rarely say no.",
      business: 'Requires comfort with ladder work. Train with low-ceiling fixtures first. Always bring extra wire nuts in multiple sizes to every electrical call.',
    },
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
    tips: {
      helper: "Offer quarterly filter-swap subscriptions for $35–55/visit. Recurring income, minimal skill required, and clients love the convenience.",
      business: 'Build this into every monthly facility check. Stock filter sizes for every unit on-site. Log change dates in your work order system.',
    },
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
    tips: {
      helper: 'Add to your HVAC tune-up package — typical visit $85–125 bundled with filter change. Prevents expensive callbacks that damage your reviews.',
      business: 'Schedule annually before summer. One clogged drain = potential ceiling damage claim. Include in your seasonal PM checklist.',
    },
  },
  {
    id: 'seal-hvac-ducts',
    title: 'Seal Leaky HVAC Ducts',
    category: 'hvac',
    difficulty: 'Medium',
    minutes: 60,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdfa, #6ee7b7)',
    intro: 'Leaky ducts can account for 20–30% of conditioned air loss. Sealing them with mastic or foil tape pays back in lower energy bills within a year.',
    steps: [
      'Turn off the HVAC system. Use a flashlight to inspect accessible ducts in the attic, basement, or crawl space for gaps, disconnections, and holes.',
      'Mark all leaks with a marker. For small gaps, apply HVAC-rated foil tape — stretch it flat and press firmly from the center out.',
      'For larger gaps or joints, brush water-based mastic sealant onto the duct surface 2 inches beyond the leak. Let it dry fully.',
      'Wrap duct insulation back over any sections you had to peel back. Secure with tape.',
      'Turn the system back on and hold your hand near sealed areas to feel for airflow — properly sealed ducts produce no draft.',
    ],
    skills: ['Duct system navigation', 'Mastic application', 'Foil tape technique'],
    tools: [
      { name: 'HVAC mastic sealant', rent: null, buy: amz('HVAC duct mastic sealant') },
      { name: 'HVAC foil tape', rent: null, buy: amz('HVAC foil tape metal duct') },
      { name: 'Paintbrush (for mastic)', rent: null, buy: amz('chip brush set') },
      { name: 'Flashlight or headlamp', rent: null, buy: amz('headlamp flashlight') },
    ],
    hireHref: '/post-job?category=hvac',
    toolsHref: '/tool-rentals?category=hvac',
    xp: 25,
    tips: {
      helper: "Add duct sealing to your HVAC service menu as an energy audit upsell — typical $150–300 for accessible duct sealing. Pair with a filter change.",
      business: 'Inspect ducts during every major HVAC service. Document findings with photos. Sealed duct systems reduce utility costs per unit.',
    },
  },
  {
    id: 'clean-dryer-vent',
    title: 'Clean Your Dryer Vent',
    category: 'hvac',
    difficulty: 'Easy',
    minutes: 30,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdfa, #34d399)',
    intro: 'Lint buildup in the dryer vent is the leading cause of residential dryer fires. Clean it once a year — or more often if you notice clothes taking longer to dry.',
    steps: [
      'Unplug the dryer. If gas, turn off the gas supply valve.',
      'Pull the dryer away from the wall and disconnect the vent duct from the back of the unit.',
      'Insert a dryer vent brush kit into the duct and rotate it through the full length, dislodging lint.',
      'Vacuum up all lint from inside the duct, behind the dryer, and at the exterior vent cap.',
      'Reattach the duct with foil tape (not plastic tape). Push the dryer back, restore power, and run a 10-minute heat cycle to confirm airflow.',
    ],
    skills: ['Vent duct disassembly', 'Brush kit use', 'Airflow testing'],
    tools: [
      { name: 'Dryer vent cleaning brush kit', rent: null, buy: amz('dryer vent cleaning brush kit') },
      { name: 'Vacuum with hose attachment', rent: '/tool-rentals?category=cleaning', buy: null },
      { name: 'HVAC foil tape', rent: null, buy: amz('HVAC foil tape') },
    ],
    hireHref: '/post-job?category=hvac',
    toolsHref: '/tool-rentals?category=hvac',
    xp: 10,
    tips: {
      helper: "Easy $75–120 recurring service. Offer annual reminder subscriptions. Pair with a furnace filter change to increase average ticket.",
      business: 'Include in annual property safety checklist. Required by many insurance policies. Quick to delegate — low skill, high safety impact.',
    },
  },
  {
    id: 'insulate-hot-water-pipes',
    title: 'Insulate Hot Water Pipes',
    category: 'hvac',
    difficulty: 'Easy',
    minutes: 45,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #ecfdf5, #a7f3d0)',
    intro: 'Insulating accessible hot water pipes reduces heat loss, lowers water heating costs, and means you get hot water at the tap faster.',
    steps: [
      'Measure the diameter of your pipes — most residential supply lines are 1/2" or 3/4".',
      'Purchase foam pipe insulation sleeves that match the pipe diameter.',
      'Starting from the water heater, slide the foam sleeves over the pipes. The sleeves are pre-slit — pinch them open and press onto the pipe.',
      'Butt sleeve joints tightly together. At elbows, cut the foam at 45 degrees so the joints meet cleanly.',
      'Secure all seams and joints with foil HVAC tape or specialty pipe insulation tape.',
    ],
    skills: ['Pipe diameter measurement', 'Foam sleeve fitting', 'Elbow cutting technique'],
    tools: [
      { name: 'Foam pipe insulation sleeves', rent: null, buy: amz('foam pipe insulation sleeves') },
      { name: 'Utility knife', rent: null, buy: amz('utility knife box cutter') },
      { name: 'Pipe insulation tape or foil tape', rent: null, buy: amz('pipe insulation tape') },
    ],
    hireHref: '/post-job?category=hvac',
    toolsHref: '/tool-rentals?category=hvac',
    xp: 10,
    tips: {
      helper: 'Offer as an energy efficiency add-on during any plumbing or HVAC call — $80–150 for a water heater room. Clients see monthly savings immediately.',
      business: 'Particularly valuable in older buildings with long pipe runs. Include in energy audit service packages. Materials cost is low, margin is high.',
    },
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
    tips: {
      helper: "List as 'Drywall Repair' — steady demand from landlords and realtors. Typical $100–250 per visit. Multi-hole jobs offer your best margin.",
      business: 'Critical skill before any paint job. Train staff to feathering stage; subcontract texture-matching on complex finishes. Proficiency: intermediate.',
    },
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
    tips: {
      helper: "Fast job that pairs well with a lock upgrade upsell. Typical $60–100 labor. Keep a variety of finishes in your truck — clients often want to match existing hardware.",
      business: 'Assign to any maintenance staff on day one. Keep a supply of standard interior sets in brushed nickel — the most common finish. Low-risk, high-frequency task.',
    },
  },
  {
    id: 'hang-floating-shelves',
    title: 'Hang Floating Shelves',
    category: 'carpentry',
    difficulty: 'Easy',
    minutes: 45,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fdf4ff, #e9d5ff)',
    intro: 'Floating shelves are one of the most-requested handyperson jobs. The whole project hinges on hitting studs and keeping things level.',
    steps: [
      'Use a stud finder to locate studs behind the wall. Mark them with a light pencil mark.',
      'Hold the shelf bracket against the wall at your desired height. Use a level to confirm horizontal, then mark the mounting holes.',
      'Drill pilot holes into the studs at your marks. If no stud is available at all mounting points, use toggle bolts for the drywall-only holes.',
      'Screw the brackets into the wall securely. Slide the shelf onto the brackets or attach per manufacturer instructions.',
      'Load the shelf evenly and test for wobble. Tighten any loose screws.',
    ],
    skills: ['Stud finding', 'Leveling', 'Wall anchor selection'],
    tools: [
      { name: 'Stud finder', rent: null, buy: amz('stud finder wall scanner') },
      { name: 'Level (24" or torpedo)', rent: null, buy: amz('24 inch level torpedo level') },
      { name: 'Drill + bits', rent: '/tool-rentals?category=power-tools', buy: null },
      { name: 'Floating shelf with mounting hardware', rent: null, buy: amz('floating shelf with brackets') },
    ],
    hireHref: '/post-job?category=carpentry',
    toolsHref: '/tool-rentals?category=carpentry',
    xp: 10,
    tips: {
      helper: "High-demand in apartments and renovated homes. Typical $60–120 per shelf set. Batch multiple shelf installs in one visit to maximize earnings per trip.",
      business: 'Great onboarding task. Teaches stud finding, leveling, and anchor selection — fundamental handyperson skills. Low risk if done correctly.',
    },
  },
  {
    id: 'fix-squeaky-floor',
    title: 'Fix a Squeaky Floor',
    category: 'carpentry',
    difficulty: 'Medium',
    minutes: 60,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
    intro: 'Most floor squeaks happen where the subfloor has separated from a joist. A few well-placed screws from below — or a squeak-specific kit from above — silences them permanently.',
    steps: [
      'Walk the floor to identify the exact squeak location. Mark it with tape.',
      'If you have basement or crawl access below: have a helper stand on the spot while you push up from below to feel the flex. Drive a short screw up through the subfloor into the joist — don\'t penetrate the finished floor.',
      'If access is from above: use a squeak-eliminator kit that drives a special screw through the finish floor, then snaps the head off flush.',
      'For hardwood over joist: drill a pilot hole at a slight angle and drive a trim-head screw into the joist below. Countersink and fill with a color-matched filler.',
      'Test by walking over the area. If the squeak persists, repeat 2–3 inches away along the joist line.',
    ],
    skills: ['Subfloor joist location', 'Below-floor screw driving', 'Squeak-kit method'],
    tools: [
      { name: 'Squeak-Ender or Squeeeeek No More kit', rent: null, buy: amz('squeeeeek no more floor repair kit') },
      { name: 'Drill + bits', rent: '/tool-rentals?category=power-tools', buy: null },
      { name: 'Color-matched wood filler', rent: null, buy: amz('wood filler color match') },
    ],
    hireHref: '/post-job?category=carpentry',
    toolsHref: '/tool-rentals?category=carpentry',
    xp: 25,
    tips: {
      helper: "Niche skill with low competition. Typical $80–150 per room. Clients are often frustrated after failed DIY attempts — you become the hero.",
      business: 'Pre-move-out service that prevents tenant complaints and deposit disputes. Train maintenance staff on the squeeeeek kit method — safest approach.',
    },
  },
  {
    id: 'install-window-screen',
    title: 'Install or Replace a Window Screen',
    category: 'carpentry',
    difficulty: 'Easy',
    minutes: 30,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f5f3ff, #d8b4fe)',
    intro: 'A torn window screen is easy to re-screen with a roll of mesh and a spline tool. It\'s also the same process for installing a screen in a frame.',
    steps: [
      'Remove the old spline (the rubber cord that holds the mesh) using a flathead screwdriver.',
      'Pull out the torn mesh. Clean the channel in the frame.',
      'Cut new mesh slightly larger than the frame on all sides.',
      'Lay the mesh over the frame. Starting from a corner, press the spline and mesh into the channel using the convex wheel of the spline roller.',
      'Work around all four sides, keeping the mesh taut (not stretched). Trim excess mesh with a utility knife.',
    ],
    skills: ['Spline removal and installation', 'Mesh tensioning', 'Knife trimming'],
    tools: [
      { name: 'Screen spline roller tool', rent: null, buy: amz('screen spline roller tool') },
      { name: 'Replacement fiberglass mesh roll', rent: null, buy: amz('window screen mesh replacement roll') },
      { name: 'Screen spline (match your frame groove)', rent: null, buy: amz('window screen spline replacement') },
      { name: 'Utility knife', rent: null, buy: amz('utility knife box cutter') },
    ],
    hireHref: '/post-job?category=carpentry',
    toolsHref: '/tool-rentals?category=carpentry',
    xp: 10,
    tips: {
      helper: 'Batch screen repairs in spring — advertise a screen repair day and do a whole neighborhood in one trip. Typical $30–60 per screen installed.',
      business: 'Include in annual spring property prep. Keep mesh rolls and assorted spline sizes in your supply kit. Great task for entry-level staff.',
    },
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
    tips: {
      helper: "List as 'Interior Wall Painting.' Typical single room: $200–450 including materials. Prep is your differentiator — clients see the difference.",
      business: 'Core crew skill. Train with a two-coat pass on a practice panel before the first real job. Invest in quality rollers — they show in the finish.',
    },
  },
  {
    id: 'prep-and-prime-wall',
    title: 'Prep and Prime a Wall Before Painting',
    category: 'painting',
    difficulty: 'Easy',
    minutes: 60,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fdf2f8, #f9a8d4)',
    intro: 'Skipping primer over fresh patches, stains, or new drywall leads to visible bleed-through that shows even after two topcoats. Primer is insurance.',
    steps: [
      'Fill all holes with spackling or lightweight compound. Let dry, then sand flush.',
      'Lightly sand glossy surfaces with 220-grit paper so primer adheres — wipe off dust with a tack cloth.',
      'Mask trim, outlets, and the ceiling edge with painter\'s tape.',
      'Roll primer onto the wall using a 3/8" nap roller, cutting in the edges first with a brush.',
      'Let primer dry fully per the can instructions (typically 1–2 hours). Inspect for any remaining stains — apply a second prime coat if needed.',
    ],
    skills: ['Hole filling', 'Surface sanding', 'Primer application'],
    tools: [
      { name: 'Spackling compound', rent: null, buy: amz('spackling compound paste') },
      { name: 'Drywall primer (PVA for new drywall, stain-blocking for water stains)', rent: null, buy: amz('drywall primer PVA') },
      { name: 'Paint roller + tray', rent: '/tool-rentals?category=painting', buy: amz('paint roller tray set') },
      { name: 'Painter\'s tape', rent: null, buy: amz("painter's tape blue") },
    ],
    hireHref: '/post-job?category=painting',
    toolsHref: '/tool-rentals?category=painting',
    xp: 10,
    tips: {
      helper: 'Always include primer in your painting quote — charging $50–80 separately is fair and prevents client complaints about bleed-through.',
      business: 'Make priming a non-negotiable step in your painting SOP. Callbacks for bleed-through cost more than the primer. Train staff to identify stain types.',
    },
  },
  {
    id: 'paint-trim-and-baseboards',
    title: 'Paint Trim and Baseboards',
    category: 'painting',
    difficulty: 'Medium',
    minutes: 90,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fdf2f8, #e879f9)',
    intro: 'Crisp trim paint is what separates an amateur paint job from a professional one. The secret is tight masking, thin coats, and patience at the brush.',
    steps: [
      'Apply painter\'s tape along the floor edge and any wall surface adjacent to trim.',
      'Lightly sand the trim with 220-grit to degloss the existing paint. Wipe clean.',
      'Load a 1.5" angled brush sparingly and apply a thin first coat — trim paint sags easily.',
      'Let the first coat dry fully (follow the can label). Lightly scuff with fine-grit paper, then apply a second coat.',
      'Remove tape while the paint is still slightly tacky (not wet, not bone dry) to avoid peeling the edge.',
    ],
    skills: ['Masking for trim', 'Thin-coat brush technique', 'Tape removal timing'],
    tools: [
      { name: '1.5" angled sash brush', rent: null, buy: amz('angled sash brush 1.5 inch') },
      { name: 'Painter\'s tape (thin profile)', rent: null, buy: amz("painter's tape fine edge") },
      { name: 'Semi-gloss or gloss trim paint', rent: null, buy: amz('semi gloss trim paint white') },
      { name: '220-grit sanding sponge', rent: null, buy: amz('220 grit sanding sponge') },
    ],
    hireHref: '/post-job?category=painting',
    toolsHref: '/tool-rentals?category=painting',
    xp: 25,
    tips: {
      helper: "Trim painting is the highest-skill part of a paint job — clients will pay $150–300 just for crisp trim work. Own this skill and charge accordingly.",
      business: "Don't rush trim. Assign your most meticulous staff. Quality here determines the client's overall impression of the whole paint job.",
    },
  },
  {
    id: 'touch-up-and-color-match',
    title: 'Touch Up Paint and Match Colors',
    category: 'painting',
    difficulty: 'Medium',
    minutes: 30,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fdf2f8, #f0abfc)',
    intro: 'Touch-ups that don\'t match are worse than the original damage. The challenge is sheen and color drift — here\'s how to make them invisible.',
    steps: [
      'Identify the original paint if possible — check closets, garages, or the utility room for leftover cans.',
      'If no leftover paint: take a paint chip (a quarter-size peeled section) to a paint store for spectrophotometer matching.',
      'Sand the damaged area lightly and apply primer if it\'s bare drywall.',
      'Apply the touch-up paint in thin coats, feathering 4–6 inches around the damage. Match the application texture — roller for rolled walls, brush strokes for brushed areas.',
      'Let dry and assess in natural light. A fresh small patch will look slightly different until it cures fully (1–2 weeks) — inform the client.',
    ],
    skills: ['Color matching process', 'Feathered touch-up technique', 'Sheen matching'],
    tools: [
      { name: 'Paint chip (for store matching)', rent: null, buy: null },
      { name: '3" foam mini roller', rent: null, buy: amz('mini foam roller set') },
      { name: '1" chip brush', rent: null, buy: amz('chip brush set') },
    ],
    hireHref: '/post-job?category=painting',
    toolsHref: '/tool-rentals?category=painting',
    xp: 25,
    tips: {
      helper: "Touch-up calls are quick high-margin jobs — $60–120 for 30 minutes. Always bring a mini-roller: rolled walls need roller texture, not brush texture.",
      business: 'Photograph paint cans in every unit and store chip samples at your office. Color matching at move-out saves tenant disputes and respray costs.',
    },
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
    tips: {
      helper: "Mobile oil change is a growing niche — typical $50–90. Differentiate with a multi-point inspection report texted to the customer after each visit.",
      business: 'Standardize on one oil spec per vehicle type to simplify procurement. Train dedicated staff. At fleet scale, this pays for itself within weeks.',
    },
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
    tips: {
      helper: 'Add-on service during any mobile auto visit — quick win that builds trust. Charge $20–35 including blades. Clients forget to do this themselves.',
      business: 'Include in fleet vehicle inspection checklist. Pre-stock the right blade sizes for every vehicle you operate. Zero skill threshold task.',
    },
  },
  {
    id: 'rotate-tires',
    title: 'Rotate Your Tires',
    category: 'car-care',
    difficulty: 'Medium',
    minutes: 30,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #eef2ff, #c7d2fe)',
    intro: 'Rotating tires every 5,000–7,500 miles evens out wear and extends their life by tens of thousands of miles. It requires jack stands and a torque wrench — but no special skills.',
    steps: [
      'Loosen all lug nuts on all four wheels while the car is still on the ground (break torque only — don\'t remove).',
      'Jack up one end of the car and set securely on two jack stands. Remove both wheels.',
      'Move wheels in the correct rotation pattern for your vehicle (front-to-back same side for non-directional; X-pattern for non-directional all-season). Check your owner\'s manual.',
      'Repeat on the other end. Torque all lug nuts to spec in a star pattern (typically 80–100 ft-lb for passenger cars).',
      'Lower the car and check tire pressure on all four tires before driving.',
    ],
    skills: ['Jack and stand safety', 'Rotation pattern identification', 'Torque wrench use'],
    tools: [
      { name: 'Floor jack and four jack stands', rent: '/tool-rentals?category=automotive', buy: null },
      { name: 'Torque wrench (0–150 ft-lb)', rent: '/tool-rentals?category=automotive', buy: amz('torque wrench 150 ft lb') },
      { name: 'Breaker bar or impact wrench', rent: '/tool-rentals?category=automotive', buy: amz('breaker bar 1/2 inch drive') },
    ],
    hireHref: '/post-job?category=car-care',
    toolsHref: '/tool-rentals?category=automotive',
    xp: 25,
    tips: {
      helper: "Bundle tire rotation with an oil change for a $90–130 full-service package. Customers love a one-stop mobile service — it sets you apart from quick-lube shops.",
      business: 'Include in fleet PM schedule every 6 months. Extend vehicle tire life significantly, reducing operating costs. Requires torque wrench — never skip this.',
    },
  },
  {
    id: 'replace-cabin-air-filter',
    title: 'Replace Your Cabin Air Filter',
    category: 'car-care',
    difficulty: 'Easy',
    minutes: 10,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #eef2ff, #a5b4fc)',
    intro: 'A clogged cabin air filter reduces AC airflow and fills your car with allergens. It\'s a 10-minute job that dealers charge $50+ for in labor alone.',
    steps: [
      'Look up the cabin air filter location for your specific vehicle — most are behind the glove box, but some are under the hood.',
      'For glove-box style: open the glove box, press the sides inward to release it, then lower it fully to expose the filter housing.',
      'Slide out the old filter — note the airflow direction arrow before removing it.',
      'Insert the new filter with the arrow pointing in the same direction.',
      'Close the housing and reinstall the glove box. Run the fan to confirm improved airflow.',
    ],
    skills: ['Vehicle-specific filter location', 'Glove box removal', 'Airflow direction'],
    tools: [
      { name: 'Cabin air filter (model-specific)', rent: null, buy: amz('cabin air filter replacement') },
    ],
    hireHref: '/post-job?category=car-care',
    toolsHref: '/tool-rentals?category=automotive',
    xp: 10,
    tips: {
      helper: 'Include with every oil change at $20–35 add-on. The profit margin is high and customers appreciate being informed — it builds trust for bigger jobs.',
      business: 'Schedule replacement in fleet vehicles every 15,000 miles. Track in your PM log. Prevents AC complaints and protects in-cabin air quality for drivers.',
    },
  },
  {
    id: 'check-and-top-fluids',
    title: 'Check and Top Off Vehicle Fluids',
    category: 'car-care',
    difficulty: 'Easy',
    minutes: 20,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #eef2ff, #818cf8)',
    intro: 'Checking five fluids every month takes 20 minutes and catches problems before they become expensive repairs. Here\'s the standard walkaround.',
    steps: [
      'Park on a level surface. Turn off the engine and wait 10 minutes for fluids to settle.',
      'Engine oil: Pull the dipstick, wipe clean, reinsert fully, pull again. Oil should be between the MIN and MAX marks.',
      'Coolant: Check the translucent overflow reservoir level (never open the radiator cap on a hot engine). Top up with 50/50 pre-mixed coolant if low.',
      'Brake fluid: Check the reservoir on top of the master cylinder. Should be between MIN and MAX. If consistently low, suspect a leak.',
      'Windshield washer fluid: Top off as needed. Power steering fluid (if not electric): check the reservoir under the hood and top to MAX.',
    ],
    skills: ['Dipstick reading', 'Reservoir identification', 'When to escalate to a mechanic'],
    tools: [
      { name: 'Funnel', rent: null, buy: amz('funnel set automotive') },
      { name: '50/50 pre-mixed coolant', rent: null, buy: amz('50 50 premixed coolant antifreeze') },
      { name: 'Windshield washer fluid', rent: null, buy: amz('windshield washer fluid') },
    ],
    hireHref: '/post-job?category=car-care',
    toolsHref: '/tool-rentals?category=automotive',
    xp: 10,
    tips: {
      helper: 'Offer a monthly vehicle wellness check at $25–40 — great recurring revenue for minimal time. Catching a low brake fluid can prevent a serious accident.',
      business: 'Add to fleet vehicle weekly check protocol. Assign to any driver. Document readings in your fleet management log to catch slow leaks early.',
    },
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
    tips: {
      helper: "High-demand spring service. Price by cubic yard — typical $50–100/yard installed. Offer a 'garden refresh' package combining weeding, edging, and mulch.",
      business: 'Great introductory landscaping task. Low technical risk, visible outcome. Buy bulk mulch by the yard to maximize margin on larger properties.',
    },
  },
  {
    id: 'plant-a-tree',
    title: 'Plant a Tree Properly',
    category: 'landscaping',
    difficulty: 'Medium',
    minutes: 90,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdf4, #86efac)',
    intro: 'Most trees die within 3 years of planting from one mistake: being planted too deep. Here\'s how to give a tree the best possible start.',
    steps: [
      'Call 811 (US) or your local utility service before digging to mark underground lines.',
      'Dig the hole 2–3× as wide as the root ball but no deeper than the root ball height. Planting too deep is the #1 cause of tree failure.',
      'Place the tree so the root flare (where the trunk widens at the base) sits at or slightly above grade.',
      'Backfill with native soil (no amendments needed for most trees). Tamp gently to eliminate air pockets.',
      'Build a 3–4" mulch ring extending to the drip line — keep mulch away from the trunk. Water deeply at planting and weekly for the first year.',
    ],
    skills: ['Utility line awareness', 'Root flare identification', 'Proper hole depth', 'Post-plant watering schedule'],
    tools: [
      { name: 'Digging spade', rent: '/tool-rentals?category=landscaping', buy: amz('digging spade shovel') },
      { name: 'Wheelbarrow', rent: '/tool-rentals?category=landscaping', buy: null },
      { name: 'Garden hose + soaker', rent: null, buy: amz('soaker hose garden') },
    ],
    hireHref: '/post-job?category=landscaping',
    toolsHref: '/tool-rentals?category=landscaping',
    xp: 25,
    tips: {
      helper: "Tree planting is premium landscaping — typical $150–350 per tree including labor. Always add a first-year care instruction sheet. Clients remember this.",
      business: 'Requires staff who understand root flare depth. Document call-before-you-dig compliance with a photo. Build a 1-year watering plan into every tree service.',
    },
  },
  {
    id: 'install-drip-irrigation',
    title: 'Install a Simple Drip Irrigation System',
    category: 'landscaping',
    difficulty: 'Medium',
    minutes: 120,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdf4, #4ade80)',
    intro: 'Drip irrigation delivers water directly to roots, cutting outdoor water use by 30–50%. A basic system for a garden bed takes an afternoon and uses standard hose fittings.',
    steps: [
      'Sketch the bed layout and count the number of plants to be irrigated. Choose emitter flow rates (0.5–1 GPH for most plants).',
      'Install a hose-thread timer and backflow preventer at the spigot. Add a pressure regulator and filter.',
      'Run the main 1/2" poly tubing from the spigot to the bed using stakes.',
      'Punch holes in the main line with a hole punch. Insert barbed fittings and connect 1/4" drip lines to each plant.',
      'Run the system and check all emitters for flow. Adjust timer to run 30–60 minutes per zone every 1–2 days.',
    ],
    skills: ['Drip system layout', 'Emitter selection', 'Timer programming'],
    tools: [
      { name: 'Drip irrigation starter kit', rent: null, buy: amz('drip irrigation system starter kit') },
      { name: 'Hole punch for poly tubing', rent: null, buy: amz('drip irrigation hole punch tool') },
      { name: 'Hose timer', rent: null, buy: amz('hose timer programmable') },
    ],
    hireHref: '/post-job?category=landscaping',
    toolsHref: '/tool-rentals?category=landscaping',
    xp: 25,
    tips: {
      helper: "Irrigation installs are one of the most profitable small landscaping services — typical $200–500 for a garden bed system. Recurring maintenance adds value.",
      business: 'Reduces water costs for properties with gardens. Offer as an upgrade during spring cleanup. Train staff on emitter sizing — wrong flow rates kill plants.',
    },
  },
  {
    id: 'build-raised-garden-bed',
    title: 'Build a Raised Garden Bed',
    category: 'landscaping',
    difficulty: 'Medium',
    minutes: 180,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdf4, #16a34a)',
    intro: 'A 4×8 raised bed can produce more food per square foot than a ground garden, while solving drainage, soil quality, and back-strain problems at once.',
    steps: [
      'Choose a spot with 6–8 hours of direct sun. Mark the outline: 4 ft × 8 ft is the standard size (reachable from all sides).',
      'Cut 2×10 or 2×12 cedar or redwood boards to length (two 8-ft and two 4-ft pieces). Assemble the frame with 3" wood screws at each corner.',
      'Set the frame in place on level ground. Staple hardware cloth to the bottom of the frame to block burrowing pests (optional but recommended).',
      'Fill the bed with a 60/40 mixture of topsoil and compost to within 1–2 inches of the top.',
      'Water thoroughly and let the soil settle for 24 hours before planting.',
    ],
    skills: ['Lumber cutting', 'Frame assembly', 'Soil mix preparation'],
    tools: [
      { name: 'Circular saw or miter saw', rent: '/tool-rentals?category=power-tools', buy: null },
      { name: 'Drill + 3" deck screws', rent: '/tool-rentals?category=power-tools', buy: amz('3 inch deck screws box') },
      { name: 'Level', rent: null, buy: amz('24 inch level') },
      { name: 'Hardware cloth + staple gun (optional)', rent: null, buy: amz('hardware cloth 1/4 inch roll') },
    ],
    hireHref: '/post-job?category=landscaping',
    toolsHref: '/tool-rentals?category=carpentry',
    xp: 25,
    tips: {
      helper: "Popular spring project — typical $250–500 per bed including lumber and soil. Offer a package with drip irrigation and first-season plant selection.",
      business: 'Great team project for newer landscaping staff — clear outcome, visible result, low risk. Pre-cut lumber at a hardware store to speed up job time.',
    },
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
    tips: {
      helper: "Book caulking calls in batches — two bathrooms per trip is efficient. Typical $60–100 per tub. Bring three caulk colors to match any grout.",
      business: 'Include in annual property inspection. One failed caulk bead can cause a mold remediation claim. Train staff on the pre-fill tub technique.',
    },
  },
  {
    id: 'clean-gutters',
    title: 'Clean Your Gutters',
    category: 'maintenance',
    difficulty: 'Easy',
    minutes: 60,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f8fafc, #cbd5e1)',
    intro: 'Clogged gutters cause fascia rot, foundation water intrusion, and ice dams. A once-a-year clean takes an hour and prevents thousands in repairs.',
    steps: [
      'Set up a stable ladder at the corner of the house. Never lean a ladder against a gutter.',
      'Starting at the downspout end, scoop out debris by hand into a bucket. Work toward the high end.',
      'Flush the gutter with a garden hose, directing water toward the downspout.',
      'Check that the downspout flows freely — feed the hose into the top. If clogged, use a plumber\'s snake or a downspout cleaning wand.',
      'Check for low spots or sagging gutters where water pools. Re-fasten any loose hanger brackets.',
    ],
    skills: ['Ladder safety', 'Downspout clearing', 'Gutter slope assessment'],
    tools: [
      { name: 'Extension ladder', rent: '/tool-rentals?category=access', buy: null },
      { name: 'Garden hose with spray nozzle', rent: null, buy: amz('garden hose spray nozzle') },
      { name: 'Bucket and hooks', rent: null, buy: amz('bucket hook ladder') },
      { name: 'Gutter scoop', rent: null, buy: amz('gutter cleaning scoop') },
    ],
    hireHref: '/post-job',
    toolsHref: '/tool-rentals?category=access',
    xp: 10,
    tips: {
      helper: "Offer fall and spring gutter cleaning packages — $100–200 per visit depending on story height. Pair with downspout extensions for a quick upsell.",
      business: 'Schedule twice a year: fall after leaves drop, and early spring. Critical for multi-unit properties. Track gutter condition and flag any repairs needed.',
    },
  },
  {
    id: 'weatherstrip-exterior-door',
    title: 'Weatherstrip an Exterior Door',
    category: 'maintenance',
    difficulty: 'Easy',
    minutes: 45,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f8fafc, #94a3b8)',
    intro: 'A drafty door can be responsible for 10–20% of a home\'s heating and cooling loss. Replacing weatherstripping costs under $20 and takes less than an hour.',
    steps: [
      'Close the door and hold a lit stick of incense along all edges — smoke wavering indicates air infiltration.',
      'Remove the old weatherstripping by pulling it off or unscrewing it. Note the type: V-strip, foam tape, or door sweep.',
      'Cut the new weatherstrip to length with scissors or a utility knife.',
      'For V-strip: nail or peel-and-stick along the door stop with the open end of the V facing outward.',
      'For the door sweep: cut to door width, align it so it just contacts the threshold, and screw in place.',
    ],
    skills: ['Air infiltration testing', 'Weatherstrip type identification', 'Door sweep installation'],
    tools: [
      { name: 'Door weatherstrip kit (includes V-strip and door sweep)', rent: null, buy: amz('door weatherstripping kit') },
      { name: 'Scissors or utility knife', rent: null, buy: amz('utility knife') },
      { name: 'Phillips screwdriver', rent: null, buy: amz('screwdriver set') },
    ],
    hireHref: '/post-job',
    toolsHref: '/tool-rentals',
    xp: 10,
    tips: {
      helper: "Include weatherstripping in a seasonal home-prep service. Typical $60–100 per door — fast and visible energy savings win 5-star reviews.",
      business: 'Inspect all exterior doors during seasonal property walkthroughs. Drafty doors raise tenant utility bills and generate complaints. Low-cost fix.',
    },
  },
  {
    id: 'power-wash-driveway',
    title: 'Power Wash a Driveway or Patio',
    category: 'maintenance',
    difficulty: 'Easy',
    minutes: 90,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f8fafc, #64748b)',
    intro: 'Power washing removes years of tire marks, oil stains, mildew, and grime in one pass. The key is using the right nozzle — the wrong one etches concrete.',
    steps: [
      'Clear the area of furniture, cars, and potted plants. Sweep off loose debris first.',
      'Connect the pressure washer to a water supply and turn on before starting the engine/motor.',
      'For concrete driveways, start with a 25-degree (green) nozzle at 2,500–3,000 PSI. For wood decks, use a 40-degree (white) nozzle.',
      'Work in overlapping passes moving away from the house. Hold the nozzle 12–18 inches from the surface.',
      'For oil stains: apply a degreaser, let it dwell 5 minutes, then wash with the 25-degree nozzle.',
    ],
    skills: ['Nozzle selection', 'PSI safety', 'Dwell time for degreasers'],
    tools: [
      { name: 'Pressure washer (2,500–3,000 PSI)', rent: '/tool-rentals?category=cleaning', buy: null },
      { name: 'Concrete/driveway degreaser', rent: null, buy: amz('concrete driveway degreaser cleaner') },
      { name: 'Safety goggles', rent: null, buy: amz('safety goggles protective eyewear') },
    ],
    hireHref: '/post-job',
    toolsHref: '/tool-rentals?category=cleaning',
    xp: 10,
    tips: {
      helper: "Power washing has low skill barrier and high demand — typical $100–250 for a driveway. Rent a 3,500 PSI commercial washer to cut job time in half.",
      business: 'Schedule before property photos and before spring/summer move-in season. Track surface condition in property records — some surfaces need softer settings.',
    },
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
