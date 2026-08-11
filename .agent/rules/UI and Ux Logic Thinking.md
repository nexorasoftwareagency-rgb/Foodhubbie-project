# 🎨 UI/UX LOGIC THINKING — Complete Design & Development Framework
> How Claude thinks through interface design, user experience, visual systems,
> and frontend execution — from first principles to pixel-perfect output.
> Built for OpenCode models to produce production-grade, distinctive UI/UX.

---

## THE CORE PHILOSOPHY

UI is what something **looks like**.
UX is what something **feels like** to use.
Great design is when they are indistinguishable — every visual choice
serves the experience, and every interaction feels inevitable.

```
Bad UI:   Pretty but confusing
Bad UX:   Functional but ugly or frustrating
Great:    The user never thinks about either — they just achieve their goal
```

> 🔑 The measure of good UI/UX is not "did the designer like it?"
> It is "did the user accomplish their goal with minimal friction and maximum clarity?"

---

## PART 1 — THE UI/UX THINKING SEQUENCE

---

### 1.1 — BEFORE TOUCHING ANY CODE OR DESIGN TOOL

Run this 5-question intake every single time:

```
Q1: WHO is the user?
    → Their technical level, mental model, emotional state when they arrive
    → Beginner vs expert changes EVERYTHING: density, labels, defaults, help text

Q2: WHAT is their goal?
    → Not what the product does — what the USER is trying to accomplish
    → "Schedule a meeting" not "use the calendar feature"

Q3: WHAT is their context?
    → Mobile or desktop? Rushed or relaxed? First time or daily use?
    → A commuter glancing at a phone ≠ a developer with 3 monitors

Q4: WHERE does this experience break down?
    → What confusion, friction, or failure is most likely?
    → Design for the failure case first, not the happy path

Q5: WHAT is the ONE thing this interface must do perfectly?
    → Everything else is secondary
    → If you could only get one thing right, what is it?
```

---

### 1.2 — THE DESIGN DIRECTION DECISION

Before any visual work, choose a **direction** and commit to it fully.

**Direction = Tone + Aesthetic + Emotional register**

```
DIRECTION SPECTRUM:

← MINIMAL ─────────────────────────────────── MAXIMAL →

Brutally minimal     →  Every pixel earns its place
Editorial/magazine   →  Typography-forward, high contrast, structured
Luxury/refined       →  Restraint, whitespace, premium materials
Soft/organic         →  Rounded, warm, approachable, natural
Playful/toy-like     →  Bold color, friendly shapes, delight-focused
Art deco/geometric   →  Structured patterns, symmetry, precision
Retro-futuristic     →  Synthwave, neon, dark backgrounds, grid lines
Industrial/utilitarian → Dense, data-forward, no decoration
Brutalist/raw        →  Exposed structure, intentionally unpolished
Maximalist chaos     →  Layered, textured, high energy, complex
```

> 🔑 RULE: Pick ONE direction. A mixed direction is not "balanced" —
> it is indecisive. Commitment to a direction is what separates
> designed from generated.

**The Direction Statement (write this before coding):**
```
"This interface is [DIRECTION] because [USER] needs to [GOAL].
 The one thing they will remember is [DIFFERENTIATOR].
 Every design decision will serve [CORE EMOTION: calm / trust / delight / power / focus]."
```

---

### 1.3 — THE AESTHETIC ANTI-PATTERNS (NEVER DO THESE)

These are the "generic AI aesthetics" that make output look machine-generated:

| Anti-Pattern | Why It's Generic | What To Do Instead |
|---|---|---|
| Inter / Roboto / Arial font | Default system fonts, used everywhere | Choose a distinctive, contextual typeface |
| Purple gradient on white | #1 AI-generated color scheme | Commit to an unexpected palette |
| Purple/blue gradient buttons | Every SaaS from 2019-2024 | Flat color, outlined, or textured CTA |
| Card grid layout (3 cols) | Default Tailwind component pattern | Break the grid — asymmetry, overlap, vary sizing |
| Centered hero with subtitle | Every landing page template | Offset, diagonal, full-bleed, or typographic hero |
| Subtle box shadows everywhere | Bootstrap legacy aesthetic | Use real depth (layering, overlap) or none at all |
| Gray placeholder text in forms | Safe but forgettable | Styled labels, floating labels, character |
| Generic icon set (Heroicons defaults) | Instantly recognizable as template | Custom icons, consistent icon language, or icon-free |
| "Get Started" CTA | Every product ever | Specific, action-oriented copy tied to the value prop |
| Evenly distributed color palette | Timid, no visual hierarchy | Dominant + accent — 60/30/10 rule |

