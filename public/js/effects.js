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

// Shared with initBlackHoleIntro's own warp timeline below -- both need the
// same total duration so the dashboard reveal lands right as the hyperspace
// streaks finish decelerating, not before or after.
const WARP_DURATION_MS = 1500;

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
    // #landing-flash's opacity is driven per-frame by initBlackHoleIntro's
    // own warp timeline now (tied to the hyperspeed streak intensity), not
    // a fixed setTimeout here -- see the "hyperspeed" comment block below.
    setTimeout(dismissLanding, WARP_DURATION_MS - 20);
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
  // Black hole intro: a direct port of the actual referenced "Black Hole
  // Background" component's canvas algorithm, not an approximation --
  // discs are tweened from one large ellipse (near the top) to a single
  // point (low in the frame) via easeInExpo on their y-position only; the
  // wireframe is traced once through every disc's position at every angle,
  // so the curved "meridian" look falls straight out of that tween rather
  // than from any hand-tuned perspective math; and a clip region (an
  // ellipse at the smallest disc, unioned with a rect above it) confines
  // the wireframe and particles to a keyhole shape, letting the CSS
  // layers' purple glow show through unobstructed at the throat. The
  // canvas itself only ever draws a neutral gray wireframe and white
  // particles at low opacity -- all the actual color (the purple glow, the
  // moving cyan/amber/pink accretion band, the scanline texture) comes
  // from the CSS layers in #blackhole-bg (see styles.css), exactly as in
  // the source component; a from-scratch attempt at coloring the canvas
  // directly never matched because that isn't where the color lives.
  // The one deliberate change from the source: disc/particle motion here
  // runs on real delta-time instead of a fixed per-frame step, so it
  // doesn't jitter when the actual frame rate varies, and clicking "Enter"
  // speeds everything up with an eased ramp instead of a linear one.
  // ---------------------------------------------------------------------
  safe(function initBlackHoleIntro() {
    const canvas = document.getElementById("blackhole-canvas");
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    const bg = canvas.parentElement; // #blackhole-bg -- warp transform applies here
    const flashEl = document.getElementById("landing-flash");

    const STROKE_COLOR = "#737373"; // the reference's own default strokeColor
    const PARTICLE_RGB = [255, 255, 255]; // the reference's own default particleRGBColor
    const NUM_LINES = 50;
    const NUM_DISCS = 50;
    const TOTAL_PARTICLES = 100;
    const DISC_CYCLE_PER_SEC = 0.06; // == the source's disc.p += 0.001 at a nominal 60fps

    let rafId = null;
    let lastNow = null;
    let warping = false;
    let warpStart = 0;

    const state = {
      discs: [],
      lines: [],
      particles: [],
      clip: {},
      startDisc: { p: 0, x: 0, y: 0, w: 0, h: 0 },
      endDisc: { p: 0, x: 0, y: 0, w: 0, h: 0 },
      rect: { width: 0, height: 0 },
      render: { width: 0, height: 0, dpi: 1 },
      particleArea: {},
      linesCanvas: null,
    };

    // Hyperspace streaks: only drawn during the click-to-enter warp, not
    // part of the reference component. Each is a light ray radiating from
    // the funnel's own throat (state.clip.disc, the same vanishing point
    // the wireframe already converges to) that lengthens and brightens as
    // the warp's speed "hump" rises, then shrinks back as it recedes --
    // the classic Star-Wars-jump-to-lightspeed look, arriving rather than
    // just fading into the dashboard.
    const NUM_STREAKS = 110;
    let streaks = Array.from({ length: NUM_STREAKS }, makeStreak);
    function makeStreak() {
      return { angle: Math.random() * Math.PI * 2, dist: Math.random() * 30, speedVariance: Math.random() * 700 };
    }

    function linear(p) { return p; }
    function easeInExpo(p) { return p === 0 ? 0 : Math.pow(2, 10 * (p - 1)); }
    function tweenValue(start, end, p, ease) {
      const delta = end - start;
      const easeFn = ease === "inExpo" ? easeInExpo : linear;
      return start + delta * easeFn(p);
    }
    function tweenDisc(disc) {
      disc.x = tweenValue(state.startDisc.x, state.endDisc.x, disc.p);
      disc.y = tweenValue(state.startDisc.y, state.endDisc.y, disc.p, "inExpo");
      disc.w = tweenValue(state.startDisc.w, state.endDisc.w, disc.p);
      disc.h = tweenValue(state.startDisc.h, state.endDisc.h, disc.p);
    }

    function setSize() {
      const rect = canvas.getBoundingClientRect();
      state.rect = { width: rect.width, height: rect.height };
      state.render = { width: rect.width, height: rect.height, dpi: Math.min(window.devicePixelRatio || 1, 2) };
      canvas.width = Math.max(1, Math.round(state.render.width * state.render.dpi));
      canvas.height = Math.max(1, Math.round(state.render.height * state.render.dpi));
    }

    function setDiscs() {
      const { width, height } = state.rect;
      if (width <= 0 || height <= 0) return;
      state.discs = [];
      state.startDisc = { p: 0, x: width * 0.5, y: height * 0.45, w: width * 0.75, h: height * 0.7 };
      state.endDisc = { p: 0, x: width * 0.5, y: height * 0.95, w: 0, h: 0 };

      let prevBottom = height;
      state.clip = {};
      for (let i = 0; i < NUM_DISCS; i++) {
        const p = i / NUM_DISCS;
        const disc = { p, x: 0, y: 0, w: 0, h: 0 };
        tweenDisc(disc);
        const bottom = disc.y + disc.h;
        if (bottom <= prevBottom) state.clip = { disc: { ...disc }, i };
        prevBottom = bottom;
        state.discs.push(disc);
      }

      if (state.clip.disc) {
        const clipPath = new Path2D();
        const d = state.clip.disc;
        clipPath.ellipse(d.x, d.y, d.w, d.h, 0, 0, Math.PI * 2);
        clipPath.rect(d.x - d.w, 0, d.w * 2, d.y);
        state.clip.path = clipPath;
      }
    }

    function setLines() {
      const { width, height } = state.rect;
      if (width <= 0 || height <= 0) return;
      state.lines = [];
      const linesAngle = (Math.PI * 2) / NUM_LINES;
      for (let i = 0; i < NUM_LINES; i++) state.lines.push([]);

      state.discs.forEach((disc) => {
        for (let i = 0; i < NUM_LINES; i++) {
          const angle = i * linesAngle;
          state.lines[i].push({
            x: disc.x + Math.cos(angle) * disc.w,
            y: disc.y + Math.sin(angle) * disc.h,
          });
        }
      });

      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.round(width));
      off.height = Math.max(1, Math.round(height));
      const octx = off.getContext("2d");
      if (!octx || !state.clip.path) {
        state.linesCanvas = null;
        return;
      }
      octx.clearRect(0, 0, off.width, off.height);

      state.lines.forEach((line) => {
        octx.save();
        let lineIsIn = false;
        line.forEach((p1, j) => {
          if (j === 0) return;
          const p0 = line[j - 1];
          if (
            !lineIsIn &&
            (octx.isPointInPath(state.clip.path, p1.x, p1.y) || octx.isPointInStroke(state.clip.path, p1.x, p1.y))
          ) {
            lineIsIn = true;
          } else if (lineIsIn) {
            octx.clip(state.clip.path);
          }
          octx.beginPath();
          octx.moveTo(p0.x, p0.y);
          octx.lineTo(p1.x, p1.y);
          octx.strokeStyle = STROKE_COLOR;
          octx.lineWidth = 2;
          octx.stroke();
          octx.closePath();
        });
        octx.restore();
      });
      state.linesCanvas = off;
    }

    function initParticle(start) {
      const area = state.particleArea;
      const sx = (area.sx || 0) + (area.sw || 0) * Math.random();
      const ex = (area.ex || 0) + (area.ew || 0) * Math.random();
      const dx = ex - sx;
      const y = start ? (area.h || 0) * Math.random() : area.h || 0;
      const r = 0.5 + Math.random() * 4;
      const vy = 0.5 + Math.random();
      return {
        x: sx,
        sx,
        dx,
        y,
        vy,
        p: 0,
        r,
        c: `rgba(${PARTICLE_RGB[0]}, ${PARTICLE_RGB[1]}, ${PARTICLE_RGB[2]}, ${Math.random()})`,
      };
    }

    function setParticles() {
      const { width, height } = state.rect;
      state.particles = [];
      const disc = state.clip.disc;
      if (!disc) return;
      state.particleArea = { sw: disc.w * 0.5, ew: disc.w * 2, h: height * 0.85 };
      state.particleArea.sx = (width - state.particleArea.sw) / 2;
      state.particleArea.ex = (width - state.particleArea.ew) / 2;
      for (let i = 0; i < TOTAL_PARTICLES; i++) state.particles.push(initParticle(true));
    }

    function drawDiscs() {
      ctx.strokeStyle = STROKE_COLOR;
      ctx.lineWidth = 2;
      const outer = state.startDisc;
      ctx.beginPath();
      ctx.ellipse(outer.x, outer.y, outer.w, outer.h, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.closePath();
      state.discs.forEach((disc, i) => {
        if (i % 5 !== 0) return;
        const clipped = disc.w < (state.clip.disc ? state.clip.disc.w : 0) - 5;
        if (clipped) {
          ctx.save();
          ctx.clip(state.clip.path);
        }
        ctx.beginPath();
        ctx.ellipse(disc.x, disc.y, disc.w, disc.h, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.closePath();
        if (clipped) ctx.restore();
      });
    }

    function drawLines() {
      if (state.linesCanvas && state.linesCanvas.width > 0 && state.linesCanvas.height > 0) {
        ctx.drawImage(state.linesCanvas, 0, 0);
      }
    }

    function drawParticles() {
      if (!state.clip.path) return;
      ctx.save();
      ctx.clip(state.clip.path);
      state.particles.forEach((particle) => {
        ctx.fillStyle = particle.c;
        ctx.beginPath();
        ctx.rect(particle.x, particle.y, particle.r, particle.r);
        ctx.closePath();
        ctx.fill();
      });
      ctx.restore();
    }

    function moveDiscs(dp) {
      state.discs.forEach((disc) => {
        disc.p = ((disc.p + dp) % 1 + 1) % 1;
        tweenDisc(disc);
      });
    }

    function moveParticles(pxPerFrame) {
      const h = state.particleArea.h || 1;
      state.particles.forEach((particle, idx) => {
        particle.p = 1 - particle.y / h;
        particle.x = particle.sx + particle.dx * particle.p;
        particle.y -= particle.vy * pxPerFrame;
        if (particle.y < 0) state.particles[idx] = initParticle(false);
      });
    }

    function drawHyperspaceStreaks(hump, dt) {
      if (hump <= 0.01) return;
      const origin = state.clip.disc
        ? { x: state.clip.disc.x, y: state.clip.disc.y }
        : { x: state.rect.width / 2, y: state.rect.height * 0.7 };
      const maxDist = Math.hypot(state.rect.width, state.rect.height) * 0.75;
      const speed = hump * hump * 3200;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      streaks.forEach((s) => {
        const prevDist = s.dist;
        s.dist += (speed + s.speedVariance) * dt;
        if (s.dist > maxDist) Object.assign(s, makeStreak());
        const alpha = hump * Math.min(1, prevDist / 90);
        if (alpha <= 0.01) return;
        const x0 = origin.x + Math.cos(s.angle) * prevDist;
        const y0 = origin.y + Math.sin(s.angle) * prevDist;
        const x1 = origin.x + Math.cos(s.angle) * s.dist;
        const y1 = origin.y + Math.sin(s.angle) * s.dist;
        ctx.strokeStyle = `rgba(210, 235, 255, ${alpha})`;
        ctx.lineWidth = 1 + hump * 1.6;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      });
      ctx.restore();
    }

    function resize() {
      setSize();
      setDiscs();
      setLines();
      setParticles();
    }
    resize();
    window.addEventListener("resize", () => safe(resize));

    function frame(now) {
      try {
        if (lastNow === null) lastNow = now;
        const dt = Math.min((now - lastNow) / 1000, 0.05); // clamp long tab-switch gaps
        lastNow = now;

        let speedMult = 1;
        let hump = 0;
        if (warping && bg) {
          const elapsed = Math.max(0, now - warpStart);
          const p = Math.min(elapsed / WARP_DURATION_MS, 1);
          // The zoom (scale/blur) rises monotonically the whole way through
          // -- we keep diving deeper into the hole right up to the reveal.
          // The "hump" (speed, streaks, flash) rises to a peak then recedes
          // before p reaches 1, so motion visibly decelerates just before
          // arrival instead of cutting off abruptly mid-rush.
          const monotonic = p * p * (3 - 2 * p); // smoothstep
          hump = p < 0.62 ? Math.pow(p / 0.62, 3) : p < 0.8 ? 1 : Math.max(0, 1 - Math.pow((p - 0.8) / 0.2, 2));
          speedMult = 1 + hump * 22;
          bg.style.transform = `scale(${1 + monotonic * 2.4})`;
          bg.style.filter = `blur(${monotonic * 2.2}px)`;
          if (flashEl) flashEl.style.opacity = String(Math.pow(hump, 1.6) * 0.95);
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(state.render.dpi, state.render.dpi);
        moveDiscs(DISC_CYCLE_PER_SEC * speedMult * dt);
        moveParticles(dt * 60 * speedMult); // dt*60 keeps the source's per-frame vy at the same real-world speed
        drawDiscs();
        drawLines();
        drawParticles();
        if (warping) drawHyperspaceStreaks(hump, dt);
        ctx.restore();

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
  // Fluid cursor: a real GPU fluid simulation (the same stable-fluids /
  // Navier-Stokes technique the referenced FluidCursor component itself
  // wraps -- Pavel Dobryakov's WebGL-Fluid-Simulation: curl -> vorticity
  // confinement -> divergence -> pressure solved by Jacobi iteration ->
  // gradient subtraction -> advection, all via ping-ponged framebuffers),
  // not a canvas2D particle approximation. Dye color is generated from a
  // slowly-oscillating mix between amber and blue rather than the
  // reference's full HSV rainbow, so the trail reads as the same hot/cool
  // accretion-disk palette as the rest of the site instead of a generic
  // rainbow cursor effect. Config values (dissipation/pressure/curl/splat
  // radius/force) are the reference component's own documented defaults.
  // Falls back to a lighter canvas2D particle-attractor effect if WebGL or
  // the required extensions aren't available.
  // ---------------------------------------------------------------------
  safe(function initFluidCursor() {
    const canvas = document.getElementById("cursor-canvas");
    if (!canvas || window.matchMedia("(pointer: coarse)").matches) {
      return; // no hover cursor to trail on touch devices
    }

    const config = {
      SIM_RESOLUTION: 96,
      DYE_RESOLUTION: 480,
      // Lower than the reference's own default (3.5) -- at that rate dye
      // decays to near-nothing well before the 0.7s gravity delay below,
      // leaving nothing visible left to pull. This keeps a trail
      // perceptible through ~0.7-0.8s so the pull toward the singularity
      // actually reads, fading out the rest of the way by ~1.2s.
      DENSITY_DISSIPATION: 1.8,
      VELOCITY_DISSIPATION: 2,
      PRESSURE: 0.1,
      PRESSURE_ITERATIONS: 15,
      CURL: 3,
      // Smaller and less energetic than the reference's own defaults --
      // this runs across the whole site, not just a demo box, so it needs
      // to stay a light accent rather than something big/bright enough to
      // obscure text or buttons underneath it.
      SPLAT_RADIUS: 0.1,
      SPLAT_FORCE: 4200,
    };

    const glParams = { alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false };
    let gl = canvas.getContext("webgl2", glParams);
    const isWebGL2 = !!gl;
    if (!gl) gl = canvas.getContext("webgl", glParams) || canvas.getContext("experimental-webgl", glParams);
    if (!gl) {
      renderCursorParticlesFallback(canvas);
      return;
    }

    function supportRenderTextureFormat(internalFormat, format, type) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    }
    function getSupportedFormat(internalFormat, format, type) {
      if (supportRenderTextureFormat(internalFormat, format, type)) return { internalFormat, format };
      if (!isWebGL2) return null;
      if (internalFormat === gl.R16F) return getSupportedFormat(gl.RG16F, gl.RG, type);
      if (internalFormat === gl.RG16F) return getSupportedFormat(gl.RGBA16F, gl.RGBA, type);
      return null;
    }

    let halfFloatTexType, formatRGBA, formatRG, formatR, supportLinearFiltering;
    try {
      if (isWebGL2) {
        gl.getExtension("EXT_color_buffer_float");
        supportLinearFiltering = !!gl.getExtension("OES_texture_float_linear");
        halfFloatTexType = gl.HALF_FLOAT;
        formatRGBA = getSupportedFormat(gl.RGBA16F, gl.RGBA, halfFloatTexType);
        formatRG = getSupportedFormat(gl.RG16F, gl.RG, halfFloatTexType);
        formatR = getSupportedFormat(gl.R16F, gl.RED, halfFloatTexType);
      } else {
        const halfFloatExt = gl.getExtension("OES_texture_half_float");
        supportLinearFiltering = !!gl.getExtension("OES_texture_half_float_linear");
        halfFloatTexType = halfFloatExt ? halfFloatExt.HALF_FLOAT_OES : gl.UNSIGNED_BYTE;
        formatRGBA = getSupportedFormat(gl.RGBA, gl.RGBA, halfFloatTexType);
        formatRG = formatRGBA;
        formatR = formatRGBA;
      }
      if (!formatRGBA || !formatRG || !formatR) throw new Error("no renderable float texture format available");
    } catch (e) {
      console.warn("[effects] fluid cursor: WebGL float textures unavailable, using 2D fallback:", e);
      renderCursorParticlesFallback(canvas);
      return;
    }
    const texFilter = supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    const baseVertexShader = `
      precision highp float;
      attribute vec2 aPosition;
      varying vec2 vUv, vL, vR, vT, vB;
      uniform vec2 texelSize;
      void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }
    `;
    const copyShader = `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      void main () { gl_FragColor = texture2D(uTexture, vUv); }
    `;
    const clearShader = `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform float value;
      void main () { gl_FragColor = value * texture2D(uTexture, vUv); }
    `;
    const splatShader = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTarget;
      uniform float aspectRatio;
      uniform vec3 color;
      uniform vec2 point;
      uniform float radius;
      void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
      }
    `;
    const advectionShader = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uVelocity;
      uniform sampler2D uSource;
      uniform vec2 texelSize;
      uniform float dt;
      uniform float dissipation;
      void main () {
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
        vec4 result = texture2D(uSource, coord);
        gl_FragColor = result / (1.0 + dissipation * dt);
      }
    `;
    const divergenceShader = `
      precision mediump float;
      varying highp vec2 vUv, vL, vR, vT, vB;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uVelocity, vL).x;
        float R = texture2D(uVelocity, vR).x;
        float T = texture2D(uVelocity, vT).y;
        float B = texture2D(uVelocity, vB).y;
        vec2 C = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) L = -C.x;
        if (vR.x > 1.0) R = -C.x;
        if (vT.y > 1.0) T = -C.y;
        if (vB.y < 0.0) B = -C.y;
        gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
      }
    `;
    const curlShader = `
      precision mediump float;
      varying highp vec2 vUv, vL, vR, vT, vB;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
      }
    `;
    const vorticityShader = `
      precision highp float;
      varying vec2 vUv, vL, vR, vT, vB;
      uniform sampler2D uVelocity;
      uniform sampler2D uCurl;
      uniform float curl;
      uniform float dt;
      void main () {
        float L = texture2D(uCurl, vL).x;
        float R = texture2D(uCurl, vR).x;
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001;
        force *= curl * C;
        force.y *= -1.0;
        vec2 vel = texture2D(uVelocity, vUv).xy + force * dt;
        gl_FragColor = vec4(clamp(vel, -1000.0, 1000.0), 0.0, 1.0);
      }
    `;
    const pressureShader = `
      precision mediump float;
      varying highp vec2 vUv, vL, vR, vT, vB;
      uniform sampler2D uPressure;
      uniform sampler2D uDivergence;
      void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        float divergence = texture2D(uDivergence, vUv).x;
        gl_FragColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
      }
    `;
    const gradientSubtractShader = `
      precision mediump float;
      varying highp vec2 vUv, vL, vR, vT, vB;
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      void main () {
        float L = texture2D(uPressure, vL).x;
        float R = texture2D(uPressure, vR).x;
        float T = texture2D(uPressure, vT).x;
        float B = texture2D(uPressure, vB).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
      }
    `;
    const displayShader = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTexture;
      void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
        float a = clamp(max(c.r, max(c.g, c.b)), 0.0, 1.0);
        gl_FragColor = vec4(c, a);
      }
    `;

    function compileShader(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error("fluid cursor shader compile failed: " + info);
      }
      return shader;
    }
    function createProgram(vsSource, fsSource) {
      const program = gl.createProgram();
      gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vsSource));
      gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fsSource));
      gl.bindAttribLocation(program, 0, "aPosition");
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error("fluid cursor program link failed: " + gl.getProgramInfoLog(program));
      }
      const uniforms = {};
      const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < count; i++) {
        const name = gl.getActiveUniform(program, i).name;
        uniforms[name] = gl.getUniformLocation(program, name);
      }
      return { program, uniforms };
    }

    let copyProgram, clearProgram, splatProgram, advectionProgram, divergenceProgram,
      curlProgram, vorticityProgram, pressureProgram, gradientSubtractProgram, displayProgram;
    try {
      copyProgram = createProgram(baseVertexShader, copyShader);
      clearProgram = createProgram(baseVertexShader, clearShader);
      splatProgram = createProgram(baseVertexShader, splatShader);
      advectionProgram = createProgram(baseVertexShader, advectionShader);
      divergenceProgram = createProgram(baseVertexShader, divergenceShader);
      curlProgram = createProgram(baseVertexShader, curlShader);
      vorticityProgram = createProgram(baseVertexShader, vorticityShader);
      pressureProgram = createProgram(baseVertexShader, pressureShader);
      gradientSubtractProgram = createProgram(baseVertexShader, gradientSubtractShader);
      displayProgram = createProgram(baseVertexShader, displayShader);
    } catch (e) {
      console.warn("[effects] fluid cursor shader setup failed, using 2D fallback:", e);
      renderCursorParticlesFallback(canvas);
      return;
    }

    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    const quadIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    function blit(target) {
      if (target == null) {
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } else {
        gl.viewport(0, 0, target.width, target.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      }
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    function createFBO(w, h, internalFormat, format, type, filter) {
      gl.activeTexture(gl.TEXTURE0);
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return {
        texture, fbo, width: w, height: h,
        attach(id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, texture); return id; },
      };
    }
    function createDoubleFBO(w, h, internalFormat, format, type, filter) {
      let a = createFBO(w, h, internalFormat, format, type, filter);
      let b = createFBO(w, h, internalFormat, format, type, filter);
      return {
        width: w, height: h, texelSizeX: 1 / w, texelSizeY: 1 / h,
        get read() { return a; }, set read(v) { a = v; },
        get write() { return b; }, set write(v) { b = v; },
        swap() { const t = a; a = b; b = t; },
      };
    }

    function getResolution(resolution) {
      let aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
      if (aspectRatio < 1) aspectRatio = 1 / aspectRatio;
      const min = Math.round(resolution);
      const max = Math.round(resolution * aspectRatio);
      return gl.drawingBufferWidth > gl.drawingBufferHeight ? { width: max, height: min } : { width: min, height: max };
    }

    let dye, velocity, divergence, curlFBO, pressure;
    function initFramebuffers() {
      const simRes = getResolution(config.SIM_RESOLUTION);
      const dyeRes = getResolution(config.DYE_RESOLUTION);
      dye = createDoubleFBO(dyeRes.width, dyeRes.height, formatRGBA.internalFormat, formatRGBA.format, halfFloatTexType, texFilter);
      velocity = createDoubleFBO(simRes.width, simRes.height, formatRG.internalFormat, formatRG.format, halfFloatTexType, texFilter);
      divergence = createFBO(simRes.width, simRes.height, formatR.internalFormat, formatR.format, halfFloatTexType, gl.NEAREST);
      curlFBO = createFBO(simRes.width, simRes.height, formatR.internalFormat, formatR.format, halfFloatTexType, gl.NEAREST);
      pressure = createDoubleFBO(simRes.width, simRes.height, formatR.internalFormat, formatR.format, halfFloatTexType, gl.NEAREST);
    }

    function resizeCanvas() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.round(window.innerWidth * dpr);
      const h = Math.round(window.innerHeight * dpr);
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        return true;
      }
      return false;
    }
    resizeCanvas();
    initFramebuffers();
    window.addEventListener("resize", () => safe(() => { if (resizeCanvas()) initFramebuffers(); }));

    // Amber<->blue mix, oscillating slowly so simultaneous splats share a
    // coherent, drifting palette rather than each picking an independent
    // random hue -- reads as one continuous accretion-disk flow.
    const HOT = [1.0, 0.66, 0.16];
    const COOL = [0.22, 0.55, 1.0];
    function nextSplatColor() {
      const cyclePos = (Math.sin(performance.now() * 0.00028) + 1) / 2;
      const m = Math.min(1, Math.max(0, cyclePos + (Math.random() - 0.5) * 0.18));
      const INTENSITY = 0.5; // dim enough to stay a background accent, not obscure UI text
      return {
        r: (HOT[0] + (COOL[0] - HOT[0]) * m) * INTENSITY,
        g: (HOT[1] + (COOL[1] - HOT[1]) * m) * INTENSITY,
        b: (HOT[2] + (COOL[2] - HOT[2]) * m) * INTENSITY,
      };
    }

    function correctRadius(radius) {
      const aspectRatio = canvas.width / canvas.height;
      return aspectRatio > 1 ? radius * aspectRatio : radius;
    }

    function splat(x, y, dx, dy, color) {
      gl.disable(gl.BLEND);
      gl.useProgram(splatProgram.program);
      gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
      gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
      gl.uniform2f(splatProgram.uniforms.point, x, y);
      gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0);
      gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100.0));
      blit(velocity.write);
      velocity.swap();

      gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
      gl.uniform3f(splatProgram.uniforms.color, color.r, color.g, color.b);
      blit(dye.write);
      dye.swap();
    }

    const pointer = { x: 0, y: 0, prevX: 0, prevY: 0, moved: false, color: nextSplatColor() };
    let havePointer = false;

    // Gravity: every trail is pulled toward the dashboard singularity's
    // screen position (viewport center), but only after it's had time to
    // drift naturally -- a sparse history of recent pointer positions
    // (sampled well below mousemove's native rate, so this stays cheap)
    // gets an extra velocity-only splat each frame once it's old enough,
    // with the pull ramping in quadratically (an acceleration, not an
    // instant switch) until the trail's total lifetime ends.
    const GRAVITY_DELAY_MS = 700;
    const GRAVITY_LIFETIME_MS = 1200;
    const GRAVITY_SAMPLE_INTERVAL_MS = 55;
    // Much larger than a naive kinematic estimate would suggest: the
    // solver's incompressibility (pressure projection) resists a purely
    // convergent velocity field and cancels out a large share of it each
    // step, so the constant has to substantially overshoot what a
    // frictionless-particle version of the same pull would need.
    const GRAVITY_ACCEL = 16000;
    const ZERO_COLOR = { r: 0, g: 0, b: 0 }; // velocity-only splat: nudges existing dye, adds none
    let gravityHistory = [];
    let lastGravitySampleAt = 0;

    window.addEventListener("mousemove", (e) => {
      pointer.prevX = havePointer ? pointer.x : e.clientX;
      pointer.prevY = havePointer ? pointer.y : e.clientY;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.moved = havePointer && (pointer.x !== pointer.prevX || pointer.y !== pointer.prevY);
      pointer.color = nextSplatColor();
      havePointer = true;

      const nowMs = Date.now();
      if (nowMs - lastGravitySampleAt >= GRAVITY_SAMPLE_INTERVAL_MS) {
        lastGravitySampleAt = nowMs;
        gravityHistory.push({ x: pointer.x, y: pointer.y, t: nowMs });
      }
    });

    function splatPointer() {
      const aspectRatio = canvas.width / canvas.height;
      const texcoordX = pointer.x / window.innerWidth;
      const texcoordY = 1.0 - pointer.y / window.innerHeight;
      let dx = ((pointer.x - pointer.prevX) / window.innerWidth) * config.SPLAT_FORCE;
      let dy = (-(pointer.y - pointer.prevY) / window.innerHeight) * config.SPLAT_FORCE;
      if (aspectRatio < 1) dx *= aspectRatio;
      if (aspectRatio > 1) dy /= aspectRatio;
      splat(texcoordX, texcoordY, dx, dy, pointer.color);
    }

    function applyGravityPulls(now, dt) {
      if (gravityHistory.length === 0) return;
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      const aspectRatio = canvas.width / canvas.height;
      gravityHistory = gravityHistory.filter((s) => now - s.t <= GRAVITY_LIFETIME_MS);
      gravityHistory.forEach((s) => {
        const age = now - s.t;
        if (age < GRAVITY_DELAY_MS) return;
        const p = (age - GRAVITY_DELAY_MS) / (GRAVITY_LIFETIME_MS - GRAVITY_DELAY_MS);
        const eased = p * p; // ramps in, reading as acceleration rather than a switched-on force
        const rawDx = cx - s.x;
        const rawDy = cy - s.y;
        const dist = Math.hypot(rawDx, rawDy) || 1;
        // Same texcoord-space convention as splatPointer's own dx/dy, just
        // pointed toward the singularity instead of the cursor's recent
        // motion, and scaled by dt since this runs once per frame (an
        // actual continuous acceleration) rather than once per input event.
        let dx = (rawDx / dist) * GRAVITY_ACCEL * eased * dt;
        let dy = -(rawDy / dist) * GRAVITY_ACCEL * eased * dt;
        if (aspectRatio < 1) dx *= aspectRatio;
        if (aspectRatio > 1) dy /= aspectRatio;
        splat(s.x / window.innerWidth, 1.0 - s.y / window.innerHeight, dx, dy, ZERO_COLOR);
      });
    }

    let lastUpdateTime = Date.now();
    function step(dt) {
      gl.disable(gl.BLEND);

      gl.viewport(0, 0, velocity.width, velocity.height);
      gl.useProgram(curlProgram.program);
      gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
      blit(curlFBO);

      gl.useProgram(vorticityProgram.program);
      gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
      gl.uniform1i(vorticityProgram.uniforms.uCurl, curlFBO.attach(1));
      gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
      gl.uniform1f(vorticityProgram.uniforms.dt, dt);
      blit(velocity.write);
      velocity.swap();

      gl.useProgram(divergenceProgram.program);
      gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
      blit(divergence);

      gl.useProgram(clearProgram.program);
      gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
      gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
      blit(pressure.write);
      pressure.swap();

      gl.useProgram(pressureProgram.program);
      gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
      for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
        gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
        blit(pressure.write);
        pressure.swap();
      }

      gl.useProgram(gradientSubtractProgram.program);
      gl.uniform2f(gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(gradientSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
      gl.uniform1i(gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
      blit(velocity.write);
      velocity.swap();

      gl.useProgram(advectionProgram.program);
      gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
      gl.uniform1i(advectionProgram.uniforms.uSource, velocity.read.attach(0));
      gl.uniform1f(advectionProgram.uniforms.dt, dt);
      gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
      blit(velocity.write);
      velocity.swap();

      gl.viewport(0, 0, dye.width, dye.height);
      gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
      gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
      gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
      blit(dye.write);
      dye.swap();
    }

    function render() {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.BLEND);
      gl.useProgram(displayProgram.program);
      gl.uniform1i(displayProgram.uniforms.uTexture, dye.read.attach(0));
      blit(null);
    }

    let contextLost = false;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      contextLost = true;
    });

    function frame() {
      if (contextLost) return;
      const now = Date.now();
      const dt = Math.min((now - lastUpdateTime) / 1000, 0.016666 * 3);
      lastUpdateTime = now;

      if (pointer.moved) {
        pointer.moved = false;
        splatPointer();
      }
      applyGravityPulls(now, dt);
      step(dt);
      render();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });

  // Canvas2D fallback for the cursor trail, used if WebGL or the float
  // texture extensions the fluid sim needs aren't available -- particles
  // spawned at the pointer that drift naturally for the first 0.7s of a
  // ~1.2s life, then get pulled toward the dashboard singularity's screen
  // position with quadratically increasing force (an acceleration, not a
  // switched-on force) for the rest of it. The pull direction is
  // recomputed every frame from each particle's current position (true
  // "gravity", not a frozen initial heading) and rotated by a fixed angle
  // so particles spiral inward instead of flying a straight line. Colored
  // along the same amber<->blue accretion palette as the WebGL path, so
  // the fallback still reads as the same effect.
  function renderCursorParticlesFallback(canvas) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let w, h, dpr;
    let particles = [];
    let lastNow = null;

    const LIFETIME_MS = 1200;
    const GRAVITY_DELAY_FRAC = 700 / LIFETIME_MS; // pull stays off for the first 0.7s
    const PULL_STRENGTH = 5200;
    const SPIRAL_ANGLE = 0.5;

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

    window.addEventListener("mousemove", (e) => {
      // Same slowly-oscillating amber<->blue mix the WebGL fluid path
      // uses, so simultaneous particles share a coherent, drifting color
      // rather than each picking an independent random one.
      const cyclePos = (Math.sin(performance.now() * 0.00028) + 1) / 2;
      for (let i = 0; i < 2; i++) {
        particles.push({
          x: e.clientX + (Math.random() - 0.5) * 5,
          y: e.clientY + (Math.random() - 0.5) * 5,
          vx: (Math.random() - 0.5) * 20,
          vy: (Math.random() - 0.5) * 20,
          born: performance.now(),
          size: 1.5 + Math.random() * 2.1,
          colorMix: Math.min(1, Math.max(0, cyclePos + (Math.random() - 0.5) * 0.18)),
        });
      }
      if (particles.length > 260) particles.splice(0, particles.length - 260);
    });

    function frame(now) {
      if (lastNow === null) lastNow = now;
      const dt = Math.min((now - lastNow) / 1000, 0.05);
      lastNow = now;

      ctx.clearRect(0, 0, w, h);
      const target = { x: w / 2, y: h / 2 };
      const cosA = Math.cos(SPIRAL_ANGLE);
      const sinA = Math.sin(SPIRAL_ANGLE);

      particles = particles.filter((p) => now - p.born < LIFETIME_MS);
      particles.forEach((p) => {
        const age = (now - p.born) / LIFETIME_MS;
        const dx = target.x - p.x;
        const dy = target.y - p.y;
        const dist = Math.hypot(dx, dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;
        const dirX = ux * cosA - uy * sinA;
        const dirY = ux * sinA + uy * cosA;
        const pullProgress = age < GRAVITY_DELAY_FRAC ? 0 : (age - GRAVITY_DELAY_FRAC) / (1 - GRAVITY_DELAY_FRAC);
        const pull = PULL_STRENGTH * pullProgress * pullProgress;
        p.vx += dirX * pull * dt;
        p.vy += dirY * pull * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;

        const fadeIn = Math.min(age / 0.08, 1);
        // Dimmed (0.7x ceiling) to match the WebGL path's own reduced
        // intensity -- a light accent rather than something that competes
        // with the text and buttons it passes over.
        const alpha = fadeIn * (1 - age) * 0.7;
        if (alpha <= 0.01) return;

        // Amber-to-blue blended directly in RGB (not via hue-degree
        // interpolation, which would sweep through an unwanted green band
        // between amber and blue on the hue wheel), matching the WebGL
        // fluid path's own HOT/COOL mix.
        const m = p.colorMix;
        const r = Math.round((255 + (56 - 255) * m));
        const g = Math.round((168 + (140 - 168) * m));
        const b = Math.round((41 + (255 - 41) * m));
        const radius = Math.max(0.3, p.size * (1 - age * 0.35));

        const speed = Math.hypot(p.vx, p.vy);
        if (speed > 25) {
          const tailLen = Math.min(speed * 0.035, 46);
          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha * 0.6})`;
          ctx.lineWidth = Math.max(0.6, radius * 0.7);
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - (p.vx / speed) * tailLen, p.y - (p.vy / speed) * tailLen);
          ctx.stroke();
        }

        const glowR = radius * 2.4;
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
        glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
        glow.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, ${alpha * 0.55})`);
        glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
        ctx.fill();
      });

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------
  // Tracing beam: a scroll-progress rail beside the results column, ported
  // from the referenced "Tracing Beam" component -- a base path plus a
  // gradient-stroked copy whose gradient endpoints (y1/y2) are driven by
  // scroll position through the same mapRange formulas as the source, then
  // smoothed with a small hand-integrated spring (semi-implicit Euler)
  // standing in for the source's spring library, since only two scalars
  // need it. The dot at top switches from the site's accent color to white
  // once the tracked content has scrolled past its own top edge.
  // ---------------------------------------------------------------------
  safe(function initTracingBeam() {
    const root = document.getElementById("tracing-beam");
    const content = document.getElementById("tracing-beam-content");
    if (!root || !content) return;
    const basePath = root.querySelector(".tracing-beam-path-base");
    const gradPath = root.querySelector(".tracing-beam-path-gradient");
    const gradient = root.querySelector("#tracing-beam-gradient");
    const dotInner = root.querySelector(".tracing-beam-dot-inner");
    const svg = root.querySelector(".tracing-beam-svg");
    if (!basePath || !gradPath || !gradient || !dotInner || !svg) return;

    const TENSION = 80;
    const FRICTION = 26;
    let svgHeight = 0;
    let scrollYProgress = 0;
    let scrollPercentage = 0;
    let y1 = 0, y2 = 0, v1 = 0, v2 = 0;
    let lastNow = null;

    function pathFor(h) {
      return `M 1 0V -36 l 18 24 V ${h * 0.8} l -18 24V ${h}`;
    }

    function mapRange(value, inMin, inMax, outMin, outMax) {
      if (inMax === inMin) return outMin;
      return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
    }

    function updateScroll() {
      const rect = root.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      scrollPercentage = (windowHeight - rect.top) / (windowHeight + rect.height);
      scrollYProgress = (rect.y / windowHeight) * -1;
      dotInner.classList.toggle("at-top", scrollYProgress > 0);
    }

    function updateSvgHeight() {
      svgHeight = content.offsetHeight;
      const d = pathFor(svgHeight);
      svg.setAttribute("viewBox", `0 0 20 ${svgHeight}`);
      svg.setAttribute("height", String(svgHeight));
      basePath.setAttribute("d", d);
      gradPath.setAttribute("d", d);
    }

    window.addEventListener("scroll", () => safe(updateScroll), { passive: true });
    window.addEventListener("resize", () => safe(() => { updateScroll(); updateSvgHeight(); }));
    if (window.ResizeObserver) {
      new ResizeObserver(() => safe(updateSvgHeight)).observe(content);
    }
    updateScroll();
    updateSvgHeight();

    function frame(now) {
      if (lastNow === null) lastNow = now;
      const dt = Math.min((now - lastNow) / 1000, 0.05);
      lastNow = now;

      const targetY1 = mapRange(scrollYProgress, 0, 0.8, scrollYProgress, svgHeight) * (1.4 - scrollPercentage);
      const targetY2 = mapRange(scrollYProgress, 0, 1, scrollYProgress, svgHeight - 500) * (1.4 - scrollPercentage);

      // Semi-implicit Euler spring integrator (mass = 1): a stand-in for
      // the source's useSpring(tension, friction), close enough for a
      // decorative gradient position with no need to match bit-for-bit.
      v1 += (-TENSION * (y1 - targetY1) - FRICTION * v1) * dt;
      y1 += v1 * dt;
      v2 += (-TENSION * (y2 - targetY2) - FRICTION * v2) * dt;
      y2 += v2 * dt;

      gradient.setAttribute("y1", String(y1));
      gradient.setAttribute("y2", String(y2));

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
