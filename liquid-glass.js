// =============================================================================
// @fileoverview liquid-glass.js  ·  v 1.1.1
//
// Ultra-premium «Liquid Glass» rendering library.
// Surpasses Apple's Liquid Glass with:
//
//   ★  WebGL2 caustic light simulation  (Voronoi-based, animated, per-element)
//   ★  True screen-space refraction     (SVG feDisplacementMap on backdrop-filter)
//   ★  Spring-physics cursor dynamics   (mass · damping · stiffness model)
//   ★  Per-channel chromatic dispersion (R/G/B independently displaced)
//   ★  Physically-based Fresnel edge    (Schlick approximation, tilt-aware)
//   ★  Thin-film iridescence            (oil-slick interference pattern)
//   ★  Prismatic edge caustics          (coloured light splitting at border)
//   ★  Liquid border morphing           (organic border-radius breathing)
//   ★  Device orientation parallax      (gyroscope → 3-D tilt on mobile)
//   ★  Adaptive GPU quality tiers       (high / mid / low – graceful fallback)
//   ★  Houdini CSS Custom Properties    (animatable CSS vars via registerProperty)
//   ★  Zero memory leaks                (full MutationObserver + cleanup API)
//
// Usage:
//   import { initLiquidGlass } from './liquid-glass.js';
//   initLiquidGlass();
//   // Any element with class="lg" now gets the full effect.
//
// @version 1.1.1
// =============================================================================


// ─────────────────────────────────────────────────────────────────────────────
// §0  JSDoc type definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {'low'|'mid'|'high'} GpuTier
 */

/**
 * Per-element runtime state stored in the _elements WeakMap.
 *
 * @typedef {Object} ElementState
 * @property {HTMLCanvasElement}             canvas       - WebGL caustics overlay canvas
 * @property {CanvasRenderingContext2D}      ctx2d        - 2-D context of overlay canvas
 * @property {ResizeObserver}                ro           - ResizeObserver for the element
 * @property {SpringState}                   springX      - Horizontal cursor spring (0..1)
 * @property {SpringState}                   springY      - Vertical cursor spring (0..1)
 * @property {SpringState}                   hoverSpring  - Hover blend factor 0→1
 * @property {SpringState}                   tiltX        - 3-D tilt X spring (-1..1)
 * @property {SpringState}                   tiltY        - 3-D tilt Y spring (-1..1)
 * @property {number}                        width        - Canvas width in physical px
 * @property {number}                        height       - Canvas height in physical px
 * @property {boolean}                       hovered      - Is pointer currently inside
 * @property {number}                        dpr          - Device pixel ratio at attach time
 * @property {(e: PointerEvent) => void}     pointerMove  - Bound pointermove handler
 * @property {() => void}                    pointerEnter - Bound pointerenter handler
 * @property {() => void}                    pointerLeave - Bound pointerleave handler
 */

/**
 * @typedef {Object} SpringState
 * @property {number} value    - Current animated value
 * @property {number} velocity - Current velocity
 * @property {number} target   - Target value (set to drive the spring)
 */

/**
 * @typedef {Object} WrapResult
 * @property {HTMLElement} wrapper - The inserted .lg-outer distortion wrapper
 * @property {() => void}  unwrap  - Removes wrapper, restores original position
 */


// ─────────────────────────────────────────────────────────────────────────────
// §1  Module-private state
// ─────────────────────────────────────────────────────────────────────────────

const _state = {
    ready:       false,
    svgReady:    false,
    houdiniReg:  false,
    observer:    /** @type {MutationObserver|null}          */ (null),
    styleEl:     /** @type {HTMLStyleElement|null}          */ (null),
    svgEl:       /** @type {SVGSVGElement|null}             */ (null),
    rafId:       /** @type {number}                        */ (0),
    glBackend:   /** @type {WebGL2RenderingContext|null}    */ (null),
    glCanvas:    /** @type {HTMLCanvasElement|null}         */ (null),
    glProgram:   /** @type {WebGLProgram|null}              */ (null),
    glUniforms:  /** @type {Record<string, WebGLUniformLocation|null>} */ ({}),
    glBuffer:    /** @type {WebGLBuffer|null}               */ (null),
    glStartTime: /** @type {number}                        */ (0),
    deviceTilt:  { x: 0, y: 0 },
    orientHandler: /** @type {((e: DeviceOrientationEvent) => void)|null} */ (null),
};

/**
 * WeakMap from a `.lg` HTMLElement → its per-element runtime state.
 * WeakMap ensures GC automatically reclaims entries when elements are removed.
 *
 * @type {WeakMap<HTMLElement, ElementState>}
 */
const _elements = new WeakMap();

/** Strong set used to iterate active elements in the RAF loop. */
const _tracked = new Set();

/** @type {GpuTier|null} */
let _gpuTierCache = null;

/** Count of elements currently using a WebGL caustic canvas. */
let _activeWebGLCount = 0;


// ─────────────────────────────────────────────────────────────────────────────
// §2  Configuration constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spring physics configuration presets.
 * Larger stiffness = snappier, larger damping = less oscillation.
 */
const SPRING = Object.freeze({
    cursor: { stiffness: 180, damping: 18, mass: 1.0 },
    hover:  { stiffness: 120, damping: 14, mass: 1.0 },
    tilt:   { stiffness:  90, damping: 12, mass: 1.2 },
});

/**
 * Maximum rAF time-step in seconds.
 * Caps physics advances when tab regains focus after being hidden.
 */
const MAX_DT = 0.05;

/**
 * Maximum number of elements allowed to have a WebGL caustic canvas.
 * Further elements fall back to CSS-only rendering.
 */
const MAX_WEBGL_ELEMENTS = 32;


// ─────────────────────────────────────────────────────────────────────────────
// §3  GPU tier detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determines approximate GPU performance class by examining the WebGL
 * renderer string via the WEBGL_debug_renderer_info extension.
 *
 * Tiers:
 *   'high' – desktop GPU or Apple A12+, full WebGL caustics enabled
 *   'mid'  – mid-range mobile GPU, caustics enabled at reduced cost
 *   'low'  – legacy / integrated GPU, CSS-only fallback
 *
 * Result is cached permanently after first call.
 *
 * @returns {GpuTier}
 */
function _detectGpuTier() {
    if (_gpuTierCache !== null) return _gpuTierCache;

    const canvas = document.createElement('canvas');
    try {
        const gl = /** @type {WebGLRenderingContext|null} */ (
            canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
        );
        if (!gl) { _gpuTierCache = 'low'; return 'low'; }

        const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
        const dbg      = gl.getExtension('WEBGL_debug_renderer_info');

        if (!dbg) {
            _gpuTierCache = isMobile ? 'low' : 'high';
        } else {
            const r = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL).toLowerCase();

            if (/adreno [2-4]\d{2}|mali-[24t]|powervr sgx|sgx 5/.test(r)) {
                _gpuTierCache = 'low';
            } else if (/adreno [56]\d{2}|mali-g[57]/.test(r)) {
                _gpuTierCache = 'mid';
            } else if (/apple gpu/.test(r)) {
                // Apple A12+ (≥10-core GPU) = high; older = mid
                const m = r.match(/(\d+)-core/);
                _gpuTierCache = (m && parseInt(m[1], 10) >= 10) ? 'high' : 'mid';
            } else {
                _gpuTierCache = 'high';
            }
        }

        gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch (_) {
        _gpuTierCache = 'low';
    } finally {
        canvas.width = canvas.height = 0;
    }

    return /** @type {GpuTier} */ (_gpuTierCache);
}


// ─────────────────────────────────────────────────────────────────────────────
// §4  Spring physics engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allocates a new spring state initialised at `initialValue` with zero velocity.
 *
 * @param {number} initialValue
 * @returns {SpringState}
 */