---

## PART 2 — VISUAL DESIGN LOGIC

---

### 2.1 — TYPOGRAPHY SYSTEM

Typography is the most powerful design tool. More than color, more than layout.

**The Font Pairing Logic:**

```
ROLE          CHOICE CRITERIA                    EXAMPLES OF DIRECTION
─────────────────────────────────────────────────────────────────────
Display/Hero  Maximum character and personality   Playfair, Fraunces, Cabinet Grotesk,
              Carries the brand voice              Syne, Clash Display, Chillax

Body/Reading  Maximum legibility at small sizes   DM Sans, Plus Jakarta, Lora,
              Complements display, doesn't compete  Source Serif, Instrument Sans

Mono/Code     Technical contexts only             JetBrains Mono, Fira Code,
              Clear character distinction (0 vs O)  IBM Plex Mono
```

**Type Scale Logic (Modular Scale):**

```
Use a modular scale — every size is a ratio apart.
Common ratios: 1.25 (Major Third), 1.333 (Perfect Fourth), 1.5 (Perfect Fifth)

Example with 1.333 (Perfect Fourth), base 16px:
  xs:   10px   (0.625rem)
  sm:   12px   (0.75rem)
  base: 16px   (1rem)       ← body text
  md:   21px   (1.333rem)   ← large body / small heading
  lg:   28px   (1.777rem)   ← h3
  xl:   37px   (2.369rem)   ← h2
  2xl:  50px   (3.157rem)   ← h1
  3xl:  67px   (4.209rem)   ← hero display
```

**Typographic Hierarchy Rules:**

```
RULE 1: No more than 3 font sizes on one screen (for most UIs)
RULE 2: Weight contrast (400 vs 700) creates hierarchy faster than size alone
RULE 3: Letter-spacing: tighten large headings (-0.02em), loosen small caps (+0.08em)
RULE 4: Line-height: 1.1-1.3 for headings, 1.5-1.7 for body text
RULE 5: Never justify body text (rivers of whitespace)
RULE 6: Measure (line length): 45-75 characters optimal for reading comfort
```

---

### 2.2 — COLOR SYSTEM LOGIC

**The 60/30/10 Rule:**

```
60% — DOMINANT color (backgrounds, large surfaces)
      This is the "room" — neutral or brand-defining
      
30% — SECONDARY color (cards, panels, sidebars)
      Creates structure and depth within the dominant
      
10% — ACCENT color (CTAs, highlights, interactive elements)
      This is where the energy lives — use it sparingly
```

**Color Palette Construction:**

```
STEP 1: Choose your dominant hue
        Ask: What emotion should this interface produce?
        Trust / stability → blues, deep greens
        Energy / urgency  → reds, oranges
        Premium / calm    → deep neutrals, warm grays, muted earth
        Creative / playful → unexpected combinations, high saturation

STEP 2: Build a tonal range (5-7 stops)
        50 (lightest) → 100 → 200 → 300 → 400 → 500 (mid) → 600 → 700 → 800 → 900 (darkest)
        Use 50-100 for backgrounds
        Use 500-600 for primary elements
        Use 800-900 for text

STEP 3: Choose ONE accent that creates maximum contrast
        The accent should be visually "loud" against the dominant
        It should appear only where you want the user's eye to go

STEP 4: Define semantic colors
        Success:  green family
        Warning:  amber family
        Error:    red family
        Info:     blue family
        These are FUNCTIONAL — keep them distinct from brand colors
```

**CSS Variable System:**

```css
:root {
  /* Core palette */
  --color-bg:          #0f0f13;
  --color-surface:     #1a1a22;
  --color-surface-2:   #252530;
  --color-border:      #2e2e3d;

  /* Text */
  --color-text-primary:   #f0f0f5;
  --color-text-secondary: #9090a8;
  --color-text-muted:     #5a5a70;

  /* Brand */
  --color-accent:      #e8c547;
  --color-accent-dim:  #b89a2e;

  /* Semantic */
  --color-success:     #4caf82;
  --color-warning:     #f0a04b;
  --color-error:       #e05c5c;

  /* Typography */
  --font-display:  'Syne', sans-serif;
  --font-body:     'DM Sans', sans-serif;
  --font-mono:     'JetBrains Mono', monospace;

  /* Spacing scale */
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-6:  24px;
  --space-8:  32px;
  --space-12: 48px;
  --space-16: 64px;
  --space-24: 96px;
}
```

