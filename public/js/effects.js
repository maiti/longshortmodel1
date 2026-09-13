/*
 * Purely cosmetic effects: the landing screen's black-hole entrance, the
 * dashboard's singularity background, the cursor trail, and the 3D tilt
 * on result cards. Everything decorative here is wrapped so a failure (an
 * unsupported API, a slow device, whatever) can never break app.js's
 * actual data logic -- worst case, the page just looks a little plainer.
 *
 * The one exception is the landing screen's dismissal path (initLanding,
 * dismissLanding), which runs unwrapped and depends on nothing else in
 * this file: even if canvas rendering fails outright, clicking "Enter"
 * must always reveal the dashboard underneath. A decorative animation is
 * never allowed to become a lock on the actual app.
 */

// ---------------------------------------------------------------------
// Landing screen dismissal -- the one thing here that must always work.
// ---------------------------------------------------------------------
let _cancelBlackHoleAnim = null;
let _triggerBlackHoleWarp = null;

function dismissLanding() {
  const overlay = document.getElementById("landing-screen");
  if (!overlay) return;
  if (_cancelBlackHoleAnim) {
    try { _cancelBlackHoleAnim(); } catch (e) { /* already stopped, fine */ }
  }
  document.body.classList.remove("landing-active");
  overlay.style.transition = "opacity 0.4s ease";
  overlay.style.opacity = "0";
  setTimeout(() => { overlay.style.display = "none"; }, 420);
}

function initLanding() {
  const overlay = document.getElementById("landing-screen");
  const enterBtn = document.getElementById("enter-btn");
  if (!overlay || !enterBtn) return; // nothing to wire up, dashboard shows as-is
  document.body.classList.add("landing-active");

  let warping = false;
  function enter() {
    if (warping) return;
    warping = true;
    try {
      if (_triggerBlackHoleWarp) _triggerBlackHoleWarp();
    } catch (e) {
      console.warn("[landing] warp animation failed, dismissing anyway:", e);
    }
    const content = overlay.querySelector(".landing-content");
    if (content) {
      content.style.transition = "opacity 0.3s ease";
      content.style.opacity = "0";
    }
    const flash = document.getElementById("landing-flash");
    if (flash) {
      flash.style.transition = "opacity 0.5s ease-in";
      setTimeout(() => { flash.style.opacity = "1"; }, 600);
    }
    setTimeout(dismissLanding, 1050);
  }

  enterBtn.addEventListener("click", enter);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.id === "blackhole-canvas") enter();
  });
  document.addEventListener("keydown", (e) => {
    if (!warping && overlay.style.display !== "none" && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      enter();
    }
  });
}
initLanding(); // unwrapped: this must run regardless of what else on this page fails

