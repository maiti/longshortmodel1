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
  // Black hole intro: a warping tunnel of concentric discs, radial lines,
  // and inward-flowing particles on the landing screen. Matches the
  // referenced component's own defaults (neutral gray stroke, white
  // particles, 50 lines, 50 discs) rather than the site's blue accent, so
  // it reads as "the black hole background" rather than a loose homage --
  // the blue shows up at the very core instead, as the one accretion-disk
  // accent tying it to the rest of the site. Clicking "Enter" accelerates
  // everything and zooms into the core before the dashboard is revealed
  // underneath -- an "entering the singularity" beat, not a plain fade.
  // ---------------------------------------------------------------------
  safe(function initBlackHoleIntro() {
    const canvas = document.getElementById("blackhole-canvas");
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    let w, h, dpr, cx, cy;
    let rafId = null;
    let t = 0;
    let warping = false;
    let warpStart = 0;

    const strokeRGB = "115, 115, 115"; // #737373, the reference's default strokeColor
    const particleRGB = "255, 255, 255"; // the reference's default particleRGBColor
    const numDiscs = 50;
    const numLines = 50;
    const numParticles = 140;

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
      cy = h / 2;
    }
    resize();
    window.addEventListener("resize", () => safe(resize));

    function spawnParticle() {
      return {
        angle: Math.random() * Math.PI * 2,
        radius: Math.random() * Math.max(w, h) * 0.6 + 60,
        speed: 0.5 + Math.random() * 1.1,
        size: 0.6 + Math.random() * 1.6,
      };
    }
    const particles = Array.from({ length: numParticles }, spawnParticle);

    function drawDiscs(speedMult) {
      const maxR = Math.hypot(w, h) * 0.62;
      for (let i = 0; i < numDiscs; i++) {
        const phase = ((i / numDiscs + t * 0.0022 * speedMult) % 1 + 1) % 1;
        const r = phase * maxR;
        const alpha = Math.max(0, 1 - phase) * 0.6;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.94, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${strokeRGB}, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    function drawLines(speedMult) {
      const maxR = Math.hypot(w, h) * 0.72;
      const rotation = t * 0.0015 * speedMult;
      for (let i = 0; i < numLines; i++) {
        const angle = (i / numLines) * Math.PI * 2 + rotation;
        const x2 = cx + Math.cos(angle) * maxR;
        const y2 = cy + Math.sin(angle) * maxR * 0.94;
        const grad = ctx.createLinearGradient(cx, cy, x2, y2);
        grad.addColorStop(0, `rgba(${strokeRGB}, 0.4)`);
        grad.addColorStop(1, `rgba(${strokeRGB}, 0)`);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    function drawParticles(speedMult) {
      const resetRadius = Math.max(w, h) * 0.65;
      particles.forEach((p) => {
        p.radius -= p.speed * speedMult;
        if (p.radius < 4) {
          Object.assign(p, spawnParticle());
          p.radius = resetRadius;
        }
        const x = cx + Math.cos(p.angle) * p.radius;
        const y = cy + Math.sin(p.angle) * p.radius * 0.94;
        const alpha = Math.min(1, (resetRadius - p.radius) / 90);
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${particleRGB}, ${0.7 * alpha})`;
        ctx.fill();
      });
    }

    function drawCore() {
      // The one accretion-disk-blue accent in an otherwise neutral tunnel,
      // at the vanishing point -- ties this to the rest of the site.
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 52);
      core.addColorStop(0, "#05070f");
      core.addColorStop(0.5, "rgba(37, 99, 235, 0.9)");
      core.addColorStop(0.8, "rgba(56, 189, 248, 0.5)");
      core.addColorStop(1, "rgba(56, 189, 248, 0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, 52, 0, Math.PI * 2);
      ctx.fill();
    }

    function frame(now) {
      try {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);

        let speedMult = 1;
        if (warping) {
          // Clamped to >= 0: the already-scheduled rAF callback firing
          // this frame can carry a timestamp from just before the
          // synchronous click handler set warpStart, which would
          // otherwise make elapsed briefly negative -- and
          // Math.pow(negative, 2.2) is NaN in JS.
          const elapsed = Math.max(0, now - warpStart);
          const p = Math.min(elapsed / 900, 1);
          speedMult = 1 + Math.pow(elapsed / 90, 2.2);
          canvas.style.transform = `scale(${1 + p * 2.6})`;
          canvas.style.filter = `blur(${p * 3}px)`;
        }

        drawLines(speedMult);
        drawDiscs(speedMult);
        drawParticles(speedMult * 4);
        drawCore();

        t += 16; // roughly ms-per-frame at 60fps, used as the animation clock
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
