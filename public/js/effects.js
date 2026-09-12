/*
 * Purely cosmetic effects: the singularity background, the cursor trail,
 * and the 3D tilt on result cards. Everything in this file is wrapped so a
 * failure here (an unsupported API, a slow device, whatever) can never break
 * app.js's actual data-fetching and rendering logic -- worst case, the page
 * just looks a little plainer.
 */

(function () {
  "use strict";

  function safe(fn) {
    try { fn(); } catch (e) { console.warn("[effects] skipped:", e); }
  }

  // ---------------------------------------------------------------------
  // Singularity background: a dark field with a slowly rotating
  // accretion-disk glow and a sparse starfield, sitting behind everything.
  // ---------------------------------------------------------------------
  safe(function initSingularityBackground() {
    const canvas = document.getElementById("bg-canvas");
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext("2d");
    let w, h, dpr;
    let stars = [];
    let t = 0;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(160, Math.floor((w * h) / 9000));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.4 + 0.3,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.8,
      }));
    }

    const cx = () => w * 0.82;
    const cy = () => h * -0.05;

    function drawDisk() {
      const centerX = cx(), centerY = cy();
      const rings = 3;
      for (let i = 0; i < rings; i++) {
        const radius = 260 + i * 150;
        const grad = ctx.createRadialGradient(centerX, centerY, radius * 0.15, centerX, centerY, radius);
        const angleShift = t * (0.05 + i * 0.02);
        grad.addColorStop(0, "rgba(129, 140, 248, 0.10)");
        grad.addColorStop(0.4, `rgba(56, 189, 248, ${0.07 - i * 0.015})`);
        grad.addColorStop(1, "rgba(5, 6, 15, 0)");
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(angleShift);
        ctx.translate(-centerX, -centerY);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // bright core
      const core = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 90);
      core.addColorStop(0, "rgba(224, 242, 255, 0.35)");
      core.addColorStop(1, "rgba(224, 242, 255, 0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 90, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawStars() {
      for (const s of stars) {
        const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(t * s.speed + s.phase));
        ctx.globalAlpha = twinkle * 0.7;
        ctx.fillStyle = "#dbeafe";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);
      drawDisk();
      drawStars();
      t += 0.006;
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