---

### 2.3 — SPATIAL COMPOSITION LOGIC

**The Grid Is a Starting Point, Not a Prison:**

```
SAFE (boring):        12-column grid, everything aligned
INTERESTING:          Break columns intentionally at specific moments
MEMORABLE:            One element that violates the grid in a controlled way

Techniques:
  → Overlap elements across grid boundaries
  → Bleed images to screen edge
  → Use negative space as a design element, not dead space
  → Diagonal lines and angles against a rectilinear grid = tension
  → Size contrast: one huge element + many small = visual drama
```

**Spacing Logic:**

```
INTERIOR spacing (within components):
  Padding follows the component's "weight" —
  heavy/important components get more padding
  
EXTERIOR spacing (between components):
  Related items: tight (8-16px)
  Different sections: generous (48-96px)
  Visual grouping IS proximity — no label needed if spacing is right

THE 4-POINT GRID:
  All spacing values are multiples of 4
  4, 8, 12, 16, 24, 32, 48, 64, 96...
  This creates invisible rhythm that feels "right" without being obvious
```

**Visual Weight Distribution:**

```
Every layout has a visual center of gravity.
Where the heaviest element sits = where the eye goes first.

CONTROL the reading path:
  1st: Where should they look first? (hero, headline)
  2nd: What do they need to understand? (value prop, key info)
  3rd: What should they do? (CTA, next step)

If ALL elements have equal weight → nothing is important
If ONE element has all the weight → monotone, boring
BEST: 1 heavy anchor + medium supporting elements + light background texture
```

---

### 2.4 — MOTION & ANIMATION LOGIC

**Animation Hierarchy:**

```
TIER 1 — STRUCTURAL (always include)
  Page/component load transitions
  Route changes
  Modal appear/disappear
  These set the tone for the whole experience

TIER 2 — FEEDBACK (include for interactive elements)
  Button press states
  Form field focus
  Toggle/switch animations
  Loading states
  These confirm user actions

TIER 3 — DELIGHT (selective — too much = distraction)
  Hover effects on cards
  Scroll-triggered reveals
  Micro-animations on success/completion
  Cursor effects
  These add personality — use 1-2, not 10
```

**Animation Timing Rules:**

```
INSTANT    (0ms):      State changes that need no acknowledgment
FAST       (100-150ms): Button clicks, immediate feedback
NORMAL     (200-300ms): UI transitions, modals, tooltips
SLOW       (400-600ms): Page transitions, hero animations
VERY SLOW  (700ms+):   Cinematic moments — use sparingly

EASING CURVES:
  ease-out:        Natural deceleration — feels physical (most interactions)
  ease-in-out:     Smooth travel — feels polished (full-page transitions)
  ease-in:         Building momentum — rarely used in UI
  cubic-bezier:    Custom spring/bounce for personality moments

STAGGER PATTERN (for lists/grids loading in):
  animation-delay: calc(var(--index) * 60ms)
  This creates a cascade effect that reads as "alive"
```

**CSS Animation Template:**

```css
/* Staggered reveal */
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}

.item {
  animation: fadeUp 0.4s ease-out both;
  animation-delay: calc(var(--i, 0) * 0.06s);
}

/* Smooth hover lift */
.card {
  transition: transform 0.2s ease-out, box-shadow 0.2s ease-out;
}
.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0,0,0,0.2);
}

/* Button press */
.button {
  transition: transform 0.1s ease-out, background 0.15s ease;
}
.button:active {
  transform: scale(0.97);
}
```

---

## PART 3 — UX LOGIC: INTERACTION DESIGN

---

### 3.1 — THE FRICTION AUDIT

Every interaction has friction. Some friction is necessary (confirmation dialogs).
Most friction is accidental and must be eliminated.

**Friction Sources:**

