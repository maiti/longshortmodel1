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
  // Dashboard singularity background: a full-viewport, continuously
  // warping plasma field (a classic multi-sine-wave technique, rendered
  // at low resolution and scaled up for a soft, shader-like look without
  // needing WebGL), mouse-reactive, plus a twinkling starfield on top.
  // Meant to be unmistakably animated -- an earlier, subtler version
  // (a couple of faint rotating gradients) was so faint it read as
  // "not there" rather than "animated but understated," so this trades
  // subtlety for being clearly, immediately visible, while staying dark
  // enough that the glass panels on top of it keep their own contrast.
  // ---------------------------------------------------------------------
  safe(function initSingularityBackground() {
    const canvas = document.getElementById("bg-canvas");
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    let w, h, dpr;
    let stars = [];
    let t = 0;
    let mouseX = 0.5, mouseY = 0.35; // fractional position, damped toward actual mouse
    let targetMouseX = mouseX, targetMouseY = mouseY;

    // Low-res plasma buffer, scaled up to fill the screen -- this is what
    // makes a per-pixel animated field affordable every frame.
    const BUFFER_W = 128;
    let bufferH = 72;
    const plasmaCanvas = document.createElement("canvas");
    const plasmaCtx = plasmaCanvas.getContext("2d", { willReadFrequently: true });
    let imageData = null;

    const hueBase = 222; // blue, matching the site's accretion-disk accent
    const speed = 1;
    const mouseSensitivity = 1.1;

    function hslToRgb(h360, s, l) {
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const hp = (h360 % 360) / 60;
      const x = c * (1 - Math.abs((hp % 2) - 1));
      let r = 0, g = 0, b = 0;
      if (hp < 1) { r = c; g = x; }
      else if (hp < 2) { r = x; g = c; }
      else if (hp < 3) { g = c; b = x; }
      else if (hp < 4) { g = x; b = c; }
      else if (hp < 5) { r = x; b = c; }
      else { r = c; b = x; }
      const m = l - c / 2;
      return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
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

      bufferH = Math.max(48, Math.round((BUFFER_W * h) / w));
      plasmaCanvas.width = BUFFER_W;
      plasmaCanvas.height = bufferH;
      imageData = plasmaCtx.createImageData(BUFFER_W, bufferH);

      const count = Math.min(140, Math.floor((w * h) / 11000));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.4 + 0.3,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.8,
      }));
    }

    window.addEventListener("mousemove", (e) => {
      targetMouseX = e.clientX / window.innerWidth;
      targetMouseY = e.clientY / window.innerHeight;
    });

    function drawPlasma() {
      mouseX += (targetMouseX - mouseX) * 0.015;
      mouseY += (targetMouseY - mouseY) * 0.015;
      const mx = 0.5 + (mouseX - 0.5) * mouseSensitivity;
      const my = 0.5 + (mouseY - 0.5) * mouseSensitivity;

      const data = imageData.data;
      for (let y = 0; y < bufferH; y++) {
        const ny = y / bufferH;
        for (let x = 0; x < BUFFER_W; x++) {
          const nx = x / BUFFER_W;
          const dx = nx - mx;
          const dy = ny - my;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const value =
            Math.sin(nx * 5.5 + t) +
            Math.sin(ny * 5.0 - t * 0.85) +
            Math.sin((nx + ny) * 4.5 + t * 1.2) +
            Math.sin(dist * 9.0 - t * 2.1);

          const hue = (hueBase + value * 26 + t * 4) % 360;
          const lightness = 0.05 + (Math.sin(value) * 0.5 + 0.5) * 0.085;
          const [r, g, b] = hslToRgb(hue < 0 ? hue + 360 : hue, 0.75, lightness);

          const idx = (y * BUFFER_W + x) * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = 255;
        }
      }
      plasmaCtx.putImageData(imageData, 0, 0);

      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(plasmaCanvas, 0, 0, BUFFER_W, bufferH, 0, 0, w, h);
    }

    function drawStars() {
      for (const s of stars) {
        const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(t * s.speed + s.phase));
        ctx.globalAlpha = twinkle * 0.8;
        ctx.fillStyle = "#f2f6ff";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    let firstFrameLogged = false;
    function frame() {
      drawPlasma();
      drawStars();
      t += 0.012 * speed;
      if (!firstFrameLogged) {
        firstFrameLogged = true;
        console.info("[effects] singularity background is running");
      }
      requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener("resize", () => safe(resize));
    requestAnimationFrame(frame);
  });

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
