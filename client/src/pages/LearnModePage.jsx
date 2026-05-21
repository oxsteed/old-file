import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  BookOpen,
  Bot,
  Lightbulb,
  ListChecks,
  PlayCircle,
  Search,
  ShoppingCart,
  Sparkles,
  Wrench,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import './LearnModePage.css';

const LESSONS = [
  {
    id: 'brake-pad-replacement',
    title: 'How to Change Front Brake Pads at Home',
    creator: 'Mike from OxSteed Garage',
    duration: '9 min',
    level: 'Intermediate',
    category: 'Auto repair',
    summary:
      'A clear front-brake walkthrough that shows safe lifting, caliper removal, pad swap, and torque checks before the test drive.',
    problemTags: ['change brakes', 'change brake pads', 'replace front brake pads', 'brake service'],
    skills: ['Brake service', 'Wheel removal', 'Torque safety', 'Jack-stand safety'],
    items: [
      {
        name: 'Front brake pad set',
        purpose: 'The replacement part used in the install.',
        sourceLabel: 'AI matched parts',
        href: '/products?q=front+brake+pad+set',
      },
      {
        name: 'Floor jack and jack stands',
        purpose: 'Required to lift and support the vehicle safely.',
        sourceLabel: 'Need to rent instead?',
        href: '/tool-rentals?category=automotive',
      },
      {
        name: 'Socket set and breaker bar',
        purpose: 'Used to remove lug nuts and caliper bolts.',
        sourceLabel: 'Shop tools',
        href: '/products?q=socket+set',
      },
      {
        name: 'Torque wrench',
        purpose: 'Used for final wheel lug torque.',
        sourceLabel: 'Rent a torque wrench',
        href: '/tool-rentals?category=hand-tools',
      },
    ],
    chapters: ['Lift and secure the car', 'Remove wheel and caliper', 'Install new pads', 'Torque and road test'],
    crossMode: {
      hireHref: '/post-job',
      toolsHref: '/tool-rentals?category=automotive',
    },
  },
  {
    id: 'patch-drywall',
    title: 'Patch a Small Drywall Hole Without Replacing the Whole Panel',
    creator: 'Nia Builds',
    duration: '6 min',
    level: 'Beginner',
    category: 'Home repair',
    summary:
      'Learn how to prep, patch, mud, sand, and prime a fist-sized drywall hole with a clean finish that is ready for paint.',
    problemTags: ['patch drywall', 'repair drywall hole', 'fix wall hole'],
    skills: ['Drywall patching', 'Mud application', 'Surface prep', 'Paint prep'],
    items: [
      {
        name: 'Drywall repair patch',
        purpose: 'Creates the backing over the damaged area.',
        sourceLabel: 'AI picked materials',
        href: '/products?q=drywall+repair+patch',
      },
      {
        name: 'Joint compound',
        purpose: 'Used to feather and finish the patch.',
        sourceLabel: 'Shop compound',
        href: '/products?q=joint+compound',
      },
      {
        name: 'Putty knife set',
        purpose: 'Lets you spread the compound smoothly.',
        sourceLabel: 'Rent or buy tools',
        href: '/tool-rentals?category=painting',
      },
    ],
    chapters: ['Clean the opening', 'Apply patch', 'Mud in layers', 'Sand and prime'],
    crossMode: {
      hireHref: '/post-job',
      toolsHref: '/tool-rentals?category=painting',
    },
  },
  {
    id: 'reset-gfci',
    title: 'Reset a GFCI Outlet and Check Why It Keeps Tripping',
    creator: 'Trade School Quickfix',
    duration: '5 min',
    level: 'Beginner',
    category: 'Electrical',
    summary:
      'A safety-first lesson on how to identify a tripped GFCI, reset it, and inspect the usual causes before calling a licensed electrician.',
    problemTags: ['reset gfci', 'outlet keeps tripping', 'bathroom outlet not working'],
    skills: ['Basic electrical safety', 'Outlet troubleshooting', 'Moisture checks'],
    items: [
      {
        name: 'Non-contact voltage tester',
        purpose: 'Used to confirm whether the circuit is live before touching anything.',
        sourceLabel: 'AI safety pick',
        href: '/products?q=non-contact+voltage+tester',
      },
      {
        name: 'Outlet tester',
        purpose: 'Checks whether the outlet wiring appears correct after reset.',
        sourceLabel: 'Shop testers',
        href: '/products?q=outlet+tester',
      },
    ],
    chapters: ['Shut off risk', 'Locate the GFCI', 'Reset and retest', 'Escalate if it trips again'],
    crossMode: {
      hireHref: '/post-job',
      toolsHref: '/tool-rentals?category=electrical',
    },
  },
  {
    id: 'replace-air-filter',
    title: 'Change Your Home HVAC Filter the Right Way',
    creator: 'Airflow with Sam',
    duration: '4 min',
    level: 'Beginner',
    category: 'HVAC',
    summary:
      'A fast lesson on choosing the right filter size, airflow direction, and replacement schedule to protect your system.',
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
        name: 'Marker labels',
        purpose: 'Useful for writing the install date on the frame.',
        sourceLabel: 'Add-on item',
        href: '/products?q=permanent+marker',
      },
    ],
    chapters: ['Check the old filter size', 'Turn system off', 'Install with airflow arrow', 'Set replacement reminder'],
    crossMode: {
      hireHref: '/post-job',
      toolsHref: '/tool-rentals?category=hvac',
    },
  },
];

