# DESIGN.md — LifeCycle Mobile
> Design system reference for the React Native / Expo app.
> Derived from codebase analysis. Keep this in sync when adding new tokens.

---

## Typography

**No explicit `fontFamily` declarations found** — the app uses the system default (San Francisco on iOS, Roboto on Android). If you add custom fonts, list them here.

### Type Scale

All sizes are in points (RN `fontSize`). Use **only** these steps:

| Token | Size | Use |
|---|---|---|
| `type.xs` | 9 | Eyebrow labels, badges, micro-copy |
| `type.sm` | 11 | Helper text, timestamps, captions |
| `type.base` | 13 | Body copy, list items |
| `type.md` | 15 | Default body, card descriptions |
| `type.lg` | 17 | Card titles, subheadings |
| `type.xl` | 20 | Section headings |
| `type.2xl` | 24 | Screen titles |
| `type.3xl` | 32 | Hero / display headings |
| `type.4xl` | 42 | Large display (use sparingly) |

> **Do not** use intermediate sizes like 14, 16, 18, 19, 21, 22, 23, 25.

---

## Color Palette

### Brand — Deep Forest Green

| Token | Hex | Use |
|---|---|---|
| `color.brand.900` | `#22312d` | Darkest text, shadow color |
| `color.brand.700` | `#41514d` | Dark text on light backgrounds |
| `color.brand.600` | `#53615d` | Secondary text |
| `color.brand.500` | `#62706b` | Muted text, subtitles |
| `color.brand.400` | `#7a8580` | Placeholder text, disabled |
| `color.brand.300` | `#8a928d` | Borders, dividers |
| `color.brand.200` | `#9aa39d` | Subtle borders |
| `color.brand.100` | `#d9d6cd` | Card borders, input borders |
| `color.brand.50` | `#eef1ec` | Tinted backgrounds, chips |
| `color.brand.25` | `#f8f6f2` | Page / surface background |

### Accent — Muted Green (Action)

| Token | Hex | Use |
|---|---|---|
| `color.accent.dark` | `#2f6b4f` | Pressed / active state |
| `color.accent.base` | `#2f6b55` | Primary action buttons |
| `color.accent.light` | `#ebf1e8` | Success backgrounds, chips |

### Warm — Tan / Earth

| Token | Hex | Use |
|---|---|---|
| `color.warm.dark` | `#86654a` | Warm dark text |
| `color.warm.base` | `#8b7255` | Warm labels |
| `color.warm.mid` | `#7f6653` | Secondary warm text |
| `color.warm.light` | `#ece9e3` | Warm tinted surface |
| `color.warm.pale` | `#e6e3da` | Subtle warm border |

### Danger — Red

| Token | Hex | Use |
|---|---|---|
| `color.danger.dark` | `#991b1b` | Dark error state |
| `color.danger.base` | `#b91c1c` | Error text |
| `color.danger.light` | `#d32f2f` | Primary destructive action |

### Success

| Token | Hex | Use |
|---|---|---|
| `color.success.base` | `#166534` | Success text |
| `color.white` | `#ffffff` | Surfaces, cards |

---

## Spacing Scale

Use **only** these steps:

| Token | Value | Use |
|---|---|---|
| `space.1` | 4 | Micro gaps (icon-to-label) |
| `space.2` | 8 | Tight gaps between related items |
| `space.3` | 12 | Default inner gap |
| `space.4` | 16 | Standard padding |
| `space.5` | 20 | Generous padding |
| `space.6` | 24 | Section separation |
| `space.8` | 32 | Screen-level padding |
| `space.10` | 40 | Hero spacing |

> **Do not** use 5, 7, 9, 10, 11, 13, 14, 18 as ad-hoc values.

---

## Shape Scale (Border Radius)

| Token | Value | Use |
|---|---|---|
| `radius.xs` | 4 | Tags, badges, small chips |
| `radius.sm` | 8 | Inputs, small buttons |
| `radius.md` | 12 | Cards, modals |
| `radius.lg` | 16 | Prominent cards |
| `radius.xl` | 22 | Full-width cards |
| `radius.full` | 999 | Pills, avatar chips only |

> Anything above `radius.xl` on a card rounds into a blob. Values like 34, 39, 40, 59, 65, 95, 105, 110, 130 found in the codebase are **slop** — replace with `radius.xl` max.

---

## Elevation / Shadow

**Never** combine `borderWidth: 1` with a wide `shadowRadius` on the same element. Pick one.

| Level | `shadowColor` | `shadowOpacity` | `shadowRadius` | `elevation` | Use |
|---|---|---|---|---|---|
| `elev.none` | — | 0 | 0 | 0 | Flat surfaces |
| `elev.sm` | `#000` | 0.04 | 4 | 1 | Default cards |
| `elev.md` | `#000` | 0.06 | 8 | 2 | Floating cards |
| `elev.lg` | `#000` | 0.10 | 14 | 4 | Modals, action sheets |

> **Do not** use colored shadowColor values (`#22312d`, `#7e9080`, `#24332f`, etc.). Always use `#000`.

---

## Motion

- **Entrances:** `Easing.out(Easing.quad)`
- **Exits:** `Easing.in(Easing.quad)`
- **Transitions:** `Easing.inOut(Easing.quad)`
- Do **not** use `Easing.bounce` or `Easing.elastic` on interface elements.

| Token | Value | Use |
|---|---|---|
| `duration.fast` | 150ms | Micro interactions |
| `duration.base` | 250ms | Default transitions |
| `duration.slow` | 400ms | Page-level entrances |
| `duration.slower` | 600ms | Complex animations |

---

## Component Rules

### Cards
- Use `borderWidth: 1, borderColor: color.brand.100` WITHOUT shadow — OR — use `elev.sm` WITHOUT a border.
- Standard card `borderRadius`: `radius.md` or `radius.lg`.
- Maximum nesting depth: **1 level**. No cards inside cards.

### Buttons
- Primary: `backgroundColor: color.accent.base`, white label.
- Secondary: `borderWidth: 1, borderColor: color.brand.100`.
- Destructive: `backgroundColor: color.danger.light`, white label.
- `radius.full` only for icon-only circular buttons.

### Section Labels
- Do **not** use kicker / eyebrow labels above screen headings.
- Embed context in the heading itself, or use the navigation header.
- Exception: step indicators (`Step 1 of 2`) in multi-step flows are acceptable.

### Icons
- Use Ionicons at sizes: 16, 18, 20, 22, 24.
- Do not put icons in large rounded-square containers above headings.

---

## Slop Reference

Patterns flagged by [impeccable.style/slop](https://impeccable.style/slop) as AI-generated UI tells:

| Anti-pattern | Use instead |
|---|---|
| Eyebrow/kicker label above every heading | Integrate into heading or use nav header |
| `borderWidth: 1` + wide `shadowRadius` on same element | Pick one: border OR shadow |
| `shadowColor: '<brand-hex>'` | Always `shadowColor: '#000'` |
| Inline literal hex colors | Use color tokens from this file |
| `borderRadius > 22` on cards | `radius.xl` max; `radius.full` for pills only |
| Ad-hoc spacing (5, 7, 9, 11, 13, 14…) | Use spacing scale only |
| Identical `<Card mode="elevated">` grids | Vary weight/size for primary vs secondary content |
