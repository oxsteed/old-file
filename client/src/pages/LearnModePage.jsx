import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Bot,
  Flame,
  Heart,
  Lightbulb,
  PlayCircle,
  Search,
  ShoppingBag,
  Sparkles,
  Wrench,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import './LearnModePage.css';

const LESSONS = [
  {
    id: 'brake-pad-replacement',
    title: 'Change front brake pads without guessing the next step',
    creator: 'Mike from OxSteed Garage',
    handle: '@garage.mike',
    duration: '9 min',
    level: 'Intermediate',
    category: 'Auto repair',
    problem: 'Squeaking brakes and worn pads',
    summary:
      'A clean vertical walkthrough that shows the safe lift, caliper removal, pad swap, and final torque check before the test drive.',
    hook: 'You should see exactly which bolts move, which tools matter, and what not to skip before the wheel goes back on.',
    metrics: {
      likes: '24.8K',
      saves: '9.3K',
      itemClicks: '3.2K',
      completions: '68%',
    },
    chapters: ['Lift and secure the car', 'Remove wheel and caliper', 'Compress and swap pads', 'Torque and test'],
    problemTags: ['change brakes', 'change brake pads', 'replace front brake pads', 'brake service'],
    skills: ['Brake service', 'Wheel removal', 'Torque safety', 'Jack-stand safety'],
    items: [
      {
        name: 'Front brake pad set',
        purpose: 'The replacement part matched to the lesson.',
        sourceLabel: 'AI matched part',
        href: '/products?q=front+brake+pad+set',
      },
      {
        name: 'Floor jack and jack stands',
        purpose: 'Needed to lift and hold the vehicle safely.',
        sourceLabel: 'Rent this setup',
        href: '/tool-rentals?category=automotive',
      },
      {
        name: 'Socket set and breaker bar',
        purpose: 'Used to remove lugs and caliper hardware.',
        sourceLabel: 'Shop tools',
        href: '/products?q=socket+set',
      },
      {
        name: 'Torque wrench',
        purpose: 'Used for the final lug torque before driving.',
        sourceLabel: 'Rent a torque wrench',
        href: '/tool-rentals?category=hand-tools',
      },
    ],
    theme: 'sunrise-garage',
    crossMode: {
      hireHref: '/post-job',
      toolsHref: '/tool-rentals?category=automotive',
    },
  },
  {
    id: 'patch-drywall',
    title: 'Patch a drywall hole so it disappears after paint',
    creator: 'Nia Builds',
    handle: '@niabuilds',
    duration: '6 min',
    level: 'Beginner',
    category: 'Home repair',
    problem: 'Fist-sized wall damage',
    summary:
      'A fast repair lesson that covers prep, patch placement, mud feathering, sanding, and paint-ready finishing.',
    hook: 'This is the kind of clip you save once and use every time a wall gets dinged.',
    metrics: {
      likes: '18.1K',
      saves: '12.4K',
      itemClicks: '2.9K',
      completions: '74%',
    },
    chapters: ['Clean the opening', 'Apply the patch', 'Feather the mud', 'Sand and prime'],
    problemTags: ['patch drywall', 'repair drywall hole', 'fix wall hole'],
    skills: ['Drywall patching', 'Mud application', 'Surface prep', 'Paint prep'],
    items: [
      {
        name: 'Drywall repair patch',
        purpose: 'Creates the backing over the damaged area.',
        sourceLabel: 'AI picked material',
        href: '/products?q=drywall+repair+patch',
      },
      {
        name: 'Joint compound',
        purpose: 'Used to build and feather the finish.',
        sourceLabel: 'Shop compound',
        href: '/products?q=joint+compound',
      },
      {
        name: 'Putty knife set',
        purpose: 'Gives you the right blade width for smooth coats.',
        sourceLabel: 'Rent or buy tools',
        href: '/tool-rentals?category=painting',
      },
    ],
    theme: 'plaster-cloud',
    crossMode: {
      hireHref: '/post-job',
      toolsHref: '/tool-rentals?category=painting',
    },
  },
  {
    id: 'reset-gfci',
    title: 'Reset a GFCI outlet and know when to stop',
    creator: 'Trade School Quickfix',
    handle: '@trades.quickfix',
    duration: '5 min',
    level: 'Beginner',
    category: 'Electrical',
    problem: 'Bathroom or kitchen outlet stopped working',
    summary:
      'A safety-first clip on finding the tripped outlet, checking for moisture, and testing whether it is safe to reset.',
    hook: 'Useful videos should save you from both panic and overconfidence.',
    metrics: {
      likes: '11.6K',
      saves: '8.7K',
      itemClicks: '1.8K',
      completions: '71%',
    },
    chapters: ['Cut the risk first', 'Locate the right GFCI', 'Reset and test', 'Call a pro if it repeats'],
    problemTags: ['reset gfci', 'outlet keeps tripping', 'bathroom outlet not working'],
    skills: ['Basic electrical safety', 'Outlet troubleshooting', 'Moisture checks'],
    items: [
      {
        name: 'Non-contact voltage tester',
        purpose: 'Checks whether the circuit is live before touching anything.',
        sourceLabel: 'AI safety match',
        href: '/products?q=non-contact+voltage+tester',
      },
      {
        name: 'Outlet tester',
        purpose: 'Helps verify the outlet after the reset.',
        sourceLabel: 'Shop tester',
        href: '/products?q=outlet+tester',
      },
    ],
    theme: 'night-current',
    crossMode: {
      hireHref: '/post-job',
      toolsHref: '/tool-rentals?category=electrical',
    },
  },
  {
    id: 'replace-air-filter',
    title: 'Change your HVAC filter in under five minutes',
    creator: 'Airflow with Sam',
    handle: '@airflow.sam',
    duration: '4 min',
    level: 'Beginner',
    category: 'HVAC',
    problem: 'Weak airflow or overdue maintenance',
    summary:
      'A quick lesson on checking filter size, reading airflow direction, and setting the next replacement reminder.',
    hook: 'Small maintenance clips keep expensive systems alive longer, and that is what makes this feed worth opening.',
    metrics: {
      likes: '9.4K',
      saves: '6.8K',
      itemClicks: '1.5K',
      completions: '79%',
    },
    chapters: ['Check the old filter size', 'Power down the system', 'Install with airflow arrow', 'Set the next reminder'],
    problemTags: ['change hvac filter', 'replace air filter', 'furnace filter'],
    skills: ['Routine maintenance', 'Filter sizing', 'Airflow direction'],
    items: [
      {
        name: 'Pleated HVAC filter',
        purpose: 'Replacement filter matched to the cabinet size.',
        sourceLabel: 'AI matched filter',
        href: '/products?q=hvac+filter',
      },
      {
        name: 'Permanent marker',
        purpose: 'Useful for writing the install date on the frame.',
        sourceLabel: 'Add-on item',
        href: '/products?q=permanent+marker',
      },
    ],
    theme: 'cool-breeze',
    crossMode: {
      hireHref: '/post-job',
      toolsHref: '/tool-rentals?category=hvac',
    },
  },
];

