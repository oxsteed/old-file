import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useRecommendations from '../hooks/useRecommendations';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Award,
  BookOpen,
  Briefcase,
  Building2,
  Car,
  CheckCircle,
  ChevronRight,
  ClipboardList,
  Clock,
  Droplet,
  ExternalLink,
  Flag,
  Hammer,
  Heart,
  Leaf,
  LayoutGrid,
  LayoutList,
  MessageCircle,
  Package,
  Paintbrush,
  PlayCircle,
  Search,
  Headphones,
  Send,
  ShoppingBag,
  Smartphone,
  Thermometer,
  TrendingUp,
  Truck,
  User,
  UserCheck,
  Users,
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

// Fire-and-forget click tracking for marketplace conversion events.
// Uses fetch with keepalive so the beacon survives navigation; every
// failure is swallowed so tracking never breaks the user flow.
function trackLearnClick(guideId, kind, target) {
  try {
    const base = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || '/api';
    fetch(`${base}/learn/track`, {
      method: 'POST',
      keepalive: true,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guide_id: guideId, kind, target: target ?? null }),
    }).catch(() => {});
  } catch (_) { /* never break navigation */ }
}

// Convert a YouTube watch/shorts or Vimeo URL to its embed form for the
// sandboxed iframe. Returns null for anything else (including non-https
// URLs) so the caller falls back to the placeholder. video_provider
// ('youtube'|'vimeo'|null) is a hint; the URL host is also sniffed so
// provider-less rows still resolve.
const toEmbedUrl = (url, provider) => {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!/^https:\/\//i.test(trimmed)) return null;
  let host = '';
  try {
    host = new URL(trimmed).hostname.toLowerCase();
  } catch (_) {
    return null;
  }
  const isYouTube = provider === 'youtube'
    || host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
  if (isYouTube) {
    const m = trimmed.match(/(?:youtube\.com\/(?:watch\?[^#\s]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? `https://www.youtube.com/embed/${m[1]}` : null;
  }
  const isVimeo = provider === 'vimeo'
    || host === 'vimeo.com' || host.endsWith('.vimeo.com') || host === 'player.vimeo.com';
  if (isVimeo) {
    const m = trimmed.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return m ? `https://player.vimeo.com/video/${m[1]}` : null;
  }
  return null;
};

// ── Categories ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'all',          tKey: 'learn.page.categories.all',         Icon: LayoutGrid,    color: '#f97316' },
  { id: 'plumbing',     tKey: 'learn.page.categories.plumbing',    Icon: Droplet,       color: '#0ea5e9' },
  { id: 'electrical',   tKey: 'learn.page.categories.electrical',  Icon: Zap,           color: '#eab308' },
  { id: 'carpentry',    tKey: 'learn.page.categories.carpentry',   Icon: Hammer,        color: '#8b5cf6' },
  { id: 'hvac',         tKey: 'learn.page.categories.hvac',        Icon: Thermometer,   color: '#14b8a6' },
  { id: 'painting',     tKey: 'learn.page.categories.painting',    Icon: Paintbrush,    color: '#ec4899' },
  { id: 'car-care',     tKey: 'learn.page.categories.carCare',     Icon: Car,           color: '#6366f1' },
  { id: 'landscaping',  tKey: 'learn.page.categories.landscaping', Icon: Leaf,          color: '#22c55e' },
  { id: 'maintenance',  tKey: 'learn.page.categories.maintenance', Icon: Wrench,        color: '#94a3b8' },
  { id: 'management',   tKey: 'learn.page.categories.management',  Icon: ClipboardList, color: '#0369a1' },
  // Persona categories
  { id: 'customer',     tKey: 'learn.page.categories.customer',    Icon: Flag,          color: '#f97316' },
  { id: 'helper',       tKey: 'learn.page.categories.helper',      Icon: UserCheck,     color: '#10b981' },
  { id: 'logistics',    tKey: 'learn.page.categories.logistics',   Icon: Package,       color: '#64748b' },
  { id: 'consulting',   tKey: 'learn.page.categories.consulting',  Icon: MessageCircle, color: '#a855f7' },
  { id: 'tool-rental',  tKey: 'learn.page.categories.toolRental',  Icon: Truck,         color: '#f59e0b' },
  { id: 'franchise',    tKey: 'learn.page.categories.franchise',   Icon: Building2,     color: '#0891b2' },
  { id: 'life',         tKey: 'learn.page.categories.life',        Icon: Heart,         color: '#ef4444' },
  // Business role categories
  { id: 'business',     tKey: 'learn.page.categories.business',    Icon: Briefcase,     color: '#7c3aed' },
  { id: 'sales',        tKey: 'learn.page.categories.sales',       Icon: Users,         color: '#059669' },
  { id: 'support',      tKey: 'learn.page.categories.support',     Icon: Headphones,    color: '#0284c7' },
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
    intro: 'A dripping faucet wastes gallons a day and usually comes down to a worn washer or O-ring, both cost under a dollar.',
    steps: [
      'Turn off the water supply valves under the sink, then open the faucet to release remaining pressure.',
      'Remove the handle by unscrewing the decorative cap and the screw underneath it.',
      'Unscrew the packing nut and pull out the stem.',
      'Inspect the rubber washer and O-ring at the bottom of the stem, replace both.',
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
      customer: 'A dripping faucet wastes up to 3,000 gallons per year. If the drip restarts within a few weeks, the seat inside the faucet body is corroded, that means a full faucet replacement. Budget $15 in parts for this fix; hiring out runs $75–150.',
      helper: "List as 'Faucet Repair', typical job runs $75–150. Upsell by checking the shutoff valve condition while you're under the sink.",
      consultant: 'Most guides gloss over faucet type differences. A great deep-dive would cover cartridge vs ball vs ceramic disc designs, how to identify yours before ordering parts, and why the same repair takes 15 minutes on one faucet and 90 on another.',
      business: 'Entry-level task. Assign to any maintenance staff. Slot 45 min including travel and cleanup. Keep a repair kit in every vehicle.',
      investor: "A dripping faucet is a $0 repair that tenants notice. Left unaddressed, it stains the basin, signals deferred maintenance, and can damage the cabinet below. Fix within 48 hours of a report, it sets the tone for the whole tenancy.",
      manager: "Log every faucet repair by unit and fixture. Two drip repairs on the same faucet means the seat is corroded, budget a full faucet swap rather than a third patch. Track frequency per property to flag buildings due for fixture upgrades.",
      support_agent: "Ask: single-handle or two-handle faucet? Drip from spout or from base? Spout drips = washer or cartridge. Base drips = O-ring. This determines whether you dispatch or walk them through a DIY. Most callers can fix a spout drip themselves with a $2 repair kit.",
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
    intro: 'Most slow drains are a hair-and-soap buildup in the trap, no chemicals needed, just the right tool and a little patience.',
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
      customer: "Skip the chemical drain cleaners, they damage pipes and rarely fix the real clog. A $5 zip-it tool clears 90% of hair clogs permanently. If water backs up in multiple drains at once, the clog is in the main line, not the trap. Call a plumber.",
      helper: "Quick-win service: list as 'Drain Clearing.' Typical $80–120. Bring a snake and a zip-it to every plumbing call, it books itself.",
      consultant: "The most common mistake is skipping the P-trap removal step, guides that stop at 'snake and flush' leave readers confused when the clog is actually in the trap arm. A great guide would also cover how to recognize main-line backups before the reader wastes time on a trap-level fix.",
      business: 'Teach all maintenance hires this in the first week. Low material cost, fast turnaround, high tenant satisfaction score.',
      investor: "Clogged drains are the top day-to-day complaint in rental units, almost always hair in the trap. If you see multiple drain calls from the same unit, provide a drain strainer at move-in. A $3 strainer eliminates the call.",
      manager: "Schedule a drain snake check in bathrooms and kitchen sinks as part of annual unit inspections. Units with recurring clogs may have a venting issue or corroded drain line that warrants a camera inspection, document frequency to make the case.",
      support_agent: "First question: is it one drain or multiple? Multiple slow drains = main-line backup, dispatch immediately. Single slow drain = guide them to a zip-it tool or schedule a service call. Ask how long it's been slow to gauge urgency and whether chemical cleaners were already tried (if yes, note for the tech).",
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
    intro: 'A toilet that runs after flushing is almost always the flapper or fill valve, both are cheap and beginner-friendly to replace.',
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
      customer: "Before buying parts, listen carefully: a hissing sound is the fill valve; a phantom flush (toilet fills on its own) is the flapper. Food coloring in the tank confirms a flapper leak, if the bowl water turns colored without flushing, the flapper is the culprit.",
      helper: "List as 'Toilet Repair.' Typical $100–180 with parts. Replace both flapper and fill valve in one visit, saves a callback and earns better reviews.",
      consultant: "Running toilets are one of the most misdiagnosed home repairs. A standout guide would walk readers through the diagnostic flow (listen → dye test → float check) before prescribing a fix, and would cover the phantom flush, a symptom that often sends people to buy the wrong part.",
      business: 'Common property management repair. Stock flappers and fill valves in your supply closet. Target proficiency: first 90 days of hire.',
      investor: "A running toilet wastes up to 200 gallons a day and raises your water bill by $30–70/month. If you pay utilities, it's your direct cost. If tenants pay, unresolved running toilets generate goodwill complaints. Either way, respond within 24 hours.",
      manager: "Include a toilet audit in your quarterly PM checklist: flush, listen for running, check for wobble, inspect the supply line. A $10 flapper prevents a $200 water bill. Note each toilet's last repair date to schedule proactive valve replacement at the 8–10 year mark.",
      support_agent: "When a tenant calls about a 'running' or 'constantly refilling' toilet, ask: Do you hear hissing or splashing into the bowl? Hissing = fill valve (phantom flush also likely). Splashing = flapper. Both are inexpensive same-day repairs. If the toilet is also rocking or leaking at the base, that's a wax ring, escalate immediately.",
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
    intro: 'Upgrading a shower head is a 15-minute job that makes a noticeable daily difference, and no tools other than a wrench.',
    steps: [
      'Turn off the water supply to the shower (or the main shutoff).',
      'Wrap the shower arm threads with 2–3 layers of plumber\'s tape (clockwise direction).',
      'Hand-thread the new shower head onto the arm. Tighten with a wrench one quarter-turn past hand-tight, avoid over-tightening.',
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
      customer: "PTFE tape is non-negotiable, a dry connection will drip regardless of how tight you go. Wrap 2–3 clockwise layers so the tape locks as you thread. Avoid over-tightening with a wrench; one quarter-turn past hand-tight is enough.",
      helper: "Offer shower head upgrades as an add-on during any bathroom plumbing call. Typical $50–80 labor. Clients love a same-day visible improvement.",
      consultant: "Most readers don't know their shower arm thread pitch. A great guide would show how to identify the thread size, explain why some shower heads strip, and cover low-flow vs pressure-compensating designs, surprisingly few guides go beyond 'wrap and tighten.'",
      business: 'Great first-day plumbing task. Zero risk of water damage if tape is applied correctly. Include in new-hire orientation.',
      investor: "Low-flow shower heads (2.0 GPM) pay for themselves within a few months in water savings on a multi-unit property. A $25 shower head is a high-ROI capex item, consider upgrading all units during a turnover cycle rather than doing them one at a time.",
      manager: "Track shower head age and flow rate by unit. Water-sensing shower heads can cut water use 20–30% on metered properties. During turnover, replace any head older than 8 years, lime scale builds up inside and reduces pressure that tenants will eventually complain about.",
      support_agent: "Shower head complaints usually fall into three categories: low pressure, dripping after shutoff, or the head popped off. Low pressure = lime scale buildup, walk them through soaking in vinegar or schedule a replacement. Dripping after shutoff = worn diverter valve, not the head. Fell off = stripped arm threads, dispatch.",
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
      customer: "Sponge out the last inch of water before you remove the old valve or you'll get a face full when you pull it. Universal fill valves fit almost all toilets, but measure your tank depth first, if it's less than 10 inches, you need a low-profile model.",
      helper: "Bundle with a flapper swap for a complete 'Toilet Tune-Up' service, $130–180 all in. Prevents two separate callbacks.",
      consultant: "The float adjustment step is where readers get lost. A great guide would include a photo showing the 'fill line' marker on the overflow tube and explain why setting it too high causes phantom running even with a brand-new valve.",
      business: 'Stock universal valves for every site. A running toilet can waste 200 gallons/day. Train staff to inspect during routine PM visits.',
      investor: "Fill valve replacement is often combined with flapper replacement as a 'toilet tune-up', total parts cost under $25, labor 45 minutes. If you're paying $80–150 for a plumber to replace just one part, ask them to do both while there. Reduces callbacks and improves toilet reliability for 8–10 years.",
      manager: "Universal fill valves (Fluidmaster 400A or equivalent) fit 95% of residential toilets. Keep four in stock. When a tenant reports a toilet that 'won't stop running' after a flapper replacement, the fill valve is the culprit, skip the diagnostic call and replace it directly.",
      support_agent: "If a tenant says their toilet was just repaired but is still running, the fill valve is the next suspect. Ask: Was only the flapper replaced? If yes, schedule a follow-up for the fill valve. Also confirm the float arm isn't bent or stuck, a quick visual check saves a second dispatch.",
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
    license_note: 'This guide covers emergency temporary repair only, not a permanent fix. Always follow up with a licensed plumber to make a proper repair.',
    gradient: 'linear-gradient(135deg, #fee2e2, #fecaca)',
    intro: 'A burst pipe can release hundreds of gallons an hour. Knowing how to stop the flow buys time until a plumber arrives and limits damage.',
    steps: [
      'Immediately shut off the main water supply valve, usually near the water meter or where the main enters the house.',
      'Open the lowest faucet in the house to drain remaining pressure from the pipes.',
      'Locate the burst or cracked section. Dry it as thoroughly as possible with rags.',
      'Apply a pipe repair clamp or silicone repair tape tightly over the damaged section, overlap by at least 2 inches on each side.',
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
      customer: "The main shutoff is the only thing standing between a slow drip and a flooded home. Find yours now, test that it turns fully, and tell everyone in your household where it is. A repair clamp buys time, have a licensed plumber make the permanent repair within 24–48 hours.",
      helper: "Emergency call premium applies, typical $200–400 for a temporary patch plus follow-up. Always carry assorted repair clamps. This gets 5-star reviews.",
      consultant: "Most burst-pipe content covers the repair clamp but skips the emotional reality: the homeowner is panicking. A great guide would open with 'first 60 seconds' decision flow, shut off, call insurance, document damage with photos. That's the content readers remember and share.",
      business: 'Print a one-page emergency protocol with main shutoff location for every property you manage. Train staff to respond within 30 minutes.',
      investor: "A burst pipe is your worst-case maintenance scenario. The repair itself is cheap, the water damage is what costs $10,000–50,000. Know the main shutoff location for every property you own. If your tenants don't know it, write it in the lease. A $50 water sensor alarm near the water heater and under sinks is extremely high ROI.",
      manager: "Every building should have a laminated emergency card near the main shutoff with the shutoff location, your on-call number, and the plumber's emergency number. Run a 'burst pipe drill' during new tenant orientation, 10 minutes that could prevent catastrophic damage. Also confirm the main shutoff actually fully closes, many older gate valves don't.",
      support_agent: "When a caller reports active flooding or a burst pipe, treat it as a Code Red. First words: 'Shut off your main water supply right now, do you know where it is?' Help them find it if not. Document when they found the shutoff and whether water is contained. Dispatch emergency plumber immediately and log for insurance purposes. Do not spend time on diagnostics until water is stopped.",
    },
  },
  {
    id: 'install-water-shutoff-valve',
    title: 'Replace a Water Supply Shutoff Valve',
    category: 'plumbing',
    difficulty: 'Medium',
    minutes: 60,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #dbeafe, #93c5fd)',
    intro: 'A shutoff valve that won\'t fully close, or one that drips when open, leaves you unable to make any downstream repair. Replacing it takes an hour and requires only basic plumbing skills.',
    steps: [
      'Turn off the main water supply. Open a faucet downstream to drain remaining pressure from the line.',
      'Use an adjustable wrench to unscrew the old valve\'s compression nuts. Note the pipe diameter (usually 1/2" or 3/4") before removing.',
      'Cut back the pipe by 1/2" with a pipe cutter to expose clean metal. Deburr the cut edge with the reamer on the pipe cutter.',
      'Slide on the new compression nut and ring. Push the new ball valve onto the pipe and tighten the nut hand-tight plus one full turn with a wrench.',
      'Restore the main supply, close the new valve, then slowly open it. Check the compression fitting for drips. One additional quarter-turn will stop a slow drip.',
    ],
    skills: ['Main shutoff operation', 'Pipe cutting', 'Compression fitting assembly', 'Leak testing'],
    tools: [
      { name: 'Pipe cutter (1/2" or 3/4")', rent: '/tool-rentals?category=plumbing', buy: amz('pipe cutter tubing cutter') },
      { name: 'Adjustable wrench', rent: '/tool-rentals?category=hand-tools', buy: amz('adjustable wrench') },
      { name: 'Ball valve with compression fittings (match pipe size)', rent: null, buy: amz('ball valve compression fitting 1/2 inch') },
    ],
    hireHref: '/post-job?category=plumbing',
    toolsHref: '/tool-rentals?category=plumbing',
    xp: 25,
    tips: {
      customer: "Old gate valves (oval handle, multiple turns to close) are increasingly unreliable, if you still have them, this is the upgrade to make. Modern ball valves close in a quarter-turn and last decades. If yours won't shut off fully during a repair, you'll be stuck calling a plumber mid-job.",
      helper: "Shutoff valve replacements are often bundled with other repairs, charge $80–140 for the upgrade while on site. A failed shutoff is a liability you can point to clearly, which makes the upsell easy.",
      consultant: "Most guides assume the reader knows the difference between a gate valve and a ball valve, and which they have. A great guide would open with that identification step and explain why gate valves fail over time (the seat corrodes), making the upgrade logical rather than optional.",
      business: 'Add shutoff valve condition to your property inspection checklist. A valve that only partially closes is a maintenance emergency waiting to happen. Upgrade to ball valves across all units on a rolling schedule.',
      investor: "A shutoff valve that won't fully close means every downstream repair requires shutting off the building's main, which affects other tenants or units. If you own multi-unit buildings with original gate valves, budget a rolling ball valve upgrade during vacancy turns. It's $40 per valve in materials and prevents emergency-call premiums.",
      manager: "During your annual inspection of each unit, test every supply shutoff: under sinks, behind toilets, at the washing machine. A valve that's stuck or only partially closes needs to be flagged for immediate replacement. Record valve type and condition in your property management system so plumbers can quote replacements in bulk.",
      support_agent: "If a tenant or tech reports that a repair can't be completed because the shutoff valve doesn't close, escalate immediately, the main water supply for the unit (or building) may need to be shut off to complete any work. Note the valve location and type in the work order so the plumber brings the right parts and schedules time to replace it.",
    },
  },
  {
    id: 'fix-toilet-wax-ring',
    title: 'Replace a Toilet Wax Ring',
    category: 'plumbing',
    difficulty: 'Hard',
    minutes: 90,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #e0f2fe, #38bdf8)',
    intro: 'A toilet that wobbles or leaves water on the floor at the base has a failed wax ring. It\'s a messy job, but straightforward, and ignoring it leads to subfloor damage.',
    steps: [
      'Turn off the supply valve. Flush to empty the tank. Use a sponge and bucket to remove remaining water from the tank and bowl.',
      'Disconnect the supply line. Unscrew the two closet bolts at the toilet base. Lift the toilet straight up and set it on its side on a tarp.',
      'Scrape the old wax off the floor flange and the toilet horn using a putty knife. Clean both surfaces thoroughly.',
      'Press the new wax ring onto the toilet horn (wax side down) or onto the floor flange. Align the toilet over the flange bolts and lower it straight down, don\'t shift side to side once wax contacts the flange.',
      'Press down firmly and evenly to seat the wax. Hand-tighten the nuts alternately; snug but not over-tight (cracks the toilet base). Reconnect supply, restore water, flush, and check for leaks.',
    ],
    skills: ['Toilet removal and reinstall', 'Wax ring seating', 'Closet bolt and flange anatomy'],
    tools: [
      { name: 'Wax ring (with or without horn extension, check flange height)', rent: null, buy: amz('toilet wax ring with horn') },
      { name: 'Putty knife', rent: null, buy: amz('putty knife set') },
      { name: 'Adjustable wrench', rent: '/tool-rentals?category=hand-tools', buy: amz('adjustable wrench') },
      { name: 'Bucket and sponge', rent: null, buy: amz('utility bucket') },
      { name: 'Tarp or old drop cloth', rent: null, buy: amz('canvas drop cloth') },
    ],
    hireHref: '/post-job?category=plumbing',
    toolsHref: '/tool-rentals?category=plumbing',
    xp: 50,
    tips: {
      customer: "Before you lift the toilet, confirm the floor flange is at floor level. If it's recessed (below the tile), you'll need an extension ring in addition to the wax ring. Lifting a toilet incorrectly, twisting sideways on the wax, breaks the seal and forces you to start over with a new ring.",
      helper: "List as 'Toilet Reset/Wax Ring', typical $150–250 including parts. Check the flange condition while you have it out. A damaged flange adds $100–200 to the job but prevents an immediate callback.",
      consultant: "The flange height question is the most common point of failure in DIY wax ring replacements. Most guides say 'press straight down' without explaining why (twisting shears the wax). A guide with a photo showing correct vs. incorrect alignment, plus clear guidance on when to use a wax-free gasket vs. a wax ring, would be distinctly useful.",
      business: 'Any toilet wobble in a unit should be addressed immediately, it means the wax ring is compromised and subfloor water damage is beginning. Train staff to report wobble as an urgent work order, not a cosmetic issue.',
      investor: "A rocking toilet is a silent subfloor killer. If a tenant reports it and it's ignored for even a few weeks, water seeps under the toilet with every flush and begins rotting the subfloor. A $150–250 wax ring job left unaddressed becomes a $2,000–5,000 subfloor replacement. Treat toilet wobble as a P1 work order.",
      manager: "Add 'toilet rock test' (push toilet side to side) to your annual unit inspection checklist. Any movement means the wax seal is compromised, schedule immediately. When the job is done, document the flange condition found, whether the floor showed moisture damage, and when it was last repaired.",
      support_agent: "When a tenant reports water around the toilet base or a rocking toilet, this is an urgent dispatch, not a scheduled call. Ask: Is there visible water on the floor? Does the toilet rock when you push it? Either yes = wax ring failure, potential subfloor damage. Flag as urgent, note when damage was first observed, and document for potential insurance claim if damage is already visible.",
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
    license_note: 'This guide covers a standard single-pole switch in jurisdictions where homeowner electrical work is permitted. Check your local code, some states require a licensed electrician even for minor repairs.',
    gradient: 'linear-gradient(135deg, #fefce8, #fef08a)',
    intro: 'Swapping a standard single-pole switch is one of the safest electrical tasks, as long as you confirm the circuit is off first.',
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
      customer: "Never assume the breaker is labeled correctly. Always use a non-contact voltage tester at the switch wires before touching anything. If the circuit is a 3-way (two switches control one light), the wiring is different, this guide only covers single-pole switches.",
      helper: "Fast, high-margin task, typical $60–100 labor. Always carry a multi-pack of switches. Offer to upgrade to a dimmer while on site for easy upsell.",
      consultant: "The photograph-before-you-disconnect step is critical and most guides bury it. A better guide would put it as step one with a note: 'This 5-second photo is your insurance policy.' Also: many readers encounter travelers on 3-way circuits and get confused, addressing that distinction upfront prevents angry comments.",
      business: 'Safe for trained staff in permit-exempt jurisdictions. Verify local code first. Proficiency: intermediate. Always photograph wiring before disconnecting.',
      investor: "Light switch replacements are typically a $60–100 expense when hired out. If you have a handyman on retainer, this should be on their competency list, it's a 15-minute job that should never require a licensed electrician call-out. Note that code in some jurisdictions requires a permit even for switch replacements.",
      manager: "Include switch functionality in your move-in/move-out checklist. A non-working switch most often indicates a tripped breaker (check first) or a wiring connection that worked loose. Log any switch replaced with date and location in your maintenance tracker.",
      support_agent: "When a tenant reports a light that won't turn on, start with the basics: Is the light bulb out? Is the breaker tripped? Only after those are confirmed should you dispatch for a switch replacement. If multiple lights on the same circuit stopped working, it's the breaker, walk them through resetting it before scheduling a tech.",
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
      customer: "Fan-rated boxes are marked 'Suitable for Fan Support' on the side. If yours isn't rated, a fan-rated retrofit brace (about $15) installs through the existing hole in minutes without attic access. Don't skip this, fans vibrate and a non-rated box will pull free over time.",
      helper: "List as 'Ceiling Fan Install.' Typical $100–200 labor. Spring demand spike. Most time goes to box verification and cleanup, quote 2 hours to be safe.",
      consultant: "The blue wire (fan light kit) confuses most readers. A standout guide would explain the three scenarios clearly: one switch (cap blue to black), two switches (run two circuits), or remote/dimmer kit. That level of specificity separates a good guide from a great one.",
      business: 'Assign to your most experienced electrical-rated staff. Always verify box rating before arrival. Keep spare fan-rated boxes in the vehicle.',
      investor: "Ceiling fans add perceived value to bedrooms and living areas at a cost of $80–200 for the fan + $100–200 labor. In warm climates they're expected in rental listings. Adding fans to key rooms during a turnover is a high-ROI amenity upgrade, note that they require a fan-rated ceiling box, which older homes may not have.",
      manager: "Log fan model and installation date per unit. Wobbling or noisy fans are a maintenance ticket waiting to happen, they're usually blade-balance issues (a $3 fix with a balancing kit) or a loose mounting bracket. If a fan motor fails under 5 years, it's typically a warranty claim. Keep the model numbers.",
      support_agent: "Fan complaints usually fall into: wobbles/shakes (balance issue, send a balancing kit), makes noise (often a loose blade screw or motor bearing), light kit doesn't work (blue wire or remote pairing), or won't turn on at all (breaker or capacitor). Ask which symptom to triage correctly before dispatching.",
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
    intro: 'GFCI outlets protect against shock in wet areas. When one trips, it can cut power to several outlets downstream, the tripped outlet is often in a different room.',
    steps: [
      'Find the outlet with TEST and RESET buttons, it may not be in the same room as the dead outlet.',
      'Check for moisture or visible damage before touching anything.',
      'Press the RESET button firmly until it clicks. Power should restore immediately.',
      'Test with a lamp or outlet tester to confirm.',
      'If the outlet trips again right away, stop and call an electrician, there\'s an underlying fault.',
    ],
    skills: ['GFCI identification', 'Circuit tracing', 'Knowing when to stop'],
    tools: [
      { name: 'Outlet tester', rent: null, buy: amz('outlet circuit tester') },
    ],
    hireHref: '/post-job?category=electrical',
    toolsHref: '/tool-rentals?category=electrical',
    xp: 10,
    tips: {
      customer: "GFCI outlets protect circuits downstream, the tripped outlet is often in a completely different room. Check the bathrooms, garage, kitchen, and outdoor areas systematically. If a GFCI won't stay reset (pops immediately), there's an active fault on the circuit. Don't force it, call an electrician.",
      helper: 'Instant value-add on any electrical service call. Explain downstream outlets to the client, it positions you as the expert, not just a button-pusher.',
      consultant: "GFCI content is everywhere, but almost none of it explains the 'daisy chain' topology, why tripping one GFCI kills outlets in other rooms. A guide that walks through how to trace the protected circuit would be genuinely useful and get shared by frustrated homeowners.",
      business: 'Include GFCI reset in every maintenance check-in. Zero material cost, prevents unnecessary callouts. Train all staff regardless of role.',
      investor: "GFCI outlets in bathrooms, kitchens, garages, and outdoor areas are required by code in most jurisdictions. If your properties have two-prong or non-GFCI outlets in wet areas, you're a code violation and a liability, budget GFCI upgrades on a rolling basis. Cost: $15–20 per outlet in materials.",
      manager: "GFCI resets are one of the most common 'no power' support calls and 90% of them can be resolved without a tech visit if support walks the tenant through it. Train your support staff to walk through the GFCI reset checklist before dispatching. Document which outlets are GFCI-protected in each unit to speed up future triage.",
      support_agent: "This is the most resolvable 'no power' call without a dispatch. Ask: Is the non-working outlet in a bathroom, kitchen, garage, or outside? If yes, find the GFCI outlet nearby (often not in the same room) and press TEST then RESET. Walk them through it step by step. If the GFCI won't stay reset, there's an active fault, dispatch immediately.",
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
    license_note: 'Outlet replacement is permitted for homeowners in most U.S. jurisdictions. Confirm your local code. Always test with a voltage tester, never assume the breaker is off.',
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
      customer: "If your outlet tester shows 'hot/neutral reversed' after installing, your black and white wires are on the wrong terminals, swap them. The small slot (hot) connects to the brass screw; large slot (neutral) to silver. If you see scorching on the old outlet's wires, call an electrician before replacing it.",
      helper: "List as 'Outlet Replacement.' Typical $75–120 each. Offer USB outlet upgrades as a popular upsell, clients love the convenience.",
      consultant: "Most guides skip the backstab connector warning. A great outlet guide would explain why push-in (backstab) connections fail over time and why screw terminals are always preferable, this is the kind of professional nuance readers can't get from a quick YouTube video.",
      business: 'Proficiency level: intermediate. Always replace in pairs when one is worn, prevents a second callout. Log outlet age in your property records.',
      investor: "Worn outlets in older properties are a code and safety issue. If you're seeing discoloration or hear buzzing from outlets, budget a sweep, aged backstab connections are a fire risk. Replacing outlets with USB combo outlets during a turnover is a low-cost amenity upgrade ($20–30 per outlet) that shows in listing photos.",
      manager: "Test outlets with an outlet tester during move-in/move-out inspections, it takes 5 seconds per outlet and catches reversed wiring and open grounds before tenants complain. Document which units have two-prong vs. three-prong outlets; two-prong in bedrooms is a tenant friction point and a potential code issue in newer additions.",
      support_agent: "When a tenant reports an outlet that 'doesn't work,' walk through: Is anything on the circuit working? Is it a GFCI-protected circuit (check nearby GFCI)? Did the tenant try the breaker panel? If all those check out, it's likely a failed outlet, dispatch. Ask if any sparks, burning smell, or discoloration were seen, if yes, mark as urgent/safety issue.",
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
    license_note: 'Confirm your local code permits homeowner switch replacement. A dimmer must be matched to the bulb type (LED, CFL, or incandescent), check the packaging.',
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
      customer: "Mismatched dimmers hum or flicker, always check that your dimmer is rated for LEDs if you have LED bulbs (the packaging will say so). Also check your total wattage: if you have six 10W LEDs, your dimmer only needs to handle 60W, not the 600W incandescent maximum on the label.",
      helper: "Always upsell a dimmer when replacing a switch, add $30–50 for the upgrade. Clients get immediate value and you stay on site longer per job.",
      consultant: "Dimmer compatibility is one of the most confusing topics in home electrical. A genuinely useful guide would provide a decision tree: bulb type → dimmer type → minimum load requirement. The 'flickering at low levels' problem almost always comes down to minimum load, and no mainstream guide explains that clearly.",
      business: 'Good intermediate training task. Stock LED-compatible dimmers in your supply kit. Always verify bulb wattage total before purchasing.',
      investor: "Dimmer switches are a $20 upgrade that improves perceived quality in a listing. Install in primary bedroom and living room during a turnover, they photograph well and are a tenant expectation in mid-market and above properties. Verify bulb compatibility; LED dimmers on incandescent bulbs hum and frustrate tenants.",
      manager: "When a tenant reports flickering lights, ask whether it's on a dimmer. If yes, the most common cause is LED bulb incompatibility with the dimmer model, a $10 bulb swap from a 'dimmable LED' to a dimmer-compatible LED usually resolves it without any repair. Keep a list of compatible bulb models for the dimmers used across your properties.",
      support_agent: "Flickering lights complaints split into: flickering on a dimmer (usually bulb incompatibility, ask if they recently changed bulbs), flickering on a standard switch (loose connection or failing bulb), or whole-room flickering (potential loose neutral, escalate to electrician). A dimmer that hums is also a compatibility issue, not a defect.",
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
    intro: 'Swapping a fixture is mostly mechanical, the wiring is the same three connections every time. The challenge is weight and working overhead.',
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
      customer: "Support the old fixture while disconnecting, don't let it dangle by its wires. Wire nuts can work loose if not pushed in firmly and twisted clockwise. After restore, wobble the fixture gently to confirm the mount is secure before leaving it.",
      helper: "List as 'Light Fixture Install.' Typical $80–150 labor. Bundle with a dimmer switch install for $130–200 total, clients rarely say no.",
      consultant: "The unspoken challenge with fixture installs is weight and ceiling box load ratings. A great guide would cover the ceiling box weight limit (usually 35 lb for standard, 50 lb for fan-rated), how to identify the box type from the attic, and why chandelier-weight fixtures require a brace or new box.",
      business: 'Requires comfort with ladder work. Train with low-ceiling fixtures first. Always bring extra wire nuts in multiple sizes to every electrical call.',
      investor: "Light fixture upgrades are a high-visibility, low-cost way to modernize a unit. A $50–80 fixture replacing a dated one can noticeably improve listing photos. Focus on the entry, kitchen, and primary bedroom, those are the most photographed rooms. Always verify the ceiling box is rated for the new fixture weight.",
      manager: "Document the fixture type and brand per room during annual inspections. When a fixture stops working, the most common causes in order are: bulb burnout, switch failure, loose wire nut connection at the fixture box. Train staff to check in that order before replacing the fixture itself.",
      support_agent: "When a tenant reports a light not working, triage: Did the bulb burn out (most likely)? Is the switch working (test with another device on that circuit)? Is it on a dimmer (bulb incompatibility)? Did the breaker trip? If all those check out and the fixture is dead, it's a wiring connection issue at the fixture box, dispatch. Note any flickering or buzzing sounds as potential fire hazards requiring urgent response.",
    },
  },
  {
    id: 'install-smart-switch',
    title: 'Install a Smart Light Switch',
    category: 'electrical',
    difficulty: 'Medium',
    minutes: 45,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fefce8, #fef9c3)',
    intro: 'Smart switches let you control lights by voice, schedule, or app, without replacing every bulb. Most require a neutral wire; this guide shows you how to identify it and wire the switch safely.',
    steps: [
      'Turn off the breaker for the circuit. Confirm power is off with a non-contact voltage tester before touching any wires.',
      'Remove the old switch. Photograph the existing wiring before disconnecting anything.',
      'Identify the wires: black (hot), white (neutral), bare or green (ground). Smart switches need all three, if you only have two, check for a neutral wire bundled in the back of the box.',
      'Connect wires per the smart switch diagram: hot to LINE, neutral to NEUTRAL, ground to GROUND. Use the included wire nuts or push-in connectors.',
      'Push the switch into the box and secure with screws. Restore power. Follow the manufacturer app to pair the switch to your Wi-Fi.',
    ],
    skills: ['Voltage testing', 'Wire identification', 'App pairing'],
    tools: [
      { name: 'Non-contact voltage tester', rent: null, buy: amz('non contact voltage tester electrical') },
      { name: 'Flathead and Phillips screwdrivers', rent: null, buy: amz('screwdriver set flathead phillips') },
      { name: 'Smart switch (e.g. Kasa, Leviton, Lutron)', rent: null, buy: amz('smart light switch wifi neutral wire') },
    ],
    hireHref: '/post-job?category=electrical',
    toolsHref: '/tool-rentals?category=electrical',
    xp: 25,
    tips: {
      customer: "The most common failure point is forgetting to check for a neutral wire before buying the switch. Look for a white wire bundled with wire nuts in the back of the box, it won't connect to the old switch but it's required for smart switches. If there's no neutral, look for smart switches that work without one (Lutron Caseta is the main option).",
      helper: "Smart switch installs are becoming one of the most requested small electrical jobs. Price at $75–120 per switch installed, clients buying multi-packs will often hire out the labor on all of them.",
      consultant: "The neutral wire problem is widely documented but guides rarely explain WHY it's needed: smart switches need a small constant current to power their Wi-Fi radio, and without a neutral the only path is through the bulb. A useful advanced guide would also cover 3-way smart switches, which require different wiring and a companion add-on switch or smart bulbs to work correctly.",
      business: 'Great recurring revenue: install smart switches during initial setup, then offer a smart home integration check-in annually. Inventory a few common neutral-required and no-neutral models to handle both wiring types.',
      investor: "Smart switches are a high-ROI amenity in short-term rental properties where automation and app control have genuine guest value. For long-term rentals, they add friction (tenants need to download an app, connect to Wi-Fi). Stick to standard upgrades in long-term units unless smart home is a selling point in your market.",
      manager: "Smart switches require a consistent Wi-Fi network to function reliably. If you install them in units, ensure your property's network infrastructure is solid, a switch that disconnects from Wi-Fi will frustrate tenants. Create a standard pairing protocol and keep a record of which network each property's switches are paired to.",
      support_agent: "Smart switch calls come in two types: installation help (neutral wire, app pairing) and reliability issues (switch loses Wi-Fi, remote control stops working). For reliability: ask whether the switch responds to physical touch (if yes, it's a Wi-Fi/app issue, walk through re-pairing). If the switch doesn't respond physically either, it may be wired incorrectly, dispatch.",
    },
  },
  {
    id: 'install-usb-outlet',
    title: 'Replace an Outlet with a USB Charging Outlet',
    category: 'electrical',
    difficulty: 'Easy',
    minutes: 30,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
    intro: 'USB outlets replace a standard wall outlet and add built-in USB-A or USB-C ports, no adapter block needed. It is one of the safest DIY electrical swaps because the wiring is identical to a regular outlet.',
    steps: [
      'Turn off the breaker and verify power is off with a voltage tester.',
      'Remove the cover plate and unscrew the old outlet from the box. Pull the outlet out, note which wires go to which screw terminals.',
      'Disconnect the old outlet: black wire from brass (hot) screw, white wire from silver (neutral) screw, bare/green from green (ground) screw.',
      'Connect wires to the new USB outlet in the same positions. Tighten each screw firmly, a loose connection causes heat and fire risk.',
      'Push the outlet back into the box, secure with screws, and attach the cover plate. Restore power and test with a phone.',
    ],
    skills: ['Outlet wiring', 'Voltage testing', 'Wire termination'],
    tools: [
      { name: 'Non-contact voltage tester', rent: null, buy: amz('non contact voltage tester electrical') },
      { name: 'Flathead screwdriver', rent: null, buy: amz('flathead screwdriver') },
      { name: 'USB outlet (USB-A+C combo)', rent: null, buy: amz('usb outlet wall charger built in usb-c') },
    ],
    hireHref: '/post-job?category=electrical',
    toolsHref: '/tool-rentals?category=electrical',
    xp: 10,
    tips: {
      customer: "The most common mistake is reversing the hot and neutral wires. Black always goes to the brass (gold-colored) screw; white always goes to the silver screw. A reversed outlet won't trip a breaker but is a shock and fire hazard. If you're ever unsure, use a $5 outlet tester before restoring power.",
      helper: "USB outlet swaps are a popular small-ticket job, offer them as an add-on during any electrical visit. $40–60 per outlet installed. Clients in older homes with two-prong outlets will often buy GFCI+USB combo upgrades for the kitchen and bathrooms.",
      consultant: "A useful advanced guide would cover the wattage and charging standard differences, a USB-A port at 2.4A charges slowly compared to USB-C PD at 20W+. Most buyers don't know this when choosing an outlet. Covering how to read the spec sheet and match the outlet to the device being charged (phone vs. tablet vs. laptop) adds real practical value.",
      business: 'Ideal small job for less experienced staff, identical wiring to a standard outlet, no special tools needed. Track the brand and model installed in each unit so you can source replacements quickly if a unit fails.',
      investor: "USB outlets in bedrooms and the kitchen are a visible amenity upgrade for under $30 per outlet installed. Tenants notice and mention it in reviews. If your properties still have only two-prong outlets, upgrading to GFCI+USB combo during a turnover resolves code issues and adds a modern touch simultaneously.",
      manager: "USB outlet failures are typically the USB module burning out, not the outlet wiring. Most units are modular, the USB module can be replaced separately. Keep the brand/model on record so you can order replacements without removing the outlet to check. Expect a 3–5 year lifespan on heavily used units.",
      support_agent: "USB outlet complaints: the outlets work but USB ports don't charge. Confirm the outlet is wired correctly (plug a lamp in), if the regular outlet works but USB doesn't, the USB module has failed. This is a simple swap, not an electrical fault. If neither the outlet nor USB works, it's either the breaker or a wiring issue, run through the standard outlet troubleshooting flow.",
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
      'Find the filter slot, typically on the return air vent or at the air handler unit.',
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
      customer: "The filter size is printed on the cardboard frame of the current filter, you don't need to measure. Thicker filters (4–5 inch) last longer but require a compatible housing. Write the next change date in permanent marker on the filter frame so you never forget.",
      helper: "Offer quarterly filter-swap subscriptions for $35–55/visit. Recurring income, minimal skill required, and clients love the convenience.",
      consultant: "Filter MERV ratings are widely misunderstood. A great guide would explain the trade-off: higher MERV = better filtration but more static pressure, which can overwork an older blower motor. That nuance, when to go to MERV 13 and when to stay at MERV 8, is what readers with aging systems need.",
      business: 'Build this into every monthly facility check. Stock filter sizes for every unit on-site. Log change dates in your work order system.',
      investor: "Deferred HVAC filter changes are one of the most common causes of premature system failure. A new HVAC system runs $5,000–12,000+. A $10 filter every 2–3 months is trivially cheap in comparison. If you allow tenants to handle this, confirm it's in the lease and do an annual inspection to verify compliance.",
      manager: "Standardize filter sizes across your property portfolio where possible, it simplifies purchasing and keeps stock simple. Set calendar reminders for filter changes per unit and track them in your property management system. A tenant who never changed a filter will deny responsibility for a failed blower motor, document every change.",
      support_agent: "When a tenant reports reduced airflow or the HVAC not cooling/heating effectively, ask when the filter was last changed. A clogged filter causes the system to work harder, can freeze the coil on an AC unit, and eventually trips the system off. Walk them through checking and replacing the filter as a first step before dispatching an HVAC tech.",
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
      'Find the condensate drain line, usually a white PVC pipe near the air handler leading outside.',
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
      customer: "If your AC shuts off unexpectedly in summer and restarts after a few hours, a clogged condensate drain triggering the float safety switch is the most common cause. Unclogging it takes 20 minutes and costs nothing. If the float keeps triggering, the drain line may need a dedicated vacuum flush.",
      helper: 'Add to your HVAC tune-up package, typical visit $85–125 bundled with filter change. Prevents expensive callbacks that damage your reviews.',
      consultant: "Most content on condensate drains covers the vinegar flush but not the wet-vac attachment method, which is far more effective for a fully clogged line. A great guide would include both methods, when to use each, and how to identify a float safety switch (and reset it) so readers can diagnose a surprise shutdown.",
      business: 'Schedule annually before summer. One clogged drain = potential ceiling damage claim. Include in your seasonal PM checklist.',
      investor: "A clogged condensate drain can overflow and damage the ceiling below, on an upper-floor unit, a slow drain leak can cause hundreds of dollars of drywall damage before anyone notices. Including an annual condensate drain flush in your PM schedule is cheap insurance. Also confirm every unit has a float safety switch installed.",
      manager: "Add condensate drain flush to your summer PM checklist. If a unit's AC keeps shutting off with no obvious cause, the float switch triggered by a clogged drain is the most common culprit, check before dispatching an HVAC tech. Log drain condition per unit at each PM visit.",
      support_agent: "When a tenant says their AC 'shuts itself off' in summer and comes back on later, the float safety switch triggered by a clogged condensate drain is the likely cause. Ask: Is there water near or under the AC unit? If yes, clogged drain, dispatch HVAC or walk them through the vinegar flush. If no water but still shutting off, it may be a refrigerant issue, dispatch.",
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
      'Mark all leaks with a marker. For small gaps, apply HVAC-rated foil tape, stretch it flat and press firmly from the center out.',
      'For larger gaps or joints, brush water-based mastic sealant onto the duct surface 2 inches beyond the leak. Let it dry fully.',
      'Wrap duct insulation back over any sections you had to peel back. Secure with tape.',
      'Turn the system back on and hold your hand near sealed areas to feel for airflow, properly sealed ducts produce no draft.',
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
      customer: "Regular duct tape (the grey fabric kind) is not suitable for ducts, it fails from heat over time. Use foil HVAC tape only. Even sealing 20% of accessible leaks makes a measurable difference on your energy bill. Focus on joints at the air handler first, that's where the highest pressure and biggest leaks are.",
      helper: "Add duct sealing to your HVAC service menu as an energy audit upsell, typical $150–300 for accessible duct sealing. Pair with a filter change.",
      consultant: "The distinction between mastic sealant and foil tape, and which to use when, is where most guides are vague. A well-researched guide would cover mastic for irregular or large gaps, foil tape for clean straight joints, and why neither should touch flex duct connections (those need specific flex-duct collars).",
      business: 'Inspect ducts during every major HVAC service. Document findings with photos. Sealed duct systems reduce utility costs per unit.',
      investor: "Leaky ducts waste 20–30% of conditioned air in typical homes. For a multi-unit property you own and maintain, this directly inflates utility costs if you pay them. If tenants pay utilities, leaky ducts mean uncomfortable units that generate complaints. A duct sealing project across a building pays for itself in 2–4 years through utility savings.",
      manager: "If tenants complain that one room is always warmer or cooler than the rest, leaky duct connections near the air handler are often the cause. Document comfort complaints by unit and location, a pattern of 'hot corner room' complaints may indicate a duct leak that's easy to seal during the next HVAC PM visit.",
      support_agent: "When a tenant complains about uneven heating or cooling in specific rooms, ask: Is there a vent in that room? Is the vent open? If vents are fine but the room is still uncomfortable, the issue is often a leaky duct connection or inadequate duct sizing. This needs an HVAC tech, note the specific room affected and whether other rooms are comfortable, which helps the tech diagnose quickly.",
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
    intro: 'Lint buildup in the dryer vent is the leading cause of residential dryer fires. Clean it once a year, or more often if you notice clothes taking longer to dry.',
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
      customer: "If clothes take two cycles to dry, the vent is almost certainly partially blocked, not a failed heating element. Check the exterior vent cap too: the louvers sometimes get clogged with lint from the outside. Clean annually at minimum; every 6 months if you do many loads per week.",
      helper: "Easy $75–120 recurring service. Offer annual reminder subscriptions. Pair with a furnace filter change to increase average ticket.",
      consultant: "The duct reattachment step is routinely skipped in dryer vent guides, and it's where most problems start: a loose connection leaks lint directly into the wall cavity. A great guide would emphasize reconnecting with foil tape (not the white plastic accordion duct that many dryers come with) and explain why plastic ducts are a fire hazard.",
      business: 'Include in annual property safety checklist. Required by many insurance policies. Quick to delegate, low skill, high safety impact.',
      investor: "Lint buildup is the leading cause of residential dryer fires, it's both a safety and insurance issue. Most policies require annual vent cleaning and will deny fire claims if maintenance records are absent. Document every cleaning with a date and technician name. If the vent run is over 25 feet or has multiple bends, hire a professional, DIY kits can't fully clean complex runs.",
      manager: "Annual dryer vent cleaning should be on your property maintenance calendar without exception. Note the vent length and number of bends for each unit, longer runs need professional cleaning, not DIY kits. Keep a signed cleaning log per unit; it's your documentation if a dryer fire claim is disputed.",
      support_agent: "When a tenant reports their dryer takes two cycles to dry clothes, the vent is almost certainly clogged, not a broken dryer. Walk them through checking the exterior vent cap (often blocked from outside), and schedule a cleaning. If they also report a burning smell from the dryer, escalate as a fire hazard, disconnect the dryer and dispatch immediately.",
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
      'Measure the diameter of your pipes, most residential supply lines are 1/2" or 3/4".',
      'Purchase foam pipe insulation sleeves that match the pipe diameter.',
      'Starting from the water heater, slide the foam sleeves over the pipes. The sleeves are pre-slit, pinch them open and press onto the pipe.',
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
      customer: "Pre-slit foam sleeves are easy to install but the slit gap can open up over time. After pressing the sleeve onto the pipe, run insulation tape along the slit seam for a proper seal. In freezing climates, insulating pipes in an unheated crawl space matters more than the water heater room, prioritize those.",
      helper: 'Offer as an energy efficiency add-on during any plumbing or HVAC call, $80–150 for a water heater room. Clients see monthly savings immediately.',
      consultant: "Most pipe insulation guides stop at straight runs. A useful advanced guide would cover elbow and T-fitting cuts (the 45-degree miter technique), what to do where pipes penetrate walls, and the difference between foam sleeves, fiberglass wrap, and self-sealing wrap, and when each is the right choice.",
      business: 'Particularly valuable in older buildings with long pipe runs. Include in energy audit service packages. Materials cost is low, margin is high.',
      investor: "Pipe insulation in utility spaces is one of the cheapest energy efficiency investments in a rental property. In climates with cold winters, uninsulated pipes in crawl spaces and basements also risk freezing, a burst pipe from a freeze costs $5,000–20,000. A $50 insulation job preventing that is an obvious investment.",
      manager: "Include pipe insulation condition in your annual mechanical inspection, foam sleeves degrade and fall off over 10–15 years, especially in humid crawl spaces. If a unit is getting complaints about long wait times for hot water, check the pipe run from the water heater, uninsulated long runs are the most common cause before blaming the water heater.",
      support_agent: "Tenants don't usually call about pipe insulation directly. But if a tenant reports pipes making noise in cold weather or concern about frozen pipes, insulation in unheated spaces is the preventive measure. For actual frozen pipes, escalate immediately, thawing instructions are in the burst pipe guide. Don't attempt to walk tenants through thawing unless you're confident in their ability.",
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
    intro: 'A fist-sized hole can be made invisible with the right patch and two thin coats of compound, the key is feathering the edges, not building them up.',
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
      customer: "Patience between coats is the difference between visible and invisible. Joint compound must be bone dry (not just dry-looking) before the next coat, if it's cold or humid, give it 24 hours. Two thin feathered coats beat one thick coat every time.",
      helper: "List as 'Drywall Repair', steady demand from landlords and realtors. Typical $100–250 per visit. Multi-hole jobs offer your best margin.",
      consultant: "The part guides get wrong: feathering technique. Most readers apply compound too thick and try to sand it smooth later, which never works. A great guide would emphasize that the final surface comes from the knife, not the sandpaper, and show how to hold the knife at a low angle for a clean feathered edge.",
      business: 'Critical skill before any paint job. Train staff to feathering stage; subcontract texture-matching on complex finishes. Proficiency: intermediate.',
      investor: "Drywall holes are the most common wear item in a rental, door knobs through walls, moved TVs, picture hooks. At move-out, professional drywall repair runs $100–250 per visit for a few holes. Establish clear lease language about what counts as normal wear (small nail holes) vs. billable damage so you have documentation to charge back.",
      manager: "Keep joint compound, mesh tape, and a 6-inch putty knife in every maintenance kit. Patch small holes on the same visit as any other repair, it takes 10 minutes and prevents a separate work order. Budget a texture-matching specialist (or airless sprayer) for units with knockdown or orange peel texture that needs matching.",
      support_agent: "Tenants asking about drywall repair are usually asking at move-out. Your job is to set expectations: small nail holes (up to 1/4 inch) are typically normal wear and tear; fist-sized holes or multiple large holes are chargeable damage. Direct them to the guide for small repairs they can do themselves, or schedule a move-out inspection to document what exists before they patch anything themselves.",
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
    intro: 'Most door handles use standard sizing, the new set includes a template that makes this a clean swap with no measuring.',
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
      customer: "Most interior door handle sets use standard backset sizes (2-3/8\" or 2-3/4\", measure from the door edge to the center of the hole). Your new handle set will include a template; use it even if the existing holes 'look right.' Misalignment by 1/8\" means the latch won't catch.",
      helper: "Fast job that pairs well with a lock upgrade upsell. Typical $60–100 labor. Keep a variety of finishes in your truck, clients often want to match existing hardware.",
      consultant: "The 'trim to fit' latch adjustment step trips up many readers, most sets have an adjustable backset but the instructions bury it. A great guide would lead with the two-measurement check (door thickness and backset) so readers buy the right set before starting, not after.",
      business: 'Assign to any maintenance staff on day one. Keep a supply of standard interior sets in brushed nickel, the most common finish. Low-risk, high-frequency task.',
      investor: "Door handles wear out in high-traffic rentals every 5–8 years. At turnover, check every door handle: wobbling, hard to latch, or stiff locks are all worth addressing for under $30 in materials. Consistent hardware finish across a unit (all brushed nickel, all brass) reads as well-maintained and improves listing photos.",
      manager: "Create a hardware spec for each property (finish, backset, keying standard) so all replacements are consistent and keys are interchangeable where appropriate. Re-keying or replacing a lockset during every tenant turnover is cheap insurance, a master key system across a portfolio simplifies your own access while maintaining tenant privacy.",
      support_agent: "Handle calls split into: knob that wiggles loose (set screw is loose, walk them through tightening it), latch that doesn't catch (strike plate misaligned), or key that won't turn (lock cylinder issue, dispatch locksmith). Ask which symptom to triage correctly. Most wobble calls can be resolved by the tenant with a Phillips screwdriver in 2 minutes.",
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
      customer: "A stud finder gives false positives near electrical wires and HVAC pipes. Always confirm a stud with a nail or small screw before drilling your real holes. For drywall-only anchors, toggle bolts hold dramatically more weight than plastic expansion anchors, use them for anything heavier than a lamp.",
      helper: "High-demand in apartments and renovated homes. Typical $60–120 per shelf set. Batch multiple shelf installs in one visit to maximize earnings per trip.",
      consultant: "Most floating shelf guides assume the reader has studs exactly where they need them. The harder real-world question is what to do when no stud falls in the right spot. A great guide would walk through the alternatives: horizontal ledger board, French cleat, and toggle bolt spacing, with load estimates for each.",
      business: 'Great onboarding task. Teaches stud finding, leveling, and anchor selection, fundamental handyperson skills. Low risk if done correctly.',
      investor: "Floating shelves are a tenant-requested amenity in modern units, but they also create wall damage (holes, anchor divots) when tenants remove them. Consider specifying in your lease whether tenants may install shelves and under what conditions. For furnished or staged units, include built-in shelving to prevent the damage cycle entirely.",
      manager: "When authorizing shelf installs for tenants, require studs or proper toggle bolts rated to hold at least 3× the intended load. Drywall-only anchors fail and damage walls. Create a simple 'shelf installation approval form' that documents what's being installed and where, this is your evidence if walls are damaged at move-out.",
      support_agent: "Shelf-related calls are usually: 'The shelf fell out of the wall.' Ask: Were they anchored into studs or drywall anchors? How heavy was the load? If studs, the screw probably pulled out (wrong screw length), dispatch for repair. If drywall anchors, the anchors were likely under-rated. Either way, document the damage and whether any property was broken so the incident is on record.",
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
    intro: 'Most floor squeaks happen where the subfloor has separated from a joist. A few well-placed screws from below, or a squeak-specific kit from above, silences them permanently.',
    steps: [
      'Walk the floor to identify the exact squeak location. Mark it with tape.',
      'If you have basement or crawl access below: have a helper stand on the spot while you push up from below to feel the flex. Drive a short screw up through the subfloor into the joist, don\'t penetrate the finished floor.',
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
      customer: "Not all squeaks are subfloor separation, some are joist hangers rubbing against the joist, or nail shafts loosening in the subfloor. Before you start driving screws, confirm the flex: have someone stand on the squeaky spot while you watch from below (if you have access). No flex = the problem is at the joist, not the subfloor.",
      helper: "Niche skill with low competition. Typical $80–150 per room. Clients are often frustrated after failed DIY attempts, you become the hero.",
      consultant: "Floor squeaks have three distinct causes, subfloor separation, joist movement, and finish floor rubbing, and the repair for each is different. Most guides only cover the subfloor case. A guide that opens with a diagnostic decision tree (access from below? hardwood or carpet? subfloor flex test?) would be genuinely distinct.",
      business: 'Pre-move-out service that prevents tenant complaints and deposit disputes. Train maintenance staff on the squeeeeek kit method, safest approach.',
      investor: "A squeaky floor bothers tenants disproportionately, it's a quality signal they notice every day. If a unit's floors squeak badly, fixing it before listing significantly improves tenant satisfaction during tours. From below (with crawl space or basement access) it's a 30-minute fix; from above, it takes longer but is still far cheaper than re-flooring.",
      manager: "Squeaky floors are often reported as a recurring maintenance request. Before dispatching for the third time, check whether the repair was done correctly or if there's an underlying joist or moisture problem. A floor that re-squeaks within 6 months after a repair may have a subfloor separation issue that's larger than a screw fix can solve.",
      support_agent: "When a tenant reports squeaky floors, ask: How long has it been happening? Is it in one spot or widespread? Did it start after a wet event? A single spot of recent onset is a simple repair. Widespread squeaking that developed over time may indicate subfloor moisture damage, flag for inspection rather than a simple squeak repair.",
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
      customer: "Measure your spline channel width before buying spline, it comes in 0.140\", 0.160\", and 0.175\" diameters and the wrong size either falls out or splits the frame. The convex (rounded) side of the spline roller goes in first; the concave side tucks and finishes. Keep mesh taut but don't stretch it or it will pull when you press the last edge.",
      helper: 'Batch screen repairs in spring, advertise a screen repair day and do a whole neighborhood in one trip. Typical $30–60 per screen installed.',
      consultant: "Screen repair guides never cover what to do when the aluminum frame is bent, which is the real reason screens get damaged. A complete guide would include how to straighten a minor frame bend with a rubber mallet and whether it's worth it vs. buying a replacement frame kit. That decision tree is what readers actually need.",
      business: 'Include in annual spring property prep. Keep mesh rolls and assorted spline sizes in your supply kit. Great task for entry-level staff.',
      investor: "Torn window screens are a move-out deduction in most leases. A re-screening kit costs $15 and 30 minutes, much cheaper than sending a technician. For properties in bug-prone climates (Florida, Gulf Coast), screen condition directly affects tenant satisfaction and lease renewal likelihood.",
      manager: "Add screen condition to your annual move-in and move-out checklist by window and room. A screen that's torn at the frame corner is typically repairable; one with a bent or twisted frame needs a full replacement screen. Keep a stock of the most common screen mesh sizes and spline diameters for your unit windows.",
      support_agent: "Torn or missing screens are a tenant quality-of-life issue, not a safety emergency. For tears, ask the size: a small tear can be patched with screen repair tape (a DIY option); a large tear or bent frame is a scheduled repair, not urgent unless insects are entering the unit. Prioritize screen repairs in summer months in areas with heavy insect activity.",
    },
  },
  {
    id: 'install-baseboards',
    title: 'Install Baseboard Trim',
    category: 'carpentry',
    difficulty: 'Medium',
    minutes: 120,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #faf5ff, #ede9fe)',
    intro: 'Baseboards hide the gap between flooring and drywall and give a room a finished look. Good results come from accurate miter cuts at corners and tight caulk at the top edge, not from luck.',
    steps: [
      'Measure each wall section and add 10% for waste. Mark stud locations with a stud finder, you need to nail into studs.',
      'Cut outside corners at 45 degrees with a miter saw. For inside corners, cope the second piece (cut the profile with a coping saw) rather than mitering both, cope joints stay tight when wood expands.',
      'Dry-fit all pieces before nailing. Trim and adjust until joints close cleanly.',
      'Nail each piece into studs using a finish nailer or hand-nail with 2" finish nails. Keep nails 6" from ends to prevent splitting.',
      'Fill nail holes with wood filler, let dry, sand flush. Caulk the top edge against the wall. Prime and paint the trim.',
    ],
    skills: ['Miter cuts', 'Coping joints', 'Finish nailing', 'Caulking'],
    tools: [
      { name: 'Miter saw', rent: '/tool-rentals?category=carpentry', buy: null },
      { name: 'Finish nailer + compressor', rent: '/tool-rentals?category=carpentry', buy: null },
      { name: 'Coping saw', rent: null, buy: amz('coping saw for trim work') },
      { name: 'Stud finder', rent: null, buy: amz('stud finder wall scanner') },
    ],
    hireHref: '/post-job?category=carpentry',
    toolsHref: '/tool-rentals?category=carpentry',
    xp: 25,
    tips: {
      customer: "The biggest beginner mistake is mitering both inside corners, mitered inside corners open up as wood moves seasonally. Cope the second piece instead: trace the profile with a pencil, cut with a coping saw, and the joint stays tight year-round. It looks harder than it is and makes a huge difference in quality.",
      helper: "Baseboard installs are a high-demand finishing job, typical $3–5 per linear foot labor including material. A full room (40 lf) is $120–200. Bundle with door casing and window trim for full-room finishing packages.",
      consultant: "Most baseboard guides treat all corners as 45-degree miters. A great professional guide would cover the full decision tree: outside corners get miters, inside corners get coped, returns at door openings need mitered returns back to the wall. It would also cover how to handle out-of-square corners with a digital angle finder and how to scribe to uneven floors.",
      business: 'Fast job with high visual impact, clients immediately see the result. Train staff on cope cuts specifically; that skill is the differentiator between a rough finish and a professional one.',
      investor: 'Baseboard condition is a quick tell for overall finish quality in a unit. Missing, cracked, or painted-over baseboards signal deferred maintenance. Budget $1.50–3/lf installed to address during turns.',
      manager: 'Track baseboard scope in work orders by linear footage, not rooms, so bids are comparable across vendors. Include cope-cut requirement in your spec sheet; contractors who miter inside corners are cutting corners.',
      support_agent: 'If a customer says baseboards look "gappy" after install, ask when they were installed and what the humidity is, freshly installed mitered inside corners open up seasonally. Coped joints are the correct fix.',
    },
  },
  {
    id: 'repair-wood-fence',
    title: 'Replace a Damaged Wood Fence Board',
    category: 'carpentry',
    difficulty: 'Medium',
    minutes: 90,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fefce8, #fef9c3)',
    intro: 'Individual fence boards rot or break long before the posts give out. Swapping them one at a time is far cheaper than a full fence replacement and keeps the fence looking maintained.',
    steps: [
      'Identify all damaged boards. Check for rot by poking with a screwdriver, rot is soft and the tip sinks in easily.',
      'Remove damaged boards by prying off with a flat bar. Start at the nails and work the board loose to avoid damaging adjacent boards.',
      'Measure the opening: width, height, and thickness of the existing boards. Buy matching cedar or pressure-treated boards.',
      'Cut new boards to length. Pre-drill nail holes near the ends to prevent splitting. For cedar, leave a 1/8" gap between boards for expansion.',
      'Nail each board to the rails using 1-5/8" galvanized or stainless deck screws (not nails, screws hold longer outdoors). Apply wood preservative to the cut ends.',
    ],
    skills: ['Rot detection', 'Pry bar technique', 'Galvanized fasteners', 'Expansion gaps'],
    tools: [
      { name: 'Flat pry bar', rent: null, buy: amz('flat pry bar demolition bar') },
      { name: 'Drill/driver', rent: null, buy: amz('cordless drill driver') },
      { name: 'Circular saw or handsaw', rent: '/tool-rentals?category=carpentry', buy: null },
    ],
    hireHref: '/post-job?category=carpentry',
    toolsHref: '/tool-rentals?category=carpentry',
    xp: 25,
    tips: {
      customer: "Before buying boards, bring a sample board to the lumber yard. Cedar grades vary significantly, a clear cedar board next to a knotty cedar board will look mismatched in a year when they weather differently. Also check if your fence uses dog-ear or flat-top boards; they're not interchangeable without awkward patching.",
      helper: "Fence board repairs are easy recurring work, advertise 'fence health check' in spring. Typical $25–40 per board replaced including material. Spot-check the whole fence and quote all damaged boards at once.",
      consultant: "Fence repair guides rarely cover the post condition, which is almost always the deciding factor between a repair and a replacement. A genuinely useful guide would teach readers how to test post depth (less than 18 inches in ground is a problem), assess concrete footing integrity, and recognize when rot has moved from the board into the rail or post itself.",
      business: 'Excellent recurring property maintenance service. Create a fence inspection checklist to give clients after each visit, noting board condition, post wobble, and gate latch condition builds trust and generates future work orders.',
      investor: 'Fence condition affects curb appeal, liability, and tenant privacy. A failing fence is a deferred maintenance flag. Budget $25–50/board for selective board replacement versus $3,000–8,000 for a full fence replacement, selective repair wins on cash-on-cash.',
      manager: 'Walk the fence perimeter at least once a year and document by section with photos. Include fence condition in your property inspection template. Scheduling rot-prevention treatment every 3 years extends life significantly.',
      support_agent: 'When a customer calls about a fence board, ask whether the post is solid, a wobbly post means the scope is larger than a board swap. If they describe multiple failing boards in the same section, route to a contractor assessment rather than a self-repair.',
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
    intro: 'Good prep determines the result, patching, sanding, and taping matter more than the paint itself.',
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
      customer: "The W pattern isn't about paint art, it prevents lap marks. Roll in a 3-foot-wide W, then fill it in with vertical strokes while the paint is still wet. Work in sections and keep a wet edge. Hiring out a single room runs $200–400; for that price you can do a whole house yourself.",
      helper: "List as 'Interior Wall Painting.' Typical single room: $200–450 including materials. Prep is your differentiator, clients see the difference.",
      consultant: "The most common reader mistake: they apply one thick coat instead of two thin ones and wonder why the finish looks uneven. A great guide would explain the chemistry of why thin coats level better, and address the most common failure mode, painting over dirty or greasy walls without cleaning first.",
      business: 'Core crew skill. Train with a two-coat pass on a practice panel before the first real job. Invest in quality rollers, they show in the finish.',
      investor: 'Fresh paint is the single highest ROI cosmetic update at a turn, $200–500 for a room versus thousands for flooring or kitchen updates. Track paint age per unit; most walls need refreshing every 5–7 years or at tenant turnover.',
      manager: 'Standardize your property\'s paint colors (walls, trim, ceilings) by unit type and document them with the brand, color name, and sheen. This cuts reorder time dramatically at each turn and keeps units consistent.',
      support_agent: 'If a customer is frustrated with lap marks or uneven finish, ask about their roller nap and whether they kept a wet edge. A dry-into-wet application causes those marks. Coach them to work in smaller sections and finish quickly.',
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
      'Lightly sand glossy surfaces with 220-grit paper so primer adheres, wipe off dust with a tack cloth.',
      'Mask trim, outlets, and the ceiling edge with painter\'s tape.',
      'Roll primer onto the wall using a 3/8" nap roller, cutting in the edges first with a brush.',
      'Let primer dry fully per the can instructions (typically 1–2 hours). Inspect for any remaining stains, apply a second prime coat if needed.',
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
      customer: "PVA primer is for new, uncoated drywall. For water stains or smoke damage, use an oil-based or shellac-based stain-blocking primer, latex won't seal those. The test: after primer dries, wipe the stained area with a damp cloth. If the stain bleeds into the cloth, prime again.",
      helper: 'Always include primer in your painting quote, charging $50–80 separately is fair and prevents client complaints about bleed-through.',
      consultant: "Stain-blocking primer is the category most guides handle superficially. A great guide would explain the three tiers: PVA (new drywall), water-based stain block (light stains), and shellac/oil-based (severe water damage, smoke, bleed-through knots in wood), with photos showing what each stain type looks like after the wrong primer was used.",
      business: 'Make priming a non-negotiable step in your painting SOP. Callbacks for bleed-through cost more than the primer. Train staff to identify stain types.',
      investor: 'Water stains require stain-blocking primer, if you see yellow or brown rings on walls at acquisition, that means an active or past leak. Document these carefully; they may affect your inspection contingency and renegotiation.',
      manager: 'When scheduling turn painting, require your contractor to call out stain types before priming. A missed water stain bleed-through means a re-do, build into your punch-out process.',
      support_agent: 'If a customer reports paint bleed-through after two topcoats, ask if they primed first and what the stain was (water, smoke, or grease). Each requires a different primer tier. Guide them to shellac-based for anything that\'s already bled through once.',
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
      'Load a 1.5" angled brush sparingly and apply a thin first coat, trim paint sags easily.',
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
      customer: "Remove tape at about 70% dry, not wet, not fully cured. Pulling dry tape tears paint with it. Score along the tape edge with a utility knife before pulling if you forgot and it fully dried. Semi-gloss trim paint should always get two coats; one coat looks thin over old paint even if coverage looks full when wet.",
      helper: "Trim painting is the highest-skill part of a paint job, clients will pay $150–300 just for crisp trim work. Own this skill and charge accordingly.",
      consultant: "The tape-removal timing tip is the single most useful piece of information in a trim guide, and almost no guide explains why (the paint skin becomes brittle as it cures and peels when tape is pulled). A guide built around the 'why' behind each technique would be far more memorable than a step list.",
      business: "Don't rush trim. Assign your most meticulous staff. Quality here determines the client's overall impression of the whole paint job.",
      investor: 'Crisp trim is the first thing buyers and high-quality tenants notice. Yellowed or chipped trim signals neglect even when the walls are fresh. Budget for trim refresh at every 2–3 turns or at acquisition.',
      manager: 'Include trim in your unit inspection scorecard separately from walls. Trim peeling at tape edges usually means the painter rushed drying time, document this for vendor accountability.',
      support_agent: 'If a customer says the paint peeled off with the tape, ask if the tape was pulled while the paint was still wet or after it had dried hard. Both are wrong, the right moment is slightly tacky. If already dry, tell them to score the edge with a utility knife before pulling.',
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
    intro: 'Touch-ups that don\'t match are worse than the original damage. The challenge is sheen and color drift, here\'s how to make them invisible.',
    steps: [
      'Identify the original paint if possible, check closets, garages, or the utility room for leftover cans.',
      'If no leftover paint: take a paint chip (a quarter-size peeled section) to a paint store for spectrophotometer matching.',
      'Sand the damaged area lightly and apply primer if it\'s bare drywall.',
      'Apply the touch-up paint in thin coats, feathering 4–6 inches around the damage. Match the application texture, roller for rolled walls, brush strokes for brushed areas.',
      'Let dry and assess in natural light. A fresh small patch will look slightly different until it cures fully (1–2 weeks), inform the client.',
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
      customer: "Color matching at a hardware store costs $5 and takes 10 minutes, far better than guessing. Bring a chip (not a photo) for accurate spectrophotometer scanning. The biggest disappointment in touch-ups is sheen mismatch: if the wall is eggshell, match eggshell exactly, flat paint on an eggshell wall shows the patch even if the color is perfect.",
      helper: "Touch-up calls are quick high-margin jobs, $60–120 for 30 minutes. Always bring a mini-roller: rolled walls need roller texture, not brush texture.",
      consultant: "Most touch-up guides skip the two-week cure caveat: fresh paint looks slightly different from cured paint in the same color, which can alarm clients who expected a perfect match. A guide that sets that expectation upfront, and explains why, prevents the most common 'it doesn't match' callback.",
      business: 'Photograph paint cans in every unit and store chip samples at your office. Color matching at move-out saves tenant disputes and respray costs.',
      investor: 'Maintaining a chip library per unit is an underrated portfolio management practice. Mismatched touch-ups at turnover translate to visible deferred maintenance, which affects comps at sale.',
      manager: 'Create a simple spreadsheet: unit number, room, color name, brand, sheen, date last painted. This eliminates the "nobody knows what color this is" problem at every turn.',
      support_agent: 'When a customer says their touch-up looks patchy, ask if they used leftover paint or had it mixed. If matched, ask about sheen, a flat patch on an eggshell wall is always visible. They need the same sheen, not just the same color.',
    },
  },
  {
    id: 'apply-exterior-caulk',
    title: 'Caulk Exterior Gaps and Trim',
    category: 'painting',
    difficulty: 'Easy',
    minutes: 60,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
    intro: 'Exterior caulk seals gaps around windows, doors, and trim that let drafts, water, and insects in. Applied before painting, it gives a professional finish. Applied alone, it adds years to paint life by preventing moisture infiltration.',
    steps: [
      'Inspect all exterior joints: where trim meets siding, where window frames meet the wall, around door frames. Mark gaps wider than 1/4", those need backer rod before caulk.',
      'Remove old cracked caulk with a caulk removal tool or utility knife. Clean the surface with a stiff brush and let it dry completely.',
      'Load a paintable siliconized acrylic caulk into the gun. Cut the tip at a 45-degree angle, a smaller hole gives you more control.',
      'Apply in a steady bead, moving the gun at a consistent pace. Don\'t stop mid-joint. For wide gaps, use two thin passes rather than one thick one.',
      'Smooth with a wet finger or caulk smoothing tool within 30 seconds. Remove excess with a damp cloth. Let cure per label before painting (usually 2–4 hours).',
    ],
    skills: ['Caulk gun control', 'Surface prep', 'Smoothing technique', 'Backer rod use'],
    tools: [
      { name: 'Caulk gun', rent: null, buy: amz('caulk gun exterior smooth rod') },
      { name: 'Exterior paintable siliconized acrylic caulk', rent: null, buy: amz('exterior paintable caulk siliconized acrylic') },
      { name: 'Caulk removal tool', rent: null, buy: amz('caulk remover tool scraper') },
    ],
    hireHref: '/post-job?category=painting',
    toolsHref: '/tool-rentals?category=painting',
    xp: 10,
    tips: {
      customer: "Don't use silicone caulk on areas you plan to paint, silicone can't be painted and will peel the topcoat. Use paintable siliconized acrylic (a hybrid) for anything that will have paint over it. Pure silicone is only right for around tubs, sinks, and glass.",
      helper: "Exterior caulking is a high-leverage add-on during any paint job or exterior work call. Quote it separately: $80–150 for caulking a full house perimeter gives the client a clear preventive maintenance value. Do it during prep so it cures before the topcoat.",
      consultant: "Exterior caulk guides focus on application technique and rarely address the underlying structural cause of chronic gap-cracking: thermal movement. Wood trim can move 1/8\" seasonally. A guide covering how to choose a joint sealant by expected movement range, and when a gap is too large for caulk alone (needs flashing or backer rod first), would give homeowners real diagnostic value.",
      business: 'Caulking is low-skill, high-impact preventive work. Include as a standard line item in any exterior paint estimate. Build it into your spring weatherproofing service package.',
      investor: 'Failed exterior caulk is a moisture intrusion pathway, water behind siding causes sheathing rot, mold, and structural damage that costs orders of magnitude more than a $20 tube of caulk. Exterior re-caulking every 5–7 years is a defensible CapEx line.',
      manager: 'Add exterior caulk inspection to your annual property walk checklist, specifically at window and door perimeters, where trim meets siding, and around any penetrations. Photograph and flag gaps over 1/4" for immediate repair.',
      support_agent: 'If a customer reports drafts around a window, exterior caulk failure is the first thing to check before expensive replacement. Ask them to run a hand along the perimeter inside on a cold day, air movement pinpoints the gap. Route to exterior caulk repair, not window replacement, unless there are other signs of seal failure.',
    },
  },
  {
    id: 'paint-cabinets',
    title: 'Paint Kitchen Cabinets',
    category: 'painting',
    difficulty: 'Hard',
    minutes: 240,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fff7ed, #fffbf5)',
    intro: 'Cabinet painting transforms a kitchen at a fraction of replacement cost, but it requires careful prep, the right primer, and patience between coats. Shortcuts here are always visible.',
    steps: [
      'Remove all doors and drawer fronts. Label each with painter\'s tape and a marker so they go back in the right position.',
      'Clean all surfaces with TSP substitute or a degreaser. Grease and cooking film prevent adhesion, this step determines whether paint lasts 3 years or 10.',
      'Lightly sand all surfaces with 120-grit, then 180-grit. Sand with the grain. Wipe dust with a tack cloth.',
      'Apply a shellac-based or bonding primer, not latex. This is non-negotiable on laminate, melamine, or previously varnished cabinets. Let dry fully, sand lightly with 220-grit.',
      'Apply two coats of cabinet-specific alkyd or waterborne alkyd paint with a foam roller (boxes) and a small brush (profiles). Let each coat cure fully, 24 hours minimum, before rehanging doors.',
    ],
    skills: ['Surface degreasing', 'Bonding primer selection', 'Foam roller technique', 'Cure time discipline'],
    tools: [
      { name: 'TSP substitute cleaner', rent: null, buy: amz('tsp substitute heavy duty cleaner degreaser') },
      { name: 'Shellac-based primer (e.g. BIN)', rent: null, buy: amz('shellac based primer BIN Zinsser cabinet') },
      { name: 'Cabinet paint (waterborne alkyd)', rent: null, buy: amz('waterborne alkyd cabinet paint trim') },
      { name: 'Foam rollers (4") + trim brush set', rent: null, buy: amz('4 inch foam roller cabinet painting set') },
    ],
    hireHref: '/post-job?category=painting',
    toolsHref: '/tool-rentals?category=painting',
    xp: 50,
    tips: {
      customer: "The two most common DIY cabinet painting failures are skipping the degreaser (paint peels within months) and using regular latex wall paint instead of cabinet-specific paint (it stays tacky and marks). Spend an extra $20 on the right primer and cabinet paint, it's the difference between a result that lasts and one you'll redo in two years.",
      helper: "Cabinet repainting is one of the highest-demand interior jobs: typical $600–1,200 for a standard kitchen. The prep is 60% of the job, clients who've tried it themselves almost always want to hand it off. Emphasize your use of bonding primer and alkyd topcoat to justify the price.",
      consultant: "Cabinet painting fails when guides skip the primer chemistry. A genuinely useful advanced guide would explain why shellac-based primer outperforms oil-based on laminate (alcohol solvent penetrates differently), when you can get away with a bonding water-based primer, and how to handle cabinets that have been previously painted with a latex coat (sand harder, prime heavier). That decision tree is what separates a professional refinisher from a DIY attempt.",
      business: 'Schedule cabinet jobs with a minimum 3-day window: Day 1 prep and prime, Day 2 first coat boxes and fronts, Day 3 second coat and rehang. Never rush the cure between coats, callbacks for peeling cabinets are expensive and reputation-damaging.',
      investor: 'Cabinet painting is the highest ROI kitchen update at acquisition, a $600–1,200 professional paint job versus $4,000–12,000 for cabinet replacement. Assess condition at due diligence: solid boxes and hardware in good shape are all you need.',
      manager: 'For rental units, budget cabinet repainting every 10–12 years or on visible failure. Document the paint product used, repainting with mismatched coatings causes adhesion failures. Alkyd topcoats are the professional standard.',
      support_agent: 'Cabinet paint peeling is one of the most common callbacks for this job type. Before dispatching, ask: did they degrease first, and did they use a bonding primer? If both answers are no, the prep was skipped and the job needs to be stripped and redone, not just repainted over.',
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
    intro: 'An oil change is the highest-leverage maintenance task you own, wrong intervals cost engines. Getting comfortable doing it yourself saves money every 5,000 miles.',
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
      customer: "Never run the engine to 'warm up' oil before a change, 2 minutes is enough to improve flow; any longer and the drain plug burns your hand. The correct oil spec and filter part number are in your owner's manual, not on the dipstick. Overfilling by even a half quart causes foaming and can damage seals.",
      helper: "Mobile oil change is a growing niche, typical $50–90. Differentiate with a multi-point inspection report texted to the customer after each visit.",
      consultant: "The jack and stand setup is the step with the highest injury risk, and most guides either skip it or write 'use jack stands' without explaining how to find the lift points on different vehicle types. A truly useful guide would include a photo of the pinch weld location and explain why you never use a floor jack as a stand.",
      business: 'Standardize on one oil spec per vehicle type to simplify procurement. Train dedicated staff. At fleet scale, this pays for itself within weeks.',
      investor: 'Fleet maintenance logs, including oil change intervals, directly affect vehicle resale value and insurance defensibility in accidents. Undocumented maintenance history is a liability, not a neutral.',
      manager: 'Maintain a simple vehicle log per unit in the fleet: date, mileage, oil spec used, filter part number. This protects you against warranty disputes and creates an audit trail for insurance.',
      support_agent: 'If a customer reports an oil warning light after a recent change, first ask if they checked the level with the dipstick. An overfill or underfill after a DIY change is the most common cause, have them recheck before dispatching a mechanic.',
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
    intro: 'Streaking wipers are a safety issue. Replacing them takes 10 minutes and no tools, just the right size for your car.',
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
      customer: "Driver and passenger blades are usually different lengths, check your vehicle's owner's manual or the lookup guide at an auto parts store. Most modern blades use a J-hook connector, but some vehicles use pin-arm, pinch-tab, or side-pin types. Installing the wrong connector style means the blade won't seat and will fly off at speed.",
      helper: 'Add-on service during any mobile auto visit, quick win that builds trust. Charge $20–35 including blades. Clients forget to do this themselves.',
      consultant: "Wiper blade sizing is the #1 point of confusion for this task, blade lengths aren't standardized by windshield size. A guide with a clear vehicle lookup instruction (not just 'check the owner's manual') and photos of all four common connector types would fill a real gap that YouTube videos don't address well.",
      business: 'Include in fleet vehicle inspection checklist. Pre-stock the right blade sizes for every vehicle you operate. Zero skill threshold task.',
      investor: 'For rental vehicle fleets, wiper blade condition is part of a defensible safety inspection record. Documented blade replacement intervals protect you in liability claims after any weather-related accident.',
      manager: 'Assign wiper checks to the driver at every fuel stop. Add to your monthly fleet inspection form, takes 10 seconds to check and 10 minutes to swap. Failure in winter creates both safety and liability exposure.',
      support_agent: 'If a customer reports poor visibility in rain even with new blades, ask if the windshield is clean, a wax or film layer causes smearing regardless of blade quality. Recommend a glass cleaner pass before assuming the blades are defective.',
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
    intro: 'Rotating tires every 5,000–7,500 miles evens out wear and extends their life by tens of thousands of miles. It requires jack stands and a torque wrench, but no special skills.',
    steps: [
      'Loosen all lug nuts on all four wheels while the car is still on the ground (break torque only, don\'t remove).',
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
      customer: "Breaking lug nut torque while the car is on the ground is critical, trying to loosen them with the wheel in the air just spins it. Cross-pattern tightening (not circular) seats the wheel evenly. A torque wrench isn't optional for safety, undertightened lug nuts can cause wheels to come off at speed.",
      helper: "Bundle tire rotation with an oil change for a $90–130 full-service package. Customers love a one-stop mobile service, it sets you apart from quick-lube shops.",
      consultant: "Tire rotation guides always mention 'check the pattern in your owner's manual' but never explain the patterns or when to use each. A great guide would show the three standard patterns, front-to-rear, X-cross, and forward-cross, with diagrams explaining which is correct for FWD, RWD, AWD, and directional tires.",
      business: 'Include in fleet PM schedule every 6 months. Extend vehicle tire life significantly, reducing operating costs. Requires torque wrench, never skip this.',
      investor: 'Tire wear patterns tell a mechanical story, inner-edge wear indicates alignment issues, center wear indicates chronic overinflation. Before buying a used vehicle, reading tire wear can surface hidden suspension problems before inspection.',
      manager: 'Schedule tire rotation concurrent with oil changes for fleet vehicles to minimize downtime. Log tire brand and installation date per vehicle, this data is essential for warranty claims and predicting replacement cycles.',
      support_agent: 'If a fleet driver reports vibration after a tire rotation, ask if lug nuts were torqued to spec with a torque wrench or just impact-gunned. Over-tightening can warp brake rotors; under-tightening can cause wheel separation. Either scenario needs a shop inspection before the vehicle goes back on the road.',
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
      'Look up the cabin air filter location for your specific vehicle, most are behind the glove box, but some are under the hood.',
      'For glove-box style: open the glove box, press the sides inward to release it, then lower it fully to expose the filter housing.',
      'Slide out the old filter, note the airflow direction arrow before removing it.',
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
      customer: "Your AC blowing weakly at the start of summer is often a clogged cabin filter, not a refrigerant issue. Before calling a mechanic, check the filter, dealerships charge $50+ in labor for a 10-minute owner task. Note the airflow direction arrow before removing the old filter or you'll install it backwards.",
      helper: 'Include with every oil change at $20–35 add-on. The profit margin is high and customers appreciate being informed, it builds trust for bigger jobs.',
      consultant: "Cabin air filter location varies enormously by vehicle, behind the glove box, under the dash, or under the hood. A guide that acknowledges this variance and shows all three access methods (with make/model examples) would be far more useful than the generic 'open the glove box' instruction that leaves half of readers confused.",
      business: 'Schedule replacement in fleet vehicles every 15,000 miles. Track in your PM log. Prevents AC complaints and protects in-cabin air quality for drivers.',
      investor: 'For any fleet or vehicle acquisition, a clogged cabin filter is a tell for deferred maintenance culture. A dirty filter after only 10K miles suggests the previous operator skipped all scheduled PM, a signal to look deeper.',
      manager: 'Add cabin filter to your annual fleet inspection checklist alongside HVAC system check. If drivers report weak AC, check this before dispatching to a shop, it saves the service call cost most of the time.',
      support_agent: 'When a driver or customer says the car AC is blowing weakly, ask when the cabin air filter was last changed before routing to an AC repair call. This is a free self-fix for the customer and avoids an unnecessary service dispatch.',
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
      customer: "Never open the radiator cap on a warm engine, pressurized coolant can cause severe burns. Always check the overflow reservoir instead. If brake fluid is consistently dropping between checks, you have a leak, don't just top it off. Low brake fluid is a safety emergency requiring a mechanic.",
      helper: 'Offer a monthly vehicle wellness check at $25–40, great recurring revenue for minimal time. Catching a low brake fluid can prevent a serious accident.',
      consultant: "Fluid check guides are written for a generic car that doesn't exist. A great guide would address what readers actually encounter: electric power steering (no reservoir), sealed transmissions (no dipstick), and coolant DEX-COOL vs green compatibility issues. Those three edge cases represent about 40% of modern vehicles.",
      business: 'Add to fleet vehicle weekly check protocol. Assign to any driver. Document readings in your fleet management log to catch slow leaks early.',
      investor: 'For vehicle acquisition due diligence, a consistently low coolant or brake fluid level with no documented repair is a major red flag. These indicate either an active leak or a seller who never checked fluids, both are problems that affect the vehicle\'s true value.',
      manager: 'Low brake fluid that keeps dropping is a leak, not a top-off situation. Enforce a policy that any fluid consistently below MIN goes to the shop the same day, not next week. A brake failure is a catastrophic liability event.',
      support_agent: 'If someone calls about a warning light and mentions the coolant reservoir is empty, advise them not to drive the vehicle until it\'s checked, overheating can destroy an engine in minutes. This is an immediate dispatch or tow situation, not a guide-them-through-it situation.',
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
    intro: 'Mulch suppresses weeds, retains moisture, and regulates soil temperature, 3 to 4 inches is the sweet spot.',
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
      customer: "A bag of mulch covers about 8 sq ft at 3-inch depth, calculate your bed area and buy a few extra bags. Mulching up to the trunk (the 'mulch volcano' look) traps moisture against the bark and causes rot and pests over years. Keep a 2–3 inch clear ring around any plant stem or trunk.",
      helper: "High-demand spring service. Price by cubic yard, typical $50–100/yard installed. Offer a 'garden refresh' package combining weeding, edging, and mulch.",
      consultant: "The 'mulch volcano' error is so common that addressing it directly at the start of a guide immediately positions it as expert-level content. A great guide would also explain the difference between hardwood vs softwood vs rubber mulch and which is appropriate for which bed type, that's information clients genuinely don't know.",
      business: 'Great introductory landscaping task. Low technical risk, visible outcome. Buy bulk mulch by the yard to maximize margin on larger properties.',
      investor: 'Curb appeal drives first impressions for buyers and tenants. Clean mulched beds signal active maintenance and can materially affect perceived value. Budget a spring mulch refresh as a standard annual operating cost for exterior properties.',
      manager: 'Schedule mulching as a fixed spring task across all managed properties. Order in bulk by cubic yard, bulk pricing is typically 40% cheaper than bags and a yard truck delivery takes one trip. Track mulch type per property for consistency.',
      support_agent: 'If a customer reports that mulch keeps washing away, ask about the bed slope and whether edging was installed. Flat beds with proper edging retain mulch; sloped beds without edging need a barrier or river rock instead. This is a routing question, landscape consultant, not self-repair.',
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
      'Build a 3–4" mulch ring extending to the drip line, keep mulch away from the trunk. Water deeply at planting and weekly for the first year.',
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
      customer: "Call 811 before you dig even for a small tree, utility line damage carries full liability. Dig the hole wide, not deep: the root ball needs sideways room more than downward room. Water deeply once a week for the first year; shallow daily watering grows shallow roots.",
      helper: "Tree planting is premium landscaping, typical $150–350 per tree including labor. Always add a first-year care instruction sheet. Clients remember this.",
      consultant: "Root flare depth is the single most important concept in tree planting and the most violated. A great guide would include a side-by-side photo of a correct and an over-deep planting and explain why the tree looks fine for years and then dies suddenly. That story is memorable and makes the guide shareable.",
      business: 'Requires staff who understand root flare depth. Document call-before-you-dig compliance with a photo. Build a 1-year watering plan into every tree service.',
      investor: 'Mature trees add measurable property value ($1,000–10,000+ depending on species and placement) but also carry liability if they fail. At acquisition, assess tree health and proximity to structures, removal is cheaper before closing than after a storm.',
      manager: 'Document tree species, planting date, and location in your property records. Include trees in your annual property inspection, check for deadwood, root heaving, or storm damage. An arborist assessment every 3–5 years is cost-effective preventive maintenance.',
      support_agent: 'If a customer asks why their newly planted tree looks wilted, the first question is watering frequency, not volume. Shallow daily watering is the most common new-tree mistake. Walk them through deep weekly watering at the drip line, not the trunk.',
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
      customer: "A pressure regulator is not optional, most home spigots run at 50–80 PSI, but drip emitters are designed for 20–30 PSI. Without a regulator, emitters pop off or drip unevenly. A $12 regulator protects the whole system. Start with emitters closest to the spigot and flush the open ends before installing the last fittings.",
      helper: "Irrigation installs are one of the most profitable small landscaping services, typical $200–500 for a garden bed system. Recurring maintenance adds value.",
      consultant: "Most drip irrigation guides show a simple star layout but don't address manifold design for multi-zone beds, which is the real question most readers have. A great guide would cover zone planning (trees on one zone, vegetables on another), timer programming for different plant types, and how to add a soil moisture sensor to make the system truly water-smart.",
      business: 'Reduces water costs for properties with gardens. Offer as an upgrade during spring cleanup. Train staff on emitter sizing, wrong flow rates kill plants.',
      investor: 'Drip irrigation is a strong amenity for rental properties with landscaping, it reduces tenant complaints about plant maintenance and cuts water bills. For properties in drought-prone areas, it can also be a meaningful differentiator for premium tenants.',
      manager: 'For multi-property portfolios, install smart timer-controlled drip systems that can be adjusted remotely. Seasonal adjustments (summer vs. winter run times) should be in your maintenance calendar rather than left to the landscaper to remember.',
      support_agent: 'If a customer reports that plants on their drip system are still dying, ask two things: are the emitters actually flowing (clog is common), and are they positioned at the root zone, not the trunk. Emitter clogs are fixed with a thin wire or pin; positioning is a user installation issue.',
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
      customer: "Use cedar or redwood, they resist rot without chemical treatment. Pressure-treated wood contains copper that can leach into soil and isn't recommended for edible gardens. The 4×8 standard size is important: wider than 4 feet means you can't reach the center from either side without stepping in.",
      helper: "Popular spring project, typical $250–500 per bed including lumber and soil. Offer a package with drip irrigation and first-season plant selection.",
      consultant: "The soil mix question is the most under-covered part of raised bed guides. Most just say '60/40 topsoil and compost' without explaining how to identify quality topsoil (not clay, not stones) or why native soil alone produces poor results. A guide that covers the Mel's Mix alternative and the no-dig cardboard layering method would appeal to gardeners beyond the beginner level.",
      business: 'Great team project for newer landscaping staff, clear outcome, visible result, low risk. Pre-cut lumber at a hardware store to speed up job time.',
      investor: 'Raised beds are a tenant amenity for single-family rentals that can command a small rent premium and attract longer-term tenants. They\'re low-maintenance compared to in-ground gardens and a distinct selling point in listings.',
      manager: 'For managed properties, use cedar and document installation. Cedar beds last 10–15 years with minimal maintenance. Include bed condition in your property inspection checklist, rotted boards are a tenant safety and aesthetic issue.',
      support_agent: 'When a customer says their raised bed soil compacted and drains poorly, ask what they filled it with, bulk topsoil alone compacts; it needs compost mixed in. Guide them to top-dress with compost annually and turn the top 3 inches each spring. This is a self-fix, not a service call.',
    },
  },
  {
    id: 'sharpen-mower-blade',
    title: 'Sharpen a Lawn Mower Blade',
    category: 'landscaping',
    difficulty: 'Easy',
    minutes: 30,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
    intro: 'A dull mower blade tears grass instead of cutting it, leaving a ragged brown edge that stresses the lawn. Sharpening once a season (or every 25 hours of use) keeps cuts clean and the lawn healthy.',
    steps: [
      'Disconnect the spark plug wire before working near the blade. Tilt the mower on its side with the carburetor facing up, if the carburetor faces down, oil enters the air filter.',
      'Use a wrench to remove the blade bolt (it\'s reverse-threaded on some models, check your manual). Mark the bottom face of the blade with chalk so you remount it the right way.',
      'Clamp the blade in a vise. Use a metal file or angle grinder to sharpen along the existing bevel angle (usually 30–45 degrees). Remove an equal amount from both ends to keep the blade balanced.',
      'Test balance: hang the blade on a nail through the center hole. If one end dips, remove a little more metal from that end. An unbalanced blade causes vibration that damages the engine bearings.',
      'Reinstall the blade, torque the bolt to spec (usually 35–50 ft-lbs for residential mowers). Reconnect the spark plug wire.',
    ],
    skills: ['Spark plug safety', 'Blade balancing', 'Bevel angle maintenance'],
    tools: [
      { name: 'Wrench set or socket set', rent: null, buy: amz('combination wrench set metric standard') },
      { name: 'Metal file or angle grinder', rent: null, buy: amz('metal file set flat bastard') },
      { name: 'Blade balancing tool', rent: null, buy: amz('lawn mower blade balancer cone') },
    ],
    hireHref: '/post-job?category=landscaping',
    toolsHref: '/tool-rentals?category=landscaping',
    xp: 10,
    tips: {
      customer: "The balance step is often skipped but matters a lot. Even 5 grams of imbalance at 3,000 RPM creates significant vibration, over a season, an unbalanced blade can damage the spindle bearings. A blade balancing cone costs $4 and takes two minutes. Worth it.",
      helper: "Blade sharpening is a quick add-on during any lawn maintenance visit, add $15–25 and a 10-minute stop at the start of the season. Many clients have never done it and notice the lawn improvement immediately.",
      consultant: "A great advanced guide would cover the difference between sharpening and reconditioning: a blade with nicks deeper than 1/4\" or with a bent tip should be replaced, not sharpened. It would also cover the different bevel angles across commercial vs. residential blades and why matching the OEM angle matters for cut quality and blade life.",
      business: 'Include blade sharpening in your pre-season equipment checklist. Track sharpening dates per mower and replace blades when they\'ve been sharpened more than 4–5 times. A sharp blade reduces fuel consumption noticeably.',
      investor: 'Lawn equipment condition signals maintenance culture. For commercial properties with on-site landscaping, inspect equipment sharpening records during due diligence, unsharpened blades indicate chronic neglect that extends to the rest of the property.',
      manager: 'Add blade sharpening to your seasonal equipment maintenance checklist, pre-season in spring, mid-season check in July. A dull blade is also a safety issue: it can grab and throw debris unpredictably. Replace blades that have visible nicks or bends.',
      support_agent: 'If a customer complains their lawn looks rough and brown-tipped after mowing, the first question is when the blade was last sharpened. A tearing cut vs. a clean cut is immediately visible on grass tips. Route to blade sharpening or replacement before any other diagnosis.',
    },
  },
  {
    id: 'lay-sod',
    title: 'Lay Sod for Instant Lawn',
    category: 'landscaping',
    difficulty: 'Medium',
    minutes: 180,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
    intro: 'Sod gives you an instant lawn rather than waiting for seed to germinate. The work is physical, but the technique is straightforward: prepare soil properly, lay tightly, water immediately and consistently for two weeks.',
    steps: [
      'Measure the area in square feet. Order 5–10% more sod than your measurement to account for cuts around edges.',
      'Till or loosen the soil 4–6 inches deep. Remove rocks, old roots, and debris. Grade the area so it slopes slightly away from the house (1" per 10 feet).',
      'Apply starter fertilizer per package directions and rake it in. Lightly water the soil before laying, it should be moist, not muddy.',
      'Lay the first row along a straight edge (a driveway or walkway). Stagger joints like brick, start every other row with a half piece. Butt pieces tightly together with no gaps and no overlaps.',
      'Water the sod immediately after laying. For the first two weeks, keep the sod consistently moist, twice daily in hot weather. After roots establish (lift a corner to check for resistance), reduce to deep infrequent watering.',
    ],
    skills: ['Soil grading', 'Staggered joint layout', 'Sod establishment watering'],
    tools: [
      { name: 'Sod cutter or sharp spade', rent: '/tool-rentals?category=landscaping', buy: null },
      { name: 'Lawn roller', rent: '/tool-rentals?category=landscaping', buy: null },
      { name: 'Landscape rake', rent: null, buy: amz('landscape rake soil leveling') },
    ],
    hireHref: '/post-job?category=landscaping',
    toolsHref: '/tool-rentals?category=landscaping',
    xp: 25,
    tips: {
      customer: "Sod dries out fast after delivery, especially in hot weather. Plan to lay it the same day it arrives or the next morning at the latest. If you must hold it overnight, unroll it on a flat surface in the shade and water the rolls. Don't leave it stacked and rolled in direct sun.",
      helper: "Sod installation is physically demanding but high-margin: typical $1.00–1.50 per sq ft labor-only, $0.60–1.00/sq ft for sod itself. A 1,000 sq ft job runs $1,600–2,500 all-in. Subcontract soil prep (tilling) to focus your time on the sod itself.",
      consultant: "Sod guides almost always ignore grass type selection, which is the most important decision. Bermuda vs. Zoysia vs. Fescue vs. St. Augustine have dramatically different sun, water, and maintenance requirements, and the wrong grass for the climate or shading will fail within one season. A great guide leads with a grass-type selector by region and sun exposure before touching prep and installation.",
      business: 'Sod jobs require advance scheduling with suppliers, order 48 hours ahead minimum and confirm day-of delivery time. Assign your most reliable crew (timing and quality both matter). Log grass type and install date at each property to inform future maintenance recommendations.',
      investor: 'Fresh sod dramatically improves curb appeal and perceived value at listing or lease-up. For vacant properties, budget sod installation in your holding cost estimates if the lawn is bare or patchy, it\'s among the highest ROI exterior improvements.',
      manager: 'After sod installation, schedule a 14-day follow-up to check establishment. Failure in the first two weeks is almost always a watering issue, not a sod quality issue. Include first-two-weeks watering requirements in your vendor scope of work.',
      support_agent: 'If a customer says their sod is dying after installation, the first triage question is: are they watering twice daily in the first two weeks? Sod death in the first week is almost exclusively a watering frequency failure. Walk them through the twice-daily soak routine before considering any other cause.',
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
      'Clean the joint thoroughly with rubbing alcohol. Let it dry completely, even overnight.',
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
      customer: "The pre-fill-tub step seems odd but it's critical: the gap between the tub and tile wall is smallest when the tub is empty, then flexes wider when you stand in it. Applying caulk on an empty tub means it'll crack on first use. Fill tub, caulk, drain only after it cures.",
      helper: "Book caulking calls in batches, two bathrooms per trip is efficient. Typical $60–100 per tub. Bring three caulk colors to match any grout.",
      consultant: "Silicone vs latex caulk in a wet area is a question most guides answer superficially ('use silicone'). A great guide would explain why: latex eventually allows moisture vapor through, but pure silicone can't be painted. The real answer for most tubs is siliconized latex, a hybrid that's paintable and more water-resistant than plain latex. That nuance is genuinely useful.",
      business: 'Include in annual property inspection. One failed caulk bead can cause a mold remediation claim. Train staff on the pre-fill tub technique.',
      investor: 'Failed tub caulk is a moisture intrusion pathway into the subfloor and walls. At acquisition inspection, run a finger along the tub perimeter and check for soft spots near the floor, mold behind a failed caulk bead can mean a $3,000–8,000 remediation job.',
      manager: 'Add tub and shower caulk inspection to your annual unit inspection checklist. A $10 re-caulk job prevented is a $3,000 water damage claim avoided. Flag any caulk that\'s cracked, discolored, or gapping for same-trip repair.',
      support_agent: 'If a tenant reports a musty smell near the bathroom or soft floor near the tub, route this to an in-person inspection immediately, do not guide them to recaulk. Existing moisture damage needs assessment before the caulk is resealed on top of it.',
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
      'Check that the downspout flows freely, feed the hose into the top. If clogged, use a plumber\'s snake or a downspout cleaning wand.',
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
      customer: "Check the gutter pitch while you're up there, water should slope toward the downspout at 1/4\" per 10 feet. Pooling water in the gutter (sagging section) causes rust, leaks, and eventually fascia rot. Re-fastening a sagging hanger takes 5 minutes and prevents a $500 fascia repair.",
      helper: "Offer fall and spring gutter cleaning packages, $100–200 per visit depending on story height. Pair with downspout extensions for a quick upsell.",
      consultant: "Gutter cleaning guides universally skip the inspection component, and that's where the real value is. A guide that taught readers what to look for while cleaning (slope issues, rust spots, separated miters, downspout clogs vs. separated outlets) would convert a commodity cleaning chore into an actionable home health check.",
      business: 'Schedule twice a year: fall after leaves drop, and early spring. Critical for multi-unit properties. Track gutter condition and flag any repairs needed.',
      investor: 'Clogged gutters are one of the most commonly overlooked maintenance items at acquisition inspections, and they drive fascia rot and foundation water intrusion. Walk the roofline during due diligence, overflowing gutters are a visible signal of deferred maintenance across the whole property.',
      manager: 'Add gutter cleaning to your spring and fall scheduled maintenance calendar for every property. Track condition per section, document any sagging, rust, or separated miters. Gutter repair is far cheaper than fascia replacement.',
      support_agent: 'If a tenant calls about water dripping from the soffit or along the wall during rain, ask whether the gutters have been recently cleaned. Overflowing gutters are the most common cause of water intrusion along exterior walls and are a fast self-resolve or scheduled maintenance call before any structural diagnosis.',
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
      'Close the door and hold a lit stick of incense along all edges, smoke wavering indicates air infiltration.',
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
      customer: "Foam tape compresses over time and loses its seal, if your weatherstripping is more than 5 years old and you can see daylight around the door frame, it's time to replace it. V-strip (spring bronze) lasts 15–20 years and is more durable than foam for the door sides and top.",
      helper: "Include weatherstripping in a seasonal home-prep service. Typical $60–100 per door, fast and visible energy savings win 5-star reviews.",
      consultant: "Most weatherstripping guides treat all products as interchangeable. A great guide would explain the material hierarchy: foam tape (cheapest, shortest life), V-strip/spring bronze (self-closing, best for sides), compression strip (best for door stop), and silicone sweep (best for threshold). That framework helps readers buy right the first time.",
      business: 'Inspect all exterior doors during seasonal property walkthroughs. Drafty doors raise tenant utility bills and generate complaints. Low-cost fix.',
      investor: 'Weatherstripping condition is a proxy for overall building envelope integrity. Failed weatherstripping means higher utility bills for tenants, in markets where utilities are tenant-paid, this creates tenant dissatisfaction and turnover. Budget $20–30 per door to address at acquisition.',
      manager: 'Add exterior door weatherstrip condition to your annual inspection checklist. A simple test: close the door on a dollar bill, if you can pull it out easily, the seal is failing. Flag for repair on the same visit.',
      support_agent: 'If a tenant reports drafts or high heating bills, ask them to close their exterior doors on a sheet of paper and try to pull it out, this is a fast field triage for weatherstrip failure. A confirmed gap routes to a weatherstripping service call, not an HVAC call.',
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
    intro: 'Power washing removes years of tire marks, oil stains, mildew, and grime in one pass. The key is using the right nozzle, the wrong one etches concrete.',
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
      customer: "Holding the nozzle too close or using a 0-degree (red) nozzle on concrete etches the surface permanently. Start at 18 inches and move closer only if needed. Pre-treat oil stains with degreaser for 5–10 minutes before washing or the high pressure just pushes the oil deeper into the concrete pores.",
      helper: "Power washing has low skill barrier and high demand, typical $100–250 for a driveway. Rent a 3,500 PSI commercial washer to cut job time in half.",
      consultant: "Most pressure washing guides skip the surface material nuances. A great guide would address when NOT to pressure wash, painted brick (removes paint), old mortar joints (can dislodge), stamped concrete (can strip sealer), and suggest soft-washing as an alternative for delicate surfaces. That knowledge is what separates a professional from someone with a rented machine.",
      business: 'Schedule before property photos and before spring/summer move-in season. Track surface condition in property records, some surfaces need softer settings.',
      investor: 'A freshly power-washed driveway and exterior immediately signals maintained property and improves listing photos significantly. It\'s one of the highest-impact, lowest-cost cosmetic improvements before a listing or lease-up, $150–250 for a driveway versus thousands for hardscape replacement.',
      manager: 'Schedule power washing on exterior surfaces every 1–2 years as a standard maintenance item. Document surface type (concrete, pavers, wood deck) per property so crews use the correct PSI and nozzle. Wrong settings on pavers or painted surfaces cause permanent damage.',
      support_agent: 'If a customer reports etched or pitted concrete after power washing, the cause is almost always a 0-degree nozzle or holding the nozzle too close. This is not reversible, damaged concrete requires grinding or overlay to correct. Use this as a teaching moment: always start at 18 inches with a 25-degree nozzle and work closer only if needed.',
    },
  },
  {
    id: 're-grout-tile',
    title: 'Remove and Re-Grout Tile',
    category: 'maintenance',
    difficulty: 'Medium',
    minutes: 120,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f8fafc, #e2e8f0)',
    intro: 'Cracked or stained grout lets water into the substrate, eventually damaging the wall or subfloor. Removing old grout and applying fresh grout is straightforward with an oscillating tool and the right grout type.',
    steps: [
      'Use a grout saw or oscillating multi-tool with a grout removal blade to cut out the old grout. Cut to at least half the grout joint depth. Vacuum out all debris.',
      'Clean the joint area with a stiff brush and a tile cleaner. Let dry completely, new grout will not bond to wet or dirty joints.',
      'Mix the grout to a peanut butter consistency (for sanded grout) or a thick paste (unsanded for joints under 1/8"). Let it slake for 10 minutes before using.',
      'Apply grout with a rubber float, pressing diagonally across the joints to pack them fully. Remove excess from the tile surface immediately with the float edge.',
      'After 15–20 minutes, clean the haze with a damp sponge in circular motions, rinsing frequently. After 24 hours, apply grout sealer to protect from staining.',
    ],
    skills: ['Oscillating tool use', 'Grout mixing', 'Float technique', 'Sponge haze removal'],
    tools: [
      { name: 'Oscillating multi-tool + grout blade', rent: '/tool-rentals?category=maintenance', buy: null },
      { name: 'Rubber grout float', rent: null, buy: amz('rubber grout float tile') },
      { name: 'Sanded grout (for joints 1/8"+ wide)', rent: null, buy: amz('sanded tile grout unsanded grout') },
      { name: 'Grout sealer', rent: null, buy: amz('tile grout sealer penetrating') },
    ],
    hireHref: '/post-job',
    toolsHref: '/tool-rentals?category=maintenance',
    xp: 25,
    tips: {
      customer: "The most important decision is sanded vs. unsanded grout. Sanded goes in joints 1/8\" and wider; unsanded for narrow joints (polished stone, glass tile). Using sanded grout in a narrow joint scratches the tile surface permanently. Measure your joint width with a ruler before buying, don't guess.",
      helper: "Re-grouting is a high-demand bathroom refresh job: $200–500 for a shower surround. Bundle with recaulking the floor-to-wall joint (use caulk, not grout, at all inside corners, grout cracks there). Clients who see the transformation often ask about resetting loose tiles at the same time.",
      consultant: "The failure mode everyone misses is incomplete old grout removal. Guides say 'remove half the joint depth' but rarely explain why, new grout bonds mechanically to the existing substrate, not to old grout. Any old grout left on the joint walls is a delamination waiting to happen. A genuinely useful guide would also address how to identify whether a popped tile means the substrate is wet underneath, which changes the repair scope entirely.",
      business: 'Re-grouting bathrooms is a strong recurring revenue service, typical shower grout lasts 5–10 years. Offer a bathroom grout inspection as a paid add-on during any plumbing or maintenance call and give clients a written condition report.',
      investor: 'Failed grout in wet areas is a moisture intrusion pathway into the substrate. At acquisition, press on tiles around showers and tubs, soft spots mean water has already penetrated. Factor tile and substrate remediation into your renovation budget if grout is visibly cracked or missing.',
      manager: 'Include shower and floor tile grout condition in your unit inspection checklist. Popped or cracked tiles are an escalation, they may indicate substrate damage that requires more than a re-grout. Document and photograph tile condition at every inspection.',
      support_agent: 'If a tenant reports grout crumbling or tiles popping loose in a bathroom, don\'t route this as a simple re-grout. Ask whether the tiles move when pressed and whether there\'s a soft spot in the wall or floor. Movement means substrate damage, this is a maintenance dispatch with scope assessment, not a guide-them-through-it situation.',
    },
  },
  {
    id: 'fix-sticking-door',
    title: 'Fix a Sticking or Binding Door',
    category: 'maintenance',
    difficulty: 'Easy',
    minutes: 30,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fef9c3, #fef3c7)',
    intro: 'A door that sticks or rubs is usually caused by swelling wood, a shifted frame, or loose hinges. Identifying which one is causing the problem takes 3 minutes and determines whether the fix is a screwdriver or a plane.',
    steps: [
      'Watch where the door binds: does it rub at the top corner (opposite hinge side), along the latch edge, or at the bottom? The location tells you the cause.',
      'Check the hinges first, tighten all screws. If a screw spins freely, the hole is stripped. Fill with a wooden toothpick and wood glue, let dry, then re-drive the screw.',
      'Close the door and look for gaps: a gap at the top-hinge corner with rubbing at the bottom-latch corner means the top hinge needs shimming. Cardboard under the hinge leaf shifts the door.',
      'If the door rubs along its full latch edge, it has swollen with humidity. Mark the binding point with a pencil on a closed door. Open the door and use a hand plane or belt sander to remove material from the marked area.',
      'Prime and paint any bare wood immediately after planing, raw wood absorbs moisture and the problem returns.',
    ],
    skills: ['Hinge diagnosis', 'Screw hole repair', 'Planing technique', 'Shimming'],
    tools: [
      { name: 'Screwdrivers', rent: null, buy: amz('screwdriver set flathead phillips') },
      { name: 'Hand plane or belt sander', rent: '/tool-rentals?category=carpentry', buy: null },
      { name: 'Toothpicks + wood glue (for stripped holes)', rent: null, buy: amz('wood glue carpenter wood filler') },
    ],
    hireHref: '/post-job',
    toolsHref: '/tool-rentals?category=carpentry',
    xp: 10,
    tips: {
      customer: "Check hinge screws before anything else, a single loose hinge screw is the cause of more sticking doors than anything else. Tightening three screws takes 2 minutes and solves about 40% of sticky door problems. Only move to planing if the hinges are tight and the door is still binding.",
      helper: "Sticking door calls are quick, high-ROI service calls, typical $60–100 for 20–30 minutes. Combine with a weather-stripping inspection and a door sweep check for a full 'door health' service. Spring is peak season as wood that swelled over winter starts to bind.",
      consultant: "Most sticky door guides attribute the problem to humidity swelling, which is one cause. A comprehensive guide would cover the full diagnostic tree: foundation settlement (gap pattern is distinctive, parallelogram not rectangle), hinge offset from wear (bottom corner sag), and frame racking from a structural load shift (requires more than a plane). Knowing which cause you're dealing with is the whole job.",
      business: 'Keep a few longer hinge screws (3\" #8) in your toolkit, often a sticking door from a shifted frame is fixed in 5 minutes by replacing the top hinge with a longer screw that bites into the stud. It\'s one of the fastest repairs in residential maintenance.',
      investor: 'A sticking door on an interior assessment walk can signal foundation settlement, if multiple doors in the same area of the house are binding, that\'s not humidity, it\'s structure. Note door patterns in your inspection report and have a structural engineer evaluate if there are multiple affected doors.',
      manager: 'Add door operation to your unit inspection checklist, all interior and exterior doors should latch and swing freely. A sticking door is easy to miss until the tenant reports it; catching it at inspection prevents a service call on move-in day.',
      support_agent: 'When a tenant says a door won\'t latch, first ask if it\'s a new or recent problem versus one that\'s been ongoing. A suddenly sticking door in winter usually means humidity swelling, this is seasonal and self-resolving. If it\'s been stuck since move-in, route for a maintenance visit with hinge inspection before assuming it needs planing.',
    },
  },

  // ── Investment & Management ───────────────────────────────────────────────
  {
    id: 'inspect-investment-property',
    title: 'How to Inspect an Investment Property',
    category: 'management',
    difficulty: 'Medium',
    minutes: 90,
    featured: true,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
    intro: 'A thorough walkthrough before you close identifies deferred maintenance, hidden defects, and real repair costs, the numbers that determine whether a deal works. Here\'s how to walk a property like a professional.',
    steps: [
      'Bring a checklist, a flashlight, a screwdriver, and a phone for photos. Start outside: roof condition, gutters, grading (slope away from foundation?), caulk at windows and doors.',
      'Check the foundation for cracks. Hairline vertical cracks are common; horizontal cracks or stair-step cracks in brick indicate structural movement, flag for an engineer.',
      'Inside: test every outlet (bring a plug-in tester), every faucet (run hot and cold, check under the sink for leak evidence), every door and window (should operate and latch freely).',
      'In kitchens and baths: look under sinks for water stains, soft cabinet floors, and drain odor. Run the dishwasher if possible. Check grout and caulk in showers.',
      'In the mechanical room: note HVAC age, water heater age, and electrical panel brand. Zinsco and Federal Pacific panels are known fire hazards, flag for replacement in your budget.',
      'Write down every issue with a photo. Group findings into: immediate safety issues, code violations, cosmetic items, and deferred maintenance. Translate to a cost estimate before finalizing your offer.',
    ],
    skills: ['Structural assessment', 'Mechanical system age estimation', 'Repair cost categorization'],
    tools: [
      { name: 'Outlet plug tester', rent: null, buy: amz('outlet receptacle tester circuit') },
      { name: 'Flashlight', rent: null, buy: amz('led flashlight bright inspection') },
      { name: 'Moisture meter', rent: null, buy: amz('moisture meter wood drywall') },
    ],
    hireHref: '/post-job?category=inspection',
    toolsHref: '/tool-rentals',
    xp: 25,
    tips: {
      customer: 'Even if you\'re not buying an investment property, these same checks work for any home purchase. A $400 professional inspection is worth it, but knowing what to look for yourself means you can walk away from bad deals before paying for an inspection.',
      helper: 'Property inspection is a specialized skill you can offer as a paid service, particularly to out-of-state investors. A thorough inspection report with photos and cost estimates is worth $200–500 and positions you as a trusted local resource.',
      consultant: 'A great companion guide would cover the difference between a general home inspection and a pre-purchase investor due diligence walkthrough: the investor needs cost estimates and prioritization, not just a checklist of what\'s present. The framing is different, and so is what you\'re looking for.',
      business: 'Train your property management team to conduct standardized unit inspections using a documented checklist. Consistent documentation protects you legally and creates a paper trail for security deposit disputes.',
      investor: 'Develop your own inspection checklist tuned to your market and property type. A 1970s duplex and a 2005 condo have entirely different failure modes. The most expensive surprises, foundation, roof, electrical panel, HVAC, all have visible tells if you know where to look.',
      manager: 'This walkthrough framework works directly as a move-in/move-out inspection protocol. Document every issue with photos, timestamps, and condition notes. This record is your primary defense in deposit disputes and deferred maintenance arguments.',
      support_agent: 'When a prospective buyer or tenant asks what to look for in a property, this guide is your reference. Key issues to flag immediately: electrical panel brand (Zinsco/FPE = major hazard), horizontal foundation cracks, and evidence of past water intrusion. These are not DIY assessments, they route to a professional inspection.',
    },
  },
  {
    id: 'estimate-repair-costs',
    title: 'How to Estimate Repair and Renovation Costs',
    category: 'management',
    difficulty: 'Medium',
    minutes: 60,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #eff6ff, #bfdbfe)',
    intro: 'Accurate repair cost estimates are the difference between a profitable deal and an expensive mistake. This guide covers the mental model and reference benchmarks that experienced investors use before committing to a number.',
    steps: [
      'Categorize repairs into three buckets: cosmetic (paint, carpet, fixtures), functional (HVAC, roof, plumbing, electrical), and structural (foundation, load-bearing walls). Each bucket has a different cost range and timeline.',
      'Use cost-per-square-foot benchmarks as starting points: full gut renovation $80–150/sqft, kitchen remodel $15,000–40,000, bathroom $6,000–15,000, roof replacement $8,000–18,000, HVAC system $4,000–10,000.',
      'Get at least three contractor quotes for any item over $2,000. Always ask for a written scope of work, "I\'ll fix the plumbing" is not a scope. "Replace all galvanized supply lines with PEX, includes shutoffs" is.',
      'Add a 20% contingency on every estimate. First-time renovators consistently underestimate by 25–40% because they miss scope creep, permit costs, and post-opening surprises.',
      'Track actual spend versus estimate on every project and build your own local benchmark database over time. Your estimates improve with every project, and local costs matter more than national averages.',
    ],
    skills: ['Cost categorization', 'Contractor scope vetting', 'Contingency budgeting'],
    tools: [
      { name: 'HomeAdvisor or Angi cost guides (free online)', rent: null, buy: null },
      { name: 'Renovation cost estimating software (optional)', rent: null, buy: null },
    ],
    hireHref: '/post-job?category=general',
    toolsHref: '/tool-rentals',
    xp: 25,
    tips: {
      customer: 'Even for home improvement projects, getting three quotes and asking for written scopes protects you. The lowest bid without a written scope is almost always a surprise.',
      helper: 'Helpers who can provide written estimates with line-item scopes win more jobs and have fewer disputes. A clear scope of work protects both parties and sets expectations before work begins.',
      consultant: 'A great companion resource would be a market-specific cost matrix, since labor rates vary significantly by metro. National averages are misleading; what matters is calibrating to your specific market. Consider publishing a local version of this guide tied to OxSteed labor data.',
      business: 'Track your own actual costs per job type over time. Your internal benchmark database is more accurate than any published guide after 12–18 months of jobs.',
      investor: 'Your ability to estimate repairs accurately at a walkthrough, without waiting for contractor bids, directly determines your underwriting speed and your competitive advantage in a hot market. Build your mental cost model around your local labor market, not national averages.',
      manager: 'When reviewing contractor bids, compare the scope of work, not just the price. A $12,000 bid and a $9,000 bid may cover entirely different scopes, the cheaper bid may exclude demo, disposal, permit fees, or finish materials.',
      support_agent: 'When a customer asks for a repair cost estimate over the phone, resist the urge to give a number, you\'re not able to see the scope. Instead, help them frame a question to get from contractors: "Can you give me a written scope of work and line-item estimate for X?" That\'s more useful than a range that will almost certainly be wrong.',
    },
  },
  {
    id: 'build-preventive-maintenance-schedule',
    title: 'Build a Property Preventive Maintenance Schedule',
    category: 'management',
    difficulty: 'Easy',
    minutes: 45,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
    intro: 'Preventive maintenance costs cents on the dollar compared to reactive repair. A simple annual schedule for each property turns chaos into a predictable rhythm, and protects asset value.',
    steps: [
      'List every major system in each property: HVAC, water heater, roof, gutters, exterior caulk, smoke detectors, fire extinguishers, plumbing shutoffs, appliances.',
      'Assign a maintenance interval to each item based on manufacturer recommendations and local climate. HVAC filter: monthly or quarterly. Gutters: twice/year. Water heater flush: annually. Roof inspection: annually.',
      'Build a 12-month calendar. Group items by season: spring (HVAC service, gutter cleaning, exterior caulk inspection), summer (pest inspection, AC checkup), fall (weatherstripping, dryer vent clean), winter (pipe insulation check, smoke detector test).',
      'Assign each task to a responsible party: self, on-site manager, or contracted vendor. Confirm the vendor in advance so you\'re not scrambling when the task is due.',
      'Document completion with a date and any findings. This record is your maintenance history, it supports warranty claims, insurance disputes, and eventually, sale documentation.',
    ],
    skills: ['Maintenance scheduling', 'Vendor management', 'Documentation practices'],
    tools: [
      { name: 'Spreadsheet or property management software', rent: null, buy: null },
      { name: 'Shared calendar (Google Calendar, Notion, etc.)', rent: null, buy: null },
    ],
    hireHref: '/post-job?category=general',
    toolsHref: '/tool-rentals',
    xp: 10,
    tips: {
      customer: 'A simple 12-month checklist for your own home prevents the "I haven\'t changed the HVAC filter in two years" problem. Set calendar reminders for the annual and semi-annual items, they don\'t happen without a trigger.',
      helper: 'Offering a recurring property maintenance contract to homeowners and small landlords is a high-retention business model. Monthly check-in visits with a documented checklist differentiate you from one-time repair Helpers.',
      consultant: 'A localized preventive maintenance calendar, adjusted for climate zone, is a genuinely useful piece of content that most property owners don\'t have. What matters in a cold climate is different from a humid subtropical one. This guide could spawn a great OxSteed content asset.',
      business: 'Standardize one maintenance calendar template per property type (single-family, multi-unit, commercial). This becomes your operating manual and training document for new property managers.',
      investor: 'A documented preventive maintenance history increases a property\'s sale value by demonstrating reduced deferred maintenance risk. Buyers and appraisers interpret maintenance records as evidence of careful stewardship, it\'s one of the cheapest ways to justify a higher asking price.',
      manager: 'Your PM schedule is your primary tool for budget forecasting. Items on the schedule are plannable CapEx; items you discover reactively are surprises that blow your budget. Every hour you spend on preventive maintenance typically eliminates 3–5 hours of reactive repair.',
      support_agent: 'When a customer asks what maintenance they should be doing on their home or rental, walk them through the four seasonal categories. The most common gap is HVAC, most homeowners don\'t know about filter changes, annual servicing, or condensate drain cleaning. That\'s your first routing question.',
    },
  },
  {
    id: 'write-a-work-order',
    title: 'Write a Clear Maintenance Work Order',
    category: 'management',
    difficulty: 'Easy',
    minutes: 20,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #eff6ff, #e0e7ff)',
    intro: 'A clear work order protects both the property owner and the contractor. Vague instructions produce vague results, and disputes. Here\'s the anatomy of a work order that gets the job done right.',
    steps: [
      'Property and location: full address, unit number, and point-of-contact name and phone number.',
      'Problem description: describe the issue in observable terms, not your diagnosis. "Dripping sound under kitchen sink since Monday, water stains on cabinet floor", not "leaky pipe."',
      'Scope of work: if you know what you want done, say it. If you don\'t, say "assess and provide a written quote before proceeding." Don\'t leave the scope open-ended if you\'re authorizing work.',
      'Access instructions: who has the key, when can the contractor enter, is the tenant home, are there pets.',
      'Authorization limit: the maximum dollar amount the contractor is authorized to spend without calling you first. This prevents a $300 job becoming a $1,200 invoice.',
      'Document completion: require a brief written summary of what was done and any follow-up items, plus photos if applicable.',
    ],
    skills: ['Problem description', 'Scope definition', 'Authorization limits'],
    tools: [
      { name: 'Work order template (spreadsheet, Word doc, or property management software)', rent: null, buy: null },
    ],
    hireHref: '/post-job?category=general',
    toolsHref: '/tool-rentals',
    xp: 10,
    tips: {
      customer: 'Even for a simple job, texting a contractor "can you fix my faucet" creates ambiguity. Write down the address, the exact symptom, and what you\'ve already tried. A clear description gets a faster response and a more accurate quote.',
      helper: 'When you receive a vague request, respond with a few clarifying questions before quoting. "Can you describe exactly what you\'re seeing?" protects you from scope creep and sets professional expectations.',
      consultant: 'Work order clarity is a process problem that most small landlords and property managers never solve systematically. A template and a training guide for property managers on how to write better work orders is a genuinely underserved content area.',
      business: 'Standardize your work order format and make it non-negotiable. A template that requires problem description, scope authorization limit, and completion documentation protects you legally and operationally.',
      investor: 'An authorization limit on every work order is non-negotiable at portfolio scale. Without it, you get the $300 job that became $1,200 "while I was there", a common pattern with small contractors. Set limits per job type: $500 for routine maintenance, $2,000 for larger repairs, anything above requires a call.',
      manager: 'Your work order is your primary accountability document with contractors. If the job doesn\'t match the work order, you have grounds for a price dispute. If the work order was vague, you don\'t. Make every work order have a clear completion condition: "until the drip stops" or "until the door latches cleanly."',
      support_agent: 'When a customer describes a problem they want fixed, help them translate it into a work order format before they contact a contractor. "The toilet runs" should become "toilet runs intermittently, water continues to fill after flushing stops, needs fill valve inspection and replacement if needed." That\'s a work order a contractor can quote accurately.',
    },
  },
  {
    id: 'diagnose-plumbing-remotely',
    title: 'Diagnose Common Plumbing Problems Remotely',
    category: 'plumbing',
    difficulty: 'Easy',
    minutes: 20,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #eff6ff, #bfdbfe)',
    intro: 'Most plumbing calls fall into a small set of recurring categories. Knowing which questions to ask, before you dispatch or pick up a wrench, saves time, money, and unnecessary service calls.',
    steps: [
      'Symptom: dripping sound. Ask: dripping from a faucet, from a pipe, or from under the sink? Faucet drip → worn washer or cartridge. Under-sink drip → drain connection or supply shut-off valve. Pipe drip → locate the pipe section and shut off water.',
      'Symptom: slow drain. Ask: one drain or multiple? One drain → likely clog local to that fixture. Multiple drains slow → main line blockage. Drain completely stopped + toilet bubbling → call a plumber.',
      'Symptom: toilet running. Ask: does it stop eventually, or run continuously? Running that stops → fill valve or flapper. Continuous running with water audible in bowl → flush valve. Try jiggling the handle, if it helps, flapper chain is the issue.',
      'Symptom: no hot water. Ask: gas or electric? When did it stop? Any pilot light visible? If electric: check the breaker first. If gas with pilot out: relight per the label. If pilot is lit but no hot water after 30 min → thermostat or element.',
      'Symptom: low water pressure. Ask: one fixture or whole house? One fixture → aerator clog (unscrew and clean). Multiple fixtures → pressure regulator or municipal supply issue. Sudden whole-house drop → check your main shutoff.',
    ],
    skills: ['Symptom-to-cause mapping', 'Triage questioning', 'Escalation criteria'],
    tools: [
      { name: 'Flashlight (for under-sink inspection)', rent: null, buy: amz('led flashlight bright inspection') },
      { name: 'Phone camera (for documenting and sharing the problem)', rent: null, buy: null },
    ],
    hireHref: '/post-job?category=plumbing',
    toolsHref: '/tool-rentals?category=plumbing',
    xp: 10,
    tips: {
      customer: 'Before calling a plumber, spend 5 minutes with this checklist. Many "emergency" calls turn out to be a clogged aerator, a tripped breaker, or a flapper that costs $4. The goal isn\'t to fix everything yourself, it\'s to know enough to route the problem correctly and avoid an unnecessary service call.',
      helper: 'Use this diagnostic framework in your intake calls. Asking the right questions before you show up ensures you bring the right parts and set accurate time expectations. A helper who diagnoses over the phone before arriving signals expertise and builds trust.',
      consultant: 'Remote triage scripts are an underutilized content format. A decision-tree version of this guide, structured as "if yes, go to step X; if no, go to step Y", would be a genuinely useful interactive tool for homeowners and support agents.',
      business: 'Train all new staff on the first-tier symptom-to-cause mapping. Most small plumbing issues have a predictable cause, knowing the most likely cause before opening a wall or pulling a fixture saves job time and builds client trust.',
      investor: 'Being able to triage a plumbing call from a tenant or property manager, without rolling a truck, reduces your per-incident cost significantly. Most plumbing "emergencies" can be de-escalated with 3 questions. This guide is a reference to have open when your PM calls.',
      manager: 'This triage framework is your first-call protocol for plumbing complaints. Run through it with the tenant before dispatching a plumber. You\'ll resolve 30–40% of calls without a service visit and know exactly what to tell the plumber when you do dispatch.',
      support_agent: 'This is your primary plumbing triage script. Run the symptom through the decision tree before routing to dispatch. A running toilet is not an emergency. A pipe dripping from a joint in an active wall is. Knowing the difference determines whether you send a helper today or tomorrow.',
    },
  },
  {
    id: 'diagnose-electrical-remotely',
    title: 'Diagnose Common Electrical Problems Remotely',
    category: 'electrical',
    difficulty: 'Easy',
    minutes: 20,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fefce8, #fef9c3)',
    intro: 'Electrical symptoms that seem mysterious usually have a logical cause. Knowing what questions to ask, and when to stop troubleshooting and call an electrician, is the most valuable electrical skill most people never learn.',
    steps: [
      'Symptom: outlet not working. First check: is it a GFCI outlet? Press the RESET button (common in bathrooms, kitchens, garages). Still dead → check the breaker panel. Breaker tripped → reset it. Still dead → outlet may need replacement (call a helper).',
      'Symptom: breaker keeps tripping. Ask: which circuits? A single circuit that trips repeatedly under load → overloaded circuit (too many devices). A breaker that trips immediately when reset → short circuit or faulty device. Unplug everything on the circuit and reset, if it holds, add devices back one at a time.',
      'Symptom: lights flickering. Ask: one light or the whole house? One light → loose bulb or failing fixture. One room → loose wire at the switch or fixture. Whole house → contact the utility company first (not an electrician). Flickering with buzzing → call an electrician.',
      'Symptom: burning smell near an outlet or panel. Action: turn off the circuit at the panel immediately and call a licensed electrician. Do not troubleshoot a burning smell, this is a fire risk.',
      'Symptom: no power in part of the house. Check: is it an outage or is it the panel? Look at the panel, any tripped breakers (middle position)? Reset them. Still no power → check with neighbors and call the utility.',
    ],
    skills: ['GFCI reset procedure', 'Breaker identification', 'Escalation criteria for safety'],
    tools: [
      { name: 'Outlet plug tester', rent: null, buy: amz('outlet receptacle tester circuit') },
      { name: 'Flashlight', rent: null, buy: amz('led flashlight bright inspection') },
    ],
    hireHref: '/post-job?category=electrical',
    toolsHref: '/tool-rentals?category=electrical',
    xp: 10,
    tips: {
      customer: 'A dead outlet is the electrical equivalent of a slow drain, usually a simple fix. Before calling an electrician, press the RESET button on any GFCI outlet in the room (they protect multiple outlets on the same circuit). This solves 30–40% of "outlet not working" calls.',
      helper: 'Pre-screening electrical calls before dispatch protects you and the customer. A burning smell near an outlet is a job you route to a licensed electrician, not a helper. A tripped GFCI is a job you can walk someone through over the phone. Know the difference.',
      consultant: 'An interactive electrical symptom checker, online or as a PDF, would be a high-value content asset. Most homeowners don\'t know GFCI outlets protect other outlets, that burning smell is a fire risk not a diagnosis opportunity, or that flickering in the whole house means utility issue, not wiring.',
      business: 'Train your support staff on the GFCI reset and breaker reset procedures, these two alone resolve the majority of first-call electrical complaints without a dispatcher. Document your escalation criteria: anything involving smell, heat, or repeated breaker trips goes straight to a licensed electrician.',
      investor: 'Knowing the difference between a GFCI reset (free) and a failed circuit breaker ($150–400) and a panel replacement ($2,000–6,000) is direct financial value. An investor who can triage electrical symptoms at a walkthrough makes faster and more accurate renovation budgets.',
      manager: 'This is your electrical triage protocol. For tenant calls: GFCI reset and breaker check are the first two steps before any dispatch. A burning smell near any electrical device or panel skips all triage and goes directly to an electrician and a building inspection, this is a safety and liability issue.',
      support_agent: 'Electrical triage has one hard rule: burning smell or heat from an outlet, panel, or fixture = immediate escalation to a licensed electrician and no further troubleshooting. Everything else, dead outlet, tripped breaker, flickering light, runs through the decision tree. Never guide a customer through electrical work that involves opening a panel.',
    },
  },

  // ── Customer guides ───────────────────────────────────────────────────────
  {
    id: 'post-your-first-job',
    title: 'Post Your First Job',
    category: 'customer',
    difficulty: 'Easy',
    minutes: 8,
    featured: true,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fff7ed, #ffedd5)',
    intro: 'A well-written job post gets better bids, faster. This guide walks you through every field, scope, budget, timeline, and photos, so helpers can quote accurately and show up prepared.',
    steps: [
      'Choose the right category so your post reaches helpers with the right skills.',
      'Write a clear title: "Install ceiling fan in master bedroom" beats "Handyman needed".',
      'Describe exactly what needs to happen, including any prep work already done.',
      'Upload photos, a picture of the space cuts quote errors in half.',
      'Set a realistic budget range and preferred completion window.',
      'Review bids, check helper profiles and reviews, then accept.',
    ],
    skills: ['Job scoping', 'Photo documentation', 'Budget setting'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'Photos are the single biggest factor in quote accuracy. Helpers who can see the actual space, access point, or item to be repaired bid more precisely, which means fewer surprises at invoice time.',
      helper: 'A job post with photos and a specific scope is a gift. Flag vague posts before bidding, "clean up yard" could mean 30 minutes or a full day. A quick clarifying message before submitting a bid sets expectations and protects you.',
      consultant: 'Job post quality directly predicts customer satisfaction. Customers who post clear jobs with photos get better bids, fewer disputes, and higher repeat rates. Consider building a short "how to post a job" onboarding flow into your client intake process.',
      business: 'If your business posts jobs on OxSteed for subcontracted work, treat the job post as a spec sheet. The more detailed your post, the closer the bid will be to your actual cost, which matters for project margin.',
      investor: 'Job post quality is a leading indicator of marketplace health. Platforms with better structured job posts have higher match rates and lower dispute rates, both of which compress cost of service delivery.',
      manager: 'If your team posts jobs for property work, set a standard template: category, scope, photo requirement, budget range. Inconsistent posts lead to inconsistent bids and budget overruns.',
      support_agent: 'Most "I got a bad bid" complaints trace back to an underspecified job post. Walk the customer through adding photos and clarifying scope before escalating to billing disputes.',
    },
  },
  {
    id: 'evaluate-bids-and-helpers',
    title: 'Evaluate Bids and Helper Profiles',
    category: 'customer',
    difficulty: 'Easy',
    minutes: 10,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fff7ed, #ffedd5)',
    intro: 'Not all bids are equal. Learn how to read helper profiles, compare quotes, and choose the right person, not just the cheapest one.',
    steps: [
      'Review each bid amount alongside the helper\'s profile completion score.',
      'Check reviews: look for specifics ("fixed the leak on first visit") not just star counts.',
      'Compare what\'s included, one bid may cover materials, another may not.',
      'Message the top two candidates with one clarifying question to test responsiveness.',
      'Select the helper whose scope, price, and communication style align best.',
    ],
    skills: ['Bid comparison', 'Profile evaluation', 'Communication'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'The middle bid is usually the best value. The lowest bidder may be cutting scope; the highest may be padding margin. Read what\'s included in each bid before comparing prices.',
      helper: 'A detailed bid that breaks down labor and materials wins over a single lump-sum number. Customers who are evaluating bids seriously want to see that you\'ve thought through the job.',
      consultant: 'Teach clients to evaluate bids on three dimensions: scope clarity, helper track record, and communication speed. Customers who choose on price alone have higher dispute rates.',
      business: 'If you\'re reviewing bids for subcontracted work, always verify that the helper\'s license and insurance match the job type before accepting.',
      investor: 'Bid acceptance rates and time-to-acceptance are strong platform health metrics. Faster acceptance correlates with better job post quality and higher customer lifetime value.',
      manager: 'For recurring property jobs, build a preferred helper list from past good performers. Re-bidding every job wastes time and introduces quality variance.',
      support_agent: 'If a customer is confused about bid differences, help them identify what\'s included vs. excluded in each bid. Most confusion comes from comparing scopes that aren\'t apples-to-apples.',
    },
  },
  {
    id: 'shop-the-marketplace',
    title: 'Shop the OxSteed Marketplace',
    category: 'customer',
    difficulty: 'Easy',
    minutes: 6,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fff7ed, #ffedd5)',
    intro: 'The OxSteed marketplace lets you buy tools, materials, and supplies, often sourced locally through verified sellers. Here\'s how to find what you need and get it fast.',
    steps: [
      'Search by product name, category, or local seller.',
      'Filter by distance to find items available for pickup today.',
      'Compare seller ratings and response times before messaging.',
      'Confirm availability and pickup or delivery details before purchasing.',
      'Leave a review after your transaction to help future buyers.',
    ],
    skills: ['Marketplace search', 'Local sourcing', 'Seller evaluation'],
    tools: [],
    hireHref: null,
    toolsHref: '/marketplace',
    xp: 10,
    tips: {
      customer: 'Local pickup is often faster than shipping and supports other community members. Filter by "available today" when you need something for a same-day job.',
      helper: 'The marketplace is a source for job materials. Checking it before a hardware store run can save time and cost, especially for common items like fasteners, lumber, and basic fixtures.',
      consultant: 'Advise clients to check the marketplace for used or surplus materials before buying new, especially for renovation projects where grade-A appearance isn\'t required for structural components.',
      business: 'The marketplace can be a distribution channel for surplus inventory. If your business has excess materials at the end of a project, listing them locally recovers cost.',
      investor: 'Marketplace liquidity, how fast items sell and at what discount to retail, is a signal of local economic activity and platform engagement depth.',
      manager: 'For property management, the marketplace can source common maintenance materials faster than a purchase order cycle. Set a spend threshold below which site managers can buy directly.',
      support_agent: 'Marketplace disputes typically involve item condition vs. description. Walk both parties through the listing screenshots and message history before escalating to a refund.',
    },
  },

  // ── Helper guides ─────────────────────────────────────────────────────────
  {
    id: 'offer-services-on-oxsteed',
    title: 'Offer Your Services on OxSteed',
    category: 'helper',
    difficulty: 'Easy',
    minutes: 10,
    featured: true,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
    intro: 'Setting up a compelling service profile is the first step to steady work. This guide covers everything from your bio to your service radius to your first booking.',
    steps: [
      'Write a bio that leads with your specialty and years of experience.',
      'List every service category you can do, don\'t leave anything out.',
      'Set your service radius and availability schedule.',
      'Add a profile photo, profiles with photos get 3× more inquiries.',
      'Set your base rate and note any minimums or travel fees.',
      'Apply to your first 3 jobs within 24 hours of going live.',
    ],
    skills: ['Profile optimization', 'Service listing', 'Rate setting'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'When browsing helpers, look for profiles that list specific skills rather than broad claims. "Certified plumber, 10 years residential experience" is more credible than "I can do anything."',
      helper: 'Your first 5 reviews are everything. Consider pricing slightly below market for your first month to build review volume, then raise rates once you have social proof.',
      consultant: 'A complete profile is the highest-leverage 30 minutes a new helper can spend. Profile completeness scores correlate strongly with job acceptance rates on most service platforms.',
      business: 'If you\'re hiring helpers for subcontracted work, profile completeness and review depth are better predictors of job quality than hourly rate.',
      investor: 'Supply-side profile quality (completeness, review count, verified credentials) is a strong predictor of marketplace liquidity. High-quality helper profiles increase match rates and reduce cancellations.',
      manager: 'Vet helper profiles the same way you\'d vet a vendor: license verification, insurance confirmation, and at least three completed jobs in the relevant category.',
      support_agent: 'New helpers often need guidance on their first bid. Walk them through the job post, help them write a scoped response, and remind them that speed of response is a factor in acceptance.',
    },
  },
  {
    id: 'bid-on-jobs-effectively',
    title: 'Write Bids That Win',
    category: 'helper',
    difficulty: 'Easy',
    minutes: 8,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
    intro: 'A winning bid isn\'t the lowest, it\'s the most reassuring. Learn the structure of a bid that converts at any price point.',
    steps: [
      'Acknowledge the specific job details to show you read the post.',
      'State your relevant experience in one sentence.',
      'Break down your price: labor, materials, and any travel separately.',
      'Mention a potential complication and how you\'d handle it, this builds trust.',
      'Close with your availability and a single question to open a conversation.',
    ],
    skills: ['Bid writing', 'Pricing', 'Client communication'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'The best bid responses address your specific situation, not a generic template. A helper who mentions something specific from your post is more likely to show up prepared.',
      helper: 'Never submit a bid that starts with "I can do this job." Start with the job itself, restate what you understand about the scope, then explain why you\'re the right person for it.',
      consultant: 'Bid conversion training is high-value for helper onboarding. Most helpers underperform on bids because they lead with price rather than competence and reassurance.',
      business: 'Review your subcontractor bid templates annually. A stale template that doesn\'t address current customer pain points (speed, liability, cleanup) will lose work to more responsive competitors.',
      investor: 'Bid acceptance rates by helper cohort are a key platform metric. Platforms that train helpers to write better bids see higher acceptance rates, faster job completion, and higher customer satisfaction.',
      manager: 'If you manage a team of helpers, run a monthly bid review: pull 5 recent accepted bids and 5 rejected bids, compare, and identify patterns. This is the fastest way to improve team bid quality.',
      support_agent: 'If a helper is struggling to win bids, review their last 3–5 submissions with them. Common issues: leading with price, no acknowledgment of the specific job, no mention of relevant experience.',
    },
  },
  {
    id: 'build-your-reputation',
    title: 'Build a 5-Star Reputation',
    category: 'helper',
    difficulty: 'Medium',
    minutes: 12,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
    intro: 'Your reputation is your most valuable asset on OxSteed. Here\'s how to build it systematically, from first impression to follow-up.',
    steps: [
      'Confirm job details 24 hours before, this one habit eliminates most cancellations.',
      'Arrive on time or message ahead if you\'re delayed.',
      'Walk the customer through what you did and why after completing the job.',
      'Take before and after photos for your own records.',
      'Ask for a review while you\'re still on site, acceptance rates drop after you leave.',
      'Follow up one week later to make sure everything is working.',
    ],
    skills: ['Customer service', 'Communication', 'Professionalism'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 25,
    tips: {
      customer: 'The best helpers communicate before, during, and after a job. A quick text when they arrive and a brief explanation of what they did at the end are signs of a professional worth rehiring.',
      helper: 'The review ask is the most awkward moment for most helpers, and the most important. Practice a natural, in-person ask: "If everything looks good to you, I\'d really appreciate a quick review, it makes a big difference."',
      consultant: 'Reputation systems compound. A helper with 50 reviews at 4.8 stars beats a helper with 10 reviews at 5.0 stars for most customers, volume signals reliability, not just quality.',
      business: 'Customer experience after job completion is as important as the work itself. Build a 3-touch post-job process: confirmation of completion, invoice, and a follow-up check-in 7 days later.',
      investor: 'Review velocity (new reviews per week) is a stronger leading indicator of a helper\'s growth trajectory than average rating alone. High velocity at high quality = compounding marketplace advantage.',
      manager: 'Track your team\'s review rate (reviews received / jobs completed). Best performers review-convert 60–70% of jobs. Under 30% suggests a follow-up or ask process gap.',
      support_agent: 'If a customer leaves a low review, the helper should message to understand what went wrong before disputing. Genuine service recovery (offer to return, partial refund) resolves most issues without escalation.',
    },
  },

  // ── Logistics guides ──────────────────────────────────────────────────────
  {
    id: 'source-goods-locally',
    title: 'Source Goods Through OxSteed',
    category: 'logistics',
    difficulty: 'Easy',
    minutes: 10,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f8fafc, #f1f5f9)',
    intro: 'Local sourcing cuts lead times and freight costs. Learn how to find, vet, and order materials through OxSteed\'s supplier network.',
    steps: [
      'Search the marketplace by material type and proximity.',
      'Filter for verified suppliers with business accounts for bulk pricing.',
      'Request a quote for quantities over 10 units.',
      'Confirm lead time and delivery options before committing.',
      'Place the order and track delivery through your dashboard.',
    ],
    skills: ['Supplier vetting', 'Quote requests', 'Local sourcing'],
    tools: [],
    hireHref: null,
    toolsHref: '/marketplace',
    xp: 10,
    tips: {
      customer: 'For renovation projects, check local suppliers on OxSteed before ordering from national retailers, local stock often means same-week availability instead of 2-week shipping.',
      helper: 'Building relationships with local suppliers gives you a materials edge. A supplier who knows you can turn around emergency stock faster than anyone can buy online.',
      consultant: 'Local sourcing is a resilience strategy, not just a cost strategy. Supply chain disruptions hit national-first businesses harder. Local-first procurement is a competitive advantage worth advising.',
      business: 'A local supplier relationship comes with price benefits at volume, faster emergency sourcing, and sometimes vendor financing. Treat local suppliers as partners, not just vendors.',
      investor: 'Local supply chain density is a market depth indicator. A market with strong local supplier participation on OxSteed has higher transaction velocity and lower fulfillment risk.',
      manager: 'Maintain a preferred local supplier list for the 10 materials you order most often. Pre-negotiated rates and standing relationships cut procurement time from days to hours.',
      support_agent: 'Sourcing disputes usually involve quantity or quality discrepancies. Ask for delivery receipts and photos on both sides before adjudicating.',
    },
  },
  {
    id: 'pooled-orders-and-group-buying',
    title: 'Save More with Pooled Orders',
    category: 'logistics',
    difficulty: 'Easy',
    minutes: 8,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f8fafc, #f1f5f9)',
    intro: 'Pooled orders let multiple buyers combine quantities to unlock wholesale pricing. Here\'s how to join or start a group buy on OxSteed.',
    steps: [
      'Browse open group buys in your category or zip code.',
      'Check the required minimum quantity and price break.',
      'Commit your quantity before the deadline.',
      'Coordinate delivery or pickup with the group organizer.',
      'Rate the supplier after receiving your order.',
    ],
    skills: ['Group buying', 'Quantity planning', 'Coordination'],
    tools: [],
    hireHref: null,
    toolsHref: '/marketplace',
    xp: 10,
    tips: {
      customer: 'If you\'re planning a project and need materials in 2–4 weeks, pooled orders can cut your material cost 15–30% compared to retail. Check open group buys before placing individual orders.',
      helper: 'Helpers with predictable material needs (weekly lumber, monthly fasteners) benefit most from pooled orders. Calculate your monthly average usage and commit to a recurring group buy.',
      consultant: 'Advise clients with seasonal demand peaks to time pooled order participation around procurement cycles, buying ahead at wholesale before peak season is a margin strategy.',
      business: 'Pooled orders work best for commodity materials with stable demand. Volatile or specialized materials are better sourced individually to avoid commitment risk.',
      investor: 'Group buy participation rates signal community trust and coordination capacity, early indicators of network effects within a local marketplace.',
      manager: 'Track your monthly materials spend by category. Any line over $500/month is worth analyzing for pooled order savings potential.',
      support_agent: 'The most common pooled order issue is a member who commits but doesn\'t pay on time. Escalate to the group organizer first, they have more context than support on individual participants.',
    },
  },
  {
    id: 'freight-and-distribution-basics',
    title: 'Freight and Distribution Basics',
    category: 'logistics',
    difficulty: 'Medium',
    minutes: 15,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f8fafc, #f1f5f9)',
    intro: 'Moving large quantities requires freight, not parcel. This guide covers LTL vs. FTL, freight classes, and how to ship pallets through OxSteed\'s logistics partners.',
    steps: [
      'Determine if your shipment is LTL (less-than-truckload) or FTL (full truckload).',
      'Calculate total weight and cubic feet to determine freight class.',
      'Get quotes from at least two freight carriers before booking.',
      'Prepare a bill of lading (BOL), required for all freight shipments.',
      'Schedule pickup and confirm delivery window with the recipient.',
      'File a freight claim within 5 days if damage occurs.',
    ],
    skills: ['Freight classification', 'BOL preparation', 'Carrier selection'],
    tools: [],
    hireHref: null,
    toolsHref: '/marketplace',
    xp: 25,
    tips: {
      customer: 'If you\'re receiving a freight delivery, inspect the pallet before signing the delivery receipt. Any visible damage should be noted on the BOL, once you sign clean, the claim becomes much harder to win.',
      helper: 'Helpers who can coordinate freight pickup and delivery add a service tier that most individual helpers can\'t. This skill unlocks larger commercial jobs.',
      consultant: 'Freight classification errors are a major source of unexpected shipping cost. Walk clients through NMFC classification before they book, a misclassified shipment can double the quoted price.',
      business: 'Negotiate an annual freight volume commitment with one preferred carrier in exchange for a rate discount. Even modest volume (10–20 pallets/year) can yield 15–25% savings.',
      investor: 'Logistics capability is a moat in local marketplace businesses. Operators who can move goods (not just people or services) have higher average transaction values and stickier customers.',
      manager: 'Require a freight checklist for all pallet shipments: BOL completed, pallet weight verified, photos taken, carrier confirmed, delivery contact notified. Skipping steps here causes expensive delays.',
      support_agent: 'Freight damage claims require: photos of damage, original BOL with damage noted, carrier contact info. If the customer signed clean, support can only advocate, not guarantee, a claim outcome.',
    },
  },

  // ── Consulting guides ─────────────────────────────────────────────────────
  {
    id: 'onboard-consulting-clients',
    title: 'Onboard Consulting Clients on OxSteed',
    category: 'consulting',
    difficulty: 'Easy',
    minutes: 10,
    featured: true,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #faf5ff, #f3e8ff)',
    intro: 'A smooth onboarding process is the foundation of a strong client relationship. This guide covers intake, scope agreement, and first-session structure for OxSteed consultants.',
    steps: [
      'Send a short intake form before the first session, business type, goals, current challenges.',
      'Review their OxSteed account history before the call.',
      'Open the first session with their top three pain points, not your pitch.',
      'Agree on deliverables and timeline before ending the first call.',
      'Send a written recap with next steps within 24 hours.',
    ],
    skills: ['Client intake', 'Scope setting', 'Session facilitation'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'A good consultant asks more than they tell in the first session. If the first meeting is mostly a pitch, that\'s a red flag.',
      helper: 'Consultants who specialize in onboarding helpers and business owners can build a repeatable client pipeline from OxSteed\'s growing user base.',
      consultant: 'An intake form saves 15–20 minutes of discovery per session. Design it to surface the three things you always need to know: revenue stage, team size, biggest current obstacle.',
      business: 'Brief your consultant before sessions, not during. A 5-minute written summary of the week\'s events is more efficient than a 20-minute verbal catch-up at the start of each call.',
      investor: 'Consulting-as-a-service on marketplace platforms is a high-margin, capital-light revenue stream. Consultants who systematize onboarding can handle more clients per week without proportional time increase.',
      manager: 'If you\'re bringing in a consultant for your team, set expectations in writing: deliverables, session cadence, escalation path. Ambiguity at the start of a consulting engagement predicts poor outcomes.',
      support_agent: 'Consultant-client scope disputes almost always come from unclear first-session agreements. Encourage consultants to send written session recaps, this creates a paper trail that resolves most ambiguity.',
    },
  },
  {
    id: 'price-consulting-services',
    title: 'Price Your Consulting Expertise',
    category: 'consulting',
    difficulty: 'Medium',
    minutes: 12,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #faf5ff, #f3e8ff)',
    intro: 'Most consultants undercharge. Learn how to anchor your rates to outcomes, not hours, and how to increase them over time without losing clients.',
    steps: [
      'Calculate your target annual income and back into your required hourly rate.',
      'Research what comparable consultants charge in your category.',
      'Build a three-tier offering: session, package, retainer.',
      'Price your retainer at a discount to the hourly rate, it trades flexibility for predictability.',
      'Raise rates by 10–15% every 6 months for new clients.',
    ],
    skills: ['Rate setting', 'Service packaging', 'Value-based pricing'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 25,
    tips: {
      customer: 'A consultant who charges more and commits to fewer clients often delivers better results than a generalist with low rates. Price is a signal of capacity and focus.',
      helper: 'If you\'re transitioning from hourly labor to consulting, your pricing ceiling is determined by outcomes you can credibly demonstrate, start with case studies from your best jobs.',
      consultant: 'Retainers create cash flow predictability. Even one client on a retainer covers fixed costs and reduces the pressure of feast-and-famine project cycles.',
      business: 'Evaluate consultants on ROI, not rate. A $200/hr consultant who saves $5,000/month is cheaper than a $100/hr consultant who delivers $1,000/month in value.',
      investor: 'Consulting revenue on platforms like OxSteed is a margin signal. High-rate consultants with strong client retention validate that the platform enables premium professional services, not just commodity tasks.',
      manager: 'If you\'re setting consultant rates for your team, price by specialty depth, not seniority. A specialist in a high-demand niche should out-earn a generalist at any level.',
      support_agent: 'Billing disputes with consultants usually involve session overruns or scope changes. The written recap sent after each session is the primary evidence, encourage consultants to make it a habit.',
    },
  },
  {
    id: 'book-paid-consulting-sessions',
    title: 'Book and Run Paid Sessions',
    category: 'consulting',
    difficulty: 'Easy',
    minutes: 8,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #faf5ff, #f3e8ff)',
    intro: 'From booking link to session recap, here\'s the full workflow for running a paid consulting session through OxSteed.',
    steps: [
      'Set your session types, durations, and rates in your consultant profile.',
      'Enable calendar sync so clients can book open slots.',
      'Send a pre-session reminder 24 hours before with agenda and prep notes.',
      'Run the session: 80% listening, 20% advising.',
      'Send a recap email with decisions made and next steps within 2 hours.',
      'Invoice through OxSteed so payment is tracked and reported.',
    ],
    skills: ['Calendar management', 'Session facilitation', 'Invoicing'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'The pre-session prep note is where you communicate your agenda. Consultants who read it and start there save 10–15 minutes of setup, time you\'re paying for.',
      helper: 'Offering a 30-minute diagnostic session at a low price point is an effective way to convert job-seeking customers into consulting clients.',
      consultant: 'The 2-hour recap rule is non-negotiable for premium consultants. Memory fades fast, notes written after a gap are less accurate and less useful than notes written immediately after.',
      business: 'Block consulting sessions on a fixed day each week. Scattering sessions across the calendar fragments your team\'s deep work time and reduces the value you get from each session.',
      investor: 'Consultant session completion rates and rebooking rates are strong proxies for service quality. Platforms where >60% of sessions result in rebooking have healthy consultant supply.',
      manager: 'If your team uses consulting sessions for skill development, require a one-paragraph written takeaway from each session. Accountability for application drives ROI.',
      support_agent: 'No-show disputes for paid sessions: check the booking confirmation timestamp and session reminder delivery. Both are logged. If the consultant no-showed with no notice, the customer is entitled to a credit.',
    },
  },

  // ── Tool rental guides ────────────────────────────────────────────────────
  {
    id: 'list-tools-for-rent',
    title: 'List Your Tools for Rent',
    category: 'tool-rental',
    difficulty: 'Easy',
    minutes: 10,
    featured: true,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fffbeb, #fef3c7)',
    intro: 'Idle tools cost money. List them on OxSteed and turn equipment downtime into rental income, with built-in damage protection and scheduling.',
    steps: [
      'Photograph each tool from 3 angles in good lighting.',
      'Write a description that includes make, model, year, and current condition.',
      'Set a daily rate, research what comparable tools rent for locally.',
      'Define your pickup/delivery policy and minimum rental period.',
      'Enable damage deposit collection through OxSteed checkout.',
      'Respond to rental inquiries within 2 hours to maintain ranking.',
    ],
    skills: ['Equipment photography', 'Rate setting', 'Rental management'],
    tools: [],
    hireHref: null,
    toolsHref: '/marketplace',
    xp: 10,
    tips: {
      customer: 'Renting a tool for a one-time job almost always costs less than buying. Check OxSteed listings before going to a hardware store, local rental is often cheaper and available same-day.',
      helper: 'Tool owners who also offer delivery and pickup earn significantly more per rental than those who require self-pickup. If you have a truck, price the option in.',
      consultant: 'Tool rental businesses on OxSteed benefit from seasonal pricing. Lawn equipment in spring, generators in fall, heating equipment in winter. Advise clients to model their pricing around demand curves.',
      business: 'If your business has fleet equipment that sits idle between projects, listing it on OxSteed during downtime recovers depreciation cost. Track utilization rates monthly.',
      investor: 'Equipment rental on a two-sided marketplace has attractive unit economics: tools are hard assets with high utilization upside, and platform takes a cut without owning inventory.',
      manager: 'Require rental condition documentation, photos before and after each rental, as a standard operating procedure. This resolves damage disputes quickly and fairly.',
      support_agent: 'Damage deposit disputes are the most common tool rental support issue. The resolution process requires pre-rental and post-rental photos. Without both, adjudication defaults to split resolution.',
    },
  },
  {
    id: 'protect-your-rental-inventory',
    title: 'Protect Your Rental Inventory',
    category: 'tool-rental',
    difficulty: 'Medium',
    minutes: 12,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fffbeb, #fef3c7)',
    intro: 'Rental tools take a beating. Here\'s how to protect your inventory with the right deposits, documentation, and maintenance schedule.',
    steps: [
      'Set damage deposits at 1–2× the daily rate for high-value items.',
      'Photograph every tool before and after each rental.',
      'Create a condition checklist and have renters sign it at pickup.',
      'Schedule maintenance every 30 rental days, regardless of visible wear.',
      'Track total rental revenue vs. maintenance cost per tool.',
      'Retire a tool when cumulative repair costs exceed 60% of replacement cost.',
    ],
    skills: ['Asset documentation', 'Maintenance scheduling', 'Deposit management'],
    tools: [],
    hireHref: null,
    toolsHref: '/marketplace',
    xp: 25,
    tips: {
      customer: 'If you\'re renting a tool, treat it as if you own it. A condition checklist at pickup protects you too, any pre-existing damage is documented so you\'re not charged for it.',
      helper: 'Helpers who rent tools frequently should build a preferred vendor relationship with a local tool owner. Consistent renters often get priority access and negotiated rates.',
      consultant: 'A tool-by-tool ROI tracker is a high-value deliverable for tool rental clients. Identifying which items are profitable vs. which are maintenance money pits can reshape the entire rental catalog.',
      business: 'Depreciation accounting matters for rental inventory. Track each tool as a depreciating asset, not an expense, this changes how you evaluate profitability and replacement decisions.',
      investor: 'Asset utilization rate (rental days / available days) is the key performance metric for tool rental businesses. Anything above 60% average utilization is considered strong for equipment rental.',
      manager: 'Build a maintenance calendar based on rental frequency, not time. A tool rented 20 days a month needs maintenance twice as often as one rented 10 days a month.',
      support_agent: 'Damage disputes require the condition checklist and both photo sets. If either is missing, escalate to the tool owner for their best available documentation before adjudicating.',
    },
  },
  {
    id: 'price-tool-rentals-for-profit',
    title: 'Price Tool Rentals for Profit',
    category: 'tool-rental',
    difficulty: 'Medium',
    minutes: 10,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fffbeb, #fef3c7)',
    intro: 'Rental pricing that feels good to customers AND covers your cost is a formula, not a guess. Here\'s how to price for profit at every rental duration.',
    steps: [
      'Calculate your target payback period: retail price / expected rental days before retirement.',
      'Set your daily rate to recover cost in 12–18 months at 50% utilization.',
      'Offer a weekly rate at 5× the daily rate (vs. 7× if priced independently).',
      'Add a weekend premium of 20%, demand peaks Friday to Sunday.',
      'Review your rates quarterly against local competitors.',
    ],
    skills: ['Rental pricing', 'Revenue modeling', 'Competitive analysis'],
    tools: [],
    hireHref: null,
    toolsHref: '/marketplace',
    xp: 25,
    tips: {
      customer: 'Weekly rates usually offer the best value if you need a tool for 4+ days. Ask the owner about a weekly discount before booking day-by-day.',
      helper: 'If you own tools and rent them on OxSteed, your rental income is taxable as self-employment income. Track it from day one.',
      consultant: 'Seasonal pricing is underused in local tool rental. A pressure washer rented at a 30% premium in spring vs. winter has the same cost structure, the premium is pure margin.',
      business: 'If you\'re deciding between purchasing vs. renting equipment, model the break-even: how many rental days do you need per year before owning makes more economic sense?',
      investor: 'Tool rental gross margins vary significantly by category. Power tools typically yield 50–70% gross margin; heavy equipment, 40–60%. Know your category economics before investing in inventory.',
      manager: 'Review rental utilization monthly. Tools sitting idle below 30% utilization for 3+ months are candidates for price reduction, targeted marketing, or catalog removal.',
      support_agent: 'Pricing complaints from customers usually come from miscommunication about weekend premiums or late fees. Make sure tool owners have these terms visible on their listings.',
    },
  },

  // ── Franchise guides ──────────────────────────────────────────────────────
  {
    id: 'understand-the-oxsteed-franchise-model',
    title: 'Understand the OxSteed Franchise Model',
    category: 'franchise',
    difficulty: 'Easy',
    minutes: 12,
    featured: true,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #ecfeff, #cffafe)',
    intro: 'Franchise ownership with OxSteed means running a local marketplace, connecting helpers, customers, and businesses in your territory. This guide explains the model before you apply.',
    steps: [
      'Understand what a franchise territory includes: geography, category exclusivity, and support level.',
      'Review the franchise fee structure and ongoing revenue share.',
      'Learn how the platform handles disputes, payments, and support in your territory.',
      'Understand your responsibilities: local marketing, helper onboarding, community events.',
      'Identify your target territory and check if it\'s available.',
    ],
    skills: ['Franchise evaluation', 'Territory analysis', 'Revenue modeling'],
    tools: [],
    hireHref: null,
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'Franchise operators in your area are your local point of contact for escalated issues and community events. Knowing who runs your territory helps you get faster support.',
      helper: 'Helpers in franchise territories often get more active onboarding support and local marketing. A strong franchise operator can significantly accelerate a helper\'s early growth.',
      consultant: 'A franchise evaluation engagement for a prospective operator is a well-defined consulting scope: territory analysis, competitive landscape, financial modeling, and operator suitability assessment.',
      business: 'Businesses operating in a franchise territory benefit from a local marketplace operator who actively recruits helpers and drives demand. This is network value that a solo business can\'t replicate.',
      investor: 'Franchise models in local marketplaces create distributed operational accountability. The franchisor scales without adding headcount; the franchisee captures local margin; both benefit from brand and infrastructure.',
      manager: 'If you\'re evaluating OxSteed franchise ownership as an expansion model for your current business, model the incremental time cost separately from the financial return, operator time is often underestimated.',
      support_agent: 'Franchise territory questions should be routed to the franchise development team, support handles platform disputes, not franchise agreement questions.',
    },
  },
  {
    id: 'evaluate-your-franchise-territory',
    title: 'Evaluate a Franchise Territory',
    category: 'franchise',
    difficulty: 'Medium',
    minutes: 15,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #ecfeff, #cffafe)',
    intro: 'Before you apply, understand your territory\'s potential. This guide walks through the quantitative and qualitative analysis that separates strong franchise markets from weak ones.',
    steps: [
      'Pull census data for your territory: population, median income, housing density.',
      'Count competing services platforms and their review counts in your area.',
      'Estimate serviceable addressable market (SAM) by category.',
      'Identify the top 10 zip codes by service demand within your territory.',
      'Build a 3-year P&L projection based on conservative adoption assumptions.',
    ],
    skills: ['Market analysis', 'Financial modeling', 'Competitive research'],
    tools: [],
    hireHref: null,
    toolsHref: null,
    xp: 25,
    tips: {
      customer: 'A strong franchise territory means more local helpers, better response times, and more active community programs. Customer experience improves with operator engagement.',
      helper: 'Helpers benefit from evaluating whether they\'re in a well-operated franchise territory. Territories with an active operator see more job posts, more events, and more platform promotion.',
      consultant: 'Territory analysis is a high-value consulting deliverable. Structure it as: supply assessment (helper density), demand assessment (job posting rate), and competitive positioning (vs. similar platforms).',
      business: 'If you\'re considering a franchise as a business diversification, treat it as a startup investment, not a passive income stream. Factor in operator time at your current hourly rate.',
      investor: 'Territory attractiveness in local marketplaces correlates with population density, median income, and homeownership rate. These three variables alone explain ~70% of variance in marketplace revenue by territory.',
      manager: 'If you\'re hired to manage a franchise territory, your first 90 days should be primarily community and relationship building, supply onboarding, local business partnerships, and first event.',
      support_agent: 'Territory boundary disputes between franchise applicants are handled by the franchise development team, not platform support. Route accordingly.',
    },
  },
  {
    id: 'launch-your-franchise-territory',
    title: 'Launch Your Franchise Territory',
    category: 'franchise',
    difficulty: 'Hard',
    minutes: 20,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #ecfeff, #cffafe)',
    intro: 'The first 90 days as a franchise operator determine long-term success. This is your launch playbook: supply, demand, community, and momentum.',
    steps: [
      'Set a 30-day goal: recruit 20 verified helpers in your top 3 categories.',
      'Reach out to 10 local businesses as anchor demand sources.',
      'Host a launch event, a free workshop or networking night.',
      'Run local social ads targeting homeowners and small businesses in your territory.',
      'Publish weekly local content: tips, helper spotlights, job success stories.',
      'Hit 50 completed jobs in your first 60 days to establish social proof.',
    ],
    skills: ['Community building', 'Local marketing', 'Helper recruitment', 'Demand generation'],
    tools: [],
    hireHref: null,
    toolsHref: null,
    xp: 50,
    tips: {
      customer: 'A newly launched franchise territory often has launch promotions, discounted first jobs, bonus credits, or free consultations. Watch for local announcements.',
      helper: 'Signing up early in a new franchise territory gives you first-mover advantage: more job posts before competition grows, direct attention from the local operator, and faster profile growth.',
      consultant: 'A franchise launch consultant can accelerate the first 90 days significantly. High-value work includes: launch event planning, local business development, and content strategy.',
      business: 'Partnering with a new franchise operator as an anchor customer can get you preferential rates and priority placement in local search results.',
      investor: 'Franchise territory launch velocity (jobs completed in first 60 days) is the strongest leading indicator of long-term territory health. Slow starts rarely recover to market-rate performance.',
      manager: 'The first hire for a franchise territory should be a community coordinator, not a marketer. Relationships build faster than ads in local marketplace launches.',
      support_agent: 'New franchise territory onboarding questions should be routed to the operator or franchise development team. Support handles transactional issues only.',
    },
  },

  // ── Life guides ───────────────────────────────────────────────────────────
  {
    id: 'track-personal-finances-with-oxsteed',
    title: 'Track Personal Finances with OxSteed',
    category: 'life',
    difficulty: 'Easy',
    minutes: 10,
    featured: true,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fff1f2, #ffe4e6)',
    intro: 'OxSteed\'s life tools help you track spending, set savings goals, and see where your money goes, without switching apps. Here\'s how to set up your financial dashboard.',
    steps: [
      'Connect your primary bank account or credit card for transaction syncing.',
      'Set up spending categories that match your actual habits.',
      'Create your first savings goal and target date.',
      'Review your weekly spending summary every Sunday.',
      'Set a monthly budget for discretionary categories.',
    ],
    skills: ['Budgeting', 'Goal setting', 'Expense tracking'],
    tools: [],
    hireHref: null,
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'Tracking what you spend on home services and repairs through OxSteed gives you data for annual budgeting. Most homeowners underestimate home maintenance costs by 30–50%.',
      helper: 'If you earn income on OxSteed, tracking your income and expenses in the same platform gives you a complete self-employment financial picture at tax time.',
      consultant: 'Personal finance clarity is often a precondition for business finance clarity. Consultants who help clients separate personal and business expenses unlock cleaner margin analysis.',
      business: 'For sole proprietors, personal finance and business finance can blur dangerously. Use OxSteed\'s categorization tools to maintain clean separation from day one.',
      investor: 'Personal cash flow modeling, income, fixed costs, variable costs, savings rate, is the foundation of any investment capacity analysis. Establish baseline data before projecting.',
      manager: 'If you manage a team of helpers or contractors who earn on OxSteed, encourage them to track their OxSteed income separately for tax preparation, it reduces year-end scramble.',
      support_agent: 'Financial tracking questions are typically product-level questions about the Life dashboard. Route to product support for feature-specific issues; handle billing disputes in your queue.',
    },
  },
  {
    id: 'manage-vehicle-costs',
    title: 'Manage Your Vehicle Costs',
    category: 'life',
    difficulty: 'Easy',
    minutes: 8,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fff1f2, #ffe4e6)',
    intro: 'Your vehicle is likely your largest recurring expense after housing. OxSteed\'s vehicle tools help you track maintenance, fuel, and total cost of ownership.',
    steps: [
      'Add your vehicle(s) to the life dashboard.',
      'Log every fuel fill-up to track miles per gallon over time.',
      'Record maintenance events: oil changes, tires, repairs.',
      'Set maintenance reminders based on mileage or date.',
      'Calculate your true cost-per-mile including depreciation.',
    ],
    skills: ['Vehicle maintenance tracking', 'Cost of ownership analysis', 'Depreciation modeling'],
    tools: [],
    hireHref: null,
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'Tracking vehicle maintenance digitally means you have a full service history when you sell, which increases resale value and reduces negotiating friction.',
      helper: 'If you use your vehicle for OxSteed jobs, your mileage is a tax deduction. Track every work-related mile starting from your first job.',
      consultant: 'Vehicle cost-of-ownership analysis often reveals that clients would save money leasing vs. owning, or replacing sooner vs. repairing more. Run the numbers before advising.',
      business: 'Fleet vehicle tracking through OxSteed life tools works for small fleets (1–5 vehicles). For larger fleets, dedicated fleet management software is more appropriate.',
      investor: 'Personal vehicle depreciation is often underweighted in household net worth models. Including it gives a more accurate picture of asset erosion over time.',
      manager: 'For helpers who use their own vehicles for jobs, encourage them to track mileage for reimbursement claims, both for their own tax purposes and for any applicable employer reimbursement.',
      support_agent: 'Vehicle tracking is a Life product feature. Bugs or sync issues should be routed to product support. Financial disputes involving vehicle-related expenses are handled in your queue.',
    },
  },
  {
    id: 'home-maintenance-budget',
    title: 'Build a Home Maintenance Budget',
    category: 'life',
    difficulty: 'Easy',
    minutes: 10,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fff1f2, #ffe4e6)',
    intro: 'The 1% rule says budget 1% of your home\'s value annually for maintenance. Here\'s how to allocate that budget intelligently across systems.',
    steps: [
      'List every major home system: roof, HVAC, plumbing, electrical, exterior.',
      'Note the age and expected lifespan remaining for each system.',
      'Allocate your annual maintenance budget weighted toward oldest systems.',
      'Set up a sinking fund for the one system closest to replacement.',
      'Track every maintenance expense against your annual budget in OxSteed.',
    ],
    skills: ['Home budgeting', 'Sinking funds', 'Maintenance planning'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'A sinking fund for your HVAC or roof means you\'re never caught off guard by a $5,000–15,000 replacement. Start small, even $100/month builds meaningful cushion in 2–3 years.',
      helper: 'Customers with maintenance budgets post jobs more frequently and accept bids faster. They\'ve already mentally committed the money, they\'re just looking for the right helper.',
      consultant: 'A home maintenance budget is a high-value deliverable for first-time homeowners. Build them a simple spreadsheet: system, age, expected replacement year, monthly reserve needed.',
      business: 'For property management businesses, a system-level maintenance reserve fund per property is standard practice. OxSteed life tools can automate the tracking for small portfolios.',
      investor: 'Maintenance reserve adequacy is a key factor in investment property valuation. Properties with documented maintenance histories sell at higher multiples than those without.',
      manager: 'For property managers, a per-property annual maintenance budget with a rolling reserve is both a financial planning tool and a liability management tool.',
      support_agent: 'Home maintenance budget questions are typically product questions about the Life tools. Route to product support unless there\'s a billing issue with an actual job posted on the platform.',
    },
  },

  // ── Investor guides ───────────────────────────────────────────────────────
  {
    id: 'track-your-oxsteed-portfolio',
    title: 'Track Your OxSteed Portfolio',
    category: 'investor',
    difficulty: 'Easy',
    minutes: 10,
    featured: true,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
    intro: 'Whether you\'re investing in rental properties, local businesses, or franchise territories, OxSteed\'s investor dashboard gives you a unified view of your local portfolio.',
    steps: [
      'Add each investment: property address, purchase price, current value estimate.',
      'Link associated income streams: rental income, franchise revenue, marketplace sales.',
      'Set a target return for each investment.',
      'Review your portfolio monthly, income vs. expenses vs. equity growth.',
      'Flag underperforming assets for review each quarter.',
    ],
    skills: ['Portfolio tracking', 'ROI analysis', 'Asset management'],
    tools: [],
    hireHref: null,
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'If you\'re a homeowner tracking home improvements, you\'re already doing a form of investor-level thinking. Renovations that add more value than they cost are investments.',
      helper: 'Experienced helpers who understand investor thinking get more referrals from investor clients. Learn the basics of cap rate and ROI, it changes the conversations you can have.',
      consultant: 'A portfolio review engagement is a repeatable consulting offering. Quarterly portfolio health reviews for local investors generate steady retainer income.',
      business: 'Business owners who track their business as an investment, not just as income, make better decisions about reinvestment vs. distribution.',
      investor: 'The OxSteed investor dashboard consolidates local portfolio data that would otherwise require multiple spreadsheets. Unified reporting is a time multiplier for active local investors.',
      manager: 'Asset managers overseeing portfolios for investors benefit from a single dashboard view. Flag any asset generating below-target returns for an owner conversation within the same reporting cycle.',
      support_agent: 'Investor dashboard feature questions go to product support. Disputes about platform fees or income reporting should be handled in your queue with finance team escalation as needed.',
    },
  },
  {
    id: 'evaluate-local-investment-opportunities',
    title: 'Evaluate Local Investment Opportunities',
    category: 'investor',
    difficulty: 'Medium',
    minutes: 15,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
    intro: 'Local investing is hyperlocal knowledge applied. Here\'s a framework for evaluating whether a local opportunity, property, business, or franchise, is worth your capital.',
    steps: [
      'Define your investment criteria: minimum return, maximum hold period, risk tolerance.',
      'Analyze the local market: population trends, income growth, service demand.',
      'Build a base-case, bear-case, and bull-case financial model.',
      'Identify your exit path before you invest.',
      'Run the numbers past a trusted advisor before committing capital.',
    ],
    skills: ['Investment analysis', 'Market research', 'Financial modeling'],
    tools: [],
    hireHref: null,
    toolsHref: null,
    xp: 25,
    tips: {
      customer: 'Understanding local investment basics helps you evaluate home improvements as investments, which renovations have the best resale ROI vs. which are personal preferences.',
      helper: 'Helpers who understand the investor perspective on local service businesses can build relationships with investor clients who need trusted, recurring labor partners.',
      consultant: 'A deal evaluation framework that you apply consistently makes your consulting advice more credible. Investors trust advisors who say "here\'s the framework, here\'s what this deal scores" over those who give gut-feel opinions.',
      business: 'Treat your business as an investment when deciding to reinvest profits. The same framework that applies to properties, return, risk, exit, applies to business capital allocation.',
      investor: 'Local investment evaluation requires local data that national models can\'t provide. OxSteed\'s transaction density, service demand, and helper supply data are inputs into a local market model that national platforms don\'t offer.',
      manager: 'If you\'re managing assets for investors, build a standard evaluation template and run every opportunity through it before presenting. Consistency in analysis builds investor confidence.',
      support_agent: 'Investment evaluation questions are outside the scope of platform support. Refer users to the consultant marketplace if they\'re looking for a financial advisor on OxSteed.',
    },
  },

  // ── Management guides (additional) ────────────────────────────────────────
  {
    id: 'manage-a-helper-team',
    title: 'Manage a Team of Helpers',
    category: 'management',
    difficulty: 'Medium',
    minutes: 15,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
    intro: 'Running multiple helpers under one business account requires consistent quality standards, communication systems, and performance tracking. Here\'s how to build a management layer that scales.',
    steps: [
      'Build a helper onboarding checklist: profile review, license check, insurance verification.',
      'Create job assignment guidelines: who gets what type of job and why.',
      'Set a weekly review cadence: job completion rate, review score, response time.',
      'Build an escalation path for quality complaints.',
      'Create a reward structure for top performers: bonuses, priority assignments, referral credits.',
    ],
    skills: ['Team management', 'Quality control', 'Performance tracking'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 25,
    tips: {
      customer: 'If you\'re hiring through a managed helper team, ask who specifically will be assigned to your job and whether that person has done similar jobs before.',
      helper: 'Being part of a managed team means more consistent work but less autonomy on job selection. Understand the assignment system before joining a team.',
      consultant: 'Helper team management consulting is a growing niche. Businesses that grew from 1 helper to 5+ often have management gaps, clear SOPs and performance systems are high-value deliverables.',
      business: 'The transition from solo helper to team operator is the hardest growth stage. The skills that made you a great helper (technical ability, customer rapport) are different from what makes you a great manager (systems, accountability, delegation).',
      investor: 'Helper teams with professional management structures have lower quality variance and higher customer retention than solo operators. This reduces revenue risk in a portfolio of service businesses.',
      manager: 'The biggest management trap in service teams: promoting your best helper to manager without preparing them for the role shift. Management is a different job, not a reward.',
      support_agent: 'Quality complaints about managed helper teams should route to the team account, not just the individual helper. The account manager is responsible for team quality.',
    },
  },
  {
    id: 'scale-your-service-business',
    title: 'Scale Your Service Business on OxSteed',
    category: 'management',
    difficulty: 'Hard',
    minutes: 20,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
    intro: 'Scaling from a solo operation to a multi-helper business requires systems before growth. This guide covers the four pillars of a scalable service business.',
    steps: [
      'Document your core service processes as SOPs before hiring anyone.',
      'Build a financial model: revenue per helper, margin per job, overhead costs.',
      'Create a hiring pipeline: where you find helpers, how you vet them, how you onboard them.',
      'Invest in tools that save management time: scheduling software, communication templates, review tracking.',
      'Set a 90-day growth target and measure against it weekly.',
    ],
    skills: ['Systems building', 'Financial modeling', 'Hiring', 'Operational efficiency'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 50,
    tips: {
      customer: 'Scaled service businesses offer more consistent availability and faster response times than solo operators, at the tradeoff of potentially less personal service.',
      helper: 'Working for a scaling business is a good way to learn operations, management, and systems, skills that can help you build your own business later.',
      consultant: 'A scaling engagement for a service business has four phases: systems documentation, financial modeling, hiring infrastructure, and growth measurement. Sell the engagement as a 6-month retainer with clear milestones.',
      business: 'The biggest mistake in service business scaling: adding headcount before adding systems. More helpers without clear processes just creates more chaos at higher cost.',
      investor: 'Service businesses with documented SOPs and management systems command 2–4× higher acquisition multiples than equivalently-sized businesses that are owner-dependent.',
      manager: 'Scaling is an operations problem, not a sales problem. Don\'t add revenue until you can deliver it consistently at the right quality. Fill your capacity before expanding it.',
      support_agent: 'Scaling businesses often have higher support volume as they onboard new helpers and take on new customers. Prioritize their escalations, they represent high platform value and high churn risk.',
    },
  },

  // ── Business Owner guides ────────────────────────────────────────────────
  {
    id: 'set-up-your-business-on-oxsteed',
    title: 'Set Up Your Business on OxSteed',
    category: 'business',
    difficulty: 'Easy',
    minutes: 10,
    featured: true,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
    intro: 'A complete business profile on OxSteed unlocks bulk pricing, business invoicing, helper team management, and priority placement. Here\'s how to set it up right.',
    steps: [
      'Switch your account to a Business account in Settings.',
      'Add your business name, EIN, and primary service categories.',
      'Upload your business license and any relevant trade certifications.',
      'Set your service area, business hours, and response time commitment.',
      'Add your team, invite helpers as employees or subcontractors.',
      'Enable business invoicing so clients can pay by ACH or card on net terms.',
    ],
    skills: ['Business profile setup', 'Team management', 'Invoicing'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'Hiring a business account vs. an individual helper gives you business invoicing, insurance documentation, and a named point of contact, worth paying a small premium for larger jobs.',
      helper: 'If your solo helper operation is growing, upgrading to a business account unlocks team management, sub-helper invitations, and higher-tier job access.',
      consultant: 'Business account setup is a recurring onboarding deliverable. Build a checklist: EIN, license upload, service categories, team invitations, invoicing setup. It takes 45 minutes and creates a complete professional footprint.',
      business: 'Your OxSteed business profile is often a potential client\'s first touchpoint. Treat it as a landing page: complete every field, upload credentials, and keep your response time green.',
      investor: 'Business account density on a marketplace platform signals professional supply depth, a metric that predicts higher average transaction values and lower dispute rates.',
      manager: 'When setting up a business account for your employer, coordinate with finance to get the EIN and billing contact ready before starting, incomplete accounts delay invoicing setup.',
      support_agent: 'Most business account setup issues involve EIN verification delays or license upload format errors. Walk the user through the accepted file types and verification timelines proactively.',
    },
  },
  {
    id: 'manage-business-invoicing',
    title: 'Manage Business Invoicing on OxSteed',
    category: 'business',
    difficulty: 'Easy',
    minutes: 8,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
    intro: 'Business invoicing lets you bill clients directly from OxSteed, with net terms, payment tracking, and automated reminders. Here\'s how to use it end to end.',
    steps: [
      'Enable business invoicing in your account settings.',
      'Create an invoice from any completed job or as a standalone document.',
      'Set payment terms: Net 15, Net 30, or due on receipt.',
      'Send the invoice, the client receives a payment link by email.',
      'Track outstanding invoices in your Billing dashboard.',
      'Enable auto-reminders at 7 days and 1 day before due date.',
    ],
    skills: ['Invoicing', 'Payment tracking', 'Net terms'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'When paying a business invoice on OxSteed, ACH bank transfer is typically free while card payments have a small processing fee. Choose your payment method at checkout.',
      helper: 'If a business client asks for net-30 invoicing, you need a business account. Individual helper accounts can only accept immediate payment through OxSteed checkout.',
      consultant: 'Net terms invoicing is a significant unlock for service businesses that work with commercial clients. Most commercial clients require net-15 or net-30 before they\'ll issue a PO.',
      business: 'Send invoices within 24 hours of job completion. Delayed invoicing increases collection friction, clients move on, memories fade, and disputes increase after the 72-hour window.',
      investor: 'Invoice aging (average days to collection) is a cash flow health metric for service businesses. Net-30 clients with a 45-day average collection are a cash flow problem in disguise.',
      manager: 'Review outstanding invoices weekly. Any invoice past due by 15+ days needs a personal call, not just an auto-reminder. The relationship value of a personal touch far exceeds the awkwardness of the call.',
      support_agent: 'Invoice disputes usually involve: amount discrepancy, service not completed as described, or payment already sent via another channel. Verify the job completion record first, then check payment logs.',
    },
  },
  {
    id: 'grow-your-business-on-oxsteed',
    title: 'Grow Your Business on OxSteed',
    category: 'business',
    difficulty: 'Medium',
    minutes: 15,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
    intro: 'OxSteed offers business owners multiple levers for growth: placement optimization, referral programs, anchor client relationships, and team expansion. This guide covers all four.',
    steps: [
      'Optimize your placement: maintain a response time under 2 hours and review score above 4.7.',
      'Activate the business referral program, each referred business earns you platform credits.',
      'Identify your top 3 clients and propose a service retainer for recurring work.',
      'Review your job acceptance rate monthly, anything below 60% signals pricing or capacity issues.',
      'Hire your next helper when your utilization stays above 80% for 3 consecutive weeks.',
    ],
    skills: ['Growth strategy', 'Client retention', 'Hiring triggers'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 25,
    tips: {
      customer: 'Businesses with retainer agreements with their best clients offer priority scheduling. If you use a service regularly, ask about a monthly retainer, it often gets you lower rates and guaranteed availability.',
      helper: 'When you hit 80% utilization consistently, the choice is: raise rates or hire. Both are good problems. Raising rates first tests price elasticity before adding overhead.',
      consultant: 'Business growth on service platforms follows a predictable S-curve: slow start, then rapid referral growth, then plateau. The plateau is usually a capacity or quality issue, diagnose before adding marketing spend.',
      business: 'The single highest-ROI growth action on OxSteed is maintaining a response time under 2 hours. Placement rank is heavily weighted on responsiveness, faster response = more visibility = more revenue.',
      investor: 'Revenue concentration risk is a real concern for service businesses. A business where one client represents 40%+ of revenue is fragile. Advise clients to diversify before that client relationship is tested.',
      manager: 'Track weekly revenue per active helper. If your revenue per helper is declining over time, you have a pricing problem or a quality problem. Diagnose before hiring.',
      support_agent: 'Growth-stage businesses often have the highest support volume as they onboard new team members and take on more clients. Prioritize their escalations and look for recurring issue patterns that signal a systemic problem.',
    },
  },

  // ── Manager guides ────────────────────────────────────────────────────────
  {
    id: 'run-daily-operations',
    title: 'Run Daily Operations as a Manager',
    category: 'management',
    difficulty: 'Easy',
    minutes: 10,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
    intro: 'A manager\'s day on OxSteed is dashboard-first: job queue, helper status, and client communications. Here\'s the daily operating rhythm that keeps everything running.',
    steps: [
      'Check the job queue at start of day: open, in-progress, and awaiting review.',
      'Confirm all helpers scheduled for today have checked in.',
      'Review any overnight messages or escalations from clients.',
      'Resolve any flagged jobs before noon, delays compound.',
      'End-of-day: review completions, approve invoices, note any follow-ups.',
    ],
    skills: ['Scheduling', 'Operations management', 'Escalation handling'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'If you\'re working with a managed team, your primary contact is the manager, not the individual helper. For scheduling changes or complaints, messaging the manager gets you faster resolution.',
      helper: 'A manager who checks in daily is a resource, not a supervisor. Use the daily check-in to flag any job concerns before they become client issues.',
      consultant: 'Operations cadence design is a high-value consulting deliverable. A manager with a clear daily rhythm resolves issues 40% faster than one who reacts to problems as they arise.',
      business: 'Your manager is the single point of accountability for daily operations. Give them the authority they need to make decisions without you, and a clear escalation threshold for what requires your input.',
      investor: 'Operational consistency, same quality, same speed, same communication every day, is the foundation of a scalable service business. Managers who build daily rhythms create that consistency.',
      manager: 'The best habit you can build: check the dashboard before you check messages. The dashboard tells you what\'s on fire; messages tell you what people think is on fire. Start with facts.',
      support_agent: 'When escalating to a managed business team, address the manager directly. Individual helper accounts often can\'t resolve billing, scheduling, or quality issues, the manager has the authority.',
    },
  },
  {
    id: 'manage-client-relationships',
    title: 'Manage Client Relationships at Scale',
    category: 'management',
    difficulty: 'Medium',
    minutes: 12,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
    intro: 'Managing multiple client relationships without dropping the ball requires a system. Here\'s how to track, communicate, and retain clients at volume.',
    steps: [
      'Segment clients: new (first 3 jobs), active (regular), and at-risk (no job in 60 days).',
      'Set a check-in cadence for each segment: weekly for new, monthly for active, immediate for at-risk.',
      'Use OxSteed\'s messaging templates for routine communications.',
      'Log every client issue and its resolution in the job notes, this builds your service history.',
      'Review at-risk clients quarterly and reach out personally before they churn.',
    ],
    skills: ['CRM basics', 'Client segmentation', 'Retention'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 25,
    tips: {
      customer: 'A manager who checks in proactively, before you have to complain, is a sign of a well-run service business. It\'s worth paying a small premium for that level of attention.',
      helper: 'If you manage your own client relationships, treat every client like a new one for the first three jobs. The habits you build in the first interactions define the long-term relationship.',
      consultant: 'Client segmentation is the foundation of scalable relationship management. Help clients build a simple tier system: white glove (top 20%), standard (middle 60%), self-serve (bottom 20%).',
      business: 'At-risk clients (60+ days inactive) are cheaper to reactivate than new clients are to acquire. A personal phone call has a 5–10× higher reactivation rate than an automated email campaign.',
      investor: 'Customer churn rate is the most important metric in a service business. Even small improvements in retention, 5% less churn, compound dramatically over 12–24 months.',
      manager: 'Build a client health score: last job date, review score, response rate, and issue frequency. Any client whose score drops two consecutive months needs a personal conversation, not an automated message.',
      support_agent: 'Client relationship issues that reach support are often a sign of a broken manager-client communication loop. Look for patterns: same manager, same type of complaint, different clients.',
    },
  },

  // ── Sales / Representative guides ────────────────────────────────────────
  {
    id: 'prospect-local-clients',
    title: 'Prospect Local Clients on OxSteed',
    category: 'sales',
    difficulty: 'Easy',
    minutes: 10,
    featured: true,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
    intro: 'OxSteed gives sales reps a local prospect universe: businesses posting jobs, helpers building teams, and property managers sourcing labor. Here\'s how to identify and approach the right ones.',
    steps: [
      'Filter the marketplace by your target category and zip code.',
      'Identify businesses with high job post volume but low helper retention.',
      'Build a prospect list: business name, contact, job categories, monthly volume.',
      'Craft an outreach message that references a specific job they posted.',
      'Follow up once at 5 days if no response, then move on.',
    ],
    skills: ['Prospecting', 'Local market research', 'Outreach'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'If you receive a sales outreach from a helper or service provider on OxSteed, check their profile reviews before engaging. Legitimate outreach will have a complete, verified profile.',
      helper: 'Proactive outreach to local businesses is a high-leverage growth strategy for experienced helpers. A business that posts 20 jobs a month is a better client than 20 one-time homeowners.',
      consultant: 'Referral-based prospecting is 5–10× more efficient than cold outreach. Before cold prospecting, exhaust your existing network, every satisfied client should be asked for one introduction.',
      business: 'If you\'re managing a sales rep on OxSteed, set clear criteria for who qualifies as a prospect: minimum monthly job volume, category match, and geography. Reps who chase too broadly waste time and miss the best opportunities.',
      investor: 'Sales rep efficiency (revenue generated per hour of outreach) is the key metric for evaluating a sales function. Track it from week one and set a ramp expectation for the first 90 days.',
      manager: 'Review your rep\'s prospect list weekly. Quality of prospects predicts quality of pipeline, a list of low-volume, low-fit businesses is a lagging indicator of missed quota.',
      support_agent: 'Sales reps contacting businesses through OxSteed messaging must comply with platform communication guidelines. Flag any outreach reported as spam to the trust and safety team.',
    },
  },
  {
    id: 'close-service-agreements',
    title: 'Close Service Agreements with Local Businesses',
    category: 'sales',
    difficulty: 'Medium',
    minutes: 12,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
    intro: 'A service agreement turns a one-time job into a recurring revenue relationship. Here\'s how to position, negotiate, and close retainer-style agreements with local business clients.',
    steps: [
      'Identify clients who have used your services 3+ times in the last 90 days.',
      'Calculate their current monthly spend, this is your retainer floor.',
      'Propose a retainer at a 10–15% discount in exchange for a 3-month commitment.',
      'Include service level commitments: response time, dedicated helper, priority scheduling.',
      'Send the agreement through OxSteed business invoicing for countersignature.',
    ],
    skills: ['Service agreement negotiation', 'Retainer pricing', 'Contract basics'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 25,
    tips: {
      customer: 'A retainer agreement with your primary service provider locks in rates, guarantees availability, and usually comes with a small discount. Ask your regular provider if they offer retainers.',
      helper: 'Retainer clients are the foundation of a stable income. One client at $800/month retainer covers your basic costs, everything above that is growth margin.',
      consultant: 'Service agreement structuring is a consulting deliverable with direct measurable impact. A consultant who converts three of a client\'s top customers to retainers has delivered thousands of dollars in annual revenue.',
      business: 'Retainer agreements change the client relationship from transactional to partnership. Clients on retainers provide more feedback, refer more often, and churn at half the rate of transactional clients.',
      investor: 'Recurring revenue percentage is a key valuation multiplier for service businesses. A business with 40% recurring revenue trades at 2–3× higher multiples than one with fully transactional revenue.',
      manager: 'Track retainer renewal rates monthly. A retention rate below 70% means the service level isn\'t meeting the commitment. Investigate before pitching new retainer clients.',
      support_agent: 'Retainer clients who contact support often have elevated expectations from their service level agreement. Review their agreement terms before responding, their SLA may grant them priority resolution.',
    },
  },
  {
    id: 'build-a-referral-pipeline',
    title: 'Build a Referral Pipeline',
    category: 'sales',
    difficulty: 'Easy',
    minutes: 8,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
    intro: 'The best sales pipeline is one that builds itself. Learn how to systematize referrals from happy clients so you spend less time prospecting and more time serving.',
    steps: [
      'Identify your top 10 happiest clients by review score and tenure.',
      'Ask each one for one introduction, not a referral in general, a specific person.',
      'Create a referral incentive: platform credits, rate discount, or a simple thank-you.',
      'Track every referral source so you know which clients generate the most introductions.',
      'Reinvest referral time savings into serving your best clients better.',
    ],
    skills: ['Referral generation', 'Client networking', 'Pipeline management'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'Referring a trusted service provider to a neighbor or colleague is one of the most valuable things you can do for them, and a good referral program makes it worth your while too.',
      helper: 'A referral from a happy client is worth 10 cold leads. Make asking for introductions part of your post-job routine, it\'s the highest-leverage habit in your sales toolkit.',
      consultant: 'Systematizing referrals is a marketing consulting deliverable that pays for itself. Most service businesses get referrals accidentally. A system turns accidents into a repeatable growth channel.',
      business: 'Measure referral conversion separately from cold outreach conversion. Referred leads typically convert at 3–5× the rate of cold leads, this difference should inform how you allocate sales time.',
      investor: 'Referral rate (referred customers / total new customers) is a proxy for NPS and product-market fit. High referral rates signal that service quality is strong enough to generate organic word-of-mouth.',
      manager: 'Build referral tracking into your CRM from day one. Knowing which clients are referral sources lets you prioritize them for white-glove service and re-engagement when they go quiet.',
      support_agent: 'Referral credit disputes are straightforward to resolve with the referral log. Pull the referral source record and confirm the credited amount matches the program terms before issuing adjustments.',
    },
  },

  // ── Support Agent guides ──────────────────────────────────────────────────
  {
    id: 'handle-first-contact-support',
    title: 'Handle First-Contact Support Like a Pro',
    category: 'support',
    difficulty: 'Easy',
    minutes: 10,
    featured: true,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)',
    intro: 'First-contact resolution, solving the issue without a transfer or follow-up, is the gold standard in support. Here\'s the framework for making it happen on OxSteed.',
    steps: [
      'Greet with name and confirm the issue in your own words before solving.',
      'Pull up the job record, payment history, and message thread before responding.',
      'Use the decision tree: billing → payment log first; quality → job completion record first.',
      'State your resolution clearly, including any timelines for credits or refunds.',
      'Ask if the resolution fully addresses the issue before closing.',
      'Document the issue type and resolution in the case notes for pattern tracking.',
    ],
    skills: ['Issue resolution', 'Active listening', 'Documentation'],
    tools: [],
    hireHref: null,
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'The best support interactions happen when you have your job confirmation number, the helper\'s name, and the specific issue ready before reaching out. Agents can solve faster with those three pieces.',
      helper: 'If a customer opens a support case about your job, respond to any agent requests within 4 hours. Delayed responses from helpers are the most common reason cases escalate to formal disputes.',
      consultant: 'Support workflow design is an operations consulting deliverable. A well-structured first-contact resolution process reduces cost-per-ticket, improves CSAT, and identifies product improvement opportunities.',
      business: 'Your business\'s support interaction quality is part of your brand. Train any team member who touches customer messages on the same resolution framework your support team uses.',
      investor: 'First-contact resolution rate (FCR) is the most important support efficiency metric. Platforms with FCR above 75% have significantly lower support cost per transaction and higher customer lifetime value.',
      manager: 'Review FCR weekly by agent and by issue type. If a specific issue type has low FCR, it needs a better decision tree or escalation path, not more agent training on a broken process.',
      support_agent: 'Confirm the issue before solving it. Agents who jump to resolution before fully understanding the problem resolve the wrong issue 20–30% of the time, creating a second contact that could have been avoided.',
    },
  },
  {
    id: 'resolve-job-disputes',
    title: 'Resolve Job Disputes Fairly and Fast',
    category: 'support',
    difficulty: 'Medium',
    minutes: 12,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)',
    intro: 'Job disputes, quality complaints, payment disagreements, no-shows, are the most emotionally charged support interactions. Here\'s the evidence-based resolution framework that keeps both parties satisfied.',
    steps: [
      'Pull all evidence first: job post, bid, messages, photos, and completion status.',
      'Hear each party separately, never in a group message thread.',
      'Apply the resolution matrix: who has the documented evidence?',
      'Offer resolution options rather than a single imposed decision where possible.',
      'Close the case with a written summary of the resolution and any credits issued.',
      'Flag repeated-dispute accounts for trust and safety review.',
    ],
    skills: ['Dispute resolution', 'Evidence evaluation', 'De-escalation'],
    tools: [],
    hireHref: null,
    toolsHref: null,
    xp: 25,
    tips: {
      customer: 'If you\'re disputing a job, gather your evidence before contacting support: photos of the work, the original job description, and any messages where you communicated your expectations.',
      helper: 'The best defense in a dispute is documentation you created at the time of the job: photos before and after, text confirmation of scope changes, and a signed condition checklist.',
      consultant: 'Dispute rate is a leading indicator of marketplace health. Platforms where disputes are rising faster than job volume are experiencing a supply quality problem, a demand quality problem, or both.',
      business: 'If your business is involved in a dispute, respond promptly and with documentation. A business that ghosts a support investigation will lose by default, regardless of the merits.',
      investor: 'Dispute rate per 1,000 transactions is a trust and quality benchmark. Leading marketplace platforms target under 2% dispute rates. Rates above 5% indicate a systemic quality or communication failure.',
      manager: 'Track your team\'s dispute rate by helper and by job type. A helper with a 10%+ dispute rate needs immediate coaching and temporary volume reduction, not just a written warning.',
      support_agent: 'Never issue a credit before reviewing all documentation. "Customer is upset" is not evidence. "Customer sent photos showing work was not completed as specified" is evidence. Stay evidence-first.',
    },
  },
  {
    id: 'de-escalate-difficult-conversations',
    title: 'De-escalate Difficult Conversations',
    category: 'support',
    difficulty: 'Medium',
    minutes: 10,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)',
    intro: 'Angry customers and frustrated helpers are a daily reality in marketplace support. Here\'s the communication framework that turns escalations into resolutions, without burning out.',
    steps: [
      'Let the person finish without interrupting, don\'t problem-solve until they\'re done.',
      'Acknowledge the frustration before explaining anything: "I can see why this is frustrating."',
      'Avoid defensive language: "our policy says" → "here\'s what I can do for you."',
      'State what you can do, then what you can\'t, never the reverse.',
      'Set a specific timeline: "I\'ll have an update for you by 3pm tomorrow" not "soon."',
      'Close by confirming understanding: "Does this resolution work for you?"',
    ],
    skills: ['De-escalation', 'Empathetic communication', 'Conflict resolution'],
    tools: [],
    hireHref: null,
    toolsHref: null,
    xp: 25,
    tips: {
      customer: 'A calm, specific complaint gets faster resolution than an angry, vague one. State what you expected, what happened instead, and what resolution you\'re looking for, that\'s the whole script.',
      helper: 'If a customer is unhappy, your first instinct should be curiosity, not defense. "Help me understand what you expected" opens more resolutions than "I did exactly what was in the job post."',
      consultant: 'De-escalation training is one of the highest-ROI investments a customer-facing team can make. A single well-handled escalation can preserve a relationship worth thousands in lifetime value.',
      business: 'Train every team member who communicates with customers on the four-part de-escalation framework: acknowledge, explain what you can do, set a timeline, confirm. It takes 30 minutes to teach and prevents hours of follow-up.',
      investor: 'Customer effort score (CES), how hard customers feel they have to work to get a resolution, is a stronger predictor of churn than satisfaction alone. Low-effort resolutions create loyal customers.',
      manager: 'Review escalated case transcripts monthly with your team. Walk through what worked and what didn\'t. This practice builds collective skill faster than any formal training program.',
      support_agent: 'The phrase "I understand your frustration" does more work than any policy explanation. Lead with empathy, follow with information. Customers who feel heard are 60% less likely to escalate further.',
    },
  },

  // ── Feature-derived guides ────────────────────────────────────────────────

  {
    id: 'book-a-helper-directly',
    title: 'Book a Helper Directly Without Posting a Job',
    category: 'customer',
    difficulty: 'Easy',
    minutes: 6,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fff7ed, #ffedd5)',
    intro: 'Direct booking lets you request a specific helper and time without putting your job in front of strangers. If you already trust someone, this is faster and more private.',
    steps: [
      'Find the helper\'s public profile via the helper directory or a shared link.',
      'Tap or click "Book", choose the service, date, and time you need.',
      'Add a note with any specific details the helper needs to know.',
      'Wait for the helper to confirm, you\'ll get a notification when they accept.',
      'If the helper declines or doesn\'t respond, you can convert the request into a public job.',
    ],
    skills: ['Direct booking', 'Private scheduling', 'Repeat hiring'],
    tools: [],
    hireHref: '/helpers',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'Direct booking is the fastest way to rehire a helper you\'ve already used. Their availability is live, if a slot is open, you can request it in under a minute.',
      helper: 'Encourage satisfied clients to use direct booking for repeat work. It bypasses the public bidding process and locks you in before competitors can respond.',
      consultant: 'Direct booking rates vs. public job acceptance rates tell you a lot about how much trust a helper has built. High direct booking volume = strong retention and reputation.',
      business: 'For recurring services (weekly cleaning, monthly maintenance), direct booking is more efficient than reposting jobs. Build preferred helper relationships and use direct booking to schedule them.',
      investor: 'Direct booking rate is a marketplace health metric. High direct booking volume signals trust accumulation and customer retention, both reduce acquisition cost over time.',
      manager: 'Use direct booking for your trusted helper roster. Assign recurring maintenance tasks to specific helpers via direct booking so they\'re already on your calendar before the season hits.',
      support_agent: 'Direct booking disputes (declined requests, expired requests) are different from public job disputes. Remind the customer that a declined direct booking doesn\'t prevent them from posting the job publicly.',
    },
  },
  {
    id: 'use-planned-needs',
    title: 'Plan Future Services So You\'re Never Surprised',
    category: 'life',
    difficulty: 'Easy',
    minutes: 10,
    featured: true,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fff1f2, #ffe4e6)',
    intro: 'Planned Needs turns future expenses into a daily savings habit. Instead of being blindsided by a $3,000 HVAC replacement, you see it coming and reserve money in advance.',
    steps: [
      'Go to Planned Needs and tap "Add a need."',
      'Name the need: "HVAC service," "brake replacement," "gutter cleaning."',
      'Set an estimated cost and a target date.',
      'OxSteed calculates how much to set aside per day, week, or month.',
      'When the date approaches, convert the planned need into a job post in one tap.',
      'Assign a preferred helper so they get first look when the job goes live.',
    ],
    skills: ['Future planning', 'Sinking funds', 'Service scheduling'],
    tools: [],
    hireHref: '/planned-needs',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'A planned need with a preferred helper is the most organized way to hire. The helper knows work is coming, you\'ve already set aside the money, and the job post is one tap away.',
      helper: 'When customers add you as a preferred helper for a planned need, you get first access to that job. Build this into your follow-up: "If you\'d like me back for the annual service, you can save me as a preferred helper."',
      consultant: 'Planned Needs is a financial planning tool, not just a scheduling tool. Advise clients to use it as a sinking fund tracker, the "reserve per week" view changes how people think about future expenses.',
      business: 'Property management businesses can use Planned Needs to model seasonal maintenance across multiple properties. The view gives a cash flow preview of upcoming obligations before they arrive.',
      investor: 'Planned Needs data reveals latent demand, services customers intend to buy but haven\'t posted yet. This is a leading indicator of future transaction volume and helps understand seasonal patterns.',
      manager: 'Use Planned Needs for property maintenance calendars. Set up the recurring services at the start of the year and let the reserve calculations guide your maintenance budget allocations.',
      support_agent: 'Customers sometimes confuse a Planned Need with an active job post. Clarify: a planned need is a future reservation, not a live listing. Help them convert it to a job when they\'re ready to hire.',
    },
  },
  {
    id: 'manage-helper-calendar',
    title: 'Manage Your Availability and Calendar',
    category: 'helper',
    difficulty: 'Easy',
    minutes: 8,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
    intro: 'A well-managed calendar means no overbooking, fewer cancellations, and customers who trust your reliability. Here\'s how to keep your availability accurate on OxSteed.',
    steps: [
      'Open your dashboard and go to the Calendar tab.',
      'Block out any days or times you\'re unavailable, standing commitments, vacations, recovery time.',
      'Set your standard weekly availability so customers see accurate open slots.',
      'Review incoming booking requests within 2 hours, expired requests hurt your ranking.',
      'Reschedule instead of canceling when possible, cancellations reduce your placement score.',
      'Set appointment reminders so you never miss a confirmed job.',
    ],
    skills: ['Calendar management', 'Availability setting', 'Booking management'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'A helper with accurate availability responds to booking requests faster and shows up when expected. Before hiring, check whether their calendar shows real availability or hasn\'t been updated.',
      helper: 'Treat your OxSteed calendar like your income calendar. Every unclaimed open slot is potential revenue. Review it Sunday night and fill gaps proactively before the week starts.',
      consultant: 'Calendar hygiene is an ops consulting deliverable. Helpers who block their calendar accurately get higher booking completion rates, the platform trusts their availability signals and promotes them higher.',
      business: 'For a multi-helper business, centralized calendar management is table stakes. Use the Business Hub calendar tab to see all staff availability in one view and prevent double-booking.',
      investor: 'Calendar utilization rate (booked slots / available slots) is the supply-side efficiency metric for service marketplaces. Helpers at 70%+ utilization represent platform revenue at scale.',
      manager: 'Run a weekly calendar audit: are all helpers\' availability windows accurate? Stale or over-generous availability windows lead to booking conflicts and customer complaints.',
      support_agent: 'Most scheduling complaints come from stale availability. Walk helpers through blocking out unavailable time and setting recurring availability before any dispute escalation.',
    },
  },
  {
    id: 'set-goals-on-oxsteed',
    title: 'Set and Track Goals on OxSteed',
    category: 'life',
    difficulty: 'Easy',
    minutes: 8,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fff1f2, #ffe4e6)',
    intro: 'Goals connect your dashboard activity to what actually matters, saving for a service, organizing your home, or building a more reliable maintenance routine.',
    steps: [
      'Go to the Goals tab in your dashboard.',
      'Create a goal: give it a name, target, and deadline.',
      'Link a sinking fund or planned need if the goal has a financial component.',
      'Review progress once a week, the dashboard shows how close you are.',
      'Mark goals complete and create the next one when you\'re done.',
    ],
    skills: ['Goal setting', 'Progress tracking', 'Financial planning'],
    tools: [],
    hireHref: '/dashboard',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'A home improvement goal linked to a sinking fund tells you exactly when you\'ll be ready to hire. It transforms "someday I should fix that" into "I\'ll post this job in April."',
      helper: 'Set income goals in OxSteed, monthly revenue, number of jobs, or new review count. The dashboard progress bars make it concrete and keep you from coasting during slow weeks.',
      consultant: 'Goals are the accountability layer that makes every other financial tool meaningful. A client who sets a goal and tracks it weekly makes better decisions than one who checks their balance once a month.',
      business: 'Business revenue goals in OxSteed give your team a shared target visible at the top of the workspace. A visible goal changes team behavior more than a goal that lives in a spreadsheet.',
      investor: 'Goals tied to specific investment returns create accountability. A rental property goal of $X net annual income, tracked monthly, surfaces underperformance before it becomes a trend.',
      manager: 'Set team goals at the start of each quarter: jobs completed, review score maintained, response time target. Mid-quarter check-ins against the dashboard are faster than quarterly reviews.',
      support_agent: 'Goals are dashboard-layer features. If a customer can\'t find or create goals, it\'s likely a navigation issue. Walk them to Dashboard → Goals tab before escalating.',
    },
  },
  {
    id: 'understand-payment-protection',
    title: 'How OxSteed Payment Protection Works',
    category: 'customer',
    difficulty: 'Easy',
    minutes: 8,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fff7ed, #ffedd5)',
    intro: 'Paying through OxSteed keeps your money safe. Understand how escrow-style job payments, invoices, and refund protection work, and why paying off-platform puts you at risk.',
    steps: [
      'Always pay through OxSteed, never send cash, Venmo, or Zelle to a helper.',
      'For jobs, your payment is held until work is confirmed complete.',
      'If work isn\'t done as described, open a dispute before releasing payment.',
      'For invoices, you have the payment record as proof for any future dispute.',
      'If a helper asks you to pay off-platform, report it, it violates OxSteed terms.',
    ],
    skills: ['Payment safety', 'Dispute basics', 'Escrow understanding'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'The moment you pay off-platform, OxSteed can\'t protect you. No dispute resolution, no refund process, no record. The convenience of Venmo is not worth the risk on a $500+ job.',
      helper: 'Getting paid through OxSteed protects you too. Every payment has a job record attached, which means no "I already paid you" disputes and a clean income record at tax time.',
      consultant: 'Payment protection education is part of customer onboarding. Advise clients to build an OxSteed payment policy into their service agreements so both parties understand expectations from the start.',
      business: 'All business transactions with helpers and subcontractors should run through OxSteed invoicing. This creates a documented payment trail that protects you in audits, disputes, and tax filings.',
      investor: 'Platform-mediated payment rate (% of transactions through OxSteed vs. off-platform) is a trust and compliance metric. High off-platform rates indicate trust gaps and lost revenue for the marketplace.',
      manager: 'Train helpers to never accept off-platform payment requests. Set it as a clear policy: all jobs booked through OxSteed are paid through OxSteed. No exceptions.',
      support_agent: 'Off-platform payment disputes are the hardest to resolve, we have no record of the transaction. When customers report this, gather any screenshots or messages as evidence and escalate to trust and safety.',
    },
  },
  {
    id: 'use-messages-to-prevent-disputes',
    title: 'Use Messaging to Prevent Disputes',
    category: 'customer',
    difficulty: 'Easy',
    minutes: 6,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fff7ed, #ffedd5)',
    intro: 'Most job disputes come from mismatched expectations that could have been caught in a message. Here\'s how to use OxSteed messaging to keep scope clear and create a record that protects both parties.',
    steps: [
      'Ask clarifying questions in OxSteed messages before accepting a bid, not by phone or text.',
      'Confirm scope in writing: "So you\'ll handle removal and haul-away, correct?"',
      'If anything changes during the job, update scope in the message thread.',
      'Take photos before the helper starts and ask them to do the same.',
      'Don\'t mark a job complete until you\'re satisfied, message the helper first if something is off.',
    ],
    skills: ['Scope documentation', 'In-platform communication', 'Pre-dispute resolution'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'Keep all job communication in OxSteed messages, not texts, not calls. If a dispute ever happens, the message thread is the evidence. Phone conversations leave no record.',
      helper: 'Confirm scope changes in writing immediately. A customer who verbally asks you to "add a few more things" while on-site should get a quick message: "Just confirming, I\'ll also handle X for an additional $Y. Sound good?"',
      consultant: 'Communication discipline is a professional differentiator. Helpers who document scope in writing have dispute rates 3–5× lower than those who rely on verbal agreements.',
      business: 'Set a company policy: all scope discussions happen in OxSteed. Any verbal scope change must be confirmed in the thread within 1 hour. This one rule prevents most billing disputes.',
      investor: 'Message thread quality is a proxy for marketplace professionalism. Platforms where helpers use in-platform communication correctly have lower dispute rates and higher customer satisfaction scores.',
      manager: 'Review disputed job message threads with your team monthly. Most disputes show a missed documentation moment, a verbal scope change, an unconfirmed expectation. Use these as training cases.',
      support_agent: 'The message thread is your primary evidence in any dispute. If a customer says "the helper agreed to X," ask for the message. If it\'s not in the thread, the agreement is very difficult to enforce.',
    },
  },
  {
    id: 'use-qr-codes-to-win-offline-leads',
    title: 'Win Offline Leads with QR Codes',
    category: 'helper',
    difficulty: 'Easy',
    minutes: 6,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
    intro: 'Your best leads often come from people who meet you in person, neighbors, referrals, people who see your truck. A QR code bridges the gap between that offline first impression and a booked job on OxSteed.',
    steps: [
      'Go to your OxSteed dashboard and open the QR Code generator.',
      'Generate a QR code that links to your public profile and booking page.',
      'Add it to your business card, invoice, truck decal, flyer, or job site sign.',
      'When someone scans it, they land on your full profile with booking enabled.',
      'Track the profile views and booking requests that come from new contacts.',
    ],
    skills: ['QR codes', 'Offline marketing', 'Profile sharing'],
    tools: [],
    hireHref: '/hire',
    toolsHref: null,
    xp: 10,
    tips: {
      customer: 'If you meet a helper in person and they hand you a card or flyer with a QR code, scan it before you forget. It brings you into their OxSteed profile where you can book, message, or save them for later.',
      helper: 'A QR code on a job site sign is passive lead generation, neighbors who see your work can scan and request a quote without you being there. One sign, infinite leads.',
      consultant: 'Offline-to-online conversion is a marketing consulting lever that most helpers ignore. A QR code investment is $0, the only cost is printing a business card or putting a decal on a truck.',
      business: 'Business QR codes should link to the business booking page, not just the profile. Make it as easy as possible for someone who scans to become a customer in one step.',
      investor: 'QR-driven traffic is organic, low-cost, and high-intent, people who scan want to learn more about that specific person or business. This is a quality lead signal worth tracking separately.',
      manager: 'Require all field staff to have a printed QR code on their work vehicle or uniform. This turns every job site into a passive lead source for the business.',
      support_agent: 'QR code issues are usually a stale link or a profile that\'s not fully set up. Walk the helper through regenerating their code and confirming their profile is public before troubleshooting further.',
    },
  },
  {
    id: 'master-the-business-hub',
    title: 'Master the Business Hub Workspace',
    category: 'business',
    difficulty: 'Medium',
    minutes: 15,
    featured: true,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
    intro: 'Business Hub is a 35-tab operations workspace covering finance, scheduling, team management, marketing, and analytics, all for your OxSteed business. This guide orients you to the tabs that matter most on day one.',
    steps: [
      'Open Business Hub from the navbar. If you have multiple businesses, the switcher lets you jump between them.',
      'Start in Overview: revenue, jobs, bookings, messages, and trend lines are all here.',
      'Set up your Services tab first, every bookable service needs to be defined before the booking engine can offer slots.',
      'Configure Hours so the booking engine knows when you\'re actually available.',
      'Go to Team and invite your first manager or representative with the right access level.',
      'Visit Health to see what\'s incomplete and what OxSteed recommends you fix next.',
    ],
    skills: ['Business Hub navigation', 'Service setup', 'Team access control'],
    tools: [],
    hireHref: '/business-hub',
    toolsHref: null,
    xp: 25,
    tips: {
      customer: 'When you book through a business\'s OxSteed profile, you\'re interacting with their Business Hub, their real-time availability, policies, and team are all managed there.',
      helper: 'If you\'re growing from a solo helper into a small operation, Business Hub is the workspace that scales with you. Start with Overview, Services, and Calendar, the rest can wait.',
      consultant: 'A Business Hub onboarding engagement has a clear scope: Services, Hours, Policies, and Team setup in session one; Pricing rules, Marketing, and Goals in session two. Two sessions, complete operational foundation.',
      business: 'The Health tab is your first stop when something feels off. It surfaces setup gaps that hurt placement, booking rates, or customer trust, fix those before running marketing.',
      investor: 'Business Hub tab utilization depth (how many tabs an operator actively uses) is a platform stickiness metric. Operators who use 10+ tabs churn at a fraction of the rate of those who use 3.',
      manager: 'Representatives in Business Hub can access Calendar, Messages, and Appointments, but not Tax, Goals, or Financial tabs. Set roles correctly from day one so you don\'t need to revoke access later.',
      support_agent: 'Most Business Hub support issues are setup-related: a missing service, stale hours, or a role assignment that blocks access. Start with the Health tab before diving into technical investigation.',
    },
  },
  {
    id: 'sell-products-on-oxsteed',
    title: 'Sell Products Through the OxSteed Marketplace',
    category: 'business',
    difficulty: 'Medium',
    minutes: 12,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
    intro: 'If your business has physical products, supplies, kits, parts, materials, or add-ons, you can list them on the OxSteed marketplace alongside your services. Here\'s how the product pipeline works.',
    steps: [
      'Go to Business Hub → Products tab.',
      'Add each product: name, description, photos, price, and stock quantity.',
      'Toggle "Publish to Marketplace" to make it visible to buyers.',
      'Set pricing rules if you want bulk discounts or segment-specific pricing.',
      'Manage orders from the Orders tab, fulfill and mark shipped from there.',
      'Use stock snapshots to avoid overselling: OxSteed reserves stock atomically at checkout.',
    ],
    skills: ['Product listing', 'Inventory management', 'Marketplace publishing'],
    tools: [],
    hireHref: null,
    toolsHref: '/products',
    xp: 25,
    tips: {
      customer: 'Products sold through OxSteed come with the same payment protection as services, you can dispute a product order if what arrives doesn\'t match the listing.',
      helper: 'Selling supply kits or materials alongside your services increases average transaction value. A plumber who sells replacement parts or a cleaner who sells cleaning kits earns more per customer.',
      consultant: 'Product marketplace strategy is a consulting deliverable: which products to list, how to price them, and whether to bundle with services. Bundling typically increases attach rate and margin.',
      business: 'Publishing products to the OxSteed marketplace is a low-friction distribution channel for surplus inventory or standard materials. One-click publish with stock control makes it operationally light.',
      investor: 'Product attachment rate (% of service customers who also buy a product) is a revenue expansion metric. Platforms where helpers sell both services and products have 30–50% higher average transaction values.',
      manager: 'Assign a team member to manage product listings and order fulfillment weekly. Stale stock counts and unfulfilled orders erode customer trust faster than any other product issue.',
      support_agent: 'Product disputes involve three common issues: item not as described, stock discrepancy, or shipping delay. Check the order record and product listing version that was live at time of purchase before adjudicating.',
    },
  },
  {
    id: 'secure-your-account',
    title: 'Secure Your OxSteed Account',
    category: 'life',
    difficulty: 'Easy',
    minutes: 8,
    featured: false,
    video_url: null,
    license_note: null,
    gradient: 'linear-gradient(135deg, #fff1f2, #ffe4e6)',
    intro: 'Your OxSteed account holds your payment methods, job history, and personal information. Ten minutes of security setup protects all of it.',
    steps: [
      'Enable two-factor authentication (2FA) in Settings → Security. This single step blocks 99% of unauthorized logins.',
      'Verify your email address so you receive alerts for account changes.',
      'Review connected devices and sign out of any you don\'t recognize.',
      'Set your notification preferences so you\'re alerted for logins, payment activity, and profile changes.',
      'Use a unique password, never reuse one from another account.',
    ],
    skills: ['Two-factor authentication', 'Account security', 'Notification setup'],
    tools: [],
    hireHref: null,
    toolsHref: null,
    xp: 10,
    tips: {
      customer: '2FA is the single highest-impact security action you can take in 5 minutes. If your email is compromised, 2FA on your OxSteed account still keeps your payment methods and job history protected.',
      helper: 'Your OxSteed account is your business. A compromised account can mean lost payment history, fake reviews, and unauthorized job acceptances. 2FA + a strong unique password is the minimum.',
      consultant: 'Account security is often overlooked during business onboarding. Add a security checklist to your client setup process: 2FA, verified email, notification preferences, reviewed devices.',
      business: 'Business accounts should have 2FA enabled for all owner-level users. Representative and manager accounts should use the same email domain as your business for easier access auditing.',
      investor: 'Platform security posture is a due diligence item. Marketplaces with high 2FA adoption rates among power users have lower fraud rates and lower chargebacks, both improve unit economics.',
      manager: 'Require 2FA for all team members with access to the Business Hub, especially anyone with payment or invoice access. This should be a condition of account creation, not an optional setting.',
      support_agent: 'Account takeover is the most urgent support issue. If a customer reports unauthorized access: immediately direct them to revoke all sessions in Settings, change their password, and enable 2FA. Escalate to security team same day.',
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const DIFFICULTY_COLOR = { Easy: '#22c55e', Medium: '#f97316', Hard: '#ef4444' };
const DIFFICULTY_XP    = { Easy: 10, Medium: 25, Hard: 50 };

// ── Persona tip metadata ──────────────────────────────────────────────────────
// Labels resolved with t() at render time.
const PERSONA_TIP_META = {
  guest:         { labelKey: 'learn.page.personaTip.guest',         Icon: User },
  customer:      { labelKey: 'learn.page.personaTip.customer',      Icon: User },
  helper:        { labelKey: 'learn.page.personaTip.helper',        Icon: TrendingUp },
  consultant:    { labelKey: 'learn.page.personaTip.consultant',    Icon: BookOpen },
  business:      { labelKey: 'learn.page.personaTip.business',      Icon: ShoppingBag },
  investor:      { labelKey: 'learn.page.personaTip.investor',      Icon: TrendingUp },
  manager:       { labelKey: 'learn.page.personaTip.manager',       Icon: ShoppingBag },
  support_agent: { labelKey: 'learn.page.personaTip.support_agent', Icon: BookOpen },
};

function normalize(str) { return String(str || '').toLowerCase(); }

function getPersona(user) {
  if (!user) return 'guest';
  if (user.role === 'support_agent') return 'support_agent';
  if (user.role === 'consultant') return 'consultant';
  if (user.role === 'investor' || user.is_investor) return 'investor';
  if (user.role === 'manager' || user.is_facilities_manager) return 'manager';
  if (user.is_business_owner || user.has_business) return 'business';
  if (user.is_helper) return 'helper';
  return 'customer';
}

// HERO uses translation keys; labels resolved with t() at render time.
const HERO = {
  guest:         { titleKey: 'learn.page.hero.guest.title',         subKey: 'learn.page.hero.guest.sub',         ctaKey: null,                              href: null },
  customer:      { titleKey: 'learn.page.hero.customer.title',      subKey: 'learn.page.hero.customer.sub',      ctaKey: 'learn.page.hero.customer.cta',      href: '/join?mode=helper' },
  helper:        { titleKey: 'learn.page.hero.helper.title',        subKey: 'learn.page.hero.helper.sub',        ctaKey: 'learn.page.hero.helper.cta',        href: '/helper-profile/skills' },
  consultant:    { titleKey: 'learn.page.hero.consultant.title',    subKey: 'learn.page.hero.consultant.sub',    ctaKey: 'learn.page.hero.consultant.cta',    href: null },
  business:      { titleKey: 'learn.page.hero.business.title',      subKey: 'learn.page.hero.business.sub',      ctaKey: 'learn.page.hero.business.cta',      href: '/business-hub' },
  investor:      { titleKey: 'learn.page.hero.investor.title',      subKey: 'learn.page.hero.investor.sub',      ctaKey: 'learn.page.hero.investor.cta',      href: '/marketplace' },
  manager:       { titleKey: 'learn.page.hero.manager.title',       subKey: 'learn.page.hero.manager.sub',       ctaKey: 'learn.page.hero.manager.cta',       href: '/post-job' },
  support_agent: { titleKey: 'learn.page.hero.support_agent.title', subKey: 'learn.page.hero.support_agent.sub', ctaKey: 'learn.page.hero.support_agent.cta', href: '/learn' },
};

function buildHowToLd(guides) {
  return (guides || []).map((g) => ({
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: g.title,
    description: g.intro,
    totalTime: `PT${g.minutes}M`,
    step: (g.steps || []).map((text, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      text,
    })),
    tool: (g.tools || []).map((t) => ({ '@type': 'HowToTool', name: t.name })),
  }));
}

// ── UGC submit form state ─────────────────────────────────────────────────────

const EMPTY_SUBMISSION = {
  title: '', category: 'plumbing', difficulty: 'Easy', estimated_minutes: 30,
  intro: '', steps: ['', ''], skills: [''], video_url: '', license_note: '',
  tools: [{ name: '', buy_url: '', rent_url: '' }],
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function LearnModePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery]                 = useState(searchParams.get('q') || '');
  const [activeCategory, setActiveCategory] = useState('all');
  const [expandedId, setExpandedId]       = useState(null);
  const [viewMode, setViewMode]           = useState('list');
  const [completions, setCompletions]     = useState({});
  const [completing, setCompleting]       = useState(null);
  const [remoteCatalog, setRemoteCatalog] = useState(null); // { guides: [...] } from /api/learn/guides
  const [productLinks,  setProductLinks]  = useState([]);   // admin-managed link overrides

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
  const { refresh: refreshRecs } = useRecommendations();

  const listRef    = useRef(null);
  const viewedRef  = useRef(new Set()); // guides already view-tracked this session

  const persona    = useMemo(() => getPersona(user), [user]);
  const hero       = HERO[persona] || HERO.guest;
  const categoryMap = useMemo(() => Object.fromEntries(CATEGORIES.map((c) => [c.id, c])), []);

  // ── Effects ──────────────────────────────────────────────────────────────────

  // App banner, show on mobile, once per session (Priority 13)
  useEffect(() => {
    const dismissed = localStorage.getItem(APP_BANNER_KEY);
    if (!dismissed && window.innerWidth < 768) setShowAppBanner(true);
  }, []);

  // Fetch guide stats for social proof (Priority 8), public, no auth needed
  useEffect(() => {
    api.get('/learn/stats')
      .then(({ data }) => { if (data.stats) setGuideStats(data.stats); })
      .catch(() => {});
  }, []);

  // Fetch canonical guide catalog so web + native stay in sync.
  // We merge it into the local GUIDES dataset to preserve web-only fields
  // like tips, gradients, and deep links.
  useEffect(() => {
    api.get('/learn/guides')
      .then(({ data }) => {
        if (Array.isArray(data.guides) && data.guides.length) setRemoteCatalog(data.guides);
      })
      .catch(() => {});
  }, []);

  // Fetch admin-managed product link overrides.
  // Fails open (empty array) when the endpoint or table isn't yet deployed.
  useEffect(() => {
    api.get('/learn/product-links')
      .then(({ data }) => {
        if (Array.isArray(data.products) && data.products.length) setProductLinks(data.products);
      })
      .catch(() => {});
  }, []);

  // Fetch earned badges (authenticated only)
  useEffect(() => {
    if (!user) return;
    api.get('/learn/badges')
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
      api.get('/learn/completions')
        .then(({ data }) => {
          const serverMap = {};
          (data.completions || []).forEach((c) => { serverMap[c.guide_id] = c.completed_at; });
          setCompletions((prev) => ({ ...prev, ...serverMap }));
        })
        .catch(() => {});
    }
  }, [user]);

  // ── Derived state ────────────────────────────────────────────────────────────

  const activeGuides = useMemo(() => {
    const remote = Array.isArray(remoteCatalog) ? remoteCatalog : [];
    if (!remote.length) return GUIDES;

    const byId = new Map(remote.map((g) => [g.id, g]));
    const baseIds = new Set(GUIDES.map((g) => g.id));

    const mergeTools = (baseTools, rTools) => {
      if (!Array.isArray(rTools) || !rTools.length) return baseTools;
      return rTools.map((t) => ({
        name: t?.name || '',
        rent: t?.rent || t?.rent_url || t?.rentURL || null,
        buy: t?.buy || t?.buy_url || t?.buyURL || null,
      }));
    };

    const merged = GUIDES.map((g) => {
      const r = byId.get(g.id);
      if (!r) return g;
      return {
        ...g,
        title: r.title || g.title,
        category: r.category || g.category,
        difficulty: r.difficulty || g.difficulty,
        minutes: r.minutes ?? g.minutes,
        featured: r.featured ?? g.featured,
        intro: r.intro || g.intro,
        steps: Array.isArray(r.steps) && r.steps.length ? r.steps : g.steps,
        skills: Array.isArray(r.skills) && r.skills.length ? r.skills : g.skills,
        tools: mergeTools(g.tools, r.tools),
        video_url: r.video_url ?? g.video_url,
        video_provider: r.video_provider ?? g.video_provider ?? null,
        xp: r.xp ?? g.xp,
      };
    });

    // Include any remote-only guides (so the website stays in sync without redeploys).
    const extras = remote
      .filter((r) => r?.id && !baseIds.has(r.id))
      .map((r) => ({
        id: r.id,
        title: r.title || 'Untitled guide',
        category: r.category || 'maintenance',
        difficulty: r.difficulty || 'Easy',
        minutes: r.minutes ?? 30,
        featured: !!r.featured,
        video_url: r.video_url || null,
        video_provider: r.video_provider || null,
        license_note: null,
        gradient: 'linear-gradient(135deg, #0b1220, #111827)',
        intro: r.intro || '',
        steps: Array.isArray(r.steps) ? r.steps : [],
        skills: Array.isArray(r.skills) ? r.skills : [],
        tools: mergeTools([], r.tools),
        hireHref: `/post-job?category=${encodeURIComponent(r.category || 'maintenance')}`,
        toolsHref: `/tool-rentals?category=${encodeURIComponent(r.category || 'maintenance')}`,
        xp: r.xp ?? null,
        tips: {},
      }));

    // Apply admin-managed product link overrides on top of the merged catalog.
    // Guide-scoped rows (guide_id set) beat global rows (guide_id null) for the
    // same tool name, same priority logic as the iOS app.
    const activeOverrides = productLinks.filter((p) => p.is_active !== false);
    if (!activeOverrides.length) return [...merged, ...extras];

    const applyOverrides = (guides) =>
      guides.map((guide) => {
        const updatedTools = guide.tools.map((tool) => {
          const nameLower = tool.name.toLowerCase();
          const match =
            activeOverrides.find((p) => p.tool_name.toLowerCase() === nameLower && p.guide_id === guide.id) ??
            activeOverrides.find((p) => p.tool_name.toLowerCase() === nameLower && !p.guide_id);
          if (!match) return tool;
          return {
            ...tool,
            buy:       match.buy_url   ?? tool.buy,
            rent:      match.rent_url  ?? tool.rent,
            link_type: match.link_type ?? tool.link_type,
          };
        });
        return updatedTools === guide.tools ? guide : { ...guide, tools: updatedTools };
      });

    return applyOverrides([...merged, ...extras]);
  }, [remoteCatalog, productLinks]);

  // Inject HowTo JSON-LD (SEO, Priority 10) from the merged guide catalog.
  // Keep the <script> node stable; just update its contents as the catalog updates.
  useEffect(() => {
    const id = 'ox-learn-howto-jsonld';
    let script = document.getElementById(id);
    if (!script) {
      script = document.createElement('script');
      script.id = id;
      script.type = 'application/ld+json';
      document.head.appendChild(script);
    }
    return () => {
      try { document.getElementById(id)?.remove(); } catch {}
    };
  }, []);

  useEffect(() => {
    const id = 'ox-learn-howto-jsonld';
    const script = document.getElementById(id);
    if (!script) return;
    script.textContent = JSON.stringify(buildHowToLd(activeGuides));
  }, [activeGuides]);

  const filteredGuides = useMemo(() => {
    const q = normalize(query);
    return activeGuides.filter((g) => {
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
  }, [query, activeCategory, activeGuides]);

  // Dynamic featured: top-3 by DB completion count, fallback to static featured flag
  const featuredGuides = useMemo(() => {
    const hasStats = Object.keys(guideStats).length > 0;
    if (hasStats) {
      return [...activeGuides]
        .sort((a, b) => (guideStats[b.id]?.completions ?? 0) - (guideStats[a.id]?.completions ?? 0))
        .slice(0, 3);
    }
    return activeGuides.filter((g) => g.featured);
  }, [guideStats, activeGuides]);
  const showFeatured   = !query && activeCategory === 'all';
  const completedCount = Object.keys(completions).length;
  const totalGuides    = activeGuides.length;

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const fireXpToast = useCallback((xp, badge) => {
    if (xpToastTimer.current) clearTimeout(xpToastTimer.current);
    setXpToast({ xp, badge });
    xpToastTimer.current = setTimeout(() => setXpToast(null), 4000);
  }, []);

  const handleComplete = useCallback(async (guideId) => {
    if (completions[guideId]) return;
    setCompleting(guideId);

    const guide = activeGuides.find((g) => g.id === guideId);
    const xp    = DIFFICULTY_XP[guide?.difficulty] ?? 10;
    const next  = { ...completions, [guideId]: Date.now() };
    setCompletions(next);
    localStorage.setItem(COMPLETIONS_KEY, JSON.stringify(next));

    let badgeAwarded = null;
    if (user) {
      try {
        const { data } = await api.post('/learn/completions', {
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

    // Bust recommendation cache so next visit reflects the new completion
    if (user) refreshRecs();

    // Helper post-completion prompt, suggest adding skill to profile
    if (persona === 'helper' && guide?.skills?.length) {
      setHelperPrompt({ guideTitle: guide.title, skill: guide.skills[0] });
    }

    setCompleting(null);
  }, [completions, user, persona, fireXpToast, activeGuides, refreshRecs]);

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
      api.post('/learn/views', { guide_id: id }).catch(() => {});
    }
  };

  // AI step prompt (Priority 7), opens the Ask AI widget with guide context
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
      await api.post('/learn/submissions', {
        ...submitForm,
        estimated_minutes: parseInt(submitForm.estimated_minutes, 10),
        steps:  submitForm.steps.filter(Boolean),
        skills: submitForm.skills.filter(Boolean),
        tools:  submitForm.tools.filter((tool) => tool.name.trim()),
      });
      setSubmitSuccess(true);
    } catch (err) {
      setSubmitError(err?.response?.data?.message || t('learn.page.submissionFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const activeCategoryLabel = activeCategory === 'all'
    ? t('learn.page.categories.all')
    : (categoryMap[activeCategory] ? t(categoryMap[activeCategory].tKey) : activeCategory);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <PageShell>
      <PageMeta
        title={t('learn.page.metaTitle')}
        description={t('learn.page.metaDesc')}
        noIndex
      />

      <div className="lrn-page">

        {/* ── Mobile app banner (Priority 13) ─────────────────────────────── */}
        {showAppBanner && (
          <div className="lrn-app-banner" role="banner">
            <Smartphone size={20} aria-hidden="true" />
            <span>{t('learn.page.appBannerText')}, <strong>{t('learn.page.appBannerCta')}</strong></span>
            <a
              href="https://apps.apple.com/us/app/oxsteed-marketplace/id6784977367"
              target="_blank"
              rel="noopener noreferrer"
              className="lrn-app-banner-btn"
            >
              {t('learn.page.appStore')}
            </a>
            <button
              type="button"
              className="lrn-app-banner-close"
              onClick={dismissAppBanner}
              aria-label={t('learn.page.dismissBanner')}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <div className={`lrn-hero lrn-hero--${persona}`}>
          <div className="lrn-hero-body">
            <p className="lrn-hero-eyebrow">{t('learn.page.hero.eyebrow')}</p>
            <h1 className="lrn-hero-title">{t(hero.titleKey)}</h1>
            <p className="lrn-hero-sub">{t(hero.subKey)}</p>
            <div className="lrn-hero-actions">
              {hero.ctaKey && (
                hero.href ? (
                  <Link to={hero.href} className="lrn-hero-cta">{t(hero.ctaKey)} →</Link>
                ) : (
                  <button
                    type="button"
                    className="lrn-hero-cta"
                    onClick={() => { setSubmitForm(EMPTY_SUBMISSION); setSubmitSuccess(false); setShowSubmitModal(true); }}
                  >
                    {t(hero.ctaKey)} →
                  </button>
                )
              )}
              {/* UGC submit button, helpers and consultants only (Priority 11) */}
              {user && (user.is_helper || user.role === 'consultant') && (
                <button
                  type="button"
                  className="lrn-hero-submit-btn"
                  onClick={() => { setSubmitForm(EMPTY_SUBMISSION); setSubmitSuccess(false); setShowSubmitModal(true); }}
                >
                  + {t('learn.page.modal.title')}
                </button>
              )}
            </div>
          </div>
          <div className="lrn-ladder">
            {['learn.step.1', 'learn.step.2', 'learn.step.3', 'learn.step.4'].map((stepKey, i) => (
              <span key={stepKey} className="lrn-ladder-step">
                <span className="lrn-ladder-num">{i + 1}</span>
                {t(stepKey)}
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
                const g = activeGuides.find((g) => g.id === id);
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
                  {c ? t(c.tKey) : cat}
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
              <strong>{helperPrompt.guideTitle}</strong> {t('learn.page.helperPromptCompleted')}
              {' '}{t('learn.page.helperPromptAdd', { skill: helperPrompt.skill })}
            </span>
            <Link to="/helper-profile/skills" className="lrn-helper-prompt-cta">{t('learn.page.helperPromptLink')}</Link>
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
            placeholder={t('learn.page.searchPlaceholder')}
            aria-label={t('learn.page.searchAriaLabel')}
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
              {t('learn.page.startHere')}
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
                      {cat ? t(cat.tKey) : null}
                    </span>
                    <span className="lrn-featured-name">{guide.title}</span>
                    <span className="lrn-featured-meta">
                      <span style={{ color: DIFFICULTY_COLOR[guide.difficulty] }}>{t(`learn.page.difficulty.${guide.difficulty}`, { defaultValue: guide.difficulty })}</span>
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
          <h2 className="lrn-section-label">{t('learn.page.browseByCategory')}</h2>
          <div className="lrn-categories">
            {CATEGORIES.map(({ id, tKey, Icon, color }) => {
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
                  <span>{t(tKey)}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Guide list ────────────────────────────────────────────────────── */}
        <section className="lrn-section" ref={listRef}>
          <div className="lrn-list-header">
            <h2 className="lrn-section-label">
              {t('learn.page.guidesCount', { label: activeCategoryLabel })}
              <span className="lrn-count">({filteredGuides.length})</span>
            </h2>
            <div className="lrn-view-toggle" role="group" aria-label={t('learn.page.viewMode')}>
              <button
                type="button"
                className={viewMode === 'list' ? 'is-active' : ''}
                onClick={() => setViewMode('list')}
                aria-pressed={viewMode === 'list'}
                title={t('learn.page.listView')}
              >
                <LayoutList size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={viewMode === 'grid' ? 'is-active' : ''}
                onClick={() => setViewMode('grid')}
                aria-pressed={viewMode === 'grid'}
                title={t('learn.page.gridView')}
              >
                <LayoutGrid size={16} aria-hidden="true" />
              </button>
            </div>
          </div>

          {filteredGuides.length === 0 ? (
            <div className="lrn-empty">
              <p>{t('learn.page.noResults', { query })}</p>
              <button type="button" onClick={() => { setQuery(''); setActiveCategory('all'); setSearchParams({}, { replace: true }); }}>
                {t('learn.page.clearFilters')}
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
                      <span className="lrn-grid-cat-label" style={{ color: cat?.color }}>{cat ? t(cat.tKey) : null}</span>
                      <span className="lrn-grid-name">{guide.title}</span>
                      <span className="lrn-grid-meta">
                        <span style={{ color: DIFFICULTY_COLOR[guide.difficulty] }} className="lrn-difficulty">{t(`learn.page.difficulty.${guide.difficulty}`, { defaultValue: guide.difficulty })}</span>
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
                    <span>{t('learn.page.moreComingSoon', { category: cat ? t(cat.tKey) : activeCategory })}</span>
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
                        {/* Video — YouTube/Vimeo URLs are normalized to embed form;
                            anything else falls back to the placeholder. */}
                        {/* Audit L11: video_url is admin-entered and unsigned, so the embed is
                            sandboxed (scripts + same-origin + presentation only, no top-level
                            navigation, no forms) and restricted to https: embed hosts. */}
                        {(() => {
                          const embedUrl = toEmbedUrl(guide.video_url, guide.video_provider);
                          return embedUrl ? (
                            <div className="lrn-video-wrap">
                              <iframe
                                src={embedUrl}
                                title={t('learn.page.videoTitle', { title: guide.title, defaultValue: `Video: ${guide.title}` })}
                                sandbox="allow-scripts allow-same-origin allow-presentation"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                              />
                            </div>
                          ) : (
                            <div className="lrn-video-placeholder">
                              <PlayCircle size={28} aria-hidden="true" />
                              <span>{t('learn.page.videoComingSoon', { defaultValue: 'Video coming soon' })}</span>
                            </div>
                          );
                        })()}

                        <p className="lrn-guide-intro">{guide.intro}</p>

                        {/* License callout */}
                        {guide.license_note && (
                          <div className="lrn-license-note" role="note">
                            <AlertTriangle size={15} aria-hidden="true" />
                            <span>{guide.license_note}</span>
                          </div>
                        )}

                        {/* What you'll need — marketplace kit panel */}
                        {Array.isArray(guide.tools) && guide.tools.length > 0 && (
                          <section
                            className="lrn-kit"
                            aria-label={t('learn.page.kitHeading', { defaultValue: "What you'll need" })}
                          >
                            <h3 className="lrn-detail-heading">
                              <ShoppingBag size={14} aria-hidden="true" />
                              {t('learn.page.kitHeading', { defaultValue: "What you'll need" })}
                            </h3>
                            <ul className="lrn-kit-grid">
                              {guide.tools.map((tool) => {
                                const isAffiliate = Boolean(tool.buy)
                                  && tool.link_type !== 'own_inventory'
                                  && tool.link_type !== 'rental';
                                return (
                                  <li key={tool.name} className="lrn-kit-card">
                                    <span className="lrn-kit-name">{tool.name}</span>
                                    <span className="lrn-kit-actions">
                                      {tool.rent && (
                                        <Link
                                          to={tool.rent}
                                          className="lrn-kit-rent"
                                          onClick={() => { try { window.gtag && window.gtag('event', 'learn_rent_clicked', { tool_name: tool.name }); } catch(_) {} trackLearnClick(guide.id, 'rent', tool.rent); }}
                                        >
                                          {t('learn.page.rent', { defaultValue: 'Rent' })}
                                        </Link>
                                      )}
                                      {tool.buy && (
                                        <a
                                          href={tool.buy}
                                          target="_blank"
                                          rel="noopener sponsored"
                                          className="lrn-kit-buy"
                                          aria-label={`${t('learn.page.buy', { defaultValue: 'Buy' })} ${tool.name}`}
                                          onClick={() => { try { window.gtag && window.gtag('event', 'learn_buy_clicked', { tool_name: tool.name, link_type: tool.link_type || 'affiliate' }); } catch(_) {} trackLearnClick(guide.id, 'buy', tool.buy); }}
                                        >
                                          {t('learn.page.buy', { defaultValue: 'Buy' })} <ExternalLink size={11} aria-hidden="true" />
                                        </a>
                                      )}
                                      {/* FTC + Amazon: "(paid link)" must appear near each affiliate link */}
                                      {isAffiliate && (
                                        <span className="lrn-tool-paid-label">{t('learn.page.paidLink', { defaultValue: '(paid link)' })}</span>
                                      )}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                            {/* Amazon Associates site-wide disclosure, required when any affiliate link is present */}
                            {guide.tools.some((tool) => tool.buy && tool.link_type !== 'own_inventory' && tool.link_type !== 'rental') && (
                              <p className="lrn-affiliate-disclosure">
                                {t('learn.page.amazonDisclosure', { defaultValue: 'As an Amazon Associate, OxSteed earns from qualifying purchases.' })}
                              </p>
                            )}
                          </section>
                        )}

                        <div className="lrn-detail-grid">
                          {/* Steps */}
                          <div className="lrn-detail-steps">
                            <h3 className="lrn-detail-heading">{t('learn.page.stepsHeading')}</h3>
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
                                      title={t('learn.page.askAiTitle')}
                                      aria-label={`${t('learn.page.askAiTitle')} ${i + 1}`}
                                    >
                                      <MessageCircle size={12} aria-hidden="true" />
                                      {t('learn.page.askAi')}
                                    </button>
                                  </span>
                                </li>
                              ))}
                            </ol>

                            {/* Completion */}
                            {done ? (
                              <div className="lrn-completed-badge">
                                <CheckCircle size={18} aria-hidden="true" />
                                {t('learn.page.guideCompleted', { xp: DIFFICULTY_XP[guide.difficulty] ?? 0 })}
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="lrn-complete-btn"
                                onClick={() => handleComplete(guide.id)}
                                disabled={completing === guide.id}
                              >
                                {completing === guide.id ? t('learn.page.saving') : t('learn.page.markComplete')}
                              </button>
                            )}
                          </div>

                          {/* Side panels */}
                          <div className="lrn-detail-side">
                            <div className="lrn-detail-panel">
                              <h3 className="lrn-detail-heading">{t('learn.page.skillsHeading')}</h3>
                              <div className="lrn-skill-chips">
                                {guide.skills.map((s) => <span key={s} className="lrn-chip">{s}</span>)}
                              </div>
                            </div>

                            {/* Persona-aware tips panel */}
                            {(() => {
                              const tip = guide.tips?.[persona] ?? guide.tips?.customer ?? null;
                              if (!tip) return null;
                              const meta = PERSONA_TIP_META[persona] ?? PERSONA_TIP_META.guest;
                              return (
                                <div className="lrn-tips-panel">
                                  <h3 className="lrn-detail-heading">
                                    <meta.Icon size={14} aria-hidden="true" />
                                    {t(meta.labelKey)}
                                  </h3>
                                  <p className="lrn-tips-text">{tip}</p>
                                </div>
                              );
                            })()}

                            {/* Persona CTA */}
                            <div className="lrn-detail-ctas">
                              {persona === 'helper' ? (
                                <>
                                  <p className="lrn-cta-label"><User size={13} aria-hidden="true" />{t('learn.page.ctaYouKnowSkill')}</p>
                                  <Link to="/helper-profile/skills" className="lrn-cta-primary">{t('learn.page.addToProfile')}</Link>
                                  <Link to={guide.hireHref} className="lrn-cta-secondary" onClick={() => trackLearnClick(guide.id, 'quote', guide.hireHref)}>{t('jobs.postJob', { defaultValue: 'Post a job in this category' })}</Link>
                                </>
                              ) : persona === 'customer' ? (
                                <>
                                  <p className="lrn-cta-label"><User size={13} aria-hidden="true" />{t('learn.page.ctaRatherNotDiy')}</p>
                                  <Link to={guide.hireHref} className="lrn-cta-primary" onClick={() => trackLearnClick(guide.id, 'helper', guide.hireHref)}>{t('learn.page.findHelper')}</Link>
                                  <Link to={guide.toolsHref} className="lrn-cta-secondary">{t('learn.page.rentTools')}</Link>
                                </>
                              ) : (
                                <>
                                  <p className="lrn-cta-label"><User size={13} aria-hidden="true" />{t('learn.page.ctaNeedHelp')}</p>
                                  <Link to={guide.hireHref} className="lrn-cta-primary" onClick={() => trackLearnClick(guide.id, 'helper', guide.hireHref)}>{t('learn.page.findHelper')}</Link>
                                  <Link to="/join?mode=helper" className="lrn-cta-secondary">{t('learn.page.offerAsService')}</Link>
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
                                : 'Complete enough guides in a category and you can list yourself as a Helper, turning what you learn into income.'}
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
          <span>{t('learn.page.xpEarned', { xp: xpToast.xp })}</span>
          {xpToast.badge && (
            <>
              <span className="lrn-xp-toast-sep">·</span>
              <Award size={14} aria-hidden="true" />
              <span className="lrn-xp-toast-badge">
                {t('learn.page.badgeUnlocked', { badge: (() => { const c = CATEGORIES.find((c) => c.id === xpToast.badge); return c ? t(c.tKey) : xpToast.badge; })() })}
              </span>
            </>
          )}
        </div>
      )}

      {/* ── UGC Submit Modal (Priority 11) ─────────────────────────────────── */}
      {showSubmitModal && (
        <div className="lrn-modal-overlay" role="dialog" aria-modal="true" aria-label={t('learn.page.modal.ariaLabel')}>
          <div className="lrn-modal">
            <div className="lrn-modal-header">
              <h2 className="lrn-modal-title">{t('learn.page.modal.title')}</h2>
              <button type="button" className="lrn-modal-close" onClick={() => setShowSubmitModal(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>

            {submitSuccess ? (
              <div className="lrn-modal-success">
                <CheckCircle size={40} aria-hidden="true" />
                <h3>{t('learn.page.modal.successTitle')}</h3>
                <p>{t('learn.page.modal.successMessage')}</p>
                <button type="button" className="lrn-cta-primary" onClick={() => setShowSubmitModal(false)}>{t('learn.page.modal.done')}</button>
              </div>
            ) : (
              <form className="lrn-modal-form" onSubmit={handleSubmitGuide}>
                <div className="lrn-modal-row">
                  <label className="lrn-modal-label">{t('learn.page.modal.titleLabel')} *
                    <input className="lrn-modal-input" type="text" maxLength={200} required
                      value={submitForm.title}
                      onChange={(e) => handleSubmitField('title', e.target.value)}
                      placeholder={t('learn.page.modal.titlePlaceholder')}
                    />
                  </label>
                </div>

                <div className="lrn-modal-row lrn-modal-row--cols">
                  <label className="lrn-modal-label">{t('learn.page.modal.categoryLabel')} *
                    <select className="lrn-modal-input" value={submitForm.category}
                      onChange={(e) => handleSubmitField('category', e.target.value)}>
                      {CATEGORIES.filter((c) => c.id !== 'all').map((c) => (
                        <option key={c.id} value={c.id}>{t(c.tKey)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="lrn-modal-label">{t('learn.page.modal.difficultyLabel')} *
                    <select className="lrn-modal-input" value={submitForm.difficulty}
                      onChange={(e) => handleSubmitField('difficulty', e.target.value)}>
                      {['Easy', 'Medium', 'Hard'].map((d) => <option key={d} value={d}>{t(`learn.page.difficulty.${d}`, { defaultValue: d })}</option>)}
                    </select>
                  </label>
                  <label className="lrn-modal-label">{t('learn.page.modal.minutesLabel')} *
                    <input className="lrn-modal-input" type="number" min={1} max={1440} required
                      value={submitForm.estimated_minutes}
                      onChange={(e) => handleSubmitField('estimated_minutes', e.target.value)}
                    />
                  </label>
                </div>

                <div className="lrn-modal-row">
                  <label className="lrn-modal-label">{t('learn.page.modal.introLabel')} *
                    <textarea className="lrn-modal-input lrn-modal-textarea" rows={3} maxLength={2000} required
                      value={submitForm.intro}
                      onChange={(e) => handleSubmitField('intro', e.target.value)}
                      placeholder={t('learn.page.modal.introPlaceholder')}
                    />
                  </label>
                </div>

                <div className="lrn-modal-row">
                  <p className="lrn-modal-label" style={{ marginBottom: '.5rem' }}>{t('learn.page.modal.stepsLabel', { n: 2 })}</p>
                  {submitForm.steps.map((step, i) => (
                    <div key={i} className="lrn-modal-step-row">
                      <span className="lrn-step-num">{i + 1}</span>
                      <input className="lrn-modal-input" type="text" maxLength={500}
                        value={step}
                        onChange={(e) => handleSubmitStep(i, e.target.value)}
                        placeholder={t('learn.page.modal.stepPlaceholder', { n: i + 1 })}
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
                      {t('learn.page.modal.addStep')}
                    </button>
                  )}
                </div>

                <div className="lrn-modal-row">
                  <p className="lrn-modal-label" style={{ marginBottom: '.5rem' }}>{t('learn.page.modal.skillsLabel')} *</p>
                  <div className="lrn-modal-skills-row">
                    {submitForm.skills.map((skill, i) => (
                      <div key={i} className="lrn-modal-skill-item">
                        <input className="lrn-modal-input" type="text" maxLength={80}
                          value={skill}
                          onChange={(e) => handleSubmitSkill(i, e.target.value)}
                          placeholder={t('learn.page.modal.skillPlaceholder')}
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
                        {t('learn.page.modal.addSkill')}
                      </button>
                    )}
                  </div>
                </div>

                <div className="lrn-modal-row">
                  <label className="lrn-modal-label">{t('learn.page.modal.videoLabel')}
                    <input className="lrn-modal-input" type="url" maxLength={500}
                      value={submitForm.video_url}
                      onChange={(e) => handleSubmitField('video_url', e.target.value)}
                      placeholder="https://www.youtube.com/embed/..."
                    />
                  </label>
                </div>

                <div className="lrn-modal-row">
                  <label className="lrn-modal-label">{t('learn.page.modal.licenseLabel')}
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
                  <button type="button" className="lrn-cta-secondary" onClick={() => setShowSubmitModal(false)}>{t('learn.page.modal.cancel')}</button>
                  <button type="submit" className="lrn-modal-submit-btn" disabled={submitting}>
                    <Send size={15} aria-hidden="true" />
                    {submitting ? t('learn.page.modal.submitting') : t('learn.page.modal.submit')}
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
