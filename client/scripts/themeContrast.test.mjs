import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const css = postcss.parse(read('src/index.css'));
const tokens = (selector) => {
  const result = {};
  css.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(/^--/, (decl) => { result[decl.prop] = decl.value; });
  });
  return result;
};
const dark = tokens(':root');
const light = { ...dark, ...tokens('html:not(.dark)') };

function rgb(color) {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    return (hex.length === 3 ? [...hex].map((v) => v + v).join('') : hex)
      .match(/../g).map((v) => parseInt(v, 16));
  }
  const values = color.match(/[\d.]+/g).map(Number);
  assert.equal(values.length, 4, `Expected rgba: ${color}`);
  return values;
}
function blend(top, bottom) {
  const [r, g, b, alpha = 1] = rgb(top);
  return [r, g, b].map((v, i) => v * alpha + bottom[i] * (1 - alpha));
}
function luminance(values) {
  const linear = values.map((v) => {
    const n = v / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(foreground, background) {
  const a = luminance(rgb(foreground)), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function readable(fg, bg, label) {
  const ratio = contrast(fg, bg);
  assert.ok(ratio >= 4.5, `${label}: ${ratio.toFixed(2)}:1 is below 4.5:1`);
}

for (const [theme, palette] of Object.entries({ light, dark })) {
  test(`${theme}: body and status text remain readable on semantic surfaces`, () => {
    for (const surface of ['bg', 'surface', 'surface-2', 'surface-3']) {
      const background = rgb(palette[`--color-${surface}`]);
      for (const text of ['text', 'text-muted', 'text-faint']) {
        readable(palette[`--color-${text}`], background, `${theme} ${text}/${surface}`);
      }
      for (const status of ['success', 'warning', 'error', 'info']) {
        readable(palette[`--color-${status}`], blend(palette[`--color-${status}-bg`], background), `${theme} ${status}/${surface}`);
      }
    }
  });
  test(`${theme}: solid actions retain readable labels, including hover`, () => {
    for (const state of ['action', 'action-hover']) {
      readable(palette['--color-on-action'], rgb(palette[`--color-${state}`]), `${theme} ${state}`);
    }
  });
}

test('light: accent links and placeholders meet normal-text contrast', () => {
  for (const surface of ['bg', 'surface', 'surface-2', 'surface-3']) {
    readable(light['--color-primary'], rgb(light[`--color-${surface}`]), `accent/${surface}`);
    readable('#475569', rgb(light[`--color-${surface}`]), `placeholder/${surface}`);
  }
});

test('neutral gradient remapping replaces the actual Tailwind via stops', () => {
  let checked = false;
  css.walkRules((rule) => {
    if (!rule.selector.startsWith('html:not(.dark)') || !rule.selector.includes('.via-slate-900')) return;
    const stops = rule.nodes.find((n) => n.prop === '--tw-gradient-stops');
    assert.ok(stops?.important);
    assert.match(stops.value, /var\(--color-bg\)/);
    checked = true;
  });
  assert.ok(checked);
  assert.doesNotMatch(read('src/index.css'), /--tw-gradient-via:/);
});

test('solid foreground utilities are generated independently of legacy text-white', async () => {
  const output = await postcss([tailwind({})])
    .process('@config "../tailwind.config.js"; @import "tailwindcss";', {
      from: fileURLToPath(new URL('../src/index.css', import.meta.url)),
    });
  for (const name of ['.text-on-action', '.text-on-solid', '.bg-action', '.text-content']) {
    assert.ok(output.css.includes(name), `${name} must be generated`);
  }
  assert.match(output.css, /color: var\(--color-on-action\)/);
});

test('invoice and order foregrounds use semantic tokens, not fixed dark-mode colors', () => {
  for (const file of ['src/pages/InvoicesPage.css', 'src/pages/OrderHistoryPage.css', 'src/styles/PublicInvoiceView.css']) {
    postcss.parse(read(file)).walkDecls('color', (decl) => {
      assert.match(decl.value, /^var\(--color-/, `${file}: ${decl.parent.selector}`);
    });
  }
});

test('legal page styles cannot overwrite global tokens or unrelated components', () => {
  for (const [name, prefix] of [['IndependentContractorPage', 'contractor'], ['AccountTerminationPage', 'termination'], ['DisputeResolutionPage', 'dispute']]) {
    postcss.parse(read(`src/styles/${name}.css`)).walkRules((rule) => {
      if (rule.parent.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
      for (const selector of rule.selectors) {
        assert.ok(selector.includes(`.${prefix}-page-container`), `${name}: unscoped ${selector}`);
      }
    });
  }
});

test('post-job hero has an explicit light-mode surface and readable accents', () => {
  // Git preserves CRLF in the Windows checkout; selector matching below is
  // semantic and should not depend on the platform line ending.
  const postJobCss = postcss.parse(read('src/styles/PostJobPage.css').replace(/\r\n/g, '\n'));
  const declarations = (selector) => {
    const rule = postJobCss.nodes
      .flatMap((node) => node.type === 'atrule' ? node.nodes || [] : [node])
      .find((node) => node.type === 'rule' && node.selector === selector);
    return rule ? Object.fromEntries(rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value])) : {};
  };

  assert.match(declarations('html:not(.dark) .pjw-hero').background, /#ffffff/);
  assert.equal(declarations('html:not(.dark) .pjw-hero-kicker').color, '#c2410c');
  assert.equal(declarations('html:not(.dark) .pjw-hero-panel-label,\nhtml:not(.dark) .pjw-side-note-kicker').color, '#1d4ed8');
});
