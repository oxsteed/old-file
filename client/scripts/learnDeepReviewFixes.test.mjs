import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const catalog = (lang) => JSON.parse(read(`src/locales/${lang}.json`));
const LANGUAGES = ['en', 'es', 'fr', 'ht', 'ar'];

const placeholders = (value) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);

test('learn ladder steps are translated in every language', () => {
  for (const lang of LANGUAGES) {
    const step = catalog(lang).learn?.step;
    assert.ok(step, `${lang}: learn.step block missing`);
    for (const n of ['1', '2', '3', '4']) {
      assert.equal(typeof step[n], 'string', `${lang}: learn.step.${n} missing`);
      assert.ok(step[n].trim().length > 0, `${lang}: learn.step.${n} is empty`);
    }
  }
  const en = ['Learn a skill', 'Do it yourself', 'List as a service', 'Grow your business'];
  for (const [i, expected] of en.entries()) {
    assert.equal(catalog('en').learn.step[String(i + 1)], expected);
  }
});

test('learn page renders ladder steps through static translation keys', () => {
  const source = read('src/pages/LearnModePage.jsx');
  for (const n of ['1', '2', '3', '4']) {
    assert.match(source, new RegExp(`t\\('learn\\.step\\.${n}'\\)`));
  }
  // The old dynamic form hid the keys from the static i18n checker.
  assert.doesNotMatch(source, /\['learn\.step\.1', 'learn\.step\.2'/);
});

test('per-step Ask AI buttons are labeled and prefilled in every language', () => {
  for (const lang of LANGUAGES) {
    const page = catalog(lang).learn?.page ?? {};
    for (const key of ['askAi', 'askAiTitle', 'askAiPrefill']) {
      assert.equal(typeof page[key], 'string', `${lang}: learn.page.${key} missing`);
      assert.ok(page[key].trim().length > 0, `${lang}: learn.page.${key} is empty`);
    }
    assert.deepEqual(placeholders(page.askAiPrefill), ['title', 'step', 'excerpt']);
  }
  assert.equal(catalog('en').learn.page.askAi, 'Ask AI');
});

test('Ask AI buttons are removed from the Learn guide pages', () => {
  const source = read('src/pages/LearnModePage.jsx');
  // Ask AI was removed from guides to avoid AI provider cost. No guide page
  // may wire the AI chat prefill or render the Ask AI buttons.
  assert.doesNotMatch(source, /learn\.page\.askAiPrefill/);
  assert.doesNotMatch(source, /learn\.page\.askAiGuidePrefill/);
  assert.doesNotMatch(source, /learn\.page\.askAiTitle/);
  assert.doesNotMatch(source, /learn\.page\.stillNeedHelp/);
  assert.doesNotMatch(source, /learn\.page\.aiDisclaimer/);
  assert.doesNotMatch(source, /handleAskAI/);
  assert.doesNotMatch(source, /handleAskAIGuide/);
  assert.doesNotMatch(source, /lrn-ask-ai-btn/);
  assert.doesNotMatch(source, /lrn-still-help/);
  // The paid human option stays hidden.
  assert.doesNotMatch(source, /learn\.page\.talkToHuman/);
  assert.doesNotMatch(source, /learn\.page\.talkToHumanPrice/);
  assert.doesNotMatch(source, /lrn-still-help-human/);
  assert.doesNotMatch(source, /'human-help'/);
});

test('end-of-steps AI option and disclaimer are fully localized in every language', () => {
  for (const lang of LANGUAGES) {
    const page = catalog(lang).learn?.page ?? {};
    for (const key of ['stillNeedHelp', 'askAi', 'askAiGuidePrefill', 'aiDisclaimer']) {
      assert.equal(typeof page[key], 'string', `${lang}: learn.page.${key} missing`);
      assert.ok(page[key].trim().length > 0, `${lang}: learn.page.${key} is empty`);
    }
    assert.deepEqual(placeholders(page.askAiGuidePrefill), ['title']);
    assert.ok(!('talkToHuman' in page), `${lang}: learn.page.talkToHuman should be removed`);
    assert.ok(!('talkToHumanPrice' in page), `${lang}: learn.page.talkToHumanPrice should be removed`);
  }
  assert.equal(catalog('en').learn.page.askAiGuidePrefill, 'I\'m following the "{{title}}" guide. I have a question about it.');
  assert.equal(catalog('en').learn.page.aiDisclaimer, 'AI can make mistakes. Verify important information before acting.');
});

test('support widget tags one-shot guide context for the Redis cache', () => {
  const source = read('src/components/SupportWidget.jsx');
  assert.match(source, /guideHelpRef/);
  assert.match(source, /guide_help/);
  // One-shot: cleared on every send so follow-up messages are never cached.
  assert.match(source, /guideHelpRef\.current = null/);
});

test('chat endpoint serves per-guide AI answers from the Redis cache', () => {
  const source = read('../server/controllers/chatController.js');
  assert.match(source, /guide_help/);
  assert.match(source, /getCachedGuideReply/);
  assert.match(source, /setCachedGuideReply/);
  assert.match(source, /cached: true/);
});

test('support widget applies the contextual prefill without clobbering user input', () => {
  const source = read('src/components/SupportWidget.jsx');
  assert.match(source, /event\?\.detail\?\.prefill/);
  assert.match(source, /setInput\(\(prev\)/);
});

test('learn progress strip is fully localized in every language', () => {
  for (const lang of LANGUAGES) {
    const page = catalog(lang).learn?.page ?? {};
    assert.equal(typeof page.progressCompleted, 'string', `${lang}: learn.page.progressCompleted missing`);
    assert.equal(typeof page.progressXp, 'string', `${lang}: learn.page.progressXp missing`);
    assert.deepEqual(placeholders(page.progressCompleted), ['done', 'total']);
    assert.deepEqual(placeholders(page.progressXp), ['xp']);
  }
  assert.equal(catalog('en').learn.page.progressCompleted, '{{done}} of {{total}} guides completed');
  assert.equal(catalog('en').learn.page.progressXp, '+{{xp}} XP earned');
});

test('learn page has no hardcoded English progress text', () => {
  const source = read('src/pages/LearnModePage.jsx');
  assert.doesNotMatch(source, /guides completed/);
  assert.doesNotMatch(source, /XP earned/);
  assert.match(source, /t\('learn\.page\.progressCompleted', \{ done: completedCount, total: totalGuides \}\)/);
  assert.match(source, /t\('learn\.page\.progressXp'/);
});

test('app banner no longer claims offline guide access', () => {
  const source = read('src/pages/LearnModePage.jsx');
  assert.doesNotMatch(source, /offline access/i);
  for (const lang of LANGUAGES) {
    const text = catalog(lang).learn?.page?.appBannerText ?? '';
    assert.ok(!/offline|sin conexión|hors ligne|san entènèt|غير متصل/i.test(text),
      `${lang}: appBannerText still claims offline access`);
  }
});
