# i18n Mixed-Locale Issue Diagnostic Report

## Problem Statement
Dashboard is rendering Spanish text in specific components (Financial Health, Stats Cards, Pro Features) while global language is set to English.

## Technical Checkpoints

### ✅ 1. Locale File Synchronization
- **Status:** PASSED
- **EN keys:** 2716 total
- **ES keys:** 2716 total  
- **FR keys:** 2716 total
- **HT keys:** 2716 total
- **Parity:** Perfect (identical line counts: 3037 lines each)

### ✅ 2. i18n Configuration
- **File:** `client/src/i18n.js`
- **Language source:** `localStorage.getItem('oxs:language') || 'en'`
- **Fallback language:** `'en'` (correct)
- **All locales registered:** Yes (en, es, fr, ht)

### ✅ 3. LanguageContext Setup
- **File:** `client/src/context/LanguageContext.jsx`
- **Provider wraps App:** Yes (confirmed in App.jsx line 64)
- **useLanguage hook exists:** Yes
- **setLanguage synchronizes i18n:** Yes (calls `i18n.changeLanguage(code)`)

### ⚠️ 4. Potential Issues Identified

#### Issue A: Dependency Array Missing in useEffect
- **File:** `client/src/components/PulseScoreSettings.jsx`
- **Line:** 73-77
- **Problem:** `useEffect` for loading settings has no dependency array
- **Impact:** Could cause race conditions or stale i18n context
- **Recommendation:** Add `[t]` dependency

#### Issue B: SOURCE_LABELS Cross-Namespace Reference
- **File:** `client/src/pages/Dashboard.jsx`
- **Lines:** 884-899
- **Problem:** Uses `t('plannedNeeds.srcXxx')` keys instead of `dashboard.pulse.srcXxx`
- **Status:** Keys exist in both namespaces, but creates coupling
- **Risk:** If plannedNeeds namespace is updated without dashboard sync, could break

#### Issue C: Multiple useTranslation() Calls
- **Files affected:** Dashboard.jsx (line 114), PulseScoreSettings.jsx (line 68), and many others
- **Each component separately:** Calls `const { t } = useTranslation()`
- **Expected behavior:** All should use same i18n instance
- **Potential issue:** If i18n language hasn't been applied globally before component render

### 5. Browser Environment Check (Manual Required)
To verify in browser console:
```javascript
// Check localStorage
localStorage.getItem('oxs:language')  // Should be 'en'

// Check i18n current language  
import i18n from './i18n'
i18n.language  // Should be 'en'

// Check if translation returns English
i18n.t('dashboard.financialHealth')  // Should return "Financial Health Score"

// Check if Spanish is being served
i18n.t('dashboard.financialHealth', { lng: 'es' })  // Should return "Puntuación de salud financiera"
```

## Root Cause Hypotheses (Priority Order)

1. **localStorage Corruption:** `oxs:language` is set to `'es'` instead of `'en'`
   - User perceives language as English in UI selector, but stored value is Spanish
   - Fix: Clear localStorage and re-select English

2. **Race Condition on Initial Load:** Components render before i18n language is initialized
   - i18n.init() reads localStorage asynchronously
   - Dashboard mounts before language is set
   - Fix: Add loading state to wait for i18n initialization

3. **Component-Level Language Override:** Specific component accidentally uses wrong language
   - PulseScoreSettings or DashboardStats using hardcoded language
   - Fix: Audit each component's useTranslation() call

4. **API Returning Localized Content:** Backend returns Spanish strings in response
   - /life/pulse or related endpoints return Spanish labels
   - Fix: Check backend response structure

5. **Stale Cache:** Browser cache serving old version of locale files
   - client/src/locales/es.json has outdated content
   - Fix: Clear browser cache and reload

## Recommended Investigation Steps

1. **First:** Open browser DevTools → Application → Storage → LocalStorage
   - Check value of `oxs:language`
   - Should be `'en'` if English is selected

2. **Second:** Check browser console for i18n warnings or errors
   - Look for "Missing translation" warnings
   - Check if i18n initialization completes successfully

3. **Third:** Verify locale files weren't accidentally swapped
   ```bash
   head -20 client/src/locales/en.json | grep -i spanish
   # Should return nothing (no Spanish in English file)
   ```

4. **Fourth:** Check if PulseScoreSettings is receiving wrong language prop
   - Add console.log(i18n.language) in Dashboard.jsx at mount
   - Add console.log(i18n.language) in PulseScoreSettings.jsx at mount
   - Compare if they differ

5. **Fifth:** Audit API responses
   - Network tab: Check `/life/pulse` response
   - Check if response contains Spanish strings in label fields
   - Expected: numeric data only, no labels from backend

## Files to Review
- ✅ `client/src/i18n.js` — OK
- ✅ `client/src/context/LanguageContext.jsx` — OK
- ✅ `client/src/pages/Dashboard.jsx` — Has cross-namespace refs (acceptable)
- ⚠️ `client/src/components/PulseScoreSettings.jsx` — Missing dependency array
- ? `client/src/pages/SmartDashboard.jsx` — Needs review
- ? Backend locale handling — Needs verification

## Next Steps
1. User should verify localStorage value in browser DevTools
2. Check browser console for i18n warnings
3. If issue persists, add debug logging to Dashboard.jsx mount
4. Check if issue is reproducible in incognito/private mode (rules out cache)
5. Compare behavior across different browsers/devices
