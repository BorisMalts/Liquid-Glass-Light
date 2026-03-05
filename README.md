# 🫧 Vortex-Glass

<div align="center">

**Glassmorphism. Done properly.**

*WebGL2 caustics · Chromatic dispersion · Spring-physics cursor · Fresnel edge · Iridescence · GPU-adaptive rendering*

[![Version](https://img.shields.io/badge/version-1.1.1-a78bfa?style=flat-square)](https://github.com/BorisMalts/Vortex-Glass?tab=readme-ov-file)
[![License](https://img.shields.io/badge/license-Apache_2.0-818cf8?style=flat-square)](LICENSE)
[![Size](https://img.shields.io/badge/gzipped-~9kb-34d399?style=flat-square)](#)
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
║   Now it caustics. Now it tilts. Now it knows physics.   ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

---

## Table of Contents

- [Overview](#overview)
- [What's New in v1.1.1](#whats-new-in-v111)
- [What's New in v1.1.0](#whats-new-in-v110)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
  - [initLiquidGlass()](#initliquidglass)
  - [destroyLiquidGlass()](#destroyliquidglass)
  - [wrapWithDistortion()](#wrapwithdistortion)
  - [createGrainLayer()](#creategrainlayer)
  - [createReplyQuote()](#createreplyquote)
  - [attachElement()](#attachelement)
  - [detachElement()](#detachelement)
  - [getGpuTier()](#getgputier)
  - [version()](#version)
- [CSS Classes](#css-classes)
- [GPU Tier System](#gpu-tier-system)
- [CSS Custom Properties](#css-custom-properties)
- [Visual Layer Stack](#visual-layer-stack)
- [Accessibility](#accessibility)
- [Performance Notes](#performance-notes)
- [Examples](#examples)
- [Browser Support](#browser-support)
- [FAQ](#faq)

---

## Overview

**liquid-glass** is a zero-dependency library that brings genuine optical depth to glass-effect UI components. v1.1.0 moves well beyond CSS-only glassmorphism by introducing a real-time WebGL2 caustic engine, spring-physics cursor dynamics, and physically-based light simulation — while remaining fully adaptive to low-end GPUs and accessible to users who prefer reduced motion.

| Layer | Technique | What it does |
|-------|-----------|--------------|
| 🌊 Distortion | SVG `feTurbulence` + 3-channel `feDisplacementMap` | Organic animated warping with per-channel chromatic fringing |
| ⚡ Caustics | WebGL2 Voronoi fragment shader | Animated light caustic patterns, per-element, blended in screen mode |
| 🌈 Iridescence | `conic-gradient` + Houdini `--lg-irid` | Slow colour-shift rainbow sheen rotating across the surface |
| 💡 Spotlight | `radial-gradient` via spring-driven `--lg-mx` / `--lg-my` | A soft highlight that follows the cursor with physical spring momentum |
| 🔮 Fresnel edge | Schlick approximation in GLSL | Edge glow that intensifies at grazing angles, tilt-aware |
| 🫧 Thin-film | Per-fragment oil-slick interference | Iridescent shimmer that shifts with tilt and time |
| 🌬️ Breathing | `lg-breathe` keyframe animation | Organic `border-radius` oscillation — the border feels alive |

---

## What's New in v1.1.1

This is a patch release. No behaviour, API, or visual output has changed.

### 🐛 Bug Fixes

**`_buildCSS()` — unclosed `@media (prefers-reduced-motion: reduce)` block**

The closing `}` for the reduced-motion media query was missing at the end of the returned CSS string. In most browsers this caused the parser to silently discard the ruleset entirely, meaning the accessibility override (`animation: none`, `transition: none`, `filter: none`) had no effect for users who had enabled reduced-motion in their OS settings.

```css
/* v1.1.0 — block never closed; rules were ignored by the parser */
@media (prefers-reduced-motion: reduce) {
    .lg { ... }
    .lg-caustic-canvas { display: none; }
↑ missing }

/* v1.1.1 — correctly closed */
@media (prefers-reduced-motion: reduce) {
    .lg { ... }
    .lg-caustic-canvas { display: none; }
}
```

**`_attach()` — `es` referenced before declaration in pointer-event closures**

Inside `_attach`, the `onEnter` and `onLeave` closures both wrote to `es.hovered`. However, `es` was declared with `const` *after* those closures — relying on function-scoped `var`-style hoisting that does not apply to `const`/`let`. Under strict temporal dead zone rules this is technically a bug, and any linter or bundler that inlines or reorders declarations (e.g. Rollup, esbuild) could produce a `ReferenceError` at runtime.

The fix declares `es` with `let` *before* the handler definitions and assigns it after, making the reference order explicit and safe under all build tools.

```js
// v1.1.0 — es used inside closures before its const declaration
const onEnter = () => { es.hovered = true; };   // ← es not yet declared
const onLeave = () => { es.hovered = false; };  // ← es not yet declared
// ...
const es = { ... };   // declared here

// v1.1.1 — es declared first, assigned after handlers, before _tracked.add()
let es;                                         // ← declared here
const onEnter = () => { es.hovered = true; };   // safe closure reference
const onLeave = () => { es.hovered = false; };  // safe closure reference
// ...
es = { ... };   // assigned before any event can fire
```

---

## What's New in v1.1.0

### ⚡ WebGL2 Caustic Engine
A Voronoi-based caustic light simulation renders on a per-element 2-D overlay canvas. The library maintains a **single shared WebGL2 context** for the entire page — the backend canvas renders one element at a time then blits the result via `drawImage`. Elements beyond the quota (`MAX_WEBGL_ELEMENTS = 12`) fall back to CSS automatically.

### 🎯 Spring-Physics Cursor Dynamics
Cursor position, hover factor, and 3-D tilt are driven by a **mass–damping–stiffness spring model** (symplectic Euler integration). The spotlight no longer snaps to the cursor — it trails behind with natural momentum, overshoots slightly, then settles.

```
F = −k(x − target) − d·v      (restoring + damping forces)
a = F / m                       (Newton's second law)
v += a · dt                     (velocity update — symplectic first)
x += v · dt                     (position update)
```

Three independent spring configurations are used: `cursor` (stiff, fast), `hover` (softer), and `tilt` (slow, heavy).

### 🔬 Per-Channel Chromatic Dispersion
The caustic layer samples R, G, and B at slightly offset UV coordinates inside the fragment shader, producing coloured light fringing at glass edges — the same optical artefact seen through real glass prisms.

### 🔭 Physically-Based Fresnel Edge
A **Schlick approximation** computes edge glow based on a surface normal that tilts in response to cursor position and device orientation. The edge brightens at grazing angles exactly as real glass does.

### 🌈 Thin-Film Iridescence & Prismatic Band
Two new GLSL effects:
- **Thin-film**: oil-slick interference pattern (`cos` of angle + time + tilt), masked to element edges.
- **Prismatic band**: a narrow rainbow stripe at the very border, simulating light splitting at the glass edge.

### 📱 Device Orientation Parallax
`DeviceOrientationEvent` feeds the tilt spring system on mobile. Physically tilting the device produces a 3-D parallax sensation — the glass appears to lean in space.

### 🌬️ Liquid Border Morphing
Non-pill, non-FAB elements now breathe through a 9-second organic `border-radius` animation cycle, with eight distinct keyframes using asymmetric radii.

### 🎛️ Six Houdini Properties
Two new custom properties added: `--lg-tx` and `--lg-ty` (tilt axes, type `<number>`), enabling native CSS interpolation of the 3-D transform alongside the existing `--lg-mx`, `--lg-my`, `--lg-irid`, and `--lg-hover`.

### 🧹 Full WeakMap Lifecycle
Per-element state (springs, canvas, ResizeObserver, listeners) is stored in a `WeakMap<HTMLElement, ElementState>`. Removed elements are automatically garbage-collected; `destroyLiquidGlass()` performs a full clean sweep with zero leaks.

---

## Features

- ⚡ **WebGL2 caustic engine** — Voronoi fragment shader, one shared GL context, per-element canvas blit
- 🎯 **Spring-physics cursor** — mass / damping / stiffness model, three independent spring configs
- 🔬 **Per-channel chromatic dispersion** — R / G / B sampled at different UV offsets in GLSL
- 🔭 **Schlick Fresnel edge glow** — physically correct, tilt-aware
- 🌈 **Thin-film iridescence** — oil-slick interference pattern at grazing angles
- 🫧 **Liquid border morphing** — organic `border-radius` breathing animation
- 📱 **Device orientation parallax** — gyroscope drives 3-D tilt on mobile
- 🏎️ **Adaptive GPU tiers** — `high / mid / low`, WebGL quota enforced
- 🎛️ **Six Houdini custom properties** — all spring-driven values are CSS-animatable
- 👁️ **ResizeObserver** — caustic canvas stays pixel-perfect as elements resize
- 🧹 **Leak-free WeakMap lifecycle** — GC handles removed elements automatically
- ♿ **`prefers-reduced-motion` aware** — all animations disabled when requested
- 📦 **Zero dependencies** — pure browser APIs, native ES modules
- 🔁 **Idempotent lifecycle** — `init` / `destroy` safe to call multiple times

---

## Installation

### From GitHub

```bash
git clone https://github.com/BorisMalts/Vortex-Glass
```

---

## Quick Start

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>My App</title>
  <style>
    body {
      background: linear-gradient(135deg, #1a0533 0%, #0d1f4c 50%, #0a2a1a 100%);
      min-height: 100vh;
    }
  </style>
</head>
<body>

  <div class="lg lg-interactive"
       style="padding: 24px; max-width: 320px; margin: 60px auto; color: white; border-radius: 18px;">
    <div class="lg-grain"></div>
    <h2>Hello, glass.</h2>
    <p>This card caustics, refracts, shimmers, and responds to your cursor with spring physics.</p>
  </div>

  <script type="module">
    import { initLiquidGlass } from './liquid-glass.js';
    initLiquidGlass();
  </script>

</body>
</html>
```

---

## API Reference

### `initLiquidGlass()`

```ts
function initLiquidGlass(): void
```

Bootstraps the entire library. Safe to call multiple times — subsequent calls before `destroyLiquidGlass()` are silent no-ops.

**What it does internally:**
1. Registers six CSS Houdini custom properties
2. Probes WebGL to detect GPU tier
3. Injects the SVG `<filter>` bank into `document.body`
4. Injects the library stylesheet into `document.head`
5. Attaches spring physics, ResizeObserver, and caustic canvas to all existing `.lg` elements
6. Starts the `MutationObserver` for future DOM additions
7. Starts the `requestAnimationFrame` physics loop
8. Registers `DeviceOrientationEvent` listener (mobile gyroscope)

```js
import { initLiquidGlass } from './liquid-glass.js';
initLiquidGlass();
```

---

### `destroyLiquidGlass()`

```ts
function destroyLiquidGlass(): void
```

Full teardown. Cancels the rAF loop, disconnects the `MutationObserver`, detaches all element state (springs, ResizeObservers, listeners, caustic canvases), removes the injected `<style>`, `<svg>`, and WebGL backend canvas, and resets all module state including the GPU tier cache.

```js
// On SPA route change:
destroyLiquidGlass();
initLiquidGlass(); // fresh init for the new view
```

---

### `wrapWithDistortion()`

```ts
function wrapWithDistortion(el: HTMLElement): WrapResult

interface WrapResult {
  wrapper: HTMLDivElement;
  unwrap:  () => void;
}
```

Wraps an element in a `.lg-outer` chromatic-aberration container. The SVG filter is applied at the wrapper level so distorted edges aren't clipped. The wrapper's `display` mode is inferred automatically from the element's computed style.

```js
const { wrapper, unwrap } = wrapWithDistortion(document.querySelector('.my-card'));
// Later:
unwrap(); // restores exact original DOM position
```

---

### `createGrainLayer()`

```ts
function createGrainLayer(): HTMLDivElement
```

Creates a `<div class="lg-grain">` animated film-grain overlay. Prepend it as the first child of any `.lg` element. The library inserts one automatically on `_attach` if none is found.

```js
const el = document.createElement('div');
el.className = 'lg lg-card lg-interactive';
el.prepend(createGrainLayer());
```

---

### `createReplyQuote()`

```ts
function createReplyQuote(
  sender:   string,
  text:     string,
  isOwn?:   boolean,          // default: false
  onClick?: (() => void) | null
): HTMLDivElement
```

Creates a fully-configured reply-quote bubble for messaging UIs. The returned element is a `.lg.lg-reply.lg-interactive` div with grain layer, sender span, text span, optional click handler, and spring physics attached immediately.

```js
const quote = createReplyQuote(
  'Alice',
  'Are you coming to the meeting?',
  false,
  () => scrollToMessage('msg-42')
);
inputArea.prepend(quote);
```

**`isOwn: true`** applies the `.lg-own` purple-tinted variant.

---

### `attachElement()`

```ts
function attachElement(el: HTMLElement): void
```

Manually attaches the full liquid-glass effect (springs, caustic canvas, ResizeObserver, listeners) to a specific element. Useful when adding `.lg` elements to Shadow DOM or detached trees where the `MutationObserver` won't fire. Requires `initLiquidGlass()` to have been called first.

```js
const el = document.createElement('div');
el.className = 'lg lg-interactive';
shadowRoot.appendChild(el);
attachElement(el);
```

---

### `detachElement()`

```ts
function detachElement(el: HTMLElement): void
```

Manually removes all liquid-glass machinery from an element, restoring it to its pre-attach state. Normally not needed — the `MutationObserver` handles cleanup automatically.

---

### `getGpuTier()`

```ts
function getGpuTier(): 'low' | 'mid' | 'high'
```

Returns the GPU performance tier detected on the current device. Useful for making independent quality decisions in your own code.

```js
if (getGpuTier() === 'high') {
  // enable additional particle effects
}
```

---

### `version()`

```ts
function version(): '1.1.1'
```

Returns the library version string.

---

## CSS Classes

### `.lg`

The core glass surface. Apply to any element.

```html
<div class="lg">Your content</div>
```

Includes: frosted `backdrop-filter`, layered `box-shadow`, asymmetric borders, `::before` spring-driven spotlight, `::after` iridescent conic-gradient, `lg-breathe` border animation, WebGL caustic overlay canvas.

---

### `.lg-interactive`

Adds hover and active state responses. Use on clickable elements.

```html
<div class="lg lg-interactive" role="button" tabindex="0">Click me</div>
```

**Hover:** caustic canvas fades in (opacity 0 → 0.32), shadows deepen, background brightens.
**Active:** compresses 1 px down, scales to 99.1%, 70 ms snap transition.

---

### `.lg-own`

Purple-tinted variant for "sent by current user" chat bubbles.

```html
<div class="lg lg-own">Your message</div>
```

---

### `.lg-reply`

Reply-quote layout. Column flex, left accent bevel, compact padding.

```html
<div class="lg lg-reply lg-interactive">
  <div class="lg-grain"></div>
  <span class="lg-sender">Alice</span>
  <span class="lg-text">Original message preview</span>
</div>
```

---

### `.lg-pill`

Full-radius pill shape. Excludes breathing animation.

```html
<div class="lg lg-pill lg-interactive">Tag</div>
```

---

### `.lg-card`

Large card variant with 22 px radius and 20 px padding.

```html
<div class="lg lg-card">Card content</div>
```

---

### `.lg-fab`

Circular floating action button, 56×56 px.

```html
<div class="lg lg-fab lg-interactive">＋</div>
```

---

### `.lg-outer`

Distortion wrapper. Normally created by `wrapWithDistortion()`. Add `.block`, `.flex`, or `.grid` to control its display mode.

```html
<div class="lg-outer block">
  <div class="lg">Content</div>
</div>
```

---

### `.lg-grain`

Animated film-grain overlay. Must be the **first child** inside `.lg`.

---

## GPU Tier System

At init time the library creates a temporary WebGL context, reads the `UNMASKED_RENDERER_WEBGL` renderer string, then immediately destroys the context.

| Tier | Detected when | WebGL caustics | SVG filter |
|------|---------------|---------------|------------|
| `low` | Old Adreno (2xx–4xx), Mali-4/T, PowerVR SGX, no WebGL | Disabled | Passthrough |
| `mid` | Adreno 5xx/6xx, Mali-G5x/G7x, Apple GPU < 10-core | Enabled (reduced scale) | Full (scale 0.9 / 0.6 / 0.3) |
| `high` | Desktop GPUs, Apple GPU ≥ 10-core, unknown desktop | Enabled (full quality) | Full (scale 1.6 / 1.0 / 0.6) |

A maximum of **12 elements** may have an active WebGL caustic canvas simultaneously. Elements beyond this quota receive CSS-only rendering automatically.

---

## CSS Custom Properties

Six typed Houdini properties are registered, enabling smooth browser-native interpolation of all spring-driven values.

| Property | Type | Default | Updated by |
|----------|------|---------|------------|
| `--lg-mx` | `<percentage>` | `50%` | Cursor X spring |
| `--lg-my` | `<percentage>` | `30%` | Cursor Y spring |
| `--lg-irid` | `<angle>` | `0deg` | CSS `lg-irid-spin` animation |
| `--lg-hover` | `<number>` | `0` | Hover spring (0 → 1) |
| `--lg-tx` | `<number>` | `0` | Tilt X spring (−1 → 1) |
| `--lg-ty` | `<number>` | `0` | Tilt Y spring (−1 → 1) |

You can override them per-element to pre-position the spotlight:

```css
.my-hero-card {
  --lg-mx: 25%;
  --lg-my: 15%;
}
```

---

## Visual Layer Stack

Inside every `.lg` element, effects are composited in z-index order:

| z-index | Element | Effect |
|---------|---------|--------|
| 1 | `::before` | Spring-driven spotlight radial gradient |
| 2 | `::after` | Rotating iridescent conic-gradient |
| 3 | `.lg-grain` | Animated film-grain (soft-light blend) |
| 4 | `.lg-caustic-canvas` | WebGL caustics (screen blend, hover-revealed) |
| 5 | Content children | Text, icons, interactive elements |

---

## Accessibility

- **`prefers-reduced-motion`** — all CSS animations (`lg-irid-spin`, `lg-grain-shift`, `lg-breathe`) are disabled, transitions set to `none`, `will-change` cleared, caustic canvas hidden. Glass surfaces still render; only motion is removed.
- **SVG filter** — disabled (`filter: none`) under reduced-motion.
- **Pointer events** — `::before`, `::after`, `.lg-grain`, and `.lg-caustic-canvas` all have `pointer-events: none`.
- **Semantic HTML** — the library imposes no semantic structure. Use proper `role`, `aria-*`, and `tabindex` on your elements.
- **Focus** — add a visible focus ring yourself:

```css
.lg.lg-interactive:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.65);
  outline-offset: 3px;
}
```

---

## Performance Notes

**WebGL caustics:**
- One shared GL context for the entire page — never hits driver limits.
- Backend canvas is resized to match each element before rendering, then blitted via `drawImage`. Resize is cheap when dimensions are unchanged (the common case).
- Quota of 12 active caustic elements prevents GPU memory over-commitment.

**Spring physics rAF loop:**
- Runs at native frame rate (~60–120 Hz).
- Each element advances 5 springs and sets 5 CSS custom properties per frame — well within the budget of a 60 fps frame.
- The loop is started once by `initLiquidGlass()` and shared across all elements.

**`backdrop-filter`:**
- The most expensive property in the stack. **Never nest `.lg` inside `.lg`** — stacking backdrop filters is extremely costly.
- Limit the number of simultaneously visible `.lg` elements on mobile.

**Recommendations:**
- Keep `.lg` elements out of high-frequency scroll lists (use virtualisation).
- On very long pages, consider `IntersectionObserver` + lazy `attachElement()` / `detachElement()` to pause physics for off-screen elements.
- Avoid animating `width` or `height` on `.lg` elements — triggering layout forces the ResizeObserver to resize the caustic canvas every frame.

---

## Examples

### Basic card

```html
<div class="lg-outer">
  <div class="lg lg-card" style="color: white; max-width: 300px;">
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
  <button class="lg lg-pill lg-interactive"
          style="font-size: 15px; font-weight: 600; color: white; border: none; cursor: pointer;">
    <div class="lg-grain"></div>
    Get Started
  </button>
</div>
```

---

### Chat bubble with reply quote

```js
import { initLiquidGlass, createReplyQuote, createGrainLayer } from './liquid-glass.js';

initLiquidGlass();

function createBubble(text, isOwn = false) {
  const bubble = document.createElement('div');
  bubble.className = `lg${isOwn ? ' lg-own' : ''}`;
  bubble.style.cssText =
    'padding: 10px 14px; max-width: 280px; color: white; border-radius: 18px;';

  bubble.append(
    createGrainLayer(),
    createReplyQuote('Alice', 'Original message…', isOwn),
    Object.assign(document.createElement('p'), {
      textContent: text,
      style: 'margin: 6px 0 0;'
    })
  );

  return bubble;
}

document.querySelector('#chat').append(createBubble('Got your message!', true));
```

---

### Shadow DOM (manual attach)

```js
import { initLiquidGlass, attachElement, detachElement } from './liquid-glass.js';

initLiquidGlass();

const host = document.createElement('div');
const shadow = host.attachShadow({ mode: 'open' });

const el = document.createElement('div');
el.className = 'lg lg-interactive';
el.textContent = 'Inside shadow DOM';
shadow.appendChild(el);

// MutationObserver doesn't see inside shadow DOM — attach manually:
attachElement(el);

// On removal:
detachElement(el);
```

---

### SPA lifecycle

```js
import { initLiquidGlass, destroyLiquidGlass } from './liquid-glass.js';

// React / Vue / Svelte — on mount:
initLiquidGlass();

// On unmount / route change:
destroyLiquidGlass();
```

---

## Browser Support

| Browser | Version | Notes |
|---------|---------|-------|
| Chrome / Edge | 94+ | Full support including Houdini and WebGL2 |
| Firefox | 103+ | Full support; no Houdini (degrades gracefully) |
| Safari | 15.4+ | Full support including Houdini and WebGL2 |
| Chrome Android | 94+ | GPU tier may resolve to `low`; caustics disabled |
| Safari iOS | 15.4+ | Full support; gyroscope parallax active |

`backdrop-filter` is the hard requirement for the glass material. All modern evergreen browsers support it.

WebGL2 is required for caustics. If unavailable, the library falls back to CSS-only rendering transparently.

---

## FAQ

**Q: The glass looks opaque / I can't see through it.**
A: `backdrop-filter` only blurs content *behind* the element in the compositing stack. Your `.lg` element needs something visually rich behind it — a gradient, an image, or other content.

---

**Q: The caustics aren't appearing.**
A: Caustics are hidden by default and only reveal on hover (opacity 0 → 0.32) for elements with `.lg-interactive`. On `low` GPU tier they are disabled entirely. Check `getGpuTier()` to confirm.

---

**Q: The distortion effect isn't showing.**
A: The SVG filter is injected into `document.body`. It won't be reachable from Shadow DOM or iframes — inject the SVG manually into those contexts if needed.

---

**Q: Can I disable the breathing animation on a specific element?**
A: Override `animation` directly:

```css
.my-card.lg {
  animation: lg-irid-spin 15s linear infinite;
}
```

---

**Q: How do I use this in a high-frequency scroll list?**
A: Don't apply `.lg` directly to list items. Use `attachElement()` / `detachElement()` in an `IntersectionObserver` callback to activate and deactivate the effect only for visible items.

---

**Q: Can I change the blur amount?**
A: Override `backdrop-filter` on your element:

```css
.my-card.lg {
  backdrop-filter: blur(10px) saturate(150%);
  -webkit-backdrop-filter: blur(10px) saturate(150%);
}
```

---

**Q: Why did my reduced-motion preference have no effect in v1.1.0?**
A: A missing closing brace in the `@media (prefers-reduced-motion: reduce)` block caused the browser to silently discard all rules inside it. This is fixed in v1.1.1 — upgrading restores correct accessibility behaviour.

---

## License

Licensed under the [Apache License 2.0](LICENSE).
© 2026 Boris Maltsev.

---

<div align="center">

*Built with an unhealthy obsession with light physics.*

</div>