```
COGNITIVE FRICTION:
  Too many choices at once (Hick's Law: more options = longer decision time)
  Unclear labels or ambiguous actions
  Inconsistent patterns (same action looks different in two places)
  Missing feedback (did my click do anything?)
  → Fix: Reduce options, clarify labels, add feedback

MOTOR FRICTION:
  Buttons too small to tap accurately (minimum 44x44px touch target)
  Critical actions placed at screen edges (hard to reach on mobile)
  Drag targets that are finicky
  Hover-only interactions on mobile
  → Fix: Generous tap targets, thumb-zone awareness, touch-friendly patterns

TEMPORAL FRICTION:
  Slow load times without loading state
  Multi-step forms that don't show progress
  Animations that block interaction
  → Fix: Loading states, progress indicators, non-blocking animations

MEMORY FRICTION:
  User has to remember something from a previous screen
  Form loses data on navigation error
  No confirmation of what was just submitted
  → Fix: Show context, preserve state, confirm completions
```

---

### 3.2 — COMPONENT DESIGN LOGIC

Each component must answer three questions before implementation:

```
1. WHAT STATE does it have?
   Default / Hover / Active / Focus / Disabled / Loading / Error / Success
   Design ALL states, not just default

2. WHAT are its EDGE CASES?
   Empty state (no data)
   Overflow state (too much content)
   Error state (something failed)
   Loading state (waiting for data)
   NEVER design only for the happy path

3. WHAT is its ROLE in the hierarchy?
   Primary (one per screen max) — the main action
   Secondary (few per screen) — supporting actions
   Tertiary (many) — navigation, minor actions
   Destructive — requires extra confirmation
```

**Button Logic:**

```
PRIMARY BUTTON:
  → Filled, high contrast, accent color
  → Only ONE primary action visible at a time
  → Clear, specific label: "Save Changes" not "Submit"
  
SECONDARY BUTTON:
  → Outlined or ghost, lower visual weight
  → Supports the primary without competing
  
DESTRUCTIVE BUTTON:
  → Red family, slightly muted by default
  → Full red on hover (escalation = intentional)
  → ALWAYS confirm before irreversible action

DISABLED STATE:
  → Reduce opacity to ~40%
  → Cursor: not-allowed
  → CRITICAL: Show WHY it's disabled (tooltip or inline message)
  → "Why can't I click this?" is one of the most common UX frustrations
  
LOADING STATE:
  → Replace label with spinner OR show spinner beside label
  → Disable the button during loading (prevent double-submit)
  → Restore state after completion (success or error)
```

**Form Design Logic:**

```
LABEL POSITION:
  Top labels:     Best for complex forms (scannable, never truncates)
  Floating labels: Good for clean look (accessible if done correctly)
  Inline labels:  Only for very short forms (disappears on focus = memory friction)

INPUT STATES:
  Default   → Subtle border, placeholder text
  Focus     → Accent color border/outline, label elevates
  Filled    → Label stays elevated, value visible
  Error     → Red border, inline error message below (not above)
  Success   → Green check (optional, use for critical validations)
  Disabled  → Gray, reduced opacity, no focus state

VALIDATION TIMING:
  ON BLUR (leaving field):   Validate format (email, phone)
  ON SUBMIT:                 Validate required fields
  REAL-TIME:                 Only for password strength — real-time for most fields feels aggressive

ERROR MESSAGES:
  → Place BELOW the field (eye follows input flow)
  → Be specific: "Enter a valid email (e.g. name@domain.com)"
  → Not accusatory: "Invalid email" is better than "You entered wrong email"
  → One error per field at a time (fix the most critical first)

FORM FLOW:
  → Group related fields visually (address block together)
  → Show progress for multi-step (Step 2 of 4)
  → Never reset a filled form on error — preserve all valid input
  → Auto-focus the first field on form open
```

---

### 3.3 — NAVIGATION LOGIC

```
NAVIGATION HIERARCHY:
  Level 1: Primary nav (top bar or sidebar) — major sections
  Level 2: Sub-nav or tabs — sections within a section
  Level 3: In-page navigation (anchors, breadcrumbs)
  RULE: Never go deeper than Level 3. Restructure the IA instead.

ACTIVE STATE:
  Always show the user where they are
  Active item: distinct from inactive (not just bold — color change + weight)

MOBILE NAVIGATION PATTERNS:
  Bottom tab bar:    Best for 3-5 primary destinations (thumb accessible)
  Hamburger menu:    Only if destinations > 5 or rarely used
  Full-screen menu:  Premium feel, high-impact — use for brand-forward products
  Gesture-based:     Swipe between tabs for immersive apps

BREADCRUMBS:
  Use for: deep hierarchies (3+ levels), e-commerce, file systems
  Don't use for: simple single-level apps, it adds noise

BACK BUTTON LOGIC:
  Always handle: where does "back" go?
  Trap: "Back" after login should not go to login page
  Fix: Redirect to home or previous meaningful state
```