const CATEGORY_PILLS = [
  'For You',
  'Plumbing',
  'Electrical',
  'Auto',
  'Walls',
  'HVAC',
  'Appliances',
];

const WRITTEN_GUIDES = {
  sink: {
    title: 'No sink video yet, so here is the written repair path',
    intro:
      'Learn Mode should still solve the problem when the video library has a gap. This guide focuses on the most common sink issues: a leak under the basin or a slow drain.',
    steps: [
      'Put a bucket and towel under the sink before loosening anything so you can catch standing water.',
      'Identify the problem first: supply-line drip, drain-trap leak, or slow drain with no visible leak.',
      'If the leak is from the drain trap, tighten the slip nuts by hand first and check whether the washers are seated evenly.',
      'If the sink drains slowly, remove debris near the stopper, then disconnect and rinse the P-trap completely.',
      'If the leak is from the supply line, shut off both valves, dry the line, and confirm whether the water returns at the nut, valve, or hose body.',
      'Turn the water back on slowly and use a dry paper towel to detect tiny drips at every connection.',
      'If a shutoff valve is frozen, a pipe is cracked, or water appears behind the wall, stop and book a licensed plumber.',
    ],
    skills: ['Sink troubleshooting', 'Drain cleaning', 'Slip-joint fitting checks', 'Basic plumbing safety'],
    items: [
      'Bucket and absorbent towels',
      'Tongue-and-groove pliers',
      'Replacement slip-joint washers',
      'Drain snake or zip tool',
      'Plumber’s tape',
    ],
  },
};

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function buildSearchTerms(query) {
  const text = normalize(query);
  if (!text) return [];
  const terms = new Set([text]);
  text.split(/\s+/).forEach((token) => terms.add(token));
  if (text.includes('brake')) {
    terms.add('brake pads');
    terms.add('brake service');
    terms.add('auto repair');
  }
  if (text.includes('drywall') || text.includes('wall')) {
    terms.add('wall repair');
    terms.add('home repair');
  }
  if (text.includes('gfci') || text.includes('outlet')) {
    terms.add('electrical');
  }
  if (text.includes('filter') || text.includes('hvac')) {
    terms.add('air filter');
    terms.add('maintenance');
  }
  if (text.includes('sink') || text.includes('fix sink')) {
    terms.add('sink');
    terms.add('plumbing');
  }
  return [...terms];
}