const WRITTEN_GUIDES = {
  sink: {
    title: 'How to fix a sink when there is no Learn video yet',
    intro:
      'We do not have a sink-repair video in Learn Mode yet, so the AI assistant is switching into written guide mode. This version focuses on the most common homeowner issue: a leaking or slow-draining sink.',
    steps: [
      'Place a bucket and towel under the sink before touching any fittings so you can catch leftover water.',
      'Identify the symptom first: leak from the supply line, leak from the drain trap, or water draining slowly.',
      'For a drain leak, hand-tighten the slip nuts first. If the leak continues, remove the trap, clean the washers, and reinstall evenly.',
      'For a slow drain, remove visible debris from the stopper area, then clean the P-trap and rinse it fully before reconnecting.',
      'For a supply-line drip, shut off the hot and cold valves, dry the line completely, and check whether the drip is coming from the nut, valve, or hose.',
      'Turn water back on slowly and watch every connection for several minutes with a dry paper towel to spot tiny leaks.',
      'If the shutoff valves are seized, the drain pipe is cracked, or the leak is behind the wall, stop and hire a licensed plumber.',
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
  }
  if (text.includes('drywall')) {
    terms.add('wall repair');
  }
  if (text.includes('gfci') || text.includes('outlet')) {
    terms.add('electrical');
  }
  if (text.includes('filter') || text.includes('hvac')) {
    terms.add('air filter');
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
  if (text.includes('sink') || text.includes('fix sink')) {
    return WRITTEN_GUIDES.sink;
  }
  return null;
}

export default function LearnModePage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
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
        lesson.summary,
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

  const fallbackGuide = useMemo(() => {
    if (results.length > 0) return null;
    return getWrittenGuide(query);
  }, [query, results.length]);

  const highlightedSearch = query.trim() || 'brake pad replacement';

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
    <PageShell>
      <PageMeta
        title="Learn Mode | OxSteed"
        description="Skills-first DIY learning with AI search, tutorial videos, item recommendations, and fallback written guides."
      />

      <div className="learn-mode-page">
        <section className="learn-mode-hero">
          <div className="learn-mode-hero-copy">
            <span className="learn-mode-kicker">
              <Sparkles size={16} aria-hidden="true" />
              {t('learnMode.kicker', { defaultValue: 'Learn Mode' })}
            </span>
            <h1>{t('learnMode.title', { defaultValue: 'Short-form trade skills, not random videos.' })}</h1>
            <p>
              {t('learnMode.subtitle', {
                defaultValue:
                  'Learn Mode turns DIY content into a skills-first feed. Each post teaches a real task, lists the skills involved, and lets AI map the exact items someone needs to buy or rent to do the work.',
              })}
            </p>

            <form className="learn-mode-search" onSubmit={handleSearchSubmit}>
              <label className="sr-only" htmlFor="learn-mode-query">
                {t('learnMode.searchLabel', { defaultValue: 'Search Learn Mode' })}
              </label>
              <Search size={18} aria-hidden="true" />
              <input
                id="learn-mode-query"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('learnMode.searchPlaceholder', {
                  defaultValue: 'Search a skill or repair, like “fix sink” or “change brakes”',
                })}
              />
              <button type="submit">
                {t('learnMode.searchAction', { defaultValue: 'AI Search' })}
              </button>
            </form>

            <div className="learn-mode-quick-searches">
              {['change brakes', 'patch drywall', 'reset GFCI outlet', 'fix sink'].map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setQuery(example);
                    setSearchParams({ q: example }, { replace: true });
                  }}
                >
                  {example}
                </button>
              ))}
            </div>
          </div>

          <div className="learn-mode-hero-panel">
            <div className="learn-mode-panel-card">
              <div className="learn-mode-panel-label">
                <Bot size={16} aria-hidden="true" />
                {t('learnMode.panelTitle', { defaultValue: 'AI search engine' })}
              </div>
              <h2>{highlightedSearch}</h2>
              <ul>
                <li>{results.length} tutorial match{results.length === 1 ? '' : 'es'} found</li>
                <li>{fallbackGuide ? 'Written fallback ready because no video exists yet' : 'Item links attached to each lesson'}</li>
                <li>Skills and tools parsed from the tutorial itself</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="learn-mode-insights">
          <div className="learn-mode-ai-summary">
            <div className="learn-mode-section-header">
              <Bot size={18} aria-hidden="true" />
              <h2>{t('learnMode.summaryTitle', { defaultValue: 'How the AI layer works' })}</h2>
            </div>
            <p>
              {searchTerms.length
                ? `For “${highlightedSearch}”, the AI search expands the request into skills, problem tags, and item names so the page can still help even when the exact words are not in a title.`
                : 'Search results are ranked by the problem being solved, the listed skills, and the items used in the tutorial, not by entertainment value.'}
            </p>
            <div className="learn-mode-term-row">
              {(searchTerms.length ? searchTerms : ['brake service', 'torque safety', 'socket set']).slice(0, 6).map((term) => (
                <span key={term}>{term}</span>
              ))}
            </div>
          </div>

          <div className="learn-mode-publisher-card">
            <div className="learn-mode-section-header">
              <PlayCircle size={18} aria-hidden="true" />
              <h2>{t('learnMode.publisherTitle', { defaultValue: 'What creators must include when posting' })}</h2>
            </div>
            <ul>
              <li>Upload a video that teaches one real job clearly from start to finish.</li>
              <li>Tag the skills used in the video so search can index the work correctly.</li>
              <li>List every item used, then let AI attach purchase links or add your own link manually.</li>
              <li>Explain safety boundaries so beginners know when to stop and hire a pro.</li>
            </ul>
          </div>
        </section>

        {fallbackGuide ? (
          <section className="learn-mode-fallback">
            <div className="learn-mode-section-header">
              <BookOpen size={18} aria-hidden="true" />
              <h2>{fallbackGuide.title}</h2>
            </div>
            <p>{fallbackGuide.intro}</p>
            <div className="learn-mode-fallback-grid">
              <div className="learn-mode-step-card">
                <h3>Step-by-step guide</h3>
                <ol>
                  {fallbackGuide.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
              <div className="learn-mode-step-card">
                <h3>Skills this guide covers</h3>
                <div className="learn-mode-chip-row">
                  {fallbackGuide.skills.map((skill) => (
                    <span key={skill}>{skill}</span>
                  ))}
                </div>
                <h3>Items you will likely need</h3>
                <ul className="learn-mode-item-bullets">
                  {fallbackGuide.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="learn-mode-fallback-cta">
              <p>
                There is no video on this yet. Be the first person to post a sink-fix tutorial for the community and attach the exact items you used.
              </p>
              <div className="learn-mode-action-row">
                <Link to="/join">Become a Learn creator</Link>
                <Link to="/post-job">Hire a plumber instead</Link>
              </div>
            </div>
          </section>
        ) : null}

        <section className="learn-mode-results">
          <div className="learn-mode-section-header">
            <ListChecks size={18} aria-hidden="true" />
            <h2>{t('learnMode.resultsTitle', { defaultValue: 'Skill-based lessons' })}</h2>
          </div>

          <div className="learn-mode-result-grid">
            {results.map((lesson) => (
              <article key={lesson.id} className="learn-mode-card">
                <div className="learn-mode-card-top">
                  <span className="learn-mode-category">{lesson.category}</span>
                  <span className="learn-mode-level">{lesson.level}</span>
                </div>

                <h3>{lesson.title}</h3>
                <p>{lesson.summary}</p>

                <div className="learn-mode-meta">
                  <span>{lesson.creator}</span>
                  <span>{lesson.duration}</span>
                </div>

                <div className="learn-mode-subsection">
                  <h4>Skills in this video</h4>
                  <div className="learn-mode-chip-row">
                    {lesson.skills.map((skill) => (
                      <span key={skill}>{skill}</span>
                    ))}
                  </div>
                </div>

                <div className="learn-mode-subsection">
                  <h4>What the AI matched for purchase or rental</h4>
                  <div className="learn-mode-item-list">
                    {lesson.items.map((item) => (
                      <div key={item.name} className="learn-mode-item-card">
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

                <div className="learn-mode-subsection">
                  <h4>Lesson flow</h4>
                  <ol className="learn-mode-chapters">
                    {lesson.chapters.map((chapter) => (
                      <li key={chapter}>{chapter}</li>
                    ))}
                  </ol>
                </div>

                <div className="learn-mode-cross-links">
                  <Link to={lesson.crossMode.hireHref}>
                    <Lightbulb size={16} aria-hidden="true" />
                    Don’t want to DIY? Post the job
                  </Link>
                  <Link to={lesson.crossMode.toolsHref}>
                    <Wrench size={16} aria-hidden="true" />
                    Rent the tools for this lesson
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="learn-mode-bottom-grid">
          <div className="learn-mode-builder-card">
            <div className="learn-mode-section-header">
              <ShoppingCart size={18} aria-hidden="true" />
              <h2>AI item-link workflow</h2>
            </div>
            <ol>
              <li>The creator uploads a how-to video and lists every item used.</li>
              <li>AI identifies likely products, parts, or tool categories from the spoken instructions and the written item list.</li>
              <li>OxSteed shows buy links, rental links, or lets the creator attach their own approved product link instead.</li>
            </ol>
          </div>

          <div className="learn-mode-builder-card">
            <div className="learn-mode-section-header">
              <Sparkles size={18} aria-hidden="true" />
              <h2>Why this is different from general video apps</h2>
            </div>
            <ul>
              <li>The feed is organized around tasks, not viral jokes.</li>
              <li>Every post has searchable skills, item lists, and a real job outcome.</li>
              <li>If there is no video yet, the user still leaves with written guidance and a next step.</li>
            </ul>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
