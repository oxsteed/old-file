import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Car,
  ChevronRight,
  Clock,
  Droplet,
  Hammer,
  Leaf,
  LayoutGrid,
  Paintbrush,
  Search,
  ShoppingBag,
  Thermometer,
  User,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import './LearnModePage.css';

// ── Categories ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'all',         label: 'All',         Icon: LayoutGrid,  color: '#f97316' },
  { id: 'plumbing',    label: 'Plumbing',    Icon: Droplet,     color: '#0ea5e9' },
  { id: 'electrical',  label: 'Electrical',  Icon: Zap,         color: '#eab308' },
  { id: 'carpentry',   label: 'Carpentry',   Icon: Hammer,      color: '#8b5cf6' },
  { id: 'hvac',        label: 'HVAC',        Icon: Thermometer, color: '#14b8a6' },
  { id: 'painting',    label: 'Painting',    Icon: Paintbrush,  color: '#ec4899' },
  { id: 'car-care',    label: 'Car Care',    Icon: Car,         color: '#6366f1' },
  { id: 'landscaping', label: 'Landscaping', Icon: Leaf,        color: '#22c55e' },
  { id: 'general',     label: 'General',     Icon: Wrench,      color: '#94a3b8' },
];

// ── Guide data ────────────────────────────────────────────────────────────────

