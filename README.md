# 🫧 liquid-glass

<div align="center">

**Glassmorphism. Done properly.**

*Chromatic aberration · Iridescent shimmer · Pointer-tracked spotlight · GPU-adaptive rendering*

[![Version](https://img.shields.io/badge/version-1.0.0-a78bfa?style=flat-square)](https://github.com/your-org/liquid-glass)
[![License](https://img.shields.io/badge/license-MIT-818cf8?style=flat-square)](LICENSE)
[![Size](https://img.shields.io/badge/gzipped-~3kb-34d399?style=flat-square)](#)
[![Zero deps](https://img.shields.io/badge/dependencies-zero-f472b6?style=flat-square)](#)

</div>

---

```
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   ░▒▓█  liquid-glass  █▓▒░                               ║
║                                                          ║
║   The glass feels alive.                                 ║
║   It breathes. It refracts. It responds.                 ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
  - [initLiquidGlass()](#initliquidglass)
  - [destroyLiquidGlass()](#destroyliquidglass)
  - [wrapWithDistortion()](#wrapwithdistortion)
  - [createGrainLayer()](#creategrainlayer)
  - [createReplyQuote()](#createreplyquote)
- [CSS Classes](#css-classes)
- [GPU Tier System](#gpu-tier-system)
- [CSS Custom Properties](#css-custom-properties)
- [Accessibility](#accessibility)
- [Performance Notes](#performance-notes)
- [Examples](#examples)
- [Browser Support](#browser-support)
- [FAQ](#faq)

---

## Overview

**liquid-glass** is a zero-dependency, ~3 kb (gzipped) library that brings genuine depth to glass-effect UI components. Unlike CSS-only glassmorphism snippets you've seen a hundred times, liquid-glass layers four distinct visual systems on top of each other to produce something that actually *looks* like glass:

| Layer | Technique | What it does |
|-------|-----------|--------------|
| 🌊 Distortion | SVG `feTurbulence` + `feDisplacementMap` | Organic, subtly animated warping of background content |
| 🌈 Chromatic aberration | Three-channel `feDisplacementMap` blend | Splits R / G / B at slightly different offsets — the signature of real optics |
| ✨ Iridescent shimmer | `conic-gradient` + CSS Houdini animation | A slow colour-shift rainbow sheen rotating across the surface |
| 💡 Pointer spotlight | `radial-gradient` via `--lg-mx` / `--lg-my` | A soft highlight that chases the user's cursor in real time |

All four layers are GPU-adaptive: on low-end devices the expensive SVG filter is automatically replaced with a passthrough, so no user gets a broken experience.

---

## Features

- 🏎️ **GPU-tier detection** — probes WebGL renderer string at init time; downgrades gracefully on mobile GPUs
- 🎛️ **CSS Houdini integration** — registers `@property` custom properties so `--lg-mx`, `--lg-my`, and `--lg-irid` can be transitioned natively by the browser
- 🧹 **Leak-free teardown** — every `addEventListener` is tracked in a `WeakMap`-style registry and removed precisely on `destroy`
- 👁️ **MutationObserver auto-tracking** — pointer listeners attach automatically to any `.lg` element added after init
- ♿ **`prefers-reduced-motion` aware** — all animations halt when the user has requested reduced motion
- 📦 **Zero dependencies** — pure browser APIs, native ES modules, no build step required
- 🔁 **Idempotent lifecycle** — `init` / `destroy` can be called multiple times safely
- 💬 **Messaging UI helpers** — first-class `createReplyQuote()` for chat interfaces

---

## Installation

### From npm

```bash
npm install liquid-glass
```

### CDN (ESM)

```html
<script type="module">
  import { initLiquidGlass } from 'https://cdn.jsdelivr.net/npm/liquid-glass@2/liquid-glass.js';
  initLiquidGlass();
</script>
```

### Manual

Download `liquid-glass.js` and import it as an ES module — no bundler or build step needed.

---

## Quick Start

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>My App</title>

  <!-- Your page needs a rich background for the glass to refract -->
  <style>
    body {
      background: linear-gradient(135deg, #1a0533 0%, #0d1f4c 50%, #0a2a1a 100%);
      min-height: 100vh;
    }
  </style>
</head>
<body>

  <!-- 1. Add the .lg class to any element -->
  <div class="lg" style="padding: 24px; max-width: 320px; margin: 60px auto; color: white;">
    <h2>Hello, glass.</h2>
    <p>This card refracts, shimmers, and responds to your cursor.</p>
  </div>

  <!-- 2. Import and init -->
  <script type="module">
    import { initLiquidGlass } from './liquid-glass.js';
    initLiquidGlass();
  </script>

</body>
</html>
```

That's it. The library scans the DOM, attaches pointer tracking, injects the SVG filter, and starts the shimmer — all from that one call.

---

## API Reference

### `initLiquidGlass()`

```ts
function initLiquidGlass(): void
```

Bootstraps the entire library. Must be called once before any glass elements appear interactive. Safe to call multiple times — subsequent invocations before `destroyLiquidGlass()` are silent no-ops.

**What it does internally:**
1. Registers CSS Houdini custom properties (`--lg-mx`, `--lg-my`, `--lg-irid`)
2. Probes WebGL to detect GPU tier
3. Injects the SVG `<filter>` into `document.body`
4. Injects the library stylesheet into `document.head`
5. Attaches pointer listeners to all existing `.lg` elements
6. Starts a `MutationObserver` to handle future DOM additions

```js
import { initLiquidGlass } from 'liquid-glass';

// At app startup:
initLiquidGlass();

// If the DOM isn't ready yet, the library waits for DOMContentLoaded automatically.
```

---

### `destroyLiquidGlass()`

```ts
function destroyLiquidGlass(): void
```

Full teardown. Disconnects the `MutationObserver`, removes all pointer event listeners, removes the injected `<style>` and `<svg>` elements, and resets all internal state — including the GPU tier cache.

After calling this, `initLiquidGlass()` can be called again from a clean slate.

```js
import { initLiquidGlass, destroyLiquidGlass } from 'liquid-glass';

initLiquidGlass();

// Later, e.g. on route change in a SPA:
destroyLiquidGlass();

// Re-init for the new view:
initLiquidGlass();
```

> **When do you need this?**  
> In most apps, you'll never call it. It's primarily useful in SPAs where you want to completely swap rendering contexts, or in test environments where you need a fresh state between test cases.

---

### `wrapWithDistortion()`

```ts
function wrapWithDistortion(el: HTMLElement): WrapResult

interface WrapResult {
  wrapper: HTMLDivElement;   // The .lg-outer container
  unwrap:  () => void;       // Restores original DOM position
}
```

Wraps an existing element in a `.lg-outer` distortion container. The distortion SVG filter is applied at the `lg-outer` level rather than directly on `.lg` because SVG filters need a containing element with overflow to avoid clipping the distorted edges.

The wrapper receives an appropriate display class (`flex`, `grid`, or `block`) automatically, inferred from the element's computed `display` style.

```js
import { wrapWithDistortion } from 'liquid-glass';

const card = document.querySelector('.my-card');
const { wrapper, unwrap } = wrapWithDistortion(card);

// The DOM is now: .lg-outer > .my-card

// To undo:
unwrap();
// The DOM is restored: .my-card is back in its original position
```

> **Note:** The `unwrap` closure captures `parentNode` and `nextSibling` at wrap time, so it can restore the exact original position even if siblings have changed.

---

### `createGrainLayer()`

```ts
function createGrainLayer(): HTMLDivElement
```

Creates a `<div class="lg-grain">` element — the animated film-grain overlay. Append it as the **first child** of any `.lg` element.

The grain is a tiny inline SVG noise texture that steps through 8 random offsets at 0.14 s intervals, simulating the flickering grain of analogue film.

```js
import { initLiquidGlass, createGrainLayer } from 'liquid-glass';

initLiquidGlass();

const card = document.querySelector('.my-card');
card.classList.add('lg');
card.prepend(createGrainLayer());
```

> When using `.lg` in HTML directly (rather than creating elements in JS), you can also add the grain in markup:
>
> ```html
> <div class="lg">
>   <div class="lg-grain"></div>
>   <!-- your content -->
> </div>
> ```

---

### `createReplyQuote()`

```ts
function createReplyQuote(
  sender:  string,
  text:    string,
  isOwn?:  boolean,       // default: false
  onClick?: (() => void) | null  // default: null
): HTMLDivElement
```

Creates a fully styled reply-quote bubble for messaging interfaces. The returned element is a `.lg.lg-reply.lg-interactive` div that includes:

- A grain layer
- A `.lg-sender` span (author name)
- A `.lg-text` span (message preview)
- Optional click handler (propagation is stopped internally)
- Pointer tracking attached immediately

```js
import { createReplyQuote } from 'liquid-glass';

// Received message style (light iridescent)
const quote = createReplyQuote(
  'Alice',
  'Are you coming to the meeting at 3?',
  false,
  () => scrollToMessage('msg-42')
);

// Own message style (purple-tinted)
const ownQuote = createReplyQuote(
  'You',
  'Yes, I\'ll be there!',
  true
);

messageInput.prepend(quote);
```

**`isOwn: true`** applies the `.lg-own` modifier which shifts the colour palette to a purple/violet tint — matching the "sent by me" convention in messaging apps.

---

## CSS Classes

Apply these classes directly in HTML for zero-JS usage (after calling `initLiquidGlass()`).

### `.lg`

The core glass surface. Apply to any block-level or inline element.

```html
<div class="lg">Your content</div>
```

**Includes:**
- Frosted glass `backdrop-filter`
- Layered `box-shadow` (inner rim light + outer depth + ambient glow)
- Asymmetric borders (brighter top/left, dimmer right/bottom — simulating top light)
- `::before` pointer-spotlight overlay
- `::after` iridescent conic-gradient overlay
- `--lg-irid` rotation animation

---

### `.lg-interactive`

Adds hover and active state responses. Use on clickable glass elements (buttons, cards, links).

```html
<div class="lg lg-interactive" role="button" tabindex="0">
  Click me
</div>
```

**Hover:** lifts 1.5 px, intensifies shadow and border brightness.  
**Active:** compresses 0.5 px down, scales to 99.2%, snap-fast 80 ms transition.

---

### `.lg-own`

Purple-tinted variant. Use for "sent by current user" bubbles in chat UIs.

```html
<div class="lg lg-own">
  Your message here
</div>
```

---

### `.lg-reply`

Reply-quote layout inside a message bubble. Usually applied together with `.lg` and `.lg-interactive`.

```html
<div class="lg lg-reply lg-interactive">
  <div class="lg-grain"></div>
  <span class="lg-sender">Alice</span>
  <span class="lg-text">Original message preview</span>
</div>
```

---

### `.lg-outer`

The distortion wrapper. You normally don't add this by hand — use `wrapWithDistortion()`. But you can apply it manually if you need to:

```html
<div class="lg-outer">
  <div class="lg">Content</div>
</div>
```

Add `.block`, `.flex`, or `.grid` to control the wrapper's display mode.

---

### `.lg-grain`

The film-grain overlay. Must be the **first child** inside `.lg`.

```html
<div class="lg">
  <div class="lg-grain"></div>
  <p>Content goes here</p>
</div>
```

---

## GPU Tier System

At `initLiquidGlass()` time, the library creates a temporary WebGL context, reads the `UNMASKED_RENDERER_WEBGL` string from `WEBGL_debug_renderer_info`, then immediately destroys the context.

| Tier | Detected when | SVG filter |
|------|---------------|-----------|
| `low` | Old Adreno (3xx/4xx), Mali-4/T, PowerVR SGX, no WebGL support | Passthrough (no distortion) |
| `mid` | Adreno 5xx/6xx, Mali-G5x/G7x, Apple GPU with fewer than 10 cores | Full filter |
| `high` | Desktop GPUs, Apple GPU ≥ 10-core, unknown desktop renderers | Full filter |

The **full filter** uses an animated `feTurbulence` (changing `baseFrequency` and `seed` over time) feeding three separate `feDisplacementMap` passes — one per colour channel — to produce chromatic aberration. This is GPU-intensive; the adaptive tier system prevents it from impacting low-end users.

If WebGL is unavailable (e.g. blocked by privacy settings), the library falls back to `low` tier silently.

---

## CSS Custom Properties

These properties drive the pointer-tracking spotlight and iridescence. They are registered as CSS Houdini `@property` values, which means the browser can interpolate them directly — enabling smooth, performant transitions without JavaScript animation loops.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `--lg-mx` | `<percentage>` | `50%` | Horizontal cursor position within the element |
| `--lg-my` | `<percentage>` | `30%` | Vertical cursor position (default biased toward top) |
| `--lg-irid` | `<angle>` | `0deg` | Current rotation of the iridescent conic-gradient |

You can override them per-element to pre-position the spotlight:

```css
.my-hero-card {
  --lg-mx: 30%;
  --lg-my: 20%;
}
```

Or animate them yourself:

```css
.my-card {
  animation: spotlight-sweep 4s ease-in-out infinite alternate;
}
@keyframes spotlight-sweep {
  from { --lg-mx: 20%; }
  to   { --lg-mx: 80%; }
}
```

> **Fallback:** In browsers without Houdini `CSS.registerProperty` support, the variables still work — you just lose the smooth CSS-native transition on cursor movement (it will still update, just without interpolation).

---

## Accessibility

- **`prefers-reduced-motion`** — when this media query is active, all CSS animations (`lg-irid-spin`, `lg-grain-shift`) are disabled, `transition` is set to `none`, and `will-change` is cleared from the grain layer. The glass surfaces still render; only motion is removed.

- **Pointer events** — `.lg-grain`, `::before`, and `::after` all have `pointer-events: none`, so overlays never interfere with interaction.

- **Semantic HTML** — the library imposes no semantic structure. You control the markup. Use proper `role`, `aria-*`, and `tabindex` attributes on your elements.

- **Focus** — `.lg-interactive` has no custom focus style by default. You should add one:
  ```css
  .lg.lg-interactive:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.6);
    outline-offset: 3px;
  }
  ```

---

## Performance Notes

**What's on the GPU:**
- `backdrop-filter: blur()` — the most expensive property. Avoid nesting `.lg` elements.
- `filter: url(#lg-distort)` on `.lg-outer` — the SVG displacement filter composites the entire subtree. One per card, not one per page.
- `will-change: transform` — promotes `.lg` to its own composite layer.

**What's on the CPU:**
- `MutationObserver` — low-overhead; only fires on DOM mutations.
- `pointermove` — runs at pointer rate (~60–125 Hz). The handler is two divisions and two `setProperty` calls — negligible.

**Recommendations:**
- Keep `.lg` elements out of scroll-heavy lists (use virtualisation).
- Don't nest `.lg` inside `.lg` — stacking `backdrop-filter` is extremely expensive.
- On very long pages with many glass cards, consider calling `wrapWithDistortion()` only on cards in the viewport (IntersectionObserver + lazy wrapping).

---

## Examples

### Basic card

```html
<div class="lg-outer">
  <div class="lg" style="padding: 28px; border-radius: 18px; color: white; max-width: 300px;">
    <div class="lg-grain"></div>
    <h3 style="margin: 0 0 8px;">Weekly Summary</h3>
    <p style="margin: 0; opacity: 0.7;">12 tasks completed · 3 in progress</p>
  </div>
</div>
```

---

### Interactive button

```html
<div class="lg-outer">
  <button class="lg lg-interactive"
          style="padding: 12px 28px; font-size: 15px; font-weight: 600;
                 color: white; border: none; border-radius: 100px; cursor: pointer;">
    <div class="lg-grain"></div>
    Get Started
  </button>
</div>
```

---

### Chat bubble with reply

```js
import { initLiquidGlass, createReplyQuote, createGrainLayer } from 'liquid-glass';

initLiquidGlass();

function createBubble(text, isOwn = false) {
  const bubble = document.createElement('div');
  bubble.className = `lg${isOwn ? ' lg-own' : ''}`;
  bubble.style.cssText = 'padding: 10px 14px; max-width: 280px; color: white; border-radius: 18px;';

  const reply = createReplyQuote('Alice', 'Original message…', false);
  const grain = createGrainLayer();
  const content = document.createElement('p');
  content.style.margin = '6px 0 0';
  content.textContent = text;

  bubble.append(grain, reply, content);
  return bubble;
}

document.querySelector('#chat').append(
  createBubble('Got your message!', true)
);
```

---

### SPA lifecycle (React-style pseudo-code)

```js
import { initLiquidGlass, destroyLiquidGlass } from 'liquid-glass';

// On mount:
useEffect(() => {
  initLiquidGlass();
  return () => destroyLiquidGlass();   // Clean up on unmount
}, []);
```

---

## Browser Support

| Browser | Version | Notes |
|---------|---------|-------|
| Chrome / Edge | 94+ | Full support including Houdini |
| Firefox | 103+ | Full support; no Houdini (smooth transitions degrade gracefully) |
| Safari | 15.4+ | Full support including Houdini |
| Chrome Android | 94+ | GPU tier may resolve to `low`; filter disabled |
| Safari iOS | 15.4+ | `backdrop-filter` fully supported |

> `backdrop-filter` is the hard requirement. All modern evergreen browsers support it. IE and legacy Edge do not.

---

## FAQ

**Q: The glass looks opaque / I can't see through it.**  
A: `backdrop-filter` only blurs content *behind* the element in the stacking context. Your `.lg` element needs to have something visually interesting behind it — a gradient background, an image, or other content. A plain white page will look like frosted nothing.

---

**Q: The distortion effect isn't showing.**  
A: The SVG filter is injected into `document.body`. If your app uses Shadow DOM or an iframe, the filter won't be reachable from inside it. In those cases, inject the SVG filter manually into the shadow root or iframe document.

---

**Q: I'm seeing a flash of unstyled glass on load.**  
A: Call `initLiquidGlass()` before your content renders, or add `.lg` elements to the DOM only after calling `init`. The `MutationObserver` handles post-init additions automatically.

---

**Q: Can I use `.lg` on `<button>` or `<a>` directly?**  
A: Yes. The library is class-based and imposes no element restrictions. Just make sure to reset browser default button/anchor styles as needed.

---

**Q: How do I customise the blur amount?**  
A: Override `backdrop-filter` directly on your element:
```css
.my-card.lg {
  backdrop-filter: blur(8px) saturate(140%);
  -webkit-backdrop-filter: blur(8px) saturate(140%);
}
```

---

**Q: Can I change the border-radius?**  
A: Yes — override `border-radius` on `.lg` or inline:
```html
<div class="lg" style="border-radius: 100px;">Pill shape</div>
```

---

## License

MIT © 2026 Boris Maltsev — do whatever you want, attribution appreciated.

---

<div align="center">

*Built with an unhealthy obsession with light physics.*

</div>