---

### 3.4 — EMPTY STATES, LOADING STATES, ERROR STATES

The three most neglected states in UI design:

**Empty State:**

```
WRONG: Just show nothing (blank white space)
RIGHT: 
  → Illustration or icon that fits the context
  → Clear message: "No projects yet" (not "No data found")
  → A clear action: "Create your first project →"
  → Make it feel like an invitation, not an error

EMPTY STATE FORMULA:
  [Visual] + [What's empty] + [Why it might be empty] + [What to do next]
  "No messages yet. Start a conversation to see them here." + [New Message button]
```

**Loading State:**

```
INSTANT (<100ms):      No loading state needed
FAST (100-1000ms):     Skeleton screen (shows layout before content)
SLOW (1000ms+):        Progress indicator + message
VERY SLOW (3000ms+):   Progress bar + "This is taking longer than usual..."

SKELETON SCREENS:
  → Match the shape/layout of the content that's loading
  → Animate with shimmer effect (left-to-right gradient sweep)
  → Never use generic "spinner only" for complex content
  
OPTIMISTIC UI:
  → Show the result BEFORE the server confirms (with rollback on error)
  → "Like" animations, message send, form save
  → Makes interfaces feel instant — use for high-frequency actions
```

**Error States:**

```
ERROR HIERARCHY:
  INLINE errors:   Field-level validation (show next to the field)
  TOAST/SNACKBAR:  Temporary notification (auto-dismiss after 4-6s)
  BANNER:          Persistent alert for important but non-blocking issues
  FULL-PAGE error: Only for catastrophic failures (404, 500, no connection)

ERROR MESSAGE FORMULA:
  [What happened] + [Why it happened if known] + [What to do]
  "Couldn't save changes. Check your connection and try again." + [Retry button]

NEVER:
  × "Error 403" with no context
  × "Something went wrong" with no action
  × Dismiss errors without giving user a path forward
  × Show technical error codes to non-technical users
```

---

## PART 4 — RESPONSIVE DESIGN LOGIC

---

### 4.1 — MOBILE-FIRST THINKING

```
MOBILE-FIRST ≠ "make a mobile version"
MOBILE-FIRST = Design for the most constrained context first,
               then progressively enhance for larger screens

Why mobile first:
  → Forces prioritization (small screen = ruthless focus)
  → Better performance baseline (load light, enhance progressively)
  → More users are on mobile than desktop for most products
```

**Breakpoint Strategy:**

```
sm:   640px   Minimum — very small phones
md:   768px   Tablets and large phones
lg:   1024px  Laptops and small desktops
xl:   1280px  Standard desktops
2xl:  1536px  Large monitors

DESIGN BREAKPOINTS (the important ones):
  < 768px:   Mobile (single column, bottom nav, full-width elements)
  768-1024px: Tablet (2 columns, can use sidebar)
  > 1024px:  Desktop (full layout, multi-column, hover states)
```

**Touch Target Rules:**

```
MINIMUM tap target:   44x44px (Apple HIG standard)
COMFORTABLE target:   48x48px
CRITICAL action:      At least 56x56px (send, confirm, purchase)

SPACING between targets: at least 8px to prevent mis-taps
THUMB ZONE (bottom 2/3 of phone screen): Place primary actions here
DEATH ZONE (top of screen, far corners): Navigation, non-critical only
```

---

### 4.2 — LAYOUT SHIFT PATTERNS

```
DESKTOP → TABLET:
  3-column grid → 2-column grid
  Sidebar stays visible but narrows
  Navigation bar stays (shrinks)
  Tables may need horizontal scroll

TABLET → MOBILE:
  2-column → single column (stack everything)
  Sidebar collapses into hamburger or bottom nav
  Tables → card-based alternative view
  Modals → full-screen sheets
  Hover states → tap states
  Multi-step flows → accordion or bottom sheet

CRITICAL RULE: Test every layout at 320px (smallest common phone)
               and 1920px (large desktop). If it breaks at extremes,
               it will break for real users.
```

---

## PART 5 — ACCESSIBILITY LOGIC

---

### 5.1 — THE CORE ACCESSIBILITY RULES

Accessibility is not a feature. It is a quality standard.
If your UI is inaccessible, it is broken — for some users completely.

