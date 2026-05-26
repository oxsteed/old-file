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
      customer: 'A dripping faucet wastes up to 3,000 gallons per year. If the drip restarts within a few weeks, the seat inside the faucet body is corroded — that means a full faucet replacement. Budget $15 in parts for this fix; hiring out runs $75–150.',
      helper: "List as 'Faucet Repair' — typical job runs $75–150. Upsell by checking the shutoff valve condition while you're under the sink.",
      consultant: 'Most guides gloss over faucet type differences. A great deep-dive would cover cartridge vs ball vs ceramic disc designs, how to identify yours before ordering parts, and why the same repair takes 15 minutes on one faucet and 90 on another.',
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
      customer: "Skip the chemical drain cleaners — they damage pipes and rarely fix the real clog. A $5 zip-it tool clears 90% of hair clogs permanently. If water backs up in multiple drains at once, the clog is in the main line, not the trap. Call a plumber.",
      helper: "Quick-win service: list as 'Drain Clearing.' Typical $80–120. Bring a snake and a zip-it to every plumbing call — it books itself.",
      consultant: "The most common mistake is skipping the P-trap removal step — guides that stop at 'snake and flush' leave readers confused when the clog is actually in the trap arm. A great guide would also cover how to recognize main-line backups before the reader wastes time on a trap-level fix.",
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
      customer: "Before buying parts, listen carefully: a hissing sound is the fill valve; a phantom flush (toilet fills on its own) is the flapper. Food coloring in the tank confirms a flapper leak — if the bowl water turns colored without flushing, the flapper is the culprit.",
      helper: "List as 'Toilet Repair.' Typical $100–180 with parts. Replace both flapper and fill valve in one visit — saves a callback and earns better reviews.",
      consultant: "Running toilets are one of the most misdiagnosed home repairs. A standout guide would walk readers through the diagnostic flow (listen → dye test → float check) before prescribing a fix, and would cover the phantom flush — a symptom that often sends people to buy the wrong part.",
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
      customer: "PTFE tape is non-negotiable — a dry connection will drip regardless of how tight you go. Wrap 2–3 clockwise layers so the tape locks as you thread. Avoid over-tightening with a wrench; one quarter-turn past hand-tight is enough.",
      helper: "Offer shower head upgrades as an add-on during any bathroom plumbing call. Typical $50–80 labor. Clients love a same-day visible improvement.",
      consultant: "Most readers don't know their shower arm thread pitch. A great guide would show how to identify the thread size, explain why some shower heads strip, and cover low-flow vs pressure-compensating designs — surprisingly few guides go beyond 'wrap and tighten.'",
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
      customer: "Sponge out the last inch of water before you remove the old valve or you'll get a face full when you pull it. Universal fill valves fit almost all toilets, but measure your tank depth first — if it's less than 10 inches, you need a low-profile model.",
      helper: "Bundle with a flapper swap for a complete 'Toilet Tune-Up' service — $130–180 all in. Prevents two separate callbacks.",
      consultant: "The float adjustment step is where readers get lost. A great guide would include a photo showing the 'fill line' marker on the overflow tube and explain why setting it too high causes phantom running even with a brand-new valve.",
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
      customer: "The main shutoff is the only thing standing between a slow drip and a flooded home. Find yours now, test that it turns fully, and tell everyone in your household where it is. A repair clamp buys time — have a licensed plumber make the permanent repair within 24–48 hours.",
      helper: "Emergency call premium applies — typical $200–400 for a temporary patch plus follow-up. Always carry assorted repair clamps. This gets 5-star reviews.",
      consultant: "Most burst-pipe content covers the repair clamp but skips the emotional reality: the homeowner is panicking. A great guide would open with 'first 60 seconds' decision flow — shut off, call insurance, document damage with photos. That's the content readers remember and share.",
      business: 'Print a one-page emergency protocol with main shutoff location for every property you manage. Train staff to respond within 30 minutes.',
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
    intro: 'A shutoff valve that won\'t fully close — or one that drips when open — leaves you unable to make any downstream repair. Replacing it takes an hour and requires only basic plumbing skills.',
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
      customer: "Old gate valves (oval handle, multiple turns to close) are increasingly unreliable — if you still have them, this is the upgrade to make. Modern ball valves close in a quarter-turn and last decades. If yours won't shut off fully during a repair, you'll be stuck calling a plumber mid-job.",
      helper: "Shutoff valve replacements are often bundled with other repairs — charge $80–140 for the upgrade while on site. A failed shutoff is a liability you can point to clearly, which makes the upsell easy.",
      consultant: "Most guides assume the reader knows the difference between a gate valve and a ball valve — and which they have. A great guide would open with that identification step and explain why gate valves fail over time (the seat corrodes), making the upgrade logical rather than optional.",
      business: 'Add shutoff valve condition to your property inspection checklist. A valve that only partially closes is a maintenance emergency waiting to happen. Upgrade to ball valves across all units on a rolling schedule.',
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
    intro: 'A toilet that wobbles or leaves water on the floor at the base has a failed wax ring. It\'s a messy job, but straightforward — and ignoring it leads to subfloor damage.',
    steps: [
      'Turn off the supply valve. Flush to empty the tank. Use a sponge and bucket to remove remaining water from the tank and bowl.',
      'Disconnect the supply line. Unscrew the two closet bolts at the toilet base. Lift the toilet straight up and set it on its side on a tarp.',
      'Scrape the old wax off the floor flange and the toilet horn using a putty knife. Clean both surfaces thoroughly.',
      'Press the new wax ring onto the toilet horn (wax side down) or onto the floor flange. Align the toilet over the flange bolts and lower it straight down — don\'t shift side to side once wax contacts the flange.',
      'Press down firmly and evenly to seat the wax. Hand-tighten the nuts alternately; snug but not over-tight (cracks the toilet base). Reconnect supply, restore water, flush, and check for leaks.',
    ],
    skills: ['Toilet removal and reinstall', 'Wax ring seating', 'Closet bolt and flange anatomy'],
    tools: [
      { name: 'Wax ring (with or without horn extension — check flange height)', rent: null, buy: amz('toilet wax ring with horn') },
      { name: 'Putty knife', rent: null, buy: amz('putty knife set') },
      { name: 'Adjustable wrench', rent: '/tool-rentals?category=hand-tools', buy: amz('adjustable wrench') },
      { name: 'Bucket and sponge', rent: null, buy: amz('utility bucket') },
      { name: 'Tarp or old drop cloth', rent: null, buy: amz('canvas drop cloth') },
    ],
    hireHref: '/post-job?category=plumbing',
    toolsHref: '/tool-rentals?category=plumbing',
    xp: 50,
    tips: {
      customer: "Before you lift the toilet, confirm the floor flange is at floor level. If it's recessed (below the tile), you'll need an extension ring in addition to the wax ring. Lifting a toilet incorrectly — twisting sideways on the wax — breaks the seal and forces you to start over with a new ring.",
      helper: "List as 'Toilet Reset/Wax Ring' — typical $150–250 including parts. Check the flange condition while you have it out. A damaged flange adds $100–200 to the job but prevents an immediate callback.",
      consultant: "The flange height question is the most common point of failure in DIY wax ring replacements. Most guides say 'press straight down' without explaining why (twisting shears the wax). A guide with a photo showing correct vs. incorrect alignment, plus clear guidance on when to use a wax-free gasket vs. a wax ring, would be distinctly useful.",
      business: 'Any toilet wobble in a unit should be addressed immediately — it means the wax ring is compromised and subfloor water damage is beginning. Train staff to report wobble as an urgent work order, not a cosmetic issue.',
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
      customer: "Never assume the breaker is labeled correctly. Always use a non-contact voltage tester at the switch wires before touching anything. If the circuit is a 3-way (two switches control one light), the wiring is different — this guide only covers single-pole switches.",
      helper: "Fast, high-margin task — typical $60–100 labor. Always carry a multi-pack of switches. Offer to upgrade to a dimmer while on site for easy upsell.",
      consultant: "The photograph-before-you-disconnect step is critical and most guides bury it. A better guide would put it as step one with a note: 'This 5-second photo is your insurance policy.' Also: many readers encounter travelers on 3-way circuits and get confused — addressing that distinction upfront prevents angry comments.",
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
      customer: "Fan-rated boxes are marked 'Suitable for Fan Support' on the side. If yours isn't rated, a fan-rated retrofit brace (about $15) installs through the existing hole in minutes without attic access. Don't skip this — fans vibrate and a non-rated box will pull free over time.",
      helper: "List as 'Ceiling Fan Install.' Typical $100–200 labor. Spring demand spike. Most time goes to box verification and cleanup — quote 2 hours to be safe.",
      consultant: "The blue wire (fan light kit) confuses most readers. A standout guide would explain the three scenarios clearly: one switch (cap blue to black), two switches (run two circuits), or remote/dimmer kit. That level of specificity separates a good guide from a great one.",
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
      customer: "GFCI outlets protect circuits downstream — the tripped outlet is often in a completely different room. Check the bathrooms, garage, kitchen, and outdoor areas systematically. If a GFCI won't stay reset (pops immediately), there's an active fault on the circuit. Don't force it — call an electrician.",
      helper: 'Instant value-add on any electrical service call. Explain downstream outlets to the client — it positions you as the expert, not just a button-pusher.',
      consultant: "GFCI content is everywhere, but almost none of it explains the 'daisy chain' topology — why tripping one GFCI kills outlets in other rooms. A guide that walks through how to trace the protected circuit would be genuinely useful and get shared by frustrated homeowners.",
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
      customer: "If your outlet tester shows 'hot/neutral reversed' after installing, your black and white wires are on the wrong terminals — swap them. The small slot (hot) connects to the brass screw; large slot (neutral) to silver. If you see scorching on the old outlet's wires, call an electrician before replacing it.",
      helper: "List as 'Outlet Replacement.' Typical $75–120 each. Offer USB outlet upgrades as a popular upsell — clients love the convenience.",
      consultant: "Most guides skip the backstab connector warning. A great outlet guide would explain why push-in (backstab) connections fail over time and why screw terminals are always preferable — this is the kind of professional nuance readers can't get from a quick YouTube video.",
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
      customer: "Mismatched dimmers hum or flicker — always check that your dimmer is rated for LEDs if you have LED bulbs (the packaging will say so). Also check your total wattage: if you have six 10W LEDs, your dimmer only needs to handle 60W, not the 600W incandescent maximum on the label.",
      helper: "Always upsell a dimmer when replacing a switch — add $30–50 for the upgrade. Clients get immediate value and you stay on site longer per job.",
      consultant: "Dimmer compatibility is one of the most confusing topics in home electrical. A genuinely useful guide would provide a decision tree: bulb type → dimmer type → minimum load requirement. The 'flickering at low levels' problem almost always comes down to minimum load, and no mainstream guide explains that clearly.",
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
      customer: "Support the old fixture while disconnecting — don't let it dangle by its wires. Wire nuts can work loose if not pushed in firmly and twisted clockwise. After restore, wobble the fixture gently to confirm the mount is secure before leaving it.",
      helper: "List as 'Light Fixture Install.' Typical $80–150 labor. Bundle with a dimmer switch install for $130–200 total — clients rarely say no.",
      consultant: "The unspoken challenge with fixture installs is weight and ceiling box load ratings. A great guide would cover the ceiling box weight limit (usually 35 lb for standard, 50 lb for fan-rated), how to identify the box type from the attic, and why chandelier-weight fixtures require a brace or new box.",
      business: 'Requires comfort with ladder work. Train with low-ceiling fixtures first. Always bring extra wire nuts in multiple sizes to every electrical call.',
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
    intro: 'Smart switches let you control lights by voice, schedule, or app — without replacing every bulb. Most require a neutral wire; this guide shows you how to identify it and wire the switch safely.',
    steps: [
      'Turn off the breaker for the circuit. Confirm power is off with a non-contact voltage tester before touching any wires.',
      'Remove the old switch. Photograph the existing wiring before disconnecting anything.',
      'Identify the wires: black (hot), white (neutral), bare or green (ground). Smart switches need all three — if you only have two, check for a neutral wire bundled in the back of the box.',
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
      customer: "The most common failure point is forgetting to check for a neutral wire before buying the switch. Look for a white wire bundled with wire nuts in the back of the box — it won't connect to the old switch but it's required for smart switches. If there's no neutral, look for smart switches that work without one (Lutron Caseta is the main option).",
      helper: "Smart switch installs are becoming one of the most requested small electrical jobs. Price at $75–120 per switch installed — clients buying multi-packs will often hire out the labor on all of them.",
      consultant: "The neutral wire problem is widely documented but guides rarely explain WHY it's needed: smart switches need a small constant current to power their Wi-Fi radio, and without a neutral the only path is through the bulb. A useful advanced guide would also cover 3-way smart switches, which require different wiring and a companion add-on switch or smart bulbs to work correctly.",
      business: 'Great recurring revenue: install smart switches during initial setup, then offer a smart home integration check-in annually. Inventory a few common neutral-required and no-neutral models to handle both wiring types.',
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
    intro: 'USB outlets replace a standard wall outlet and add built-in USB-A or USB-C ports — no adapter block needed. It is one of the safest DIY electrical swaps because the wiring is identical to a regular outlet.',
    steps: [
      'Turn off the breaker and verify power is off with a voltage tester.',
      'Remove the cover plate and unscrew the old outlet from the box. Pull the outlet out — note which wires go to which screw terminals.',
      'Disconnect the old outlet: black wire from brass (hot) screw, white wire from silver (neutral) screw, bare/green from green (ground) screw.',
      'Connect wires to the new USB outlet in the same positions. Tighten each screw firmly — a loose connection causes heat and fire risk.',
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
      helper: "USB outlet swaps are a popular small-ticket job — offer them as an add-on during any electrical visit. $40–60 per outlet installed. Clients in older homes with two-prong outlets will often buy GFCI+USB combo upgrades for the kitchen and bathrooms.",
      consultant: "A useful advanced guide would cover the wattage and charging standard differences — a USB-A port at 2.4A charges slowly compared to USB-C PD at 20W+. Most buyers don't know this when choosing an outlet. Covering how to read the spec sheet and match the outlet to the device being charged (phone vs. tablet vs. laptop) adds real practical value.",
      business: 'Ideal small job for less experienced staff — identical wiring to a standard outlet, no special tools needed. Track the brand and model installed in each unit so you can source replacements quickly if a unit fails.',
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
      customer: "The filter size is printed on the cardboard frame of the current filter — you don't need to measure. Thicker filters (4–5 inch) last longer but require a compatible housing. Write the next change date in permanent marker on the filter frame so you never forget.",
      helper: "Offer quarterly filter-swap subscriptions for $35–55/visit. Recurring income, minimal skill required, and clients love the convenience.",
      consultant: "Filter MERV ratings are widely misunderstood. A great guide would explain the trade-off: higher MERV = better filtration but more static pressure, which can overwork an older blower motor. That nuance — when to go to MERV 13 and when to stay at MERV 8 — is what readers with aging systems need.",
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
      customer: "If your AC shuts off unexpectedly in summer and restarts after a few hours, a clogged condensate drain triggering the float safety switch is the most common cause. Unclogging it takes 20 minutes and costs nothing. If the float keeps triggering, the drain line may need a dedicated vacuum flush.",
      helper: 'Add to your HVAC tune-up package — typical visit $85–125 bundled with filter change. Prevents expensive callbacks that damage your reviews.',
      consultant: "Most content on condensate drains covers the vinegar flush but not the wet-vac attachment method — which is far more effective for a fully clogged line. A great guide would include both methods, when to use each, and how to identify a float safety switch (and reset it) so readers can diagnose a surprise shutdown.",
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
      customer: "Regular duct tape (the grey fabric kind) is not suitable for ducts — it fails from heat over time. Use foil HVAC tape only. Even sealing 20% of accessible leaks makes a measurable difference on your energy bill. Focus on joints at the air handler first — that's where the highest pressure and biggest leaks are.",
      helper: "Add duct sealing to your HVAC service menu as an energy audit upsell — typical $150–300 for accessible duct sealing. Pair with a filter change.",
      consultant: "The distinction between mastic sealant and foil tape — and which to use when — is where most guides are vague. A well-researched guide would cover mastic for irregular or large gaps, foil tape for clean straight joints, and why neither should touch flex duct connections (those need specific flex-duct collars).",
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
      customer: "If clothes take two cycles to dry, the vent is almost certainly partially blocked — not a failed heating element. Check the exterior vent cap too: the louvers sometimes get clogged with lint from the outside. Clean annually at minimum; every 6 months if you do many loads per week.",
      helper: "Easy $75–120 recurring service. Offer annual reminder subscriptions. Pair with a furnace filter change to increase average ticket.",
      consultant: "The duct reattachment step is routinely skipped in dryer vent guides, and it's where most problems start: a loose connection leaks lint directly into the wall cavity. A great guide would emphasize reconnecting with foil tape (not the white plastic accordion duct that many dryers come with) and explain why plastic ducts are a fire hazard.",
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
      customer: "Pre-slit foam sleeves are easy to install but the slit gap can open up over time. After pressing the sleeve onto the pipe, run insulation tape along the slit seam for a proper seal. In freezing climates, insulating pipes in an unheated crawl space matters more than the water heater room — prioritize those.",
      helper: 'Offer as an energy efficiency add-on during any plumbing or HVAC call — $80–150 for a water heater room. Clients see monthly savings immediately.',
      consultant: "Most pipe insulation guides stop at straight runs. A useful advanced guide would cover elbow and T-fitting cuts (the 45-degree miter technique), what to do where pipes penetrate walls, and the difference between foam sleeves, fiberglass wrap, and self-sealing wrap — and when each is the right choice.",
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
      customer: "Patience between coats is the difference between visible and invisible. Joint compound must be bone dry (not just dry-looking) before the next coat — if it's cold or humid, give it 24 hours. Two thin feathered coats beat one thick coat every time.",
      helper: "List as 'Drywall Repair' — steady demand from landlords and realtors. Typical $100–250 per visit. Multi-hole jobs offer your best margin.",
      consultant: "The part guides get wrong: feathering technique. Most readers apply compound too thick and try to sand it smooth later, which never works. A great guide would emphasize that the final surface comes from the knife — not the sandpaper — and show how to hold the knife at a low angle for a clean feathered edge.",
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
      customer: "Most interior door handle sets use standard backset sizes (2-3/8\" or 2-3/4\" — measure from the door edge to the center of the hole). Your new handle set will include a template; use it even if the existing holes 'look right.' Misalignment by 1/8\" means the latch won't catch.",
      helper: "Fast job that pairs well with a lock upgrade upsell. Typical $60–100 labor. Keep a variety of finishes in your truck — clients often want to match existing hardware.",
      consultant: "The 'trim to fit' latch adjustment step trips up many readers — most sets have an adjustable backset but the instructions bury it. A great guide would lead with the two-measurement check (door thickness and backset) so readers buy the right set before starting, not after.",
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
      customer: "A stud finder gives false positives near electrical wires and HVAC pipes. Always confirm a stud with a nail or small screw before drilling your real holes. For drywall-only anchors, toggle bolts hold dramatically more weight than plastic expansion anchors — use them for anything heavier than a lamp.",
      helper: "High-demand in apartments and renovated homes. Typical $60–120 per shelf set. Batch multiple shelf installs in one visit to maximize earnings per trip.",
      consultant: "Most floating shelf guides assume the reader has studs exactly where they need them. The harder real-world question is what to do when no stud falls in the right spot. A great guide would walk through the alternatives: horizontal ledger board, French cleat, and toggle bolt spacing — with load estimates for each.",
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
      customer: "Not all squeaks are subfloor separation — some are joist hangers rubbing against the joist, or nail shafts loosening in the subfloor. Before you start driving screws, confirm the flex: have someone stand on the squeaky spot while you watch from below (if you have access). No flex = the problem is at the joist, not the subfloor.",
      helper: "Niche skill with low competition. Typical $80–150 per room. Clients are often frustrated after failed DIY attempts — you become the hero.",
      consultant: "Floor squeaks have three distinct causes — subfloor separation, joist movement, and finish floor rubbing — and the repair for each is different. Most guides only cover the subfloor case. A guide that opens with a diagnostic decision tree (access from below? hardwood or carpet? subfloor flex test?) would be genuinely distinct.",
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
      customer: "Measure your spline channel width before buying spline — it comes in 0.140\", 0.160\", and 0.175\" diameters and the wrong size either falls out or splits the frame. The convex (rounded) side of the spline roller goes in first; the concave side tucks and finishes. Keep mesh taut but don't stretch it or it will pull when you press the last edge.",
      helper: 'Batch screen repairs in spring — advertise a screen repair day and do a whole neighborhood in one trip. Typical $30–60 per screen installed.',
      consultant: "Screen repair guides never cover what to do when the aluminum frame is bent — which is the real reason screens get damaged. A complete guide would include how to straighten a minor frame bend with a rubber mallet and whether it's worth it vs. buying a replacement frame kit. That decision tree is what readers actually need.",
      business: 'Include in annual spring property prep. Keep mesh rolls and assorted spline sizes in your supply kit. Great task for entry-level staff.',
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
    intro: 'Baseboards hide the gap between flooring and drywall and give a room a finished look. Good results come from accurate miter cuts at corners and tight caulk at the top edge — not from luck.',
    steps: [
      'Measure each wall section and add 10% for waste. Mark stud locations with a stud finder — you need to nail into studs.',
      'Cut outside corners at 45 degrees with a miter saw. For inside corners, cope the second piece (cut the profile with a coping saw) rather than mitering both — cope joints stay tight when wood expands.',
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
      customer: "The biggest beginner mistake is mitering both inside corners — mitered inside corners open up as wood moves seasonally. Cope the second piece instead: trace the profile with a pencil, cut with a coping saw, and the joint stays tight year-round. It looks harder than it is and makes a huge difference in quality.",
      helper: "Baseboard installs are a high-demand finishing job — typical $3–5 per linear foot labor including material. A full room (40 lf) is $120–200. Bundle with door casing and window trim for full-room finishing packages.",
      consultant: "Most baseboard guides treat all corners as 45-degree miters. A great professional guide would cover the full decision tree: outside corners get miters, inside corners get coped, returns at door openings need mitered returns back to the wall. It would also cover how to handle out-of-square corners with a digital angle finder and how to scribe to uneven floors.",
      business: 'Fast job with high visual impact — clients immediately see the result. Train staff on cope cuts specifically; that skill is the differentiator between a rough finish and a professional one.',
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
      'Identify all damaged boards. Check for rot by poking with a screwdriver — rot is soft and the tip sinks in easily.',
      'Remove damaged boards by prying off with a flat bar. Start at the nails and work the board loose to avoid damaging adjacent boards.',
      'Measure the opening: width, height, and thickness of the existing boards. Buy matching cedar or pressure-treated boards.',
      'Cut new boards to length. Pre-drill nail holes near the ends to prevent splitting. For cedar, leave a 1/8" gap between boards for expansion.',
      'Nail each board to the rails using 1-5/8" galvanized or stainless deck screws (not nails — screws hold longer outdoors). Apply wood preservative to the cut ends.',
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
      customer: "Before buying boards, bring a sample board to the lumber yard. Cedar grades vary significantly — a clear cedar board next to a knotty cedar board will look mismatched in a year when they weather differently. Also check if your fence uses dog-ear or flat-top boards; they're not interchangeable without awkward patching.",
      helper: "Fence board repairs are easy recurring work — advertise 'fence health check' in spring. Typical $25–40 per board replaced including material. Spot-check the whole fence and quote all damaged boards at once.",
      consultant: "Fence repair guides rarely cover the post condition — which is almost always the deciding factor between a repair and a replacement. A genuinely useful guide would teach readers how to test post depth (less than 18 inches in ground is a problem), assess concrete footing integrity, and recognize when rot has moved from the board into the rail or post itself.",
      business: 'Excellent recurring property maintenance service. Create a fence inspection checklist to give clients after each visit — noting board condition, post wobble, and gate latch condition builds trust and generates future work orders.',
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
      customer: "The W pattern isn't about paint art — it prevents lap marks. Roll in a 3-foot-wide W, then fill it in with vertical strokes while the paint is still wet. Work in sections and keep a wet edge. Hiring out a single room runs $200–400; for that price you can do a whole house yourself.",
      helper: "List as 'Interior Wall Painting.' Typical single room: $200–450 including materials. Prep is your differentiator — clients see the difference.",
      consultant: "The most common reader mistake: they apply one thick coat instead of two thin ones and wonder why the finish looks uneven. A great guide would explain the chemistry of why thin coats level better, and address the most common failure mode — painting over dirty or greasy walls without cleaning first.",
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
      customer: "PVA primer is for new, uncoated drywall. For water stains or smoke damage, use an oil-based or shellac-based stain-blocking primer — latex won't seal those. The test: after primer dries, wipe the stained area with a damp cloth. If the stain bleeds into the cloth, prime again.",
      helper: 'Always include primer in your painting quote — charging $50–80 separately is fair and prevents client complaints about bleed-through.',
      consultant: "Stain-blocking primer is the category most guides handle superficially. A great guide would explain the three tiers: PVA (new drywall), water-based stain block (light stains), and shellac/oil-based (severe water damage, smoke, bleed-through knots in wood) — with photos showing what each stain type looks like after the wrong primer was used.",
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
      customer: "Remove tape at about 70% dry — not wet, not fully cured. Pulling dry tape tears paint with it. Score along the tape edge with a utility knife before pulling if you forgot and it fully dried. Semi-gloss trim paint should always get two coats; one coat looks thin over old paint even if coverage looks full when wet.",
      helper: "Trim painting is the highest-skill part of a paint job — clients will pay $150–300 just for crisp trim work. Own this skill and charge accordingly.",
      consultant: "The tape-removal timing tip is the single most useful piece of information in a trim guide — and almost no guide explains why (the paint skin becomes brittle as it cures and peels when tape is pulled). A guide built around the 'why' behind each technique would be far more memorable than a step list.",
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
      customer: "Color matching at a hardware store costs $5 and takes 10 minutes — far better than guessing. Bring a chip (not a photo) for accurate spectrophotometer scanning. The biggest disappointment in touch-ups is sheen mismatch: if the wall is eggshell, match eggshell exactly — flat paint on an eggshell wall shows the patch even if the color is perfect.",
      helper: "Touch-up calls are quick high-margin jobs — $60–120 for 30 minutes. Always bring a mini-roller: rolled walls need roller texture, not brush texture.",
      consultant: "Most touch-up guides skip the two-week cure caveat: fresh paint looks slightly different from cured paint in the same color, which can alarm clients who expected a perfect match. A guide that sets that expectation upfront — and explains why — prevents the most common 'it doesn't match' callback.",
      business: 'Photograph paint cans in every unit and store chip samples at your office. Color matching at move-out saves tenant disputes and respray costs.',
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
      'Inspect all exterior joints: where trim meets siding, where window frames meet the wall, around door frames. Mark gaps wider than 1/4" — those need backer rod before caulk.',
      'Remove old cracked caulk with a caulk removal tool or utility knife. Clean the surface with a stiff brush and let it dry completely.',
      'Load a paintable siliconized acrylic caulk into the gun. Cut the tip at a 45-degree angle — a smaller hole gives you more control.',
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
      customer: "Don't use silicone caulk on areas you plan to paint — silicone can't be painted and will peel the topcoat. Use paintable siliconized acrylic (a hybrid) for anything that will have paint over it. Pure silicone is only right for around tubs, sinks, and glass.",
      helper: "Exterior caulking is a high-leverage add-on during any paint job or exterior work call. Quote it separately: $80–150 for caulking a full house perimeter gives the client a clear preventive maintenance value. Do it during prep so it cures before the topcoat.",
      consultant: "Exterior caulk guides focus on application technique and rarely address the underlying structural cause of chronic gap-cracking: thermal movement. Wood trim can move 1/8\" seasonally. A guide covering how to choose a joint sealant by expected movement range — and when a gap is too large for caulk alone (needs flashing or backer rod first) — would give homeowners real diagnostic value.",
      business: 'Caulking is low-skill, high-impact preventive work. Include as a standard line item in any exterior paint estimate. Build it into your spring weatherproofing service package.',
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
    intro: 'Cabinet painting transforms a kitchen at a fraction of replacement cost — but it requires careful prep, the right primer, and patience between coats. Shortcuts here are always visible.',
    steps: [
      'Remove all doors and drawer fronts. Label each with painter\'s tape and a marker so they go back in the right position.',
      'Clean all surfaces with TSP substitute or a degreaser. Grease and cooking film prevent adhesion — this step determines whether paint lasts 3 years or 10.',
      'Lightly sand all surfaces with 120-grit, then 180-grit. Sand with the grain. Wipe dust with a tack cloth.',
      'Apply a shellac-based or bonding primer — not latex. This is non-negotiable on laminate, melamine, or previously varnished cabinets. Let dry fully, sand lightly with 220-grit.',
      'Apply two coats of cabinet-specific alkyd or waterborne alkyd paint with a foam roller (boxes) and a small brush (profiles). Let each coat cure fully — 24 hours minimum — before rehanging doors.',
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
      customer: "The two most common DIY cabinet painting failures are skipping the degreaser (paint peels within months) and using regular latex wall paint instead of cabinet-specific paint (it stays tacky and marks). Spend an extra $20 on the right primer and cabinet paint — it's the difference between a result that lasts and one you'll redo in two years.",
      helper: "Cabinet repainting is one of the highest-demand interior jobs: typical $600–1,200 for a standard kitchen. The prep is 60% of the job — clients who've tried it themselves almost always want to hand it off. Emphasize your use of bonding primer and alkyd topcoat to justify the price.",
      consultant: "Cabinet painting fails when guides skip the primer chemistry. A genuinely useful advanced guide would explain why shellac-based primer outperforms oil-based on laminate (alcohol solvent penetrates differently), when you can get away with a bonding water-based primer, and how to handle cabinets that have been previously painted with a latex coat (sand harder, prime heavier). That decision tree is what separates a professional refinisher from a DIY attempt.",
      business: 'Schedule cabinet jobs with a minimum 3-day window: Day 1 prep and prime, Day 2 first coat boxes and fronts, Day 3 second coat and rehang. Never rush the cure between coats — callbacks for peeling cabinets are expensive and reputation-damaging.',
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
      customer: "Never run the engine to 'warm up' oil before a change — 2 minutes is enough to improve flow; any longer and the drain plug burns your hand. The correct oil spec and filter part number are in your owner's manual, not on the dipstick. Overfilling by even a half quart causes foaming and can damage seals.",
      helper: "Mobile oil change is a growing niche — typical $50–90. Differentiate with a multi-point inspection report texted to the customer after each visit.",
      consultant: "The jack and stand setup is the step with the highest injury risk, and most guides either skip it or write 'use jack stands' without explaining how to find the lift points on different vehicle types. A truly useful guide would include a photo of the pinch weld location and explain why you never use a floor jack as a stand.",
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
      customer: "Driver and passenger blades are usually different lengths — check your vehicle's owner's manual or the lookup guide at an auto parts store. Most modern blades use a J-hook connector, but some vehicles use pin-arm, pinch-tab, or side-pin types. Installing the wrong connector style means the blade won't seat and will fly off at speed.",
      helper: 'Add-on service during any mobile auto visit — quick win that builds trust. Charge $20–35 including blades. Clients forget to do this themselves.',
      consultant: "Wiper blade sizing is the #1 point of confusion for this task — blade lengths aren't standardized by windshield size. A guide with a clear vehicle lookup instruction (not just 'check the owner's manual') and photos of all four common connector types would fill a real gap that YouTube videos don't address well.",
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
      customer: "Breaking lug nut torque while the car is on the ground is critical — trying to loosen them with the wheel in the air just spins it. Cross-pattern tightening (not circular) seats the wheel evenly. A torque wrench isn't optional for safety — undertightened lug nuts can cause wheels to come off at speed.",
      helper: "Bundle tire rotation with an oil change for a $90–130 full-service package. Customers love a one-stop mobile service — it sets you apart from quick-lube shops.",
      consultant: "Tire rotation guides always mention 'check the pattern in your owner's manual' but never explain the patterns or when to use each. A great guide would show the three standard patterns — front-to-rear, X-cross, and forward-cross — with diagrams explaining which is correct for FWD, RWD, AWD, and directional tires.",
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
      customer: "Your AC blowing weakly at the start of summer is often a clogged cabin filter, not a refrigerant issue. Before calling a mechanic, check the filter — dealerships charge $50+ in labor for a 10-minute owner task. Note the airflow direction arrow before removing the old filter or you'll install it backwards.",
      helper: 'Include with every oil change at $20–35 add-on. The profit margin is high and customers appreciate being informed — it builds trust for bigger jobs.',
      consultant: "Cabin air filter location varies enormously by vehicle — behind the glove box, under the dash, or under the hood. A guide that acknowledges this variance and shows all three access methods (with make/model examples) would be far more useful than the generic 'open the glove box' instruction that leaves half of readers confused.",
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
      customer: "Never open the radiator cap on a warm engine — pressurized coolant can cause severe burns. Always check the overflow reservoir instead. If brake fluid is consistently dropping between checks, you have a leak — don't just top it off. Low brake fluid is a safety emergency requiring a mechanic.",
      helper: 'Offer a monthly vehicle wellness check at $25–40 — great recurring revenue for minimal time. Catching a low brake fluid can prevent a serious accident.',
      consultant: "Fluid check guides are written for a generic car that doesn't exist. A great guide would address what readers actually encounter: electric power steering (no reservoir), sealed transmissions (no dipstick), and coolant DEX-COOL vs green compatibility issues. Those three edge cases represent about 40% of modern vehicles.",
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
      customer: "A bag of mulch covers about 8 sq ft at 3-inch depth — calculate your bed area and buy a few extra bags. Mulching up to the trunk (the 'mulch volcano' look) traps moisture against the bark and causes rot and pests over years. Keep a 2–3 inch clear ring around any plant stem or trunk.",
      helper: "High-demand spring service. Price by cubic yard — typical $50–100/yard installed. Offer a 'garden refresh' package combining weeding, edging, and mulch.",
      consultant: "The 'mulch volcano' error is so common that addressing it directly at the start of a guide immediately positions it as expert-level content. A great guide would also explain the difference between hardwood vs softwood vs rubber mulch and which is appropriate for which bed type — that's information clients genuinely don't know.",
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
      customer: "Call 811 before you dig even for a small tree — utility line damage carries full liability. Dig the hole wide, not deep: the root ball needs sideways room more than downward room. Water deeply once a week for the first year; shallow daily watering grows shallow roots.",
      helper: "Tree planting is premium landscaping — typical $150–350 per tree including labor. Always add a first-year care instruction sheet. Clients remember this.",
      consultant: "Root flare depth is the single most important concept in tree planting and the most violated. A great guide would include a side-by-side photo of a correct and an over-deep planting and explain why the tree looks fine for years and then dies suddenly. That story is memorable and makes the guide shareable.",
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
      customer: "A pressure regulator is not optional — most home spigots run at 50–80 PSI, but drip emitters are designed for 20–30 PSI. Without a regulator, emitters pop off or drip unevenly. A $12 regulator protects the whole system. Start with emitters closest to the spigot and flush the open ends before installing the last fittings.",
      helper: "Irrigation installs are one of the most profitable small landscaping services — typical $200–500 for a garden bed system. Recurring maintenance adds value.",
      consultant: "Most drip irrigation guides show a simple star layout but don't address manifold design for multi-zone beds, which is the real question most readers have. A great guide would cover zone planning (trees on one zone, vegetables on another), timer programming for different plant types, and how to add a soil moisture sensor to make the system truly water-smart.",
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
      customer: "Use cedar or redwood — they resist rot without chemical treatment. Pressure-treated wood contains copper that can leach into soil and isn't recommended for edible gardens. The 4×8 standard size is important: wider than 4 feet means you can't reach the center from either side without stepping in.",
      helper: "Popular spring project — typical $250–500 per bed including lumber and soil. Offer a package with drip irrigation and first-season plant selection.",
      consultant: "The soil mix question is the most under-covered part of raised bed guides. Most just say '60/40 topsoil and compost' without explaining how to identify quality topsoil (not clay, not stones) or why native soil alone produces poor results. A guide that covers the Mel's Mix alternative and the no-dig cardboard layering method would appeal to gardeners beyond the beginner level.",
      business: 'Great team project for newer landscaping staff — clear outcome, visible result, low risk. Pre-cut lumber at a hardware store to speed up job time.',
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
      'Disconnect the spark plug wire before working near the blade. Tilt the mower on its side with the carburetor facing up — if the carburetor faces down, oil enters the air filter.',
      'Use a wrench to remove the blade bolt (it\'s reverse-threaded on some models — check your manual). Mark the bottom face of the blade with chalk so you remount it the right way.',
      'Clamp the blade in a vise. Use a metal file or angle grinder to sharpen along the existing bevel angle (usually 30–45 degrees). Remove an equal amount from both ends to keep the blade balanced.',
      'Test balance: hang the blade on a nail through the center hole. If one end dips, remove a little more metal from that end. An unbalanced blade causes vibration that damages the engine bearings.',
      'Reinstall the blade — torque the bolt to spec (usually 35–50 ft-lbs for residential mowers). Reconnect the spark plug wire.',
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
      customer: "The balance step is often skipped but matters a lot. Even 5 grams of imbalance at 3,000 RPM creates significant vibration — over a season, an unbalanced blade can damage the spindle bearings. A blade balancing cone costs $4 and takes two minutes. Worth it.",
      helper: "Blade sharpening is a quick add-on during any lawn maintenance visit — add $15–25 and a 10-minute stop at the start of the season. Many clients have never done it and notice the lawn improvement immediately.",
      consultant: "A great advanced guide would cover the difference between sharpening and reconditioning: a blade with nicks deeper than 1/4\" or with a bent tip should be replaced, not sharpened. It would also cover the different bevel angles across commercial vs. residential blades and why matching the OEM angle matters for cut quality and blade life.",
      business: 'Include blade sharpening in your pre-season equipment checklist. Track sharpening dates per mower and replace blades when they\'ve been sharpened more than 4–5 times. A sharp blade reduces fuel consumption noticeably.',
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
      'Apply starter fertilizer per package directions and rake it in. Lightly water the soil before laying — it should be moist, not muddy.',
      'Lay the first row along a straight edge (a driveway or walkway). Stagger joints like brick — start every other row with a half piece. Butt pieces tightly together with no gaps and no overlaps.',
      'Water the sod immediately after laying. For the first two weeks, keep the sod consistently moist — twice daily in hot weather. After roots establish (lift a corner to check for resistance), reduce to deep infrequent watering.',
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
      customer: "Sod dries out fast after delivery — especially in hot weather. Plan to lay it the same day it arrives or the next morning at the latest. If you must hold it overnight, unroll it on a flat surface in the shade and water the rolls. Don't leave it stacked and rolled in direct sun.",
      helper: "Sod installation is physically demanding but high-margin: typical $1.00–1.50 per sq ft labor-only, $0.60–1.00/sq ft for sod itself. A 1,000 sq ft job runs $1,600–2,500 all-in. Subcontract soil prep (tilling) to focus your time on the sod itself.",
      consultant: "Sod guides almost always ignore grass type selection, which is the most important decision. Bermuda vs. Zoysia vs. Fescue vs. St. Augustine have dramatically different sun, water, and maintenance requirements — and the wrong grass for the climate or shading will fail within one season. A great guide leads with a grass-type selector by region and sun exposure before touching prep and installation.",
      business: 'Sod jobs require advance scheduling with suppliers — order 48 hours ahead minimum and confirm day-of delivery time. Assign your most reliable crew (timing and quality both matter). Log grass type and install date at each property to inform future maintenance recommendations.',
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
      customer: "The pre-fill-tub step seems odd but it's critical: the gap between the tub and tile wall is smallest when the tub is empty, then flexes wider when you stand in it. Applying caulk on an empty tub means it'll crack on first use. Fill tub, caulk, drain only after it cures.",
      helper: "Book caulking calls in batches — two bathrooms per trip is efficient. Typical $60–100 per tub. Bring three caulk colors to match any grout.",
      consultant: "Silicone vs latex caulk in a wet area is a question most guides answer superficially ('use silicone'). A great guide would explain why: latex eventually allows moisture vapor through, but pure silicone can't be painted. The real answer for most tubs is siliconized latex — a hybrid that's paintable and more water-resistant than plain latex. That nuance is genuinely useful.",
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
      customer: "Check the gutter pitch while you're up there — water should slope toward the downspout at 1/4\" per 10 feet. Pooling water in the gutter (sagging section) causes rust, leaks, and eventually fascia rot. Re-fastening a sagging hanger takes 5 minutes and prevents a $500 fascia repair.",
      helper: "Offer fall and spring gutter cleaning packages — $100–200 per visit depending on story height. Pair with downspout extensions for a quick upsell.",
      consultant: "Gutter cleaning guides universally skip the inspection component — and that's where the real value is. A guide that taught readers what to look for while cleaning (slope issues, rust spots, separated miters, downspout clogs vs. separated outlets) would convert a commodity cleaning chore into an actionable home health check.",
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
      customer: "Foam tape compresses over time and loses its seal — if your weatherstripping is more than 5 years old and you can see daylight around the door frame, it's time to replace it. V-strip (spring bronze) lasts 15–20 years and is more durable than foam for the door sides and top.",
      helper: "Include weatherstripping in a seasonal home-prep service. Typical $60–100 per door — fast and visible energy savings win 5-star reviews.",
      consultant: "Most weatherstripping guides treat all products as interchangeable. A great guide would explain the material hierarchy: foam tape (cheapest, shortest life), V-strip/spring bronze (self-closing, best for sides), compression strip (best for door stop), and silicone sweep (best for threshold). That framework helps readers buy right the first time.",
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
      customer: "Holding the nozzle too close or using a 0-degree (red) nozzle on concrete etches the surface permanently. Start at 18 inches and move closer only if needed. Pre-treat oil stains with degreaser for 5–10 minutes before washing or the high pressure just pushes the oil deeper into the concrete pores.",
      helper: "Power washing has low skill barrier and high demand — typical $100–250 for a driveway. Rent a 3,500 PSI commercial washer to cut job time in half.",
      consultant: "Most pressure washing guides skip the surface material nuances. A great guide would address when NOT to pressure wash — painted brick (removes paint), old mortar joints (can dislodge), stamped concrete (can strip sealer) — and suggest soft-washing as an alternative for delicate surfaces. That knowledge is what separates a professional from someone with a rented machine.",
      business: 'Schedule before property photos and before spring/summer move-in season. Track surface condition in property records — some surfaces need softer settings.',
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
      'Clean the joint area with a stiff brush and a tile cleaner. Let dry completely — new grout will not bond to wet or dirty joints.',
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
      customer: "The most important decision is sanded vs. unsanded grout. Sanded goes in joints 1/8\" and wider; unsanded for narrow joints (polished stone, glass tile). Using sanded grout in a narrow joint scratches the tile surface permanently. Measure your joint width with a ruler before buying — don't guess.",
      helper: "Re-grouting is a high-demand bathroom refresh job: $200–500 for a shower surround. Bundle with recaulking the floor-to-wall joint (use caulk, not grout, at all inside corners — grout cracks there). Clients who see the transformation often ask about resetting loose tiles at the same time.",
      consultant: "The failure mode everyone misses is incomplete old grout removal. Guides say 'remove half the joint depth' but rarely explain why — new grout bonds mechanically to the existing substrate, not to old grout. Any old grout left on the joint walls is a delamination waiting to happen. A genuinely useful guide would also address how to identify whether a popped tile means the substrate is wet underneath, which changes the repair scope entirely.",
      business: 'Re-grouting bathrooms is a strong recurring revenue service — typical shower grout lasts 5–10 years. Offer a bathroom grout inspection as a paid add-on during any plumbing or maintenance call and give clients a written condition report.',
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
      'Check the hinges first — tighten all screws. If a screw spins freely, the hole is stripped. Fill with a wooden toothpick and wood glue, let dry, then re-drive the screw.',
      'Close the door and look for gaps: a gap at the top-hinge corner with rubbing at the bottom-latch corner means the top hinge needs shimming. Cardboard under the hinge leaf shifts the door.',
      'If the door rubs along its full latch edge, it has swollen with humidity. Mark the binding point with a pencil on a closed door. Open the door and use a hand plane or belt sander to remove material from the marked area.',
      'Prime and paint any bare wood immediately after planing — raw wood absorbs moisture and the problem returns.',
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
      customer: "Check hinge screws before anything else — a single loose hinge screw is the cause of more sticking doors than anything else. Tightening three screws takes 2 minutes and solves about 40% of sticky door problems. Only move to planing if the hinges are tight and the door is still binding.",
      helper: "Sticking door calls are quick, high-ROI service calls — typical $60–100 for 20–30 minutes. Combine with a weather-stripping inspection and a door sweep check for a full 'door health' service. Spring is peak season as wood that swelled over winter starts to bind.",
      consultant: "Most sticky door guides attribute the problem to humidity swelling, which is one cause. A comprehensive guide would cover the full diagnostic tree: foundation settlement (gap pattern is distinctive — parallelogram not rectangle), hinge offset from wear (bottom corner sag), and frame racking from a structural load shift (requires more than a plane). Knowing which cause you're dealing with is the whole job.",
      business: 'Keep a few longer hinge screws (3\" #8) in your toolkit — often a sticking door from a shifted frame is fixed in 5 minutes by replacing the top hinge with a longer screw that bites into the stud. It\'s one of the fastest repairs in residential maintenance.',
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const DIFFICULTY_COLOR = { Easy: '#22c55e', Medium: '#f97316', Hard: '#ef4444' };
const DIFFICULTY_XP    = { Easy: 10, Medium: 25, Hard: 50 };

// ── Persona tip metadata ──────────────────────────────────────────────────────
const PERSONA_TIP_META = {
  guest:      { label: 'Homeowner Tip',           Icon: User },
  customer:   { label: 'Before You DIY',          Icon: User },
  helper:     { label: 'Offer This as a Service', Icon: TrendingUp },
  consultant: { label: 'Expert Perspective',      Icon: BookOpen },
  business:   { label: 'Managing at Scale',       Icon: ShoppingBag },
};

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

                            {/* Persona-aware tips panel */}
                            {(() => {
                              const tip = guide.tips?.[persona] ?? guide.tips?.customer ?? null;
                              if (!tip) return null;
                              const meta = PERSONA_TIP_META[persona] ?? PERSONA_TIP_META.guest;
                              return (
                                <div className="lrn-tips-panel">
                                  <h3 className="lrn-detail-heading">
                                    <meta.Icon size={14} aria-hidden="true" />
                                    {meta.label}
                                  </h3>
                                  <p className="lrn-tips-text">{tip}</p>
                                </div>
                              );
                            })()}

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