const GUIDES = [
  // Plumbing
  {
    id: 'fix-leaky-faucet',
    title: 'Fix a Leaky Faucet',
    category: 'plumbing',
    difficulty: 'Easy',
    minutes: 30,
    intro: 'A dripping faucet wastes gallons a day and usually comes down to a worn washer or O-ring — both cost under a dollar.',
    steps: [
      'Turn off water supply valves under the sink. Turn on the faucet to release remaining pressure.',
      'Remove the handle by unscrewing the decorative cap and the screw underneath.',
      'Unscrew the packing nut and pull out the stem.',
      'Inspect the rubber washer and O-ring at the bottom of the stem. Replace both.',
      'Reassemble in reverse order. Turn the supply valves back on and test.',
    ],
    skills: ['Shutoff valve operation', 'Basic disassembly', 'Washer replacement'],
    tools: [
      { name: 'Adjustable wrench', href: '/tool-rentals?category=hand-tools' },
      { name: 'Flathead + Phillips screwdrivers', href: '/products?q=screwdriver+set' },
      { name: 'Replacement washers and O-rings', href: '/products?q=faucet+repair+kit' },
    ],
    hireHref: '/post-job?category=plumbing',
    toolsHref: '/tool-rentals?category=plumbing',
  },
  {
    id: 'unclog-drain',
    title: 'Unclog a Drain',
    category: 'plumbing',
    difficulty: 'Easy',
    minutes: 20,
    intro: 'Most slow drains are a hair-and-soap buildup in the trap — no chemicals needed, just the right tool and a little patience.',
    steps: [
      'Remove the drain stopper (usually just lifts out or unscrews).',
      'Use a drain snake or zip-it tool to pull out debris. Go at least 12 inches deep.',
      'Run hot water for 30 seconds to flush loosened buildup.',
      'If still slow, place a bucket under the P-trap and unscrew the slip-joint nuts. Clean the trap and reinstall.',
      'Test the drain and check the trap connections for leaks.',
    ],
    skills: ['Drain snake use', 'P-trap removal', 'Slip-joint fittings'],
    tools: [
      { name: 'Drain snake or zip-it tool', href: '/products?q=drain+snake' },
      { name: 'Bucket', href: '/products?q=utility+bucket' },
      { name: 'Tongue-and-groove pliers', href: '/tool-rentals?category=hand-tools' },
    ],
    hireHref: '/post-job?category=plumbing',
    toolsHref: '/tool-rentals?category=plumbing',
  },
  {
    id: 'fix-running-toilet',
    title: 'Fix a Running Toilet',
    category: 'plumbing',
    difficulty: 'Medium',
    minutes: 45,
    intro: 'A toilet that keeps running after flushing is almost always the flapper or fill valve — both are inexpensive and beginner-friendly.',
    steps: [
      'Lift the tank lid and listen. Hissing = fill valve. Water running into bowl = flapper.',
      'To fix the flapper: turn off the shutoff, flush to empty, unhook the old flapper, snap on the new one.',
      'To fix the fill valve: turn off the shutoff, flush to empty, unscrew the lock nut at the base of the old valve, and twist in the new one.',
      'Set the water level to about 1 inch below the overflow tube.',
      'Turn the water back on. Let the tank fill and verify the running has stopped.',
    ],
    skills: ['Toilet tank anatomy', 'Flapper replacement', 'Fill valve replacement'],
    tools: [
      { name: 'Universal flapper', href: '/products?q=toilet+flapper' },
      { name: 'Fill valve kit', href: '/products?q=toilet+fill+valve' },
      { name: 'Adjustable wrench', href: '/tool-rentals?category=hand-tools' },
    ],
    hireHref: '/post-job?category=plumbing',
    toolsHref: '/tool-rentals?category=plumbing',
  },

  // Electrical
  {
    id: 'replace-light-switch',
    title: 'Replace a Light Switch',
    category: 'electrical',
    difficulty: 'Easy',
    minutes: 15,
    intro: 'Swapping a standard single-pole switch is one of the safest electrical tasks — as long as you confirm the circuit is off first.',
    steps: [
      'Turn off the circuit breaker. Confirm power is off with a non-contact voltage tester.',
      'Unscrew the cover plate and pull the switch out from the box.',
      'Photograph the existing wiring before disconnecting anything.',
      'Unscrew the terminals and transfer the wires to the new switch: black to brass, white (marked) to brass, bare copper to green.',
      'Push the switch back in, screw it down, reinstall the cover plate, and restore power.',
    ],
    skills: ['Breaker shutoff', 'Voltage testing', 'Basic wiring connections'],
    tools: [
      { name: 'Non-contact voltage tester', href: '/products?q=voltage+tester' },
      { name: 'Flathead + Phillips screwdrivers', href: '/products?q=screwdriver+set' },
      { name: 'Replacement switch', href: '/products?q=light+switch' },
    ],
    hireHref: '/post-job?category=electrical',
    toolsHref: '/tool-rentals?category=electrical',
  },
  {
    id: 'install-ceiling-fan',
    title: 'Install a Ceiling Fan',
    category: 'electrical',
    difficulty: 'Medium',
    minutes: 90,
    intro: 'Installing a fan is manageable if the existing box is fan-rated. If you\'re replacing a light fixture, check the box first.',
    steps: [
      'Turn off the circuit breaker. Confirm the existing box is fan-rated (it must support dynamic load).',
      'Install the mounting bracket over the box according to the fan\'s instructions.',
      'Assemble the motor and canopy on the ground. Then lift and hang it on the bracket hook.',
      'Connect wiring: black to black, white to white, bare to bare. If there\'s a blue wire (light kit), connect it to black or a separate switch.',
      'Attach the blades and light kit if included. Restore power, test both speeds and the light.',
    ],
    skills: ['Fan-rated box identification', 'Wire connections', 'Blade balancing'],
    tools: [
      { name: 'Non-contact voltage tester', href: '/products?q=voltage+tester' },
      { name: 'Drill + bits', href: '/tool-rentals?category=power-tools' },
      { name: 'Ladder', href: '/tool-rentals?category=access' },
      { name: 'Wire connectors (supplied or separately)', href: '/products?q=wire+nuts' },
    ],
    hireHref: '/post-job?category=electrical',
    toolsHref: '/tool-rentals?category=electrical',
  },
  {
    id: 'reset-gfci',
    title: 'Reset a GFCI Outlet',
    category: 'electrical',
    difficulty: 'Easy',
    minutes: 5,
    intro: 'GFCI outlets protect against shock in wet areas. When one trips, it can kill power to several outlets downstream — here\'s how to find and reset it.',
    steps: [
      'Look for the outlet with TEST and RESET buttons — it may not be in the same room as the dead outlet.',
      'Check for moisture or damage around the outlet before touching anything.',
      'Press the RESET button firmly until it clicks. Power should restore immediately.',
      'Plug in a lamp or use an outlet tester to confirm.',
      'If the outlet trips again immediately, stop and call an electrician — there\'s an underlying fault.',
    ],
    skills: ['GFCI identification', 'Circuit tracing', 'When to stop'],
    tools: [
      { name: 'Outlet tester', href: '/products?q=outlet+tester' },
    ],
    hireHref: '/post-job?category=electrical',
    toolsHref: '/tool-rentals?category=electrical',
  },

  // HVAC
  {
    id: 'replace-hvac-filter',
    title: 'Replace Your HVAC Filter',
    category: 'hvac',
    difficulty: 'Easy',
    minutes: 10,
    intro: 'A clogged filter makes your system work harder, raises your energy bill, and shortens the unit\'s life. Replace it every 1–3 months.',
    steps: [
      'Find the filter slot — typically on the return air vent or at the air handler unit.',
      'Note the size printed on the existing filter frame before buying a replacement.',
      'Turn off the thermostat. Slide out the old filter and note the airflow direction arrow.',
      'Slide in the new filter with the arrow pointing toward the unit (away from the return duct).',
      'Write the install date on the frame with a marker. Turn the thermostat back on.',
    ],
    skills: ['Filter sizing', 'Airflow direction', 'Replacement schedule'],
    tools: [
      { name: 'Replacement pleated filter (match your size)', href: '/products?q=hvac+filter' },
      { name: 'Permanent marker', href: '/products?q=permanent+marker' },
    ],
    hireHref: '/post-job?category=hvac',
    toolsHref: '/tool-rentals?category=hvac',
  },
  {
    id: 'clean-condensate-drain',
    title: 'Clear Your AC Condensate Drain',
    category: 'hvac',
    difficulty: 'Easy',
    minutes: 20,
    intro: 'A clogged condensate drain causes water to back up and can shut down your AC or cause ceiling damage. It\'s a quick flush.',
    steps: [
      'Turn off the AC at the thermostat.',
      'Find the condensate drain line — a white PVC pipe near the air handler, usually leading outside.',
      'Locate the clean-out cap on the line and remove it.',
      'Pour 1 cup of distilled white vinegar into the opening. Wait 30 minutes.',
      'Flush with water. Restore power and confirm no water is backing up at the drain pan.',
    ],
    skills: ['Condensate system basics', 'Preventive maintenance'],
    tools: [
      { name: 'Distilled white vinegar', href: '/products?q=white+vinegar' },
      { name: 'Wet/dry vacuum (optional, for severe clogs)', href: '/tool-rentals?category=cleaning' },
    ],
    hireHref: '/post-job?category=hvac',
    toolsHref: '/tool-rentals?category=hvac',
  },

  // Carpentry
  {
    id: 'patch-drywall',
    title: 'Patch a Drywall Hole',
    category: 'carpentry',
    difficulty: 'Medium',
    minutes: 60,
    intro: 'A fist-sized hole can be made invisible with the right patch and two thin coats of compound — the key is feathering the edges, not building them up.',
    steps: [
      'Cut the damaged area into a clean square using a drywall saw.',
      'Cut a patch from scrap drywall slightly larger than the hole, score it to create a paper backing flap.',
      'Apply joint compound around the hole, press the patch in place using the paper flap as a bond.',
      'Apply a thin first coat of compound over the patch, feathering 4–6 inches beyond the edges.',
      'Sand lightly when dry. Apply a second thin coat, feathering even wider. Sand, prime, and paint.',
    ],
    skills: ['Drywall cutting', 'Mud application', 'Feathering', 'Surface prep'],
    tools: [
      { name: 'Drywall patch (or scrap drywall)', href: '/products?q=drywall+patch' },
      { name: 'Joint compound', href: '/products?q=joint+compound' },
      { name: 'Putty knives (4" and 8")', href: '/tool-rentals?category=painting' },
      { name: 'Sanding sponge', href: '/products?q=sanding+sponge' },
    ],
    hireHref: '/post-job?category=carpentry',
    toolsHref: '/tool-rentals?category=painting',
  },
  {
    id: 'install-door-handle',
    title: 'Replace a Door Handle',
    category: 'carpentry',
    difficulty: 'Easy',
    minutes: 30,
    intro: 'Most door handles use standard sizing — the new set will come with a template that makes this a straightforward swap.',
    steps: [
      'Remove the existing handle by unscrewing the mounting screws on the interior rose plate.',
      'Pull both sides of the handle out and unscrew the latch from the edge of the door.',
      'Use the template included with the new handle to confirm hole sizing matches.',
      'Insert the new latch and secure with the edge screws.',
      'Thread the exterior handle through the latch and align the interior handle. Tighten the mounting screws.',
    ],
    skills: ['Door hardware sizing', 'Latch alignment'],
    tools: [
      { name: 'Phillips screwdriver or drill', href: '/tool-rentals?category=power-tools' },
      { name: 'Replacement door handle set', href: '/products?q=door+handle+set' },
    ],
    hireHref: '/post-job?category=carpentry',
    toolsHref: '/tool-rentals?category=carpentry',
  },

  // Painting
  {
    id: 'paint-a-wall',
    title: 'Prep and Paint a Room Wall',
    category: 'painting',
    difficulty: 'Medium',
    minutes: 180,
    intro: 'Good prep determines the result — patching, sanding, and taping matter more than the paint itself.',
    steps: [
      'Patch any nail holes or dings with spackling compound. Sand smooth when dry.',
      'Wipe the wall down with a damp cloth to remove dust and grease. Let dry.',
      'Tape trim, outlets, and edges with painter\'s tape. Lay a drop cloth on the floor.',
      'Cut in edges with a brush: around the tape lines, corners, and ceiling edge.',
      'Roll the field (main wall area) in a W pattern with a 3/8" nap roller. Apply two coats, letting the first dry fully between coats.',
    ],
    skills: ['Surface prep', 'Cutting in', 'Rolling technique', 'Two-coat application'],
    tools: [
      { name: 'Paint roller and tray', href: '/tool-rentals?category=painting' },
      { name: '2" angled brush (for cutting in)', href: '/products?q=paint+brush' },
      { name: 'Painter\'s tape', href: '/products?q=painters+tape' },
      { name: 'Drop cloth', href: '/products?q=drop+cloth' },
    ],
    hireHref: '/post-job?category=painting',
    toolsHref: '/tool-rentals?category=painting',
  },

  // Car Care
  {
    id: 'change-oil',
    title: 'Change Your Engine Oil',
    category: 'car-care',
    difficulty: 'Medium',
    minutes: 45,
    intro: 'An oil change is the highest-leverage maintenance task you can do — wrong intervals cost engines. Getting comfortable doing it yourself saves money every 5,000 miles.',
    steps: [
      'Look up the correct oil type (e.g., 5W-30) and filter for your car year/make/model.',
      'Warm the engine for 2 minutes, then turn it off. Jack up the car and set it on jack stands.',
      'Place a drain pan under the drain plug. Remove the plug with a wrench and let the oil drain fully (5–10 min).',
      'Remove the old oil filter with a filter wrench. Lightly coat the new filter gasket with fresh oil and hand-tighten.',
      'Reinstall the drain plug. Fill with new oil from the top. Check level with the dipstick. Run the engine briefly and check for leaks.',
    ],
    skills: ['Jack and jack stand safety', 'Oil spec lookup', 'Filter replacement', 'Drain plug torque'],
    tools: [
      { name: 'Floor jack and jack stands', href: '/tool-rentals?category=automotive' },
      { name: 'Oil filter wrench', href: '/tool-rentals?category=automotive' },
      { name: 'Drain pan', href: '/products?q=oil+drain+pan' },
      { name: 'Correct oil and filter for your vehicle', href: '/products?q=motor+oil' },
    ],
    hireHref: '/post-job?category=car-care',
    toolsHref: '/tool-rentals?category=automotive',
  },
  {
    id: 'replace-wipers',
    title: 'Replace Windshield Wipers',
    category: 'car-care',
    difficulty: 'Easy',
    minutes: 10,
    intro: 'Wipers that streak or skip are a safety issue. Replacing them takes 10 minutes and no tools — just the right size for your car.',
    steps: [
      'Look up the correct blade size for your driver and passenger sides (they\'re often different).',
      'Lift the wiper arm away from the windshield until it locks in the raised position.',
      'Press the tab where the blade meets the arm and slide the old blade off.',
      'Hook the new blade onto the arm and press until it clicks.',
      'Gently lower the arm back to the glass. Repeat for the other side.',
    ],
    skills: ['Blade sizing', 'Hook-style connector', 'Safe arm handling'],
    tools: [
      { name: 'Replacement wiper blades (check your vehicle size)', href: '/products?q=wiper+blades' },
    ],
    hireHref: '/post-job?category=car-care',
    toolsHref: '/tool-rentals?category=automotive',
  },

  // Landscaping
  {
    id: 'mulch-garden-bed',
    title: 'Mulch a Garden Bed',
    category: 'landscaping',
    difficulty: 'Easy',
    minutes: 120,
    intro: 'Mulch suppresses weeds, retains moisture, and regulates soil temperature — three to four inches is the sweet spot.',
    steps: [
      'Clear the bed of weeds, pulling from the root. Don\'t just cut them — they\'ll regrow.',
      'Edge the bed with a flat spade to create a clean border.',
      'Lay cardboard or landscape fabric over the soil for extra weed suppression (optional).',
      'Pour or wheelbarrow mulch into the bed. Spread with a rake to an even 3–4 inch depth.',
      'Keep mulch 2–3 inches away from plant stems and tree trunks to prevent rot.',
    ],
    skills: ['Weed removal', 'Edging', 'Mulch depth control'],
    tools: [
      { name: 'Flat spade for edging', href: '/tool-rentals?category=landscaping' },
      { name: 'Garden rake', href: '/tool-rentals?category=landscaping' },
      { name: 'Wheelbarrow', href: '/tool-rentals?category=landscaping' },
      { name: 'Bagged or bulk mulch', href: '/products?q=mulch' },
    ],
    hireHref: '/post-job?category=landscaping',
    toolsHref: '/tool-rentals?category=landscaping',
  },

  // General
  {
    id: 'caulk-bathtub',
    title: 'Recaulk a Bathtub',
    category: 'general',
    difficulty: 'Easy',
    minutes: 30,
    intro: 'Cracked or moldy caulk lets water into the wall. Removing the old bead and applying a fresh one is straightforward and worth doing every few years.',
    steps: [
      'Use a caulk remover tool or utility knife to cut and pull out all the old caulk.',
      'Clean the joint thoroughly with rubbing alcohol and let it dry completely (even overnight).',
      'Fill the tub with water before caulking — this pre-stresses the joint so it won\'t crack when in use.',
      'Apply a thin, continuous bead of tub-and-tile caulk along the joint.',
      'Wet your finger and smooth the bead in one pass. Remove the tape immediately. Let cure 24–48 hours before using the tub.',
    ],
    skills: ['Caulk removal', 'Surface prep', 'Bead application', 'Wet smoothing'],
    tools: [
      { name: 'Caulk remover tool', href: '/products?q=caulk+remover' },
      { name: 'Tub-and-tile silicone caulk', href: '/products?q=bathtub+caulk' },
      { name: 'Rubbing alcohol', href: '/products?q=isopropyl+alcohol' },
    ],
    hireHref: '/post-job?category=general',
    toolsHref: '/tool-rentals',
  },
];