```
THE BIG FOUR:
1. COLOR CONTRAST:
   Normal text:   4.5:1 minimum contrast ratio (WCAG AA)
   Large text:    3:1 minimum (18px bold or 24px regular)
   UI components: 3:1 minimum
   Tool: use contrast checker before finalizing any color pair

2. KEYBOARD NAVIGATION:
   Every interactive element must be reachable by Tab
   Focus order must follow visual reading order
   Focus states must be VISIBLE (not just outline: none)
   Custom :focus-visible styles replace browser default

3. SEMANTIC HTML:
   Use <button> for actions, <a> for navigation (not divs with onClick)
   Use heading hierarchy (h1 → h2 → h3, never skip levels)
   Use <label> for inputs, <fieldset> for groups
   Screen readers read the DOM — semantic structure IS the UX for them

4. ARIA LABELS:
   aria-label for icon-only buttons: <button aria-label="Close dialog">✕</button>
   aria-live for dynamic content that updates: notifications, errors
   aria-expanded for disclosure patterns (accordion, dropdown)
   role="dialog" + aria-modal="true" for modal dialogs
```

**Contrast Quick Reference:**

```
PASS (AA):  White on #767676 or darker
PASS (AA):  Black on #949494 or lighter
FAIL:       Gray text on white background (very common mistake)
FAIL:       Light yellow on white
FAIL:       Pale blue on white

CHECK EVERY:
  → Body text on background
  → Placeholder text on input background
  → Icon on button background
  → Badge text on badge background
```

---

### 5.2 — FOCUS STATE DESIGN

```
WRONG: outline: none; /* I hate the ugly browser ring */
RIGHT: Design a beautiful, visible focus state

/* Good focus state */
.interactive:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 3px;
  border-radius: 4px;
}

/* Alternatively — glow effect */
.interactive:focus-visible {
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.4);
  outline: none;
}

RULE: :focus-visible only shows for keyboard navigation,
      not for mouse clicks — best of both worlds
```

---

## PART 6 — IMPLEMENTATION LOGIC (CODE)

---

### 6.1 — CSS ARCHITECTURE LOGIC

```
STRUCTURE ORDER (inside a component's CSS):
1. Layout (display, position, grid, flex)
2. Box model (width, height, padding, margin, border)
3. Visual (background, color, box-shadow)
4. Typography (font, line-height, text-align)
5. Animation (transition, animation)
6. States (:hover, :focus, :active, :disabled)
7. Media queries (at the end, per component)
```

**CSS Custom Properties Best Practice:**

```css
/* WRONG: hardcoded values */
.button {
  background: #e8c547;
  color: #0f0f13;
  padding: 12px 24px;
}

/* RIGHT: semantic variables */
.button {
  background: var(--color-accent);
  color: var(--color-bg);
  padding: var(--space-3) var(--space-6);
  font-family: var(--font-body);
  transition: background var(--duration-fast) ease-out;
}
```

---

### 6.2 — REACT COMPONENT ARCHITECTURE LOGIC

```
COMPONENT DECOMPOSITION RULE:
  If a component does more than ONE thing clearly, split it.
  If a component has more than ~150 lines, split it.
  If you copy-paste a block twice, extract it.

COMPONENT TYPES:
  Presentational:  Only renders UI. No state, no side effects.
                   Props in → JSX out. Easiest to test.
  Container:       Manages state, fetches data, passes to presentational.
  Compound:        Multiple sub-components with shared state (Tabs, Accordion).
  HOC/Hook:        Shared behavior extracted (useForm, useTheme, useDebounce).

STATE PLACEMENT RULE:
  State lives as CLOSE to where it's used as possible.
  If only one component needs it → local useState
  If sibling components need it → lift to parent
  If distant components need it → Context or state management
  NEVER: Global state for local concerns (don't put a modal's open state in Redux)
```

**Component Template:**

```jsx
// Presentational component — clean pattern
const Button = ({
  children,
  variant = 'primary',  // Always provide defaults
  size = 'md',
  disabled = false,
  loading = false,
  onClick,
  ...props               // Spread remaining HTML props
}) => {
  return (
    <button
      className={`btn btn--${variant} btn--${size}`}
      disabled={disabled || loading}
      onClick={onClick}
      aria-busy={loading}  // Accessibility
      {...props}
    >
      {loading ? <Spinner size="sm" /> : children}
    </button>
  );
};
```