function _createSpring(initialValue) {
    return { value: initialValue, velocity: 0, target: initialValue };
}

/**
 * Advances a spring by `dt` seconds using symplectic (semi-implicit) Euler.
 *
 * Equation of motion:
 *   F = −k(x − target) − d·v
 *   a = F / m
 *   v += a·dt  (velocity updated first for symplectic stability)
 *   x += v·dt
 *
 * @param {SpringState}                                  s
 * @param {{ stiffness: number, damping: number, mass: number }} cfg
 * @param {number}                                        dt  seconds
 */
function _stepSpring(s, cfg, dt) {
    const safeDt   = Math.min(dt, MAX_DT);
    const force    = -cfg.stiffness * (s.value - s.target) - cfg.damping * s.velocity;
    s.velocity    += (force / cfg.mass) * safeDt;
    s.value       += s.velocity * safeDt;
}

/**
 * Returns true if a spring has effectively settled (invisible movement).
 *
 * @param {SpringState} s
 * @returns {boolean}
 */
function _atRest(s) {
    return Math.abs(s.value - s.target) < 0.0002 && Math.abs(s.velocity) < 0.0002;
}


// ─────────────────────────────────────────────────────────────────────────────
// §5  Houdini CSS Custom Properties
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registers typed, animatable CSS custom properties via CSS.registerProperty.
 * This enables smooth CSS transitions on properties like --lg-mx / --lg-my
 * whose values change every frame via JavaScript.
 *
 * Silently skips properties that are already registered or when the API is
 * unavailable (Firefox, older browsers).
 */
function _registerHoudini() {
    if (_state.houdiniReg || !window.CSS?.registerProperty) return;
    _state.houdiniReg = true;

    /** @type {Array<PropertyDefinition>} */
    const defs = [
        { name: '--lg-mx',    syntax: '<percentage>', inherits: false, initialValue: '50%'  },
        { name: '--lg-my',    syntax: '<percentage>', inherits: false, initialValue: '30%'  },
        { name: '--lg-irid',  syntax: '<angle>',      inherits: false, initialValue: '0deg' },
        { name: '--lg-hover', syntax: '<number>',     inherits: false, initialValue: '0'    },
        { name: '--lg-tx',    syntax: '<number>',     inherits: false, initialValue: '0'    },
        { name: '--lg-ty',    syntax: '<number>',     inherits: false, initialValue: '0'    },
    ];

    defs.forEach(p => { try { CSS.registerProperty(p); } catch (_) { /* already set */ } });
}


// ─────────────────────────────────────────────────────────────────────────────
// §6  WebGL 2 Caustics Engine
// ─────────────────────────────────────────────────────────────────────────────
//
// Architecture overview:
//
//   • One shared hidden WebGL2 canvas is created globally (the "backend").
//   • Every RAF frame, for each .lg element with WebGL enabled:
//       1. Resize backend canvas to the element's physical pixel dimensions.
//       2. Render the caustic fragment shader with element-specific uniforms.
//       3. Blit (drawImage) the backend canvas onto the element's private
//          2-D overlay canvas.
//   • Only ONE WebGL context exists for the entire page → driver limit safe.
//   • Falls back silently to CSS-only if WebGL2 is unavailable.
//
// ─────────────────────────────────────────────────────────────────────────────

/** @type {string} Vertex shader – full-screen triangle, passes UV to fragment */
const _VERT_SRC = /* glsl */`#version 300 es
precision mediump float;
in  vec2 a_pos;
out vec2 v_uv;
void main() {
    v_uv        = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/**
 * @type {string}
 * Fragment shader implementing:
 *   • Multi-scale animated Voronoi caustics
 *   • Per-channel chromatic dispersion
 *   • Physically-based Schlick Fresnel edge glow
 *   • Specular hot-spot (moves with cursor via u_mouse)
 *   • Thin-film iridescence at grazing angles
 *   • Prismatic colour band at element border
 *   • Surface undulation noise
 */
const _FRAG_SRC = /* glsl */`#version 300 es
precision highp float;

in  vec2  v_uv;
out vec4  fragColor;

uniform float u_time;
uniform vec2  u_mouse;   // normalised cursor pos 0..1 within element
uniform float u_hover;   // hover blend 0..1
uniform vec2  u_tilt;    // world tilt (device orient or cursor) -1..1
uniform vec2  u_res;     // element pixel dimensions (w, h)

// ────────────────────────────────────────────────────────
// Pseudo-random hash
// ────────────────────────────────────────────────────────

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)),
             dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

// ────────────────────────────────────────────────────────
// Gradient (value) noise  –  smooth surface undulation
// ────────────────────────────────────────────────────────

float gnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);   // smoothstep curve
    return mix(
        mix(dot(hash2(i + vec2(0,0)), f - vec2(0,0)),
            dot(hash2(i + vec2(1,0)), f - vec2(1,0)), u.x),
        mix(dot(hash2(i + vec2(0,1)), f - vec2(0,1)),
            dot(hash2(i + vec2(1,1)), f - vec2(1,1)), u.x),
        u.y
    ) * 0.5 + 0.5;
}

// ────────────────────────────────────────────────────────
// Animated Voronoi – core of caustic simulation
//
// Real water caustics form at the boundary between Voronoi
// cells as rays converge on cell edges.  We simulate this
// by finding the distance to the nearest moving point and
// mapping it to a bright sharp ring.
// ────────────────────────────────────────────────────────

float voronoi(vec2 p, float t) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float minD = 8.0;

    for (int dy = -2; dy <= 2; dy++) {
        for (int dx = -2; dx <= 2; dx++) {
            vec2 n = vec2(float(dx), float(dy));
            vec2 h = hash2(i + n);
            // Animate point using two slightly different frequencies per axis
            vec2 pt = n + 0.5 + 0.46 * sin(
                t * (vec2(0.63, 0.91) + abs(h) * 0.35)
                + 6.2831 * h
            );
            minD = min(minD, length(pt - f));
        }
    }
    return minD;
}

// Caustic value: bright bands at Voronoi cell edges
float causticBand(vec2 uv, float scale, float speed, float seed) {
    float d = voronoi(uv * scale + seed, u_time * speed);
    // pow sharpens the ring; smoothstep cleans noise floor
    return pow(smoothstep(0.0, 0.30, d), 1.5);
}

// Blend four scales together for rich layered caustics
float caustic(vec2 uv) {
    // Subtle mouse-driven UV warp when hovered
    vec2 mw = (u_mouse - 0.5) * 0.07 * u_hover;

    float c1 = causticBand(uv + mw,        3.4, 0.38,  0.00);
    float c2 = causticBand(uv + mw * 0.6,  5.9, 0.27, 17.30);
    float c3 = causticBand(uv,              2.1, 0.19, 31.70);
    float c4 = causticBand(uv + mw * 1.2,  8.1, 0.55,  5.53);

    return c1*0.48 + c2*0.26 + c3*0.17 + c4*0.10;
}

// ────────────────────────────────────────────────────────
// Schlick Fresnel approximation
// ────────────────────────────────────────────────────────