// ── Difficulty config ─────────────────────────────────────────────────────────

const DIFFICULTY_COLOR = {
  Easy:   '#22c55e',
  Medium: '#f97316',
  Hard:   '#ef4444',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(str) {
  return String(str || '').toLowerCase();
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function LearnModePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [activeCategory, setActiveCategory] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  const filteredGuides = useMemo(() => {
    const q = normalize(query);
    return GUIDES.filter((g) => {
      const matchesCategory = activeCategory === 'all' || g.category === activeCategory;
      if (!matchesCategory) return false;
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

  const categoryMap = useMemo(
    () => Object.fromEntries(CATEGORIES.map((c) => [c.id, c])),
    [],
  );

  const handleSearch = (e) => {
    e.preventDefault();
    const trimmed = query.trim();
    setSearchParams(trimmed ? { q: trimmed } : {}, { replace: true });
    setExpandedId(null);
  };

  const handleCategoryClick = (id) => {
    setActiveCategory(id);
    setExpandedId(null);
    setQuery('');
    setSearchParams({}, { replace: true });
  };

  const toggleGuide = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const activeCategoryLabel =
    activeCategory === 'all'
      ? 'All'
      : (categoryMap[activeCategory]?.label ?? activeCategory);

  return (
    <PageShell>
      <PageMeta
        title="Learn to DIY | OxSteed"
        description="Step-by-step guides for home repair, car care, and everyday fixes — with tools, kits, and a hire path when you need one."
      />

      <div className="lrn-page">

        {/* ── Header ──────────────────────────────────────────── */}
        <div className="lrn-header">
          <div>
            <h1 className="lrn-title">Learn to DIY</h1>
            <p className="lrn-subtitle">Step-by-step guides for home &amp; car</p>
          </div>
          <div className="lrn-header-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
          </div>
        </div>

        {/* ── Search ──────────────────────────────────────────── */}
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
            <button
              type="button"
              className="lrn-search-clear"
              onClick={() => {
                setQuery('');
                setSearchParams({}, { replace: true });
              }}
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </form>

        {/* ── Category grid ───────────────────────────────────── */}
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

        {/* ── Guide list ──────────────────────────────────────── */}
        <section className="lrn-section">
          <h2 className="lrn-section-label">
            {activeCategoryLabel} Guides
            <span className="lrn-count">({filteredGuides.length})</span>
          </h2>

          {filteredGuides.length === 0 ? (
            <div className="lrn-empty">
              <p>No guides match "{query}" in this category.</p>
              <button
                type="button"
                onClick={() => { setQuery(''); setActiveCategory('all'); setSearchParams({}, { replace: true }); }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <ul className="lrn-guide-list">
              {filteredGuides.map((guide) => {
                const cat = categoryMap[guide.category];
                const isExpanded = expandedId === guide.id;
                return (
                  <li key={guide.id} className="lrn-guide-item">
                    {/* Row */}
                    <button
                      type="button"
                      className={`lrn-guide-row${isExpanded ? ' is-open' : ''}`}
                      onClick={() => toggleGuide(guide.id)}
                      aria-expanded={isExpanded}
                    >
                      {/* Icon */}
                      <span
                        className="lrn-guide-icon"
                        style={{ background: cat ? `${cat.color}18` : '#f1f5f9', color: cat?.color ?? '#64748b' }}
                        aria-hidden="true"
                      >
                        {cat && <cat.Icon size={18} />}
                      </span>

                      {/* Text */}
                      <span className="lrn-guide-text">
                        <span className="lrn-guide-name">{guide.title}</span>
                        <span className="lrn-guide-meta">
                          <span
                            className="lrn-difficulty"
                            style={{ color: DIFFICULTY_COLOR[guide.difficulty] ?? '#64748b' }}
                          >
                            {guide.difficulty}
                          </span>
                          <span className="lrn-meta-sep" aria-hidden="true" />
                          <Clock size={13} aria-hidden="true" />
                          <span>{guide.minutes} min</span>
                        </span>
                      </span>

                      {/* Chevron */}
                      <ChevronRight
                        size={18}
                        className={`lrn-chevron${isExpanded ? ' is-open' : ''}`}
                        aria-hidden="true"
                      />
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="lrn-guide-detail">
                        <p className="lrn-guide-intro">{guide.intro}</p>

                        <div className="lrn-detail-grid">
                          {/* Steps */}
                          <div className="lrn-detail-steps">
                            <h3 className="lrn-detail-heading">Steps</h3>
                            <ol className="lrn-steps">
                              {guide.steps.map((step, i) => (
                                <li key={i}>
                                  <span className="lrn-step-num">{i + 1}</span>
                                  <span>{step}</span>
                                </li>
                              ))}
                            </ol>
                          </div>

                          {/* Side: skills + tools + CTAs */}
                          <div className="lrn-detail-side">
                            <div className="lrn-detail-panel">
                              <h3 className="lrn-detail-heading">Skills you'll learn</h3>
                              <div className="lrn-skill-chips">
                                {guide.skills.map((s) => (
                                  <span key={s} className="lrn-chip">{s}</span>
                                ))}
                              </div>
                            </div>

                            <div className="lrn-detail-panel">
                              <h3 className="lrn-detail-heading">
                                <ShoppingBag size={14} aria-hidden="true" />
                                Tools &amp; materials
                              </h3>
                              <ul className="lrn-tool-list">
                                {guide.tools.map((tool) => (
                                  <li key={tool.name}>
                                    <Link to={tool.href} className="lrn-tool-link">
                                      {tool.name}
                                      <ChevronRight size={14} aria-hidden="true" />
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </div>

                            <div className="lrn-detail-ctas">
                              <p className="lrn-cta-label">
                                <User size={13} aria-hidden="true" />
                                Rather hire someone?
                              </p>
                              <Link to={guide.hireHref} className="lrn-cta-hire">
                                Post this as a job
                              </Link>
                              <Link to={guide.toolsHref} className="lrn-cta-tools">
                                Rent the tools
                              </Link>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

      </div>
    </PageShell>
  );
}