function getWrittenGuide(query) {
  const text = normalize(query);
  if (!text) return null;
  if (text.includes('sink')) {
    return WRITTEN_GUIDES.sink;
  }
  return null;
}

export default function LearnModePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [activeLessonId, setActiveLessonId] = useState(LESSONS[0].id);
  const searchTerms = useMemo(() => buildSearchTerms(query), [query]);

  useEffect(() => {
    const next = searchParams.get('q') || '';
    if (next !== query) {
      setQuery(next);
    }
  }, [searchParams, query]);

  const results = useMemo(() => {
    if (!searchTerms.length) {
      return LESSONS;
    }

    return LESSONS.filter((lesson) => {
      const haystack = [
        lesson.title,
        lesson.problem,
        lesson.summary,
        lesson.hook,
        lesson.category,
        ...lesson.problemTags,
        ...lesson.skills,
        ...lesson.items.map((item) => item.name),
      ]
        .join(' ')
        .toLowerCase();

      return searchTerms.some((term) => haystack.includes(term));
    });
  }, [searchTerms]);

  useEffect(() => {
    if (!results.length) return;
    if (!results.some((lesson) => lesson.id === activeLessonId)) {
      setActiveLessonId(results[0].id);
    }
  }, [results, activeLessonId]);

  const activeLesson = useMemo(
    () => results.find((lesson) => lesson.id === activeLessonId) || results[0] || null,
    [results, activeLessonId],
  );

  const fallbackGuide = useMemo(() => {
    if (results.length > 0) return null;
    return getWrittenGuide(query);
  }, [query, results.length]);

  const highlightedSearch = query.trim() || 'change brakes';

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchParams({}, { replace: true });
      return;
    }
    setSearchParams({ q: trimmed }, { replace: true });
  };

  return (
    <PageShell hideFooter>
      <PageMeta
        title="Learn Mode | OxSteed"
        description="A short-form, skills-first learning feed where every useful fix can turn into action, shopping, or a hire."
      />

      <div className="learn-feed-page">
        <header className="learn-feed-topbar">
          <div className="learn-feed-wordmark">
            <span className="learn-feed-wordmark-badge">OS</span>
            <div>
              <strong>Learn Mode</strong>
              <span>Useful fixes, useful tools, useful outcomes.</span>
            </div>
          </div>

          <form className="learn-feed-searchbar" onSubmit={handleSearchSubmit}>
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search real jobs like fix sink, change brakes, patch drywall"
              aria-label="Search Learn Mode"
            />
            <button type="submit">AI Search</button>
          </form>

          <div className="learn-feed-actions">
            <Link to="/join">Post a lesson</Link>
            <Link to="/products">Shop</Link>
          </div>
        </header>

        <div className="learn-feed-shell">
          <aside className="learn-feed-left-rail">
            <div className="learn-feed-left-card">
              <span className="learn-feed-section-kicker">
                <Sparkles size={15} aria-hidden="true" />
                Learn feed
              </span>
              <h1>Compete on usefulness, not noise.</h1>
              <p>
                This feed is for real repairs, real tasks, and real skills. Every clip should help someone finish a job or know when to call a pro.
              </p>
            </div>

            <div className="learn-feed-left-card">
              <h2>Browse</h2>
              <div className="learn-feed-pill-grid">
                {CATEGORY_PILLS.map((pill) => (
                  <button
                    key={pill}
                    type="button"
                    onClick={() => {
                      setQuery(pill === 'For You' ? '' : pill);
                      if (pill === 'For You') {
                        setSearchParams({}, { replace: true });
                      } else {
                        setSearchParams({ q: pill }, { replace: true });
                      }
                    }}
                  >
                    {pill}
                  </button>
                ))}
              </div>
            </div>

            <div className="learn-feed-left-card">
              <h2>How ranking works</h2>
              <ul className="learn-feed-bullet-list">
                <li>Search is weighted by the repair being solved, not random popularity.</li>
                <li>Skill tags and item lists help the AI understand what the clip actually teaches.</li>
                <li>If there is no clip yet, Learn Mode should still give a written repair path.</li>
              </ul>
            </div>
          </aside>

          <main className="learn-feed-main-stage">
            {fallbackGuide ? (
              <section className="learn-feed-guide-mode">
                <div className="learn-feed-guide-header">
                  <span className="learn-feed-section-kicker">
                    <BookOpen size={15} aria-hidden="true" />
                    Guide mode
                  </span>
                  <h2>{fallbackGuide.title}</h2>
                  <p>{fallbackGuide.intro}</p>
                </div>

                <div className="learn-feed-guide-grid">
                  <div className="learn-feed-guide-steps">
                    <h3>Step-by-step</h3>
                    <ol>
                      {fallbackGuide.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </div>

                  <div className="learn-feed-guide-side">
                    <div className="learn-feed-side-panel">
                      <h3>Skills covered</h3>
                      <div className="learn-feed-chip-row">
                        {fallbackGuide.skills.map((skill) => (
                          <span key={skill}>{skill}</span>
                        ))}
                      </div>
                    </div>

                    <div className="learn-feed-side-panel">
                      <h3>Likely items needed</h3>
                      <ul className="learn-feed-bullet-list">
                        {fallbackGuide.items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="learn-feed-guide-cta">
                      <p>There is no video for this task yet. Be the first person to post it and attach the exact items used.</p>
                      <div className="learn-feed-guide-actions">
                        <Link to="/join">Become a creator</Link>
                        <Link to="/post-job">Hire a pro instead</Link>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {activeLesson ? (
              <section className="learn-feed-stage">
                <div className={`learn-feed-video-frame theme-${activeLesson.theme}`}>
                  <div className="learn-feed-video-topline">
                    <span>
                      <PlayCircle size={15} aria-hidden="true" />
                      {activeLesson.category}
                    </span>
                    <span>{activeLesson.duration}</span>
                  </div>

                  <div className="learn-feed-video-body">
                    <div className="learn-feed-video-callout">
                      <span>{activeLesson.problem}</span>
                      <strong>{activeLesson.level}</strong>
                    </div>

                    <div className="learn-feed-video-moment">
                      <div className="learn-feed-moment-chip">Real-use-case lesson</div>
                      <h2>{activeLesson.title}</h2>
                      <p>{activeLesson.hook}</p>
                    </div>

                    <div className="learn-feed-video-overlay">
                      <div className="learn-feed-overlay-copy">
                        <strong>{activeLesson.handle}</strong>
                        <span>{activeLesson.creator}</span>
                        <p>{activeLesson.summary}</p>
                      </div>

                      <div className="learn-feed-overlay-tags">
                        {activeLesson.skills.slice(0, 3).map((skill) => (
                          <span key={skill}>#{skill.replace(/\s+/g, '')}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="learn-feed-video-metrics">
                    <div>
                      <Heart size={16} aria-hidden="true" />
                      <span>{activeLesson.metrics.likes}</span>
                    </div>
                    <div>
                      <BookOpen size={16} aria-hidden="true" />
                      <span>{activeLesson.metrics.saves}</span>
                    </div>
                    <div>
                      <ShoppingBag size={16} aria-hidden="true" />
                      <span>{activeLesson.metrics.itemClicks}</span>
                    </div>
                    <div>
                      <Flame size={16} aria-hidden="true" />
                      <span>{activeLesson.metrics.completions} complete</span>
                    </div>
                  </div>
                </div>

                <div className="learn-feed-reel-queue">
                  {(results.length ? results : LESSONS).map((lesson) => {
                    const isActive = lesson.id === activeLesson.id;
                    return (
                      <button
                        key={lesson.id}
                        type="button"
                        className={isActive ? 'is-active' : ''}
                        onClick={() => setActiveLessonId(lesson.id)}
                      >
                        <span className={`learn-feed-queue-thumb theme-${lesson.theme}`} aria-hidden="true" />
                        <span className="learn-feed-queue-copy">
                          <strong>{lesson.title}</strong>
                          <small>{lesson.category}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </main>

          <aside className="learn-feed-right-rail">
            <div className="learn-feed-right-card">
              <span className="learn-feed-section-kicker">
                <Bot size={15} aria-hidden="true" />
                AI interpretation
              </span>
              <h2>{highlightedSearch}</h2>
              <p>
                {searchTerms.length
                  ? `The search expands this request into related skills, item names, and repair intent so useful clips surface even when titles differ.`
                  : 'Every result here is intended to teach a task someone can actually complete, not just keep them scrolling.'}
              </p>
              <div className="learn-feed-chip-row">
                {(searchTerms.length ? searchTerms : ['repair intent', 'skill tags', 'item links']).slice(0, 6).map((term) => (
                  <span key={term}>{term}</span>
                ))}
              </div>
            </div>

            {activeLesson ? (
              <>
                <div className="learn-feed-right-card">
                  <span className="learn-feed-section-kicker">
                    <Wrench size={15} aria-hidden="true" />
                    Skills in this lesson
                  </span>
                  <div className="learn-feed-chip-row">
                    {activeLesson.skills.map((skill) => (
                      <span key={skill}>{skill}</span>
                    ))}
                  </div>
                </div>

                <div className="learn-feed-right-card">
                  <span className="learn-feed-section-kicker">
                    <ShoppingBag size={15} aria-hidden="true" />
                    Shoppable setup
                  </span>
                  <div className="learn-feed-shop-list">
                    {activeLesson.items.map((item) => (
                      <div key={item.name} className="learn-feed-shop-item">
                        <div>
                          <strong>{item.name}</strong>
                          <p>{item.purpose}</p>
                        </div>
                        <Link to={item.href}>
                          {item.sourceLabel}
                          <ArrowRight size={15} aria-hidden="true" />
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="learn-feed-right-card">
                  <span className="learn-feed-section-kicker">
                    <Lightbulb size={15} aria-hidden="true" />
                    If they do not want to DIY
                  </span>
                  <div className="learn-feed-cta-stack">
                    <Link to={activeLesson.crossMode.hireHref}>Post this as a job</Link>
                    <Link to={activeLesson.crossMode.toolsHref}>Rent the tools for this lesson</Link>
                  </div>
                </div>
              </>
            ) : null}

            <div className="learn-feed-right-card">
              <span className="learn-feed-section-kicker">
                <PlayCircle size={15} aria-hidden="true" />
                Creator rules
              </span>
              <ul className="learn-feed-bullet-list">
                <li>Every video should solve one real use case from start to finish.</li>
                <li>The creator must tag the actual skills involved in the task.</li>
                <li>The creator must list the items used so AI can attach buy or rental links.</li>
                <li>Safety boundaries matter just as much as the steps themselves.</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </PageShell>
  );
}