(function () {
  "use strict";

  function safe(fn) {
    try { fn(); } catch (e) { console.warn("[effects] skipped:", e); }
  }

  // ---------------------------------------------------------------------
  // Black hole intro: a genuine sinkhole/divot in a wireframe grid, matched
  // against a reference screenshot -- not a flat set of concentric circles
  // with straight spokes, but a grid whose "latitude" rings get rounder and
  // more tightly packed as they near the throat and flatten out toward a
  // near-invisible sliver at the far edges, so the connecting "meridian"
  // lines curve the way they would over a real funnel surface rather than
  // running dead straight to a vanishing point. A large animated radial
  // wash (not a single static glow blob) cycles teal -> blue -> purple ->
  // magenta in bands that continuously drift inward toward the throat,
  // like color flowing down the drain. The animation clock runs on real
  // elapsed time (delta-time), not a fixed per-frame increment, so motion
  // stays smooth regardless of actual frame rate. Clicking "Enter"
  // accelerates everything with an eased (not power-law) ramp and zooms
  // into the throat before the dashboard is revealed underneath.
  // ---------------------------------------------------------------------
  safe(function initBlackHoleIntro() {
    const canvas = document.getElementById("blackhole-canvas");
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    let w, h, dpr, cx, cy, maxR;
    let rafId = null;
    let t = 0; // seconds, advanced by real delta-time each frame
    let lastNow = null;
    let warping = false;
    let warpStart = 0;

    const NUM_RINGS = 26;
    const NUM_SPOKES = 40;
    const NUM_PARTICLES = 130;
    const RADIUS_POWER = 1.7; // > 1 packs rings tightly near the throat
    const SQUASH_CENTER = 0.85; // near the throat, rings read almost round
    const SQUASH_EDGE = 0.1; // far out, rings flatten to a sliver (steep perspective)
    const CENTER_Y_FRAC = 0.58; // the throat sits low in the frame
    const ROTATION_SPEED = 0.05; // slow swirl, radians/sec at speedMult=1
    const FLOW_SPEED = 0.09; // how fast color bands drift inward, cycles/sec

    // Fixed spatial hue mapping -- magenta at the throat (u=0) fading
    // through purple and blue out to teal at the rim (u=1). This stays
    // constant; it's the grid's radius (u), not the palette itself, that
    // moves over time, so a ring sliding inward visibly passes through
    // this same gradient the way a real object would sliding down a drain
    // -- rather than the whole screen's colors swapping in place.
    const HUE_STOPS = [300, 262, 222, 184];

    function hueForU(u) {
      const uc = Math.min(Math.max(u, 0), 1);
      const n = HUE_STOPS.length - 1;
      const scaled = uc * n;
      const idx = Math.min(Math.floor(scaled), n - 1);
      const frac = scaled - idx;
      return HUE_STOPS[idx] + (HUE_STOPS[idx + 1] - HUE_STOPS[idx]) * frac;
    }

    // Geometry of ring index i (0 = throat, NUM_RINGS-1 = outer rim): how
    // far out it sits and how flattened it is. Spokes reuse this per ring
    // so their curvature falls out naturally from the varying squash.
    function ringGeom(u) {
      return {
        r: maxR * Math.pow(u, RADIUS_POWER),
        squash: SQUASH_CENTER + (SQUASH_EDGE - SQUASH_CENTER) * u,
      };
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = w / 2;
      cy = h * CENTER_Y_FRAC;
      maxR = Math.hypot(w, h) * 0.62;
    }
    resize();
    window.addEventListener("resize", () => safe(resize));

    function spawnParticle() {
      return {
        angle: Math.random() * Math.PI * 2,
        u: Math.random() * 0.85 + 0.15,
        speed: 0.05 + Math.random() * 0.09,
        size: 1.4 + Math.random() * 2.6,
      };
    }
    const particles = Array.from({ length: NUM_PARTICLES }, spawnParticle);

    function drawWash(rotation) {
      // A large, spatially fixed color wash filling the whole basin --
      // magenta at the throat fading through purple/blue to teal at the
      // rim. This anchors the scene's overall coloring; the animated
      // "flowing inward" motion comes from the rings below moving through
      // this stable gradient, not from the gradient itself repainting.
      const STOPS = 28;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 1.05);
      for (let s = 0; s <= STOPS; s++) {
        const posFrac = s / STOPS;
        const hue = hueForU(posFrac);
        const lightness = 60 - posFrac * 44;
        const alpha = Math.pow(1 - posFrac, 1.5) * 0.85;
        grad.addColorStop(posFrac, `hsla(${hue}, 80%, ${lightness}%, ${alpha})`);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      void rotation; // wash itself doesn't need speedMult; kept for a uniform call signature
    }

    function drawRings(rotation) {
      // Each ring's radial position (not its color-vs-radius mapping)
      // advances over time and wraps, so individual rings continuously
      // slide from the rim toward the throat and vanish -- like objects
      // actually flowing down the drain -- picking up the wash's fixed
      // hue-for-radius color as they go, rather than the color cycling
      // in place.
      for (let i = 0; i < NUM_RINGS; i++) {
        const u = ((i / NUM_RINGS - t * FLOW_SPEED * rotation.speedMult) % 1 + 1) % 1;
        const { r, squash } = ringGeom(u);
        const hue = hueForU(u);
        const alpha = 0.32 + u * 0.3;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * squash, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `hsla(${hue}, 90%, 68%, ${alpha})`;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
    }

    function drawSpokes(rotation) {
      // Each spoke walks outward through every ring's radius at a fixed
      // angle. Because squash varies per ring, connecting those points
      // produces a naturally curved meridian -- exactly the bent-line look
      // of a real warped surface, without any actual 3D projection math.
      for (let s = 0; s < NUM_SPOKES; s++) {
        const angle = (s / NUM_SPOKES) * Math.PI * 2 + rotation.angle;
        ctx.beginPath();
        for (let i = 0; i < NUM_RINGS; i++) {
          const u = i / (NUM_RINGS - 1);
          const { r, squash } = ringGeom(u);
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r * squash;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        const outer = ringGeom(1);
        const x2 = cx + Math.cos(angle) * outer.r;
        const y2 = cy + Math.sin(angle) * outer.r * outer.squash;
        const grad = ctx.createLinearGradient(cx, cy, x2, y2);
        grad.addColorStop(0, `hsla(${hueForU(0)}, 90%, 70%, 0.4)`);
        grad.addColorStop(1, `hsla(${hueForU(1)}, 85%, 62%, 0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    function drawParticles(rotation, dtSec) {
      particles.forEach((p) => {
        p.u -= p.speed * rotation.speedMult * dtSec;
        if (p.u < 0.03) Object.assign(p, spawnParticle(), { u: 0.9 + Math.random() * 0.1 });
        const { r, squash } = ringGeom(p.u);
        const x = cx + Math.cos(p.angle) * r;
        const y = cy + Math.sin(p.angle) * r * squash;
        const alpha = Math.min(1, (0.95 - p.u) / 0.25 + 0.15);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.8 * alpha})`;
        ctx.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
      });
    }

    function drawThroatFlare() {
      // A soft, small highlight right at the throat -- a light source, not
      // a hard disc -- blended additively so it brightens the wash below
      // rather than sitting on top of it as a flat circle.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const r = Math.max(28, maxR * 0.06);
      const flare = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      flare.addColorStop(0, "rgba(255, 255, 255, 0.8)");
      flare.addColorStop(0.5, "rgba(255, 170, 230, 0.4)");
      flare.addColorStop(1, "rgba(255, 170, 230, 0)");
      ctx.fillStyle = flare;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function frame(now) {
      try {
        if (lastNow === null) lastNow = now;
        const dt = Math.min((now - lastNow) / 1000, 0.05); // clamp long tab-switch gaps
        lastNow = now;
        t += dt;

        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);

        let speedMult = 1;
        if (warping) {
          const elapsed = Math.max(0, now - warpStart);
          const p = Math.min(elapsed / 900, 1);
          const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic, not a power ramp
          speedMult = 1 + eased * 14;
          canvas.style.transform = `scale(${1 + eased * 2.6})`;
          canvas.style.filter = `blur(${eased * 3}px)`;
        }
        const rotation = { angle: t * ROTATION_SPEED * speedMult, speedMult };

        drawWash(rotation);
        drawSpokes(rotation);
        drawRings(rotation);
        drawParticles(rotation, dt);
        drawThroatFlare();

        rafId = requestAnimationFrame(frame);
      } catch (e) {
        // A purely decorative animation must never keep erroring every
        // frame (or worse, take anything else down with it) -- log once
        // and stop, rather than retrying into a console flood.
        console.warn("[effects] black hole animation stopped:", e);
      }
    }
    rafId = requestAnimationFrame(frame);

    _cancelBlackHoleAnim = () => { if (rafId) cancelAnimationFrame(rafId); };
    _triggerBlackHoleWarp = () => {
      warping = true;
      warpStart = performance.now();
    };
  });

  // ---------------------------------------------------------------------
  // Dashboard singularity background: a real WebGL port of "Singularity"
  // by @XorDev (https://www.shadertoy.com/view/3csSWB, the shader the
  // requested component's own credits cite), not a from-scratch
  // approximation -- the fragment shader below is that shader's actual
  // math, adapted only for a bare WebGL1 main() instead of ShaderToy's
  // mainImage() wrapper. hue/saturation/brightness are applied as an
  // HSV post-process on the shader's own output (the shader has no such
  // uniforms itself); mouseSensitivity nudges the field's center toward
  // the cursor, damped, since the source shader doesn't read iMouse
  // either. Falls back to a canvas2D plasma approximation if WebGL is
  // unavailable, so there's still an animated background either way.
  // ---------------------------------------------------------------------
  safe(function initSingularityBackground() {
    const canvas = document.getElementById("bg-canvas");
    if (!canvas || !canvas.getContext) return;

    const HUE_DEGREES = 190; // shifts the shader's native red/blue toward the site's cyan/blue accent
    const SATURATION = 1.05;
    const BRIGHTNESS = 1.15;
    const SPEED = 0.55;
    const MOUSE_SENSITIVITY = 0.5;
    const MOUSE_DAMPING = 0.02;

    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) {
      renderFallback2D(canvas);
      return;
    }

    const VERTEX_SRC = `
      attribute vec2 aPosition;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;

    // "Singularity" by @XorDev -- ported verbatim from ShaderToy's
    // mainImage(out vec4 O, vec2 F) into a WebGL1 main(), plus a small
    // HSV post-process block appended at the end for hue/saturation/
    // brightness, and mouseOffset feeding into `p`'s origin.
    const FRAGMENT_SRC = `
      precision highp float;
      uniform vec2 iResolution;
      uniform float iTime;
      uniform vec2 uMouseOffset;
      uniform float uHue;
      uniform float uSaturation;
      uniform float uBrightness;

      vec3 rgb2hsv(vec3 c) {
        vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y);
        float e = 1.0e-10;
        return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
      }
      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }

      void main() {
        vec2 F = gl_FragCoord.xy;
        float i = 0.2, a;
        vec2 r = iResolution.xy;
        vec2 p = ( F + F - r ) / r.y / 0.7 - uMouseOffset;
        vec2 d = vec2(-1.0, 1.0);
        vec2 b = p - i * d;
        vec2 c = p * mat2(1.0, 1.0, d.x / (0.1 + i / dot(b, b)), d.y / (0.1 + i / dot(b, b)));
        a = dot(c, c);
        vec4 rotv = cos(0.5 * log(a) + iTime * i + vec4(0.0, 33.0, 11.0, 0.0));
        vec2 v = c * mat2(rotv) / i;
        vec2 w = vec2(0.0);

        for (int j = 0; j < 9; j++) {
          i += 1.0;
          v += 0.7 * sin(v.yx * i + iTime) / i + 0.5;
          w += 1.0 + sin(v);
        }
        i = length( sin(v / 0.3) * 0.4 + c * (3.0 + d) );
        vec4 O = 1.0 - exp( -exp( c.x * vec4(0.6, -0.4, -1.0, 0.0) )
                       / w.xyyx
                       / ( 2.0 + i * i / 4.0 - i )
                       / ( 0.5 + 1.0 / a )
                       / ( 0.03 + abs( length(p) - 0.7 ) )
                 );

        vec3 hsv = rgb2hsv(clamp(O.rgb, 0.0, 1.0));
        hsv.x = fract(hsv.x + uHue / 360.0);
        hsv.y = clamp(hsv.y * uSaturation, 0.0, 1.0);
        hsv.z = clamp(hsv.z * uBrightness, 0.0, 1.0);
        gl_FragColor = vec4(hsv2rgb(hsv), 1.0);
      }
    `;

    function compileShader(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error("shader compile failed: " + info);
      }
      return shader;
    }

    let program;
    try {
      const vs = compileShader(gl.VERTEX_SHADER, VERTEX_SRC);
      const fs = compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SRC);
      program = gl.createProgram();
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error("program link failed: " + gl.getProgramInfoLog(program));
      }
    } catch (e) {
      console.warn("[effects] singularity WebGL shader failed, using 2D fallback:", e);
      renderFallback2D(canvas);
      return;
    }

    gl.useProgram(program);
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPosition = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, "iResolution");
    const uTime = gl.getUniformLocation(program, "iTime");
    const uMouseOffsetLoc = gl.getUniformLocation(program, "uMouseOffset");
    const uHueLoc = gl.getUniformLocation(program, "uHue");
    const uSaturationLoc = gl.getUniformLocation(program, "uSaturation");
    const uBrightnessLoc = gl.getUniformLocation(program, "uBrightness");
    gl.uniform1f(uHueLoc, HUE_DEGREES);
    gl.uniform1f(uSaturationLoc, SATURATION);
    gl.uniform1f(uBrightnessLoc, BRIGHTNESS);

    let w, h, dpr;
    let mouseX = 0.5, mouseY = 0.5, targetMouseX = 0.5, targetMouseY = 0.5;
    window.addEventListener("mousemove", (e) => {
      targetMouseX = e.clientX / window.innerWidth;
      targetMouseY = e.clientY / window.innerHeight;
    });

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5); // shader cost scales with pixel count; cap it
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    resize();
    window.addEventListener("resize", () => safe(resize));

    const start = performance.now();
    let firstFrameLogged = false;
    function frame(now) {
      mouseX += (targetMouseX - mouseX) * MOUSE_DAMPING;
      mouseY += (targetMouseY - mouseY) * MOUSE_DAMPING;

      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform1f(uTime, ((now - start) / 1000) * SPEED);
      gl.uniform2f(uMouseOffsetLoc, (mouseX - 0.5) * MOUSE_SENSITIVITY, (mouseY - 0.5) * MOUSE_SENSITIVITY);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (!firstFrameLogged) {
        firstFrameLogged = true;
        console.info("[effects] singularity background (WebGL) is running");
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });

  // Canvas2D fallback for the dashboard background, used only if WebGL is
  // unavailable or the shader fails to compile/link on this device --
  // a simpler multi-sine plasma field, not the real shader, but still a
  // clearly-animated full-viewport background rather than nothing.
  function renderFallback2D(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let w, h, dpr, t = 0;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    function frame() {
      const grad = ctx.createRadialGradient(w * 0.5, h * 0.4, 0, w * 0.5, h * 0.4, Math.max(w, h) * 0.7);
      const hue = (200 + Math.sin(t) * 30 + 360) % 360;
      grad.addColorStop(0, `hsla(${hue}, 70%, 18%, 1)`);
      grad.addColorStop(1, "rgba(5,6,15,1)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      t += 0.01;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------
  // Cursor trail: a short-lived glowing particle trail following the mouse.
  // ---------------------------------------------------------------------
  safe(function initCursorTrail() {
    const canvas = document.getElementById("cursor-canvas");
    if (!canvas || !canvas.getContext || window.matchMedia("(pointer: coarse)").matches) {
      // Skip entirely on touch devices -- there is no hover cursor to trail.
      return;
    }
    const ctx = canvas.getContext("2d");
    let w, h, dpr;
    let particles = [];

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", () => safe(resize));

    const colors = ["56,189,248", "129,140,248", "34,211,238"];
    window.addEventListener("mousemove", (e) => {
      particles.push({
        x: e.clientX,
        y: e.clientY,
        r: 6 + Math.random() * 6,
        life: 1,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
      if (particles.length > 80) particles.splice(0, particles.length - 80);
    });

    function frame() {
      ctx.clearRect(0, 0, w, h);
      particles.forEach((p) => {
        p.life -= 0.035;
        p.r *= 0.98;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        grad.addColorStop(0, `rgba(${p.color}, ${Math.max(p.life, 0) * 0.5})`);
        grad.addColorStop(1, `rgba(${p.color}, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(p.r, 0.1), 0, Math.PI * 2);
        ctx.fill();
      });
      particles = particles.filter((p) => p.life > 0);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });

  // ---------------------------------------------------------------------
  // 3D tilt cards: any element with .tilt-card rotates toward the cursor
  // and shows a spotlight glow. Uses event delegation on the document so
  // it keeps working for cards that get re-rendered later (e.g. the
  // metric cards, which app.js rebuilds via innerHTML on every run).
  // ---------------------------------------------------------------------
  safe(function initTiltCards() {
    if (window.matchMedia("(pointer: coarse)").matches) return; // no hover on touch
    const MAX_TILT = 8;

    document.addEventListener("mousemove", (e) => {
      const card = e.target.closest(".tilt-card");
      if (!card) return;
      const rect = card.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      const rotateY = (px - 0.5) * MAX_TILT * 2;
      const rotateX = (0.5 - py) * MAX_TILT * 2;
      card.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.015)`;
      card.style.setProperty("--mx", `${px * 100}%`);
      card.style.setProperty("--my", `${py * 100}%`);
    });

    document.addEventListener(
      "mouseleave",
      (e) => {
        const card = e.target.closest && e.target.closest(".tilt-card");
        if (!card) return;
        card.style.transform = "";
      },
      true
    );
  });
})();