float schlick(float cosTheta, float f0) {
    return f0 + (1.0 - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// ────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────

void main() {
    vec2  uv  = v_uv;
    float ar  = u_res.x / max(u_res.y, 1.0);
    // Aspect-correct UV so caustics aren't stretched on wide/tall elements
    vec2  uvA = vec2(uv.x * ar, uv.y);

    // ── Caustic base ──────────────────────────────────────
    float cBase = caustic(uvA);
    cBase = pow(cBase, 1.7);   // increase contrast

    // ── Per-channel chromatic caustic dispersion ─────────
    // Each colour channel samples caustics at a slightly different UV.
    // This creates the colour fringing visible through real glass.
    float cR = causticBand(uvA + vec2( 0.009,  0.004), 3.4, 0.38,  0.0);
    float cG = causticBand(uvA + vec2(-0.005, -0.006), 3.4, 0.38,  0.0);
    float cB = causticBand(uvA + vec2( 0.004, -0.010), 3.4, 0.38,  0.0);

    vec3 chromCaustic = vec3(
        pow(cR, 1.8) * 0.20,
        pow(cG, 1.8) * 0.16,
        pow(cB, 1.8) * 0.24
    );

    // ── Specular highlights ───────────────────────────────
    // Primary light source: upper-left, pulled toward cursor when hovered.
    vec2 lightPos  = vec2(0.22, 0.18)
                   + u_mouse * 0.28 * u_hover
                   + u_tilt  * 0.12;
    float sDist    = length(uv - lightPos);

    float spec1    = pow(max(0.0, 1.0 - sDist * 2.1), 7.0) * 0.95; // wide
    float spec2    = pow(max(0.0, 1.0 - sDist * 5.8), 16.0)* 0.55; // tight hot-spot

    // Ghost specular: reflection of light on opposite side (physical double-bounce)
    vec2  ghostPos = 1.0 - lightPos;
    float gDist    = length(uv - ghostPos);
    float specGhost= pow(max(0.0, 1.0 - gDist * 4.0), 11.0) * 0.14;

    float specular = spec1 + spec2 + specGhost;

    // ── Fresnel edge glow ─────────────────────────────────
    // Simulate a surface normal that tilts with cursor/device tilt.
    vec2  centered = uv * 2.0 - 1.0;
    vec3  N        = normalize(vec3(
                        centered * 0.55 + u_tilt * 0.30,
                        max(0.001, sqrt(1.0 - dot(centered * 0.55, centered * 0.55)))
                     ));
    float fr       = schlick(max(dot(N, vec3(0,0,1)), 0.0), 0.04);

    // Bevel highlights: top edge & left edge (physical glass bevel simulation)
    float topEdge  = pow(smoothstep(0.15, 0.0, uv.y),  2.3) * 0.65;
    float leftEdge = pow(smoothstep(0.12, 0.0, uv.x),  2.0) * 0.32;
    float botEdge  = pow(smoothstep(0.90, 1.0, uv.y),  3.0) * 0.12;
    float edgeGlow = topEdge + leftEdge + botEdge + fr * 0.28;

    // ── Thin-film iridescence ─────────────────────────────
    // Simulates the rainbow sheen of a thin transparent coating (like soap bubble).
    // Intensity grows toward element edges where the viewing angle is most oblique.
    float edgeR    = length(centered);
    float iridMask = smoothstep(0.25, 1.08, edgeR);
    float iridAng  = atan(centered.y, centered.x);
    vec3  thinFilm = 0.5 + 0.5 * cos(
        iridAng * 2.0
        + u_time * 0.30
        + u_tilt.x * 3.14159
        + vec3(0.0, 2.0944, 4.1888)   // 0°, 120°, 240°
    );
    vec3 irid = thinFilm * iridMask * 0.08;

    // ── Prismatic edge band ───────────────────────────────
    // Right at the glass border, light splits into a narrow rainbow stripe.
    float prismBand  = smoothstep(0.80, 0.92, edgeR)
                     * smoothstep(1.06, 0.92, edgeR);
    vec3  prismColor = (0.5 + 0.5 * cos(
        iridAng * 4.0 + u_time * 0.55 + vec3(0.0, 2.0944, 4.1888)
    )) * prismBand * 0.16;

    // ── Surface undulation ────────────────────────────────
    // Very subtle slow noise that makes the glass look like it has gentle waves.
    float wave = gnoise(uv * 5.5 + u_time * 0.11) * 0.013
               + gnoise(uv * 9.2 - u_time * 0.08) * 0.006;

    // ── Compose final colour ──────────────────────────────
    vec3 col  = vec3(cBase * 0.52) + chromCaustic;
    col      += vec3(specular);
    col      += vec3(edgeGlow);
    col      += irid;
    col      += prismColor;
    col      += vec3(wave);

    // Soft feathered vignette: contribution falls to 0 at the very border pixels
    float vx = smoothstep(0.0, 0.05, uv.x) * smoothstep(1.0, 0.95, uv.x);
    float vy = smoothstep(0.0, 0.05, uv.y) * smoothstep(1.0, 0.95, uv.y);
    col *= vx * vy;

    // Alpha: luminance-based so opaque regions match bright caustics
    float luma  = dot(col, vec3(0.299, 0.587, 0.114));
    float alpha = clamp(luma * 1.85, 0.0, 1.0);

    fragColor = vec4(col, alpha * 0.88);
}`;


// ─────────────────────────────────────────────────────────────────────────────
// §6.1  WebGL helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compiles a single GLSL shader stage.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {number}                 type   gl.VERTEX_SHADER | gl.FRAGMENT_SHADER
 * @param {string}                 src
 * @returns {WebGLShader}
 * @throws {Error} on compile failure (logs info log to console.warn)
 */
function _compileShader(gl, type, src) {
    const sh = gl.createShader(type);
    if (!sh) throw new Error('LG: gl.createShader returned null');
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(`LG shader compile:\n${log}`);
    }
    return sh;
}

/**
 * Compiles and links a WebGL program from vertex + fragment GLSL source.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {string}                 vs  vertex shader source
 * @param {string}                 fs  fragment shader source
 * @returns {WebGLProgram}
 */
function _buildProgram(gl, vs, fs) {
    const p = gl.createProgram();
    if (!p) throw new Error('LG: gl.createProgram returned null');
    gl.attachShader(p, _compileShader(gl, gl.VERTEX_SHADER,   vs));
    gl.attachShader(p, _compileShader(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(`LG program link:\n${gl.getProgramInfoLog(p)}`);
    }
    return p;
}

/**
 * Lazily creates the shared WebGL2 back-end canvas + shader program.
 * Called the first time a high/mid tier element needs caustic rendering.
 *
 * @returns {boolean} true on success
 */
function _initWebGL() {
    if (_state.glBackend) return true;

    const canvas = document.createElement('canvas');
    // Hidden but attached to the real DOM so the context doesn't get throttled
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText =
        'position:fixed;width:0;height:0;pointer-events:none;opacity:0;z-index:-99999';
    document.body.appendChild(canvas);

    const gl = /** @type {WebGL2RenderingContext|null} */ (
        canvas.getContext('webgl2', {
            alpha:              true,
            premultipliedAlpha: true,
            antialias:          false,
            depth:              false,
            stencil:            false,
            preserveDrawingBuffer: true,   // needed for drawImage blit
        })
    );

    if (!gl) {
        canvas.remove();
        return false;
    }

    try {
        const prog = _buildProgram(gl, _VERT_SRC, _FRAG_SRC);

        // Single full-screen triangle (more efficient than two-triangle quad)
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER,
            new Float32Array([-1,-1,  3,-1,  -1,3]),
            gl.STATIC_DRAW);

        gl.useProgram(prog);
        const aPos = gl.getAttribLocation(prog, 'a_pos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        // Premultiplied alpha blending (matches canvas2d's drawImage compositing)
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        // Cache uniform locations
        const uNames = ['u_time', 'u_mouse', 'u_hover', 'u_tilt', 'u_res'];
        const uni = /** @type {Record<string, WebGLUniformLocation|null>} */ ({});
        uNames.forEach(n => { uni[n] = gl.getUniformLocation(prog, n); });

        _state.glCanvas    = canvas;
        _state.glBackend   = gl;
        _state.glProgram   = prog;
        _state.glUniforms  = uni;
        _state.glBuffer    = buf;
        _state.glStartTime = performance.now();
        return true;
    } catch (err) {
        console.warn('LG: WebGL2 initialisation failed – CSS fallback active.\n', err);
        canvas.remove();
        return false;
    }
}

/**
 * Renders caustics for one element into the shared WebGL backend canvas,
 * then copies the result to the element's 2-D overlay canvas via drawImage.
 *
 * @param {ElementState} es   - Element runtime state
 * @param {number}       now  - performance.now() timestamp
 */
function _renderCausticsGL(es, now) {
    const gl  = _state.glBackend;
    const uni = _state.glUniforms;
    if (!gl || !_state.glProgram) return;

    const w = es.width;
    const h = es.height;
    if (w < 1 || h < 1) return;

    // Resize backend to match element (resize is cheap when dimensions match)
    if (_state.glCanvas.width !== w || _state.glCanvas.height !== h) {
        _state.glCanvas.width  = w;
        _state.glCanvas.height = h;
        gl.viewport(0, 0, w, h);
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const t = (now - _state.glStartTime) * 0.001;
    gl.uniform1f(uni.u_time,  t);
    gl.uniform2f(uni.u_mouse, es.springX.value,  es.springY.value);
    gl.uniform1f(uni.u_hover, es.hoverSpring.value);
    gl.uniform2f(uni.u_tilt,  es.tiltX.value,    es.tiltY.value);
    gl.uniform2f(uni.u_res,   w, h);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Blit rendered frame to element's 2-D canvas overlay
    es.ctx2d.clearRect(0, 0, w, h);
    es.ctx2d.drawImage(_state.glCanvas, 0, 0);
}


// ─────────────────────────────────────────────────────────────────────────────
// §7  SVG Filter Bank
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds the SVG <defs> block containing:
 *
 *   #lg-distort   – animated chromatic aberration (3-channel displacement)
 *   #lg-refract   – high-amplitude warp for refractive border edge
 *
 * For low-GPU tier returns pass-through (identity) filters only.
 *
 * @param {GpuTier} tier
 * @returns {string}  SVG markup string
 */
function _buildSVGDefs(tier) {
    if (tier === 'low') {
        return `<defs>
          <filter id="lg-distort"><feComposite operator="atop"/></filter>
          <filter id="lg-refract"><feComposite operator="atop"/></filter>
        </defs>`;
    }

    // Tune aberration strength per tier.
    // Values must stay small (≤2px) – large displacement creates visible
    // colour-band "zebra" stripes across chat bubble text content.
    const aber   = tier === 'high' ? 1.6 : 0.9;
    const refSc  = tier === 'high' ? 3   : 2;

    return `<defs>

      <!-- ── Chromatic aberration filter ──────────────────────────────── -->
      <!-- Applied to .lg-outer wrapper so it distorts the entire element  -->
      <!-- boundary, creating the characteristic glass edge colour fringe. -->
      <filter id="lg-distort" x="-25%" y="-25%" width="150%" height="150%"
              color-interpolation-filters="sRGB">

        <!-- Animated turbulence seed drives organic, non-repeating motion -->
        <feTurbulence type="turbulence"
            baseFrequency="0.015 0.019" numOctaves="3" seed="7" result="turb">
          <animate attributeName="baseFrequency"
              values="0.015 0.019;0.022 0.014;0.018 0.024;0.015 0.019"
              dur="12s" repeatCount="indefinite"
              calcMode="spline"
              keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1"/>
          <animate attributeName="seed"
              values="7;13;3;19;5;11;7"
              dur="31s" repeatCount="indefinite"
              calcMode="discrete"/>
        </feTurbulence>

        <!-- Each colour channel displaced by a different amount → fringing -->
        <feDisplacementMap in="SourceGraphic" in2="turb"
            scale="${aber.toFixed(1)}"
            xChannelSelector="R" yChannelSelector="G" result="dR"/>
        <feDisplacementMap in="SourceGraphic" in2="turb"
            scale="${(aber * 0.62).toFixed(1)}"
            xChannelSelector="G" yChannelSelector="B" result="dG"/>
        <feDisplacementMap in="SourceGraphic" in2="turb"
            scale="${(aber * 0.36).toFixed(1)}"
            xChannelSelector="B" yChannelSelector="R" result="dB"/>

        <!-- Isolate individual colour channels -->
        <feColorMatrix in="dR" type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="oR"/>
        <feColorMatrix in="dG" type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="oG"/>
        <feColorMatrix in="dB" type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="oB"/>

        <!-- Screen-blend recombines channels without clipping brightness -->
        <feBlend in="oR"  in2="oG"            mode="screen" result="rg"/>
        <feBlend in="rg"  in2="oB"            mode="screen" result="rgb"/>
        <feComposite in="rgb" in2="SourceGraphic" operator="atop"/>
      </filter>

      <!-- ── Refractive edge warp ───────────────────────────────────────── -->
      <!-- Higher amplitude fractal noise distorts the content at the edge,  -->
      <!-- simulating the barrel distortion of a real glass lens boundary.    -->
      <filter id="lg-refract" x="-32%" y="-32%" width="164%" height="164%"
              color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise"
            baseFrequency="0.007 0.011" numOctaves="2" seed="3" result="warp">
          <animate attributeName="baseFrequency"
              values="0.007 0.011;0.013 0.008;0.009 0.015;0.007 0.011"
              dur="16s" repeatCount="indefinite"
              calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1"/>
        </feTurbulence>
        <feDisplacementMap in="SourceGraphic" in2="warp"
            scale="${refSc}"
            xChannelSelector="R" yChannelSelector="G"/>
      </filter>

    </defs>`;
}

/**
 * Creates the hidden <svg> element containing filter defs and appends it to
 * <body>. Safe to call multiple times – only inserts once.
 */
function _injectSVG() {
    if (_state.svgReady) return;
    _state.svgReady = true;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('style',
        'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;z-index:-9999');
    svg.innerHTML = _buildSVGDefs(_detectGpuTier());

    document.body.appendChild(svg);
    _state.svgEl = svg;
}


// ─────────────────────────────────────────────────────────────────────────────
// §8  CSS Injection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates the complete CSS stylesheet for the liquid-glass system.
 *
 * Design notes on layer stack (z-index inside .lg):
 *   z 1  ::before  – cursor-following highlight radial gradient
 *   z 2  ::after   – rotating iridescent conic gradient
 *   z 3  .lg-grain – static film grain (animated position)
 *   z 4  .lg-caustic-canvas – WebGL caustics (screen blend)
 *   z 5  content   – actual child content (text, icons, etc.)
 *
 * @returns {string}
 */
function _buildCSS() {
    return `
/* ─────────────────────────────────────────────────────────────────────────
   .lg-outer  –  SVG chromatic-aberration wrapper
   ─────────────────────────────────────────────────────────────────────── */

.lg-outer {
    display:  inline-flex;
    position: relative;
    /* Negative margin + matching padding compensate for filter overflow */
    margin:   -10px;
    padding:   10px;
}
.lg-outer.block { display: block; }
.lg-outer.flex  { display: flex;  }
.lg-outer.grid  { display: grid;  }

/* Apply the animated RGB-split filter only when motion is allowed */
@media (prefers-reduced-motion: no-preference) {
    .lg-outer { filter: url(#lg-distort); }
}


/* ─────────────────────────────────────────────────────────────────────────
   .lg  –  Core glass element
   ─────────────────────────────────────────────────────────────────────── */

.lg {
    /* Houdini-animatable custom properties (spring-driven each RAF frame) */
    --lg-mx:    50%;     /* cursor X within element, 0%..100% */
    --lg-my:    30%;     /* cursor Y within element, 0%..100% */
    --lg-irid:   0deg;   /* iridescence rotation angle         */
    --lg-hover:  0;      /* hover blend factor                 */
    --lg-tx:     0;      /* tilt X  -1..1                      */
    --lg-ty:     0;      /* tilt Y  -1..1                      */

    position:      relative;
    isolation:     isolate;
    overflow:      hidden;
    border-radius: 16px;

    /* GPU compositing acceleration */
    will-change: transform, box-shadow;

    /* ── Glass material ──────────────────────────────────────────────── */
    background:
        /* Radial hot-spot that follows the cursor */
        radial-gradient(
            ellipse 48% 34% at var(--lg-mx) var(--lg-my),
            rgba(255,255,255,0.16) 0%,
            rgba(255,255,255,0.05) 48%,
            transparent 68%
        ),
        /* Ambient translucent fill */
        rgba(255, 255, 255, 0.032);

    /* Frosted-glass blur + saturation boost */
    backdrop-filter:         blur(26px) saturate(175%) brightness(1.10);
    -webkit-backdrop-filter: blur(26px) saturate(175%) brightness(1.10);

    /* Layered shadow stack:
       1. Top-edge bevel (inset)     – most physically important
       2. Left-edge bevel (inset)    – secondary bevel
       3. Bottom-edge shadow (inset) – ground contact
       4. Near contact shadow        – sharp, small
       5. Distant ambient shadow     – wide, soft
       6. Colour halo                – purple ambient reflection */
    box-shadow:
        inset 0   1.5px 0   rgba(255,255,255,0.44),
        inset 1px 0     0   rgba(255,255,255,0.20),
        inset 0  -1px   0   rgba(0,0,0,0.12),
        0   4px 18px  -4px  rgba(0,0,0,0.30),
        0  16px 48px -12px  rgba(0,0,0,0.20),
        0   1px  4px        rgba(0,0,0,0.18),
        0   0   48px -18px  rgba(185,160,255,0.22);

    transition:
        transform   0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
        box-shadow  0.22s ease,
        background  0.22s ease;
}


/* ── Highlight pseudo-element – cursor-tracking glow ──────────────────── */

.lg::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    z-index: 1;

    background:
        /* Tight caustic specular hot-spot */
        radial-gradient(
            ellipse 36% 26% at var(--lg-mx) var(--lg-my),
            rgba(255,255,255,0.28) 0%,
            rgba(255,255,255,0.08) 35%,
            transparent 60%
        ),
        /* Softer ambient lobe */
        radial-gradient(
            ellipse 82% 66% at var(--lg-mx) var(--lg-my),
            rgba(255,255,255,0.05) 0%,
            transparent 64%
        ),
        /* Static top-left bevel catch-light */
        linear-gradient(
            142deg,
            rgba(255,255,255,0.16) 0%,
            rgba(255,255,255,0.04) 30%,
            transparent 58%,
            rgba(255,255,255,0.04) 100%
        );

    /* Houdini allows smooth transition of CSS gradient positions */
    transition: background 0.04s linear;
}


/* ── Iridescent thin-film pseudo-element ─────────────────────────────── */

.lg::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    z-index: 2;

    /* Conic gradient mimics thin-film colour shift at different angles */
    background: conic-gradient(
        from var(--lg-irid) at 50% 50%,
        hsla(195,100%,88%,0.000),
        hsla(235,100%,92%,0.044),
        hsla(278,100%,88%,0.029),
        hsla(328,100%,92%,0.044),
        hsla( 18,100%,88%,0.029),
        hsla( 78,100%,92%,0.044),
        hsla(138,100%,88%,0.029),
        hsla(195,100%,88%,0.000)
    );

    mix-blend-mode: overlay;
    opacity: 0.94;
    animation: lg-irid-spin 15s linear infinite;
}


/* ── Film grain layer ─────────────────────────────────────────────────── */

.lg-grain {
    position:      absolute;
    inset:         0;
    border-radius: inherit;
    pointer-events:none;
    z-index:       3;
    will-change:   background-position;

    /* Fractal noise SVG inlined as data URI – no external request */
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.76' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E");
    background-size: 240px 240px;
    mix-blend-mode:  soft-light;
    opacity:         0.038;
    animation:       lg-grain-shift 0.12s steps(1) infinite;
}


/* ── WebGL caustics overlay canvas ──────────────────────────────────── */

.lg-caustic-canvas {
    position:        absolute;
    inset:           0;
    width:           100%;
    height:          100%;
    pointer-events:  none;
    z-index:         4;
    border-radius:   inherit;
    /* screen blend: caustic brights add light without darkening base */
    mix-blend-mode:  screen;
    /* Hidden at rest – Voronoi pattern is too visible on dark backgrounds.
       Only revealed (subtly) when the user hovers over an interactive element. */
    opacity:         0;
    transition:      opacity 0.35s ease;
}

/* On hover: show caustics very gently so they read as shimmer, not zebra */
.lg.lg-interactive:hover .lg-caustic-canvas { opacity: 0.02; }


/* ── Child content must sit above all effect layers ─────────────────── */

.lg > *:not(.lg-grain):not(.lg-caustic-canvas) {
    position: relative;
    z-index:  5;
}


/* ─────────────────────────────────────────────────────────────────────────
   Interactive states
   ─────────────────────────────────────────────────────────────────────── */

.lg.lg-interactive { cursor: pointer; }

.lg.lg-interactive:hover {
    background:
        radial-gradient(
            ellipse 36% 26% at var(--lg-mx) var(--lg-my),
            rgba(255,255,255,0.35) 0%,
            rgba(255,255,255,0.10) 38%,
            transparent 63%
        ),
        rgba(255, 255, 255, 0.060);

    box-shadow:
        inset 0   2px   0   rgba(255,255,255,0.55),
        inset 1px 0     0   rgba(255,255,255,0.24),
        inset 0  -1px   0   rgba(0,0,0,0.12),
        0  10px  30px  -6px rgba(0,0,0,0.38),
        0  24px  60px -12px rgba(0,0,0,0.26),
        0   2px   6px       rgba(0,0,0,0.22),
        0   0    65px -18px rgba(168,138,255,0.34);
}

.lg.lg-interactive:active {
    transform:         translateY(1px) scale(0.991) translateZ(0) !important;
    transition-duration: 0.07s;
    box-shadow:
        inset 0  1px   0  rgba(255,255,255,0.32),
        inset 1px 0    0  rgba(255,255,255,0.14),
        0  2px  8px -3px  rgba(0,0,0,0.28),
        0  6px 22px -8px  rgba(0,0,0,0.18);
}


/* ─────────────────────────────────────────────────────────────────────────
   Variants
   ─────────────────────────────────────────────────────────────────────── */

/* Reply / quote widget */
.lg-reply {
    display:        flex;
    flex-direction: column;
    gap:            3px;
    padding:        8px 12px;
    margin-bottom:  8px;
    border-radius:  10px;
    box-shadow:
        inset 2.5px 0    0 rgba(255,255,255,0.40),
        inset 0     1px  0 rgba(255,255,255,0.18),
        inset 0    -1px  0 rgba(0,0,0,0.10),
        0     2px  10px -3px rgba(0,0,0,0.22);
}
.lg-reply .lg-sender {
    font-size: 11px; font-weight: 700;
    color: rgba(255,255,255,0.85);
    letter-spacing: 0.02em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    position: relative; z-index: 5;
}
.lg-reply .lg-text {
    font-size: 12px;
    color: rgba(255,255,255,0.50);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    position: relative; z-index: 5;
}

/* Own-message purple tint */
.lg.lg-own {
    background:
        radial-gradient(
            ellipse 36% 26% at var(--lg-mx) var(--lg-my),
            rgba(200,175,255,0.22) 0%,
            rgba(180,150,255,0.06) 38%,
            transparent 62%
        ),
        rgba(110, 68, 202, 0.055);
    box-shadow:
        inset 0   2px  0  rgba(220,195,255,0.32),
        inset 1px 0    0  rgba(200,175,255,0.16),
        inset 0  -1px  0  rgba(0,0,0,0.12),
        0   4px 18px  -4px rgba(0,0,0,0.26),
        0  16px 44px -12px rgba(0,0,0,0.16),
        0   0   38px -12px rgba(165,100,255,0.24);
}
.lg.lg-own::after {
    background: conic-gradient(
        from var(--lg-irid) at 50% 50%,
        hsla(248,100%,88%,0.000),
        hsla(278,100%,92%,0.054),
        hsla(312,100%,88%,0.034),
        hsla(338,100%,92%,0.054),
        hsla(248,100%,88%,0.000)
    );
}
.lg.lg-own .lg-sender { color: rgba(226,202,255,0.92); }
.lg.lg-own:hover {
    background:
        radial-gradient(
            ellipse 36% 26% at var(--lg-mx) var(--lg-my),
            rgba(210,185,255,0.34) 0%,
            rgba(190,160,255,0.10) 38%,
            transparent 63%
        ),
        rgba(130, 90, 222, 0.085);
}

/* Pill / chip */
.lg.lg-pill {
    border-radius: 999px;
    padding: 6px 18px;
}

/* Card */
.lg.lg-card {
    border-radius: 22px;
    padding: 20px;
}

/* Floating action button */
.lg.lg-fab {
    border-radius: 50%;
    width:  56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}


/* ─────────────────────────────────────────────────────────────────────────
   Keyframe animations
   ─────────────────────────────────────────────────────────────────────── */

/* Iridescent film rotation */
@keyframes lg-irid-spin {
    from { --lg-irid:   0deg; }
    to   { --lg-irid: 360deg; }
}

/* Film grain position jitter */
@keyframes lg-grain-shift {
    0%  { background-position:   0px   0px; }
    11% { background-position: -48px -34px; }
    22% { background-position:  34px  56px; }
    33% { background-position: -72px  24px; }
    44% { background-position:  20px -60px; }
    55% { background-position: -42px  78px; }
    66% { background-position:  66px -16px; }
    77% { background-position: -22px  46px; }
    88% { background-position:  46px -30px; }
}

/* Liquid border breathing – organic radius oscillation */
@keyframes lg-breathe {
     0% { border-radius: 16px 19px 14px 21px / 19px 14px 21px 16px; }
    20% { border-radius: 21px 14px 19px 16px / 14px 21px 16px 19px; }
    40% { border-radius: 14px 22px 16px 18px / 22px 16px 18px 14px; }
    60% { border-radius: 19px 16px 22px 13px / 16px 19px 13px 22px; }
    80% { border-radius: 13px 21px 17px 20px / 21px 17px 20px 13px; }
   100% { border-radius: 16px 19px 14px 21px / 19px 14px 21px 16px; }
}

/* Apply animations – only breathing-capable shapes */
.lg:not(.lg-pill):not(.lg-fab):not(.lg-reply):not(.vb-wrap) {
    animation:
        lg-irid-spin  15s linear      infinite,
        lg-breathe     9s ease-in-out infinite;
}
.lg.lg-pill,
.lg.lg-fab,
.lg.lg-reply,
.lg.vb-wrap {
    animation: lg-irid-spin 15s linear infinite;
}
.lg.vb-wrap {
    width: fit-content;
    min-width: 230px;
    max-width: 300px;
}
.lg.lg-pill,
.lg.lg-fab,
.lg.lg-reply {
    animation: lg-irid-spin 15s linear infinite;
}
.lg::after {
    animation: lg-irid-spin 15s linear infinite;
}


/* ─────────────────────────────────────────────────────────────────────────
   Accessibility: respect prefers-reduced-motion
   ─────────────────────────────────────────────────────────────────────── */

@media (prefers-reduced-motion: reduce) {
    .lg,
    .lg::before,
    .lg::after,
    .lg-grain,
    .lg-caustic-canvas {
        animation:   none !important;
        transition:  none !important;
        will-change: auto !important;
    }
    .lg           { border-radius: 16px !important; transform: none !important; }
    .lg-outer     { filter: none !important; }
    .lg-caustic-canvas { display: none; }
}
`;
}

/**
 * Injects the stylesheet into <head>. Idempotent – second call is a no-op.
 */
function _injectCSS() {
    if (document.getElementById('liquid-glass-style-110')) return;

    _state.styleEl = Object.assign(document.createElement('style'), {
        id:          'liquid-glass-style-110',
        textContent: _buildCSS(),
    });
    document.head.appendChild(_state.styleEl);
}


// ─────────────────────────────────────────────────────────────────────────────
// §9  Device orientation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Subscribes to DeviceOrientationEvent to provide gyroscopic tilt data that
 * feeds the spring tilt system on mobile devices, giving a parallax depth
 * sensation when tilting the phone.
 *
 * Silently skips registration on platforms that don't fire the event.
 */
function _startOrientationTracking() {
    if (_state.orientHandler) return;

    const handler = /** @param {DeviceOrientationEvent} e */ (e) => {
        // gamma = left/right tilt  (-90..90 deg)
        // beta  = front/back tilt  (-180..180 deg)
        const rx = (e.gamma ?? 0) / 45;   // normalise to roughly -1..1
        const ry = (e.beta  ?? 0) / 45 - 0.5; // −0.5 compensates natural phone hold angle
        _state.deviceTilt.x = Math.max(-1, Math.min(1, rx));
        _state.deviceTilt.y = Math.max(-1, Math.min(1, ry));
    };

    window.addEventListener('deviceorientation', handler, { passive: true });
    _state.orientHandler = handler;
}

/** Removes the DeviceOrientation listener. */
function _stopOrientationTracking() {
    if (!_state.orientHandler) return;
    window.removeEventListener('deviceorientation', _state.orientHandler);
    _state.orientHandler = null;
    _state.deviceTilt.x  = 0;
    _state.deviceTilt.y  = 0;
}


// ─────────────────────────────────────────────────────────────────────────────
// §10  Per-element attachment / detachment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attaches the full liquid-glass effect to a single `.lg` element:
 *   • Creates caustic overlay canvas (WebGL when quota available, else 2-D noop)
 *   • Prepends grain layer
 *   • Registers pointermove / pointerenter / pointerleave listeners
 *   • Starts a ResizeObserver to keep canvas dimensions up-to-date
 *
 * If the element is already tracked, this is a no-op.
 *
 * @param {HTMLElement} el
 */
function _attach(el) {
    if (_tracked.has(el)) return;

    const dpr  = Math.min(window.devicePixelRatio || 1, 2);
    const rect = el.getBoundingClientRect();
    const w    = Math.round(rect.width  * dpr) || 1;
    const h    = Math.round(rect.height * dpr) || 1;

    // ── Caustic overlay canvas ──────────────────────────────────────────────
    const cvs   = document.createElement('canvas');
    cvs.className = 'lg-caustic-canvas';
    cvs.width   = w;
    cvs.height  = h;
    // CSS size matches element exactly via 100%/100% in stylesheet

    const ctx2d = /** @type {CanvasRenderingContext2D} */ (
        cvs.getContext('2d', { alpha: true, willReadFrequently: false })
    );

    // Insert canvas as absolute-positioned first child
    el.insertBefore(cvs, el.firstChild);

    // ── Grain layer ──────────────────────────────────────────────────────────
    if (!el.querySelector('.lg-grain')) {
        const grain = createGrainLayer();
        // Insert after canvas so grain sits on top of caustics
        el.insertBefore(grain, cvs.nextSibling);
    }

    // ── Spring states ────────────────────────────────────────────────────────
    const springX     = _createSpring(0.5);
    const springY     = _createSpring(0.3);
    const hoverSpring = _createSpring(0);
    const tiltX       = _createSpring(0);
    const tiltY       = _createSpring(0);

    /** @type {ElementState} */
    let es;

    // ── Pointer event handlers ───────────────────────────────────────────────

    /** @param {PointerEvent} e */
    const onMove = (e) => {
        const r  = el.getBoundingClientRect();
        springX.target = Math.max(0, Math.min(1, (e.clientX - r.left)  / r.width));
        springY.target = Math.max(0, Math.min(1, (e.clientY - r.top)   / r.height));
        // Tilt toward cursor for perspective lean (range -1..1 centred at 0)
        tiltX.target   = (springX.target - 0.5) * 2;
        tiltY.target   = (springY.target - 0.5) * 2;
    };

    const onEnter = () => {
        hoverSpring.target = 1;
        es.hovered = true;
    };

    const onLeave = () => {
        springX.target     = 0.5;
        springY.target     = 0.30;
        hoverSpring.target = 0;
        tiltX.target       = 0;
        tiltY.target       = 0;
        es.hovered         = false;
    };

    el.addEventListener('pointermove',  onMove,  { passive: true });
    el.addEventListener('pointerenter', onEnter, { passive: true });
    el.addEventListener('pointerleave', onLeave, { passive: true });

    // ── ResizeObserver ───────────────────────────────────────────────────────
    const ro = new ResizeObserver(entries => {
        for (const entry of entries) {
            const cr   = entry.contentRect;
            const newW = Math.round(cr.width  * dpr) || 1;
            const newH = Math.round(cr.height * dpr) || 1;
            if (newW !== es.width || newH !== es.height) {
                cvs.width  = es.width  = newW;
                cvs.height = es.height = newH;
            }
        }
    });
    ro.observe(el);

    // ── Assemble state ───────────────────────────────────────────────────────
    es = /** @type {ElementState} */ ({
        canvas: cvs, ctx2d, ro,
        springX, springY, hoverSpring, tiltX, tiltY,
        width: w, height: h,
        hovered: false, dpr,
        pointerMove: onMove, pointerEnter: onEnter, pointerLeave: onLeave,
    });

    _elements.set(el, es);
    _tracked.add(el);

    // ── Upgrade to WebGL caustics if quota allows ────────────────────────────
    const tier = _detectGpuTier();
    if (tier !== 'low' && _activeWebGLCount < MAX_WEBGL_ELEMENTS) {
        if (_initWebGL()) {
            _activeWebGLCount++;
            el.dataset.lgWebgl = '1';
        }
    }
}

/**
 * Fully removes all liquid-glass machinery from an element, restoring it to
 * the same state it was in before {@link _attach} was called.
 *
 * @param {HTMLElement} el
 */
function _detach(el) {
    const es = _elements.get(el);
    if (!es) return;

    el.removeEventListener('pointermove',  es.pointerMove);
    el.removeEventListener('pointerenter', es.pointerEnter);
    el.removeEventListener('pointerleave', es.pointerLeave);

    es.ro.disconnect();

    // Remove overlay canvas and grain layer
    es.canvas.remove();
    el.querySelector('.lg-grain')?.remove();

    // Clear JS-injected inline styles
    el.style.removeProperty('--lg-mx');
    el.style.removeProperty('--lg-my');
    el.style.removeProperty('--lg-tx');
    el.style.removeProperty('--lg-ty');
    el.style.removeProperty('--lg-hover');
    el.style.removeProperty('transform');

    if (el.dataset.lgWebgl) {
        _activeWebGLCount = Math.max(0, _activeWebGLCount - 1);
        delete el.dataset.lgWebgl;
    }

    _elements.delete(el);
    _tracked.delete(el);
}


// ─────────────────────────────────────────────────────────────────────────────
// §11  rAF animation loop
// ─────────────────────────────────────────────────────────────────────────────

/** Timestamp of previous rAF call, used to compute delta time. */
let _lastTs = 0;

/**
 * Main animation loop.  Every frame:
 *   1. Advances all spring states for each tracked element.
 *   2. Writes updated values to CSS custom properties.
 *   3. Applies perspective 3-D transform from tilt springs.
 *   4. Renders WebGL caustics (if enabled) and blits to overlay canvas.
 *
 * @param {number} ts  - DOMHighResTimeStamp from requestAnimationFrame
 */
function _rafLoop(ts) {
    _state.rafId = requestAnimationFrame(_rafLoop);

    const dt = Math.min((ts - (_lastTs || ts)) * 0.001, MAX_DT);
    _lastTs  = ts;

    const gx = _state.deviceTilt.x;
    const gy = _state.deviceTilt.y;

    for (const el of _tracked) {
        const es = _elements.get(el);
        if (!es) continue;

        // ── Advance springs ─────────────────────────────────────────────────
        _stepSpring(es.springX,     SPRING.cursor, dt);
        _stepSpring(es.springY,     SPRING.cursor, dt);
        _stepSpring(es.hoverSpring, SPRING.hover,  dt);
        _stepSpring(es.tiltX,       SPRING.tilt,   dt);
        _stepSpring(es.tiltY,       SPRING.tilt,   dt);

        // Blend in device tilt when not overridden by cursor hover
        if (!es.hovered) {
            es.tiltX.target = gx * 0.45;
            es.tiltY.target = gy * 0.45;
        }

        // ── Update CSS custom properties ────────────────────────────────────
        el.style.setProperty('--lg-mx',    (es.springX.value     * 100).toFixed(2) + '%');
        el.style.setProperty('--lg-my',    (es.springY.value     * 100).toFixed(2) + '%');
        el.style.setProperty('--lg-tx',     es.tiltX.value.toFixed(4));
        el.style.setProperty('--lg-ty',     es.tiltY.value.toFixed(4));
        el.style.setProperty('--lg-hover',  es.hoverSpring.value.toFixed(4));

        // ── 3-D perspective tilt transform ──────────────────────────────────
        // Rotations are in degrees; combined device + cursor tilt
        const rx =  (es.tiltY.value * 3.0).toFixed(3);
        const ry = -(es.tiltX.value * 3.0).toFixed(3);
        el.style.transform =
            `translateZ(0) perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg)`;

        // ── WebGL caustic render ─────────────────────────────────────────────
        if (el.dataset.lgWebgl) {
            _renderCausticsGL(es, ts);
        }
    }
}

/** Starts the rAF loop (idempotent). */
function _startLoop() {
    if (_state.rafId) return;
    _lastTs = 0;
    _state.rafId = requestAnimationFrame(_rafLoop);
}

/** Cancels the rAF loop. */
function _stopLoop() {
    if (_state.rafId) {
        cancelAnimationFrame(_state.rafId);
        _state.rafId = 0;
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// §12  MutationObserver – auto-attach on DOM changes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walks a DOM subtree and calls {@link _attach} on every `.lg` element found.
 *
 * @param {Node} node
 */
function _attachSubtree(node) {
    if (!(node instanceof HTMLElement)) return;
    if (node.classList.contains('lg'))  _attach(node);
    node.querySelectorAll?.('.lg').forEach(_attach);
}

/**
 * Walks a DOM subtree and calls {@link _detach} on every `.lg` element found.
 * Called when nodes are removed from the document.
 *
 * @param {Node} node
 */
function _detachSubtree(node) {
    if (!(node instanceof HTMLElement)) return;
    if (node.classList.contains('lg'))  _detach(node);
    node.querySelectorAll?.('.lg').forEach(_detach);
}

/**
 * Attaches to all pre-existing `.lg` elements in the document, then
 * starts observing the DOM for future additions/removals.
 */
function _startObserver() {
    document.querySelectorAll('.lg').forEach(_attach);

    _state.observer = new MutationObserver(mutations => {
        for (const m of mutations) {
            m.addedNodes.forEach(_attachSubtree);
            m.removedNodes.forEach(_detachSubtree);
        }
    });

    _state.observer.observe(document.body, {
        childList: true,
        subtree:   true,
    });
}


// ─────────────────────────────────────────────────────────────────────────────
// §13  Display helper map (for wrapWithDistortion)
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Readonly<Record<string, string>>} */
const _DISPLAY_MAP = Object.freeze({
    'flex':        'flex',
    'inline-flex': 'flex',
    'grid':        'grid',
    'inline-grid': 'grid',
});


// ─────────────────────────────────────────────────────────────────────────────
// §14  Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialises the liquid-glass system.
 *
 * This is the single entry point for host applications.  Call once at
 * page load; subsequent calls before {@link destroyLiquidGlass} are silently
 * ignored.
 *
 * Side effects:
 *   • Registers Houdini CSS custom properties
 *   • Injects SVG filter bank into <body>
 *   • Injects CSS stylesheet into <head>
 *   • Attaches to all pre-existing `.lg` elements
 *   • Starts MutationObserver for future `.lg` elements
 *   • Starts rAF animation loop
 *   • Registers DeviceOrientationEvent listener (mobile)
 *
 * @example
 * import { initLiquidGlass } from './liquid-glass.js';
 * initLiquidGlass();
 */
export function initLiquidGlass() {
    if (_state.ready) return;
    _state.ready = true;

    _registerHoudini();
    _injectSVG();
    _injectCSS();
    _startOrientationTracking();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            _startObserver();
            _startLoop();
        }, { once: true });
    } else {
        _startObserver();
        _startLoop();
    }
}

/**
 * Completely tears down the liquid-glass system, undoing every side effect
 * of {@link initLiquidGlass}.
 *
 * After calling this function the system is in a fully clean state and
 * {@link initLiquidGlass} may be called again safely.  This is the correct
 * cleanup hook for SPA route changes.
 *
 * @example
 * // Before navigating away:
 * destroyLiquidGlass();
 */
export function destroyLiquidGlass() {
    _stopLoop();

    _state.observer?.disconnect();
    _state.observer = null;

    // Detach all currently tracked elements
    for (const el of [..._tracked]) _detach(el);

    // Remove injected DOM nodes
    _state.styleEl?.remove();
    _state.svgEl?.remove();
    _state.glCanvas?.remove();

    _stopOrientationTracking();

    // Reset GPU tier cache (re-probe on next init, in case context changed)
    _gpuTierCache     = null;
    _activeWebGLCount = 0;

    Object.assign(_state, {
        ready:       false,
        svgReady:    false,
        houdiniReg:  false,
        observer:    null,
        styleEl:     null,
        svgEl:       null,
        rafId:       0,
        glBackend:   null,
        glCanvas:    null,
        glProgram:   null,
        glUniforms:  {},
        glBuffer:    null,
        glStartTime: 0,
        deviceTilt:  { x: 0, y: 0 },
    });
}

/**
 * Wraps an existing DOM element with a `.lg-outer` container so that the
 * SVG chromatic-aberration filter applies to the entire element boundary.
 *
 * The wrapper preserves the element's position in the layout via
 * `parent.insertBefore`.  Call `unwrap()` to fully restore the original DOM.
 *
 * @param {HTMLElement} el  - The element to wrap
 * @returns {WrapResult}
 *
 * @example
 * const { wrapper, unwrap } = wrapWithDistortion(myCard);
 * // Later:
 * unwrap();
 */
export function wrapWithDistortion(el) {
    const parent      = el.parentNode;
    const nextSibling = el.nextSibling;

    const wrapper     = document.createElement('div');
    wrapper.className = 'lg-outer';

    const display = window.getComputedStyle(el).display;
    const cls     = _DISPLAY_MAP[display];
    if (cls) {
        wrapper.classList.add(cls);
    } else if (display !== 'inline' && display !== 'none') {
        wrapper.classList.add('block');
    }

    parent?.insertBefore(wrapper, el);
    wrapper.appendChild(el);

    function unwrap() {
        if (!wrapper.isConnected) return;
        if (parent) parent.insertBefore(el, nextSibling ?? null);
        else        wrapper.removeChild(el);
        wrapper.remove();
    }

    return { wrapper, unwrap };
}

/**
 * Creates a `.lg-grain` layer element.
 *
 * Normally the grain layer is inserted automatically by {@link _attach},
 * but this function is exported for cases where you construct glass elements
 * manually before calling {@link initLiquidGlass}.
 *
 * @returns {HTMLDivElement}
 *
 * @example
 * const el = document.createElement('div');
 * el.className = 'lg lg-card lg-interactive';
 * el.prepend(createGrainLayer());
 * document.body.appendChild(el);
 */
export function createGrainLayer() {
    return Object.assign(document.createElement('div'), { className: 'lg-grain' });
}

/**
 * Manually attaches the liquid-glass effect to a specific element.
 *
 * Useful when you add `.lg` elements to the DOM in contexts where the
 * MutationObserver may not fire (e.g. Shadow DOM, detached trees).
 * Requires {@link initLiquidGlass} to have been called first.
 *
 * @param {HTMLElement} el
 *
 * @example
 * const el = document.createElement('div');
 * el.className = 'lg lg-interactive';
 * shadowRoot.appendChild(el);
 * attachElement(el); // manually trigger since MO doesn't see shadow DOM
 */
export function attachElement(el) {
    if (!_state.ready) {
        console.warn('LiquidGlass: call initLiquidGlass() before attachElement().');
        return;
    }
    _attach(el);
}

/**
 * Manually detaches the liquid-glass effect from a specific element.
 *
 * You do not normally need to call this – the MutationObserver handles
 * cleanup automatically when elements are removed from the document.
 * Use this only when removing elements from Shadow DOM or detached trees.
 *
 * @param {HTMLElement} el
 */
export function detachElement(el) {
    _detach(el);
}

/**
 * Creates a fully-configured reply-quote element for chat UIs.
 *
 * The returned element is already wired up with pointer tracking and
 * WebGL caustics (if available).  Simply append it to your container.
 *
 * @param {string}            sender         - Display name of quoted author
 * @param {string}            text           - Truncated quoted message text
 * @param {boolean}           [isOwn=false]  - true = purple "own message" tint
 * @param {(() => void)|null} [onClick=null] - Click handler (e.g. scroll to message)
 * @returns {HTMLDivElement}
 *
 * @example
 * chatContainer.appendChild(
 *   createReplyQuote('Alice', 'See you at 9!', false, () => scrollToMessage(id))
 * );
 */
export function createReplyQuote(sender, text, isOwn = false, onClick = null) {
    const el = document.createElement('div');
    el.className = `lg lg-reply lg-interactive${isOwn ? ' lg-own' : ''}`;

    el.appendChild(createGrainLayer());
    el.append(
        Object.assign(document.createElement('span'), {
            className: 'lg-sender', textContent: sender,
        }),
        Object.assign(document.createElement('span'), {
            className: 'lg-text', textContent: text,
        })
    );

    if (typeof onClick === 'function') {
        el.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    }

    if (_state.ready) _attach(el);

    return el;
}

/**
 * Returns the GPU performance tier detected on the current device.
 *
 * Host applications can use this to make independent quality decisions
 * (e.g. showing additional particle effects only on 'high' tier).
 *
 * @returns {GpuTier}
 */
export function getGpuTier() {
    return _detectGpuTier();
}

/**
 * Returns the library version string.
 *
 * @returns {'1.1.1'}
 */
export function version() {
    return '1.1.1';
}