---

### 6.3 — PERFORMANCE LOGIC (UI SIDE)

```
RENDER PERFORMANCE:
  → Avoid re-renders: useMemo for expensive computations, useCallback for handlers
  → Key prop: Always use stable IDs as keys (not array index)
  → Virtualize long lists: react-virtual or similar for 100+ items
  → Code split: lazy-load routes and heavy components

IMAGE PERFORMANCE:
  → Always specify width/height (prevents layout shift)
  → Use modern formats: WebP > JPEG > PNG for photos
  → Lazy load images below fold: loading="lazy"
  → Responsive images: srcset for different screen sizes

CSS PERFORMANCE:
  → Avoid animating layout properties (width, height, top, left)
  → Animate ONLY: transform, opacity (GPU-accelerated, no layout recalc)
  → Use will-change: transform for elements that will animate (sparingly)
  → Avoid deep CSS selectors (more than 3 levels)
```

---

## PART 7 — THE COMPLETE UI/UX WORKFLOW

---

### 7.1 — FROM REQUEST TO DELIVERED UI

```
STEP 1: INTAKE (always before any code)
         Who is the user? What is their goal? What is the context?
         What must work perfectly?

STEP 2: DIRECTION STATEMENT
         Choose aesthetic direction. Write the direction statement.
         This is non-negotiable — commit before touching code.

STEP 3: SYSTEM SETUP
         Define CSS variables (colors, fonts, spacing, durations)
         Set up typography scale
         Establish base component styles

STEP 4: LAYOUT FIRST
         Build the spatial structure before adding content
         Get the hierarchy and composition right
         Test at mobile and desktop widths

STEP 5: COMPONENTS
         Build each component with ALL states (default, hover, focus, disabled, error)
         Start with the most critical component (primary CTA)

STEP 6: CONTENT & COPY
         Fill with realistic content (not Lorem Ipsum for final designs)
         Test edge cases: very long text, very short text, empty

STEP 7: MOTION & POLISH
         Add Tier 1 animations (structural)
         Add Tier 2 animations (feedback)
         Add 1-2 Tier 3 delights (personality)

STEP 8: ACCESSIBILITY PASS
         Check contrast ratios
         Test keyboard navigation
         Add aria labels to icon-only elements
         Verify focus states are visible

STEP 9: RESPONSIVE CHECK
         Test at 320px, 768px, 1024px, 1440px
         Fix layout shifts
         Verify touch targets on mobile

STEP 10: DELIVER
          Clean code, working file
          Present with present_files
```

---

## PART 8 — QUICK REFERENCE

---

### The UI/UX Golden Rules

```
VISUAL:
  One direction, committed fully — not a mix of aesthetics
  60/30/10 color rule — dominant + secondary + accent
  Type: distinctive pair, modular scale, max 3 sizes on screen
  Spacing: 4-point grid everywhere
  Motion: structural → feedback → delight (in that priority)

UX:
  Design for failure states first, happy path second
  Every component has 5+ states (default/hover/focus/disabled/error)
  Friction is the enemy — eliminate it wherever it's accidental
  Never design only for the happy path
  Show the user where they are, what happened, what to do next

ACCESSIBILITY:
  4.5:1 contrast minimum (3:1 for large text)
  Keyboard navigable — visible focus states
  Semantic HTML — not div soup
  ARIA for dynamic content

CODE:
  CSS variables for every repeated value
  Animate transform/opacity only (GPU)
  Mobile-first breakpoints
  All interactive elements: 44x44px minimum tap target
```

### The 10 Questions Before Any UI Output

```
1. Did I write the Direction Statement?
2. Is the font pairing distinctive (not Inter/Roboto/Arial)?
3. Is the color palette committed (not timid/evenly distributed)?
4. Are ALL component states designed (not just default)?
5. Is there an empty state, loading state, and error state?
6. Does the layout have one clear visual anchor?
7. Are animations structural before decorative?
8. Does every button have 44px minimum tap target?
9. Is contrast ratio passing (≥4.5:1 for body text)?
10. Does it work at 320px mobile AND 1440px desktop?
```

---

*Load this file alongside AGENT_RULES.md, ANALYSIS_AND_SEARCH_STRATEGY.md,
and LOGIC_THINKING_SKILL_SYSTEM.md for the complete 4-layer agent cognitive stack.
This file governs all UI/UX and frontend design tasks.*