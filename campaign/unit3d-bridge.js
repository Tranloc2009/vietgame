"use strict";
/**
 * T09 Military Visual Bridge:
 * - Connects the 2D Vietnam campaign map (#map) to the Three.js 2.5D WebGL unit overlay (#unit3d)
 *   using the 36 audited GLB models (12 ground models x 3 LODs) + explicit procedural fallbacks for
 *   the 4 missing GLB types (sam, fighter, corvette, submarine).
 * - Preserves 100% server-authoritative Fog-of-War by ONLY consuming `live.units`.
 * - Falls back cleanly to original SVG tactical portraits & 2D badges on file:// offline mode,
 *   no-WebGL browsers, or WebGL context loss.
 */
const unit3dBridge = (() => {
  const MODEL_NAMES = {
    NORTH: {
      reserve: "Bộ binh QĐNDVN",
      motor: "BTR-40 (Cấp I)",
      motor2: "BTR-60PB (Cấp II)",
      recon: "PT-76 Trinh sát",
      artillery: "Lựu pháo 122mm M-30",
      tank: "Xe tăng T-54/55",
      sam: "SAM phòng không (Dự phòng 2.5D)",
      fighter: "Tiêm kích (Dự phòng 2.5D)",
      corvette: "Tàu hộ vệ (Dự phòng 2.5D)",
      submarine: "Tàu ngầm (Dự phòng 2.5D)",
    },
    SOUTH: {
      reserve: "Bộ binh QLVNCH",
      motor: "M113 APC (Cấp I)",
      motor2: "M113 ACAV (Cấp II)",
      recon: "V-100 Commando",
      artillery: "Lựu pháo 105mm M101A1",
      tank: "Xe tăng M48A3 Patton",
      sam: "SAM phòng không (Dự phòng 2.5D)",
      fighter: "Tiêm kích (Dự phòng 2.5D)",
      corvette: "Tàu hộ vệ (Dự phòng 2.5D)",
      submarine: "Tàu ngầm (Dự phòng 2.5D)",
    },
  };

  const HAS_GLB_KEYS = new Set(["reserve", "motor", "recon", "artillery", "tank"]);
  const svgPortraitCache = new Map();
  const cityOwnerSnapshot = new Map();
  const capturePulses = [];

  let overlay = null;
  let canvasEl = null;
  let rafId = 0;
  let scriptRequested = false;
  let prefEnabled = true;
  let benchmarkOverrideUnits = null;
  let lastMetrics = {
    rendererMode: "fallback-2d",
    enabled: true,
    webglContextLost: false,
    activeLod: "SYMBOL",
    zoom: 1,
    fps: 0,
    avgFrameMs: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    visibleUnits: 0,
    rendered3dInstances: 0,
    loadedGlbCount: 0,
    totalGlbCount: 36,
    missingGlbSlots: 8,
    initialLod2LoadMs: null,
    portraitsCached: 0,
  };

  try {
    const savedPref = localStorage.getItem("vdn_t09_3d_units");
    if (savedPref === "0") prefEnabled = false;
  } catch {}

  function isForcedNoWebGL() {
    if (typeof window === "undefined") return true;
    if (window.__VDN_FORCE_NO_WEBGL) return true;
    if (location.protocol === "file:") return true;
    try {
      const qs = new URLSearchParams(location.search);
      if (qs.get("nowebgl") === "1" || qs.get("webgl") === "0") return true;
    } catch {}
    return false;
  }

  function resolveUnitFaction(unit) {
    if (unit?.ownerNationId === "nat_south_rep") return "SOUTH";
    if (unit?.ownerNationId === "nat_north_dir") return "NORTH";
    if (typeof mp !== "undefined" && mp?.room?.viewerSlot === "SOUTH") {
      return unit?.owned === false ? "NORTH" : "SOUTH";
    }
    return unit?.owned === false ? "SOUTH" : "NORTH";
  }

  function resolveViewerFaction() {
    if (typeof mp !== "undefined" && mp?.room?.viewerSlot === "SOUTH") return "SOUTH";
    return "NORTH";
  }

  function resolveLearnedForUnit(unit) {
    if (!live?.learned) return [];
    if (live.online && unit?.owned === false) return [];
    return live.learned;
  }

  function getModelDisplayName(unitKey, faction, learned = []) {
    const fac = faction === "SOUTH" ? "SOUTH" : "NORTH";
    const lookupKey =
      unitKey === "motor" && Array.isArray(learned) && learned.includes("motor2")
        ? "motor2"
        : unitKey;
    return MODEL_NAMES[fac]?.[lookupKey] || unitKey;
  }

  function fallbackSvgPortrait(faction, unitKey, learned = []) {
    const upgraded = unitKey === "motor" && learned.includes("motor2");
    const cacheKey = faction + ":" + unitKey + ":" + (upgraded ? "2" : "1");
    if (svgPortraitCache.has(cacheKey)) return svgPortraitCache.get(cacheKey);

    const isNorth = faction !== "SOUTH";
    const bg1 = isNorth ? "#312420" : "#1d2b36";
    const bg2 = isNorth ? "#1d2721" : "#1b2627";
    const armor = isNorth ? "#5f744c" : "#6b7556";
    const armorDark = isNorth ? "#3f4f33" : "#49523b";
    const accent = isNorth ? "#d94a3d" : "#d9a73e";
    const star = isNorth
      ? '<polygon points="18,14 20,19 25,19 21,22 22.5,27 18,24 13.5,27 15,22 11,19 16,19" fill="#f5cf58"/>'
      : '<rect x="11" y="15" width="16" height="10" fill="#d9a73e"/><line x1="11" y1="18" x2="27" y2="18" stroke="#b53328" stroke-width="1.4"/><line x1="11" y1="22" x2="27" y2="22" stroke="#b53328" stroke-width="1.4"/>';

    let shape = "";
    if (unitKey === "reserve") {
      shape =
        '<g transform="translate(46,16)">' +
        '<ellipse cx="26" cy="58" rx="22" ry="6" fill="#0d140e" opacity="0.5"/>' +
        '<circle cx="14" cy="24" r="6" fill="' + armor + '"/><path d="M8 31h12l3 24H5z" fill="' + armorDark + '"/>' +
        '<circle cx="36" cy="22" r="6.5" fill="' + armor + '"/><path d="M29 29h14l3 26H26z" fill="' + armor + '"/><line x1="36" y1="34" x2="54" y2="27" stroke="#222" stroke-width="2.5"/>' +
        "</g>";
    } else if (unitKey === "motor") {
      shape =
        '<g transform="translate(26,24)">' +
        '<ellipse cx="46" cy="48" rx="38" ry="8" fill="#0d140e" opacity="0.5"/>' +
        '<polygon points="10,40 18,22 68,20 82,32 82,42 10,42" fill="' + armor + '" stroke="' + armorDark + '" stroke-width="2"/>' +
        (upgraded
          ? '<rect x="34" y="11" width="22" height="11" rx="2" fill="' + armorDark + '"/><line x1="56" y1="15" x2="78" y2="13" stroke="#222" stroke-width="3"/><rect x="37" y="13" width="6" height="4" fill="' + accent + '"/>'
          : '<rect x="38" y="16" width="14" height="6" fill="' + armorDark + '"/><line x1="52" y1="18" x2="66" y2="16" stroke="#222" stroke-width="2"/>') +
        '<circle cx="22" cy="43" r="6" fill="#1d2221"/><circle cx="40" cy="43" r="6" fill="#1d2221"/><circle cx="58" cy="43" r="6" fill="#1d2221"/><circle cx="72" cy="43" r="6" fill="#1d2221"/>' +
        "</g>";
    } else if (unitKey === "recon") {
      shape =
        '<g transform="translate(26,25)">' +
        '<ellipse cx="46" cy="46" rx="36" ry="8" fill="#0d140e" opacity="0.5"/>' +
        '<polygon points="8,38 20,24 66,24 84,34 78,42 14,42" fill="' + armor + '" stroke="' + armorDark + '" stroke-width="2"/>' +
        '<ellipse cx="46" cy="22" rx="14" ry="7" fill="' + armorDark + '"/><line x1="58" y1="21" x2="88" y2="19" stroke="#222" stroke-width="2.6"/>' +
        '<rect x="18" y="40" width="56" height="6" rx="3" fill="#1d2221"/>' +
        "</g>";
    } else if (unitKey === "tank") {
      shape =
        '<g transform="translate(22,22)">' +
        '<ellipse cx="50" cy="50" rx="42" ry="9" fill="#0d140e" opacity="0.55"/>' +
        '<polygon points="10,40 18,27 78,27 88,38 82,46 14,46" fill="' + armor + '" stroke="' + armorDark + '" stroke-width="2"/>' +
        '<ellipse cx="48" cy="23" rx="19" ry="9" fill="' + armorDark + '"/><line x1="65" y1="21" x2="100" y2="18" stroke="#1d2221" stroke-width="4"/>' +
        '<rect x="14" y="43" width="70" height="8" rx="4" fill="#1b201f"/>' +
        "</g>";
    } else if (unitKey === "artillery") {
      shape =
        '<g transform="translate(24,26)">' +
        '<ellipse cx="48" cy="46" rx="36" ry="7" fill="#0d140e" opacity="0.45"/>' +
        '<line x1="12" y1="43" x2="48" y2="34" stroke="' + armorDark + '" stroke-width="5"/>' +
        '<polygon points="44,18 58,20 55,39 42,39" fill="' + armor + '"/>' +
        '<line x1="48" y1="27" x2="92" y2="11" stroke="#222" stroke-width="4.2"/>' +
        '<circle cx="48" cy="40" r="9" fill="#1e2221" stroke="' + armorDark + '" stroke-width="3"/>' +
        "</g>";
    } else if (unitKey === "sam") {
      shape =
        '<g transform="translate(24,22)">' +
        '<ellipse cx="48" cy="50" rx="38" ry="8" fill="#0d140e" opacity="0.5"/>' +
        '<rect x="16" y="34" width="62" height="14" rx="2" fill="' + armor + '"/>' +
        '<line x1="34" y1="34" x2="66" y2="10" stroke="' + accent + '" stroke-width="5"/>' +
        '<line x1="44" y1="34" x2="76" y2="12" stroke="#dce5d8" stroke-width="4"/>' +
        '<rect x="20" y="46" width="54" height="6" rx="3" fill="#1b201f"/>' +
        "</g>";
    } else if (unitKey === "fighter") {
      shape =
        '<g transform="translate(24,18)">' +
        '<ellipse cx="48" cy="58" rx="26" ry="5" fill="#0d140e" opacity="0.35"/>' +
        '<polygon points="10,34 46,24 88,28 52,38" fill="#8e9ea6" stroke="#36424a" stroke-width="1.5"/>' +
        '<polygon points="34,12 58,28 38,32" fill="#778791"/><polygon points="34,52 58,34 38,32" fill="#778791"/>' +
        '<polygon points="12,34 22,19 28,31" fill="' + accent + '"/>' +
        "</g>";
    } else if (unitKey === "corvette") {
      shape =
        '<g transform="translate(18,26)">' +
        '<ellipse cx="54" cy="46" rx="46" ry="7" fill="#133342" opacity="0.65"/>' +
        '<polygon points="8,36 20,44 90,44 102,32 14,32" fill="#526877" stroke="#2c3a44" stroke-width="1.5"/>' +
        '<rect x="38" y="20" width="24" height="12" fill="#637b8a"/><line x1="50" y1="20" x2="50" y2="9" stroke="' + accent + '" stroke-width="2.5"/>' +
        '<line x1="74" y1="30" x2="90" y2="26" stroke="#222" stroke-width="2.5"/>' +
        "</g>";
    } else {
      // submarine
      shape =
        '<g transform="translate(18,28)">' +
        '<ellipse cx="54" cy="44" rx="44" ry="7" fill="#0b2430" opacity="0.7"/>' +
        '<rect x="12" y="30" width="84" height="12" rx="6" fill="#2c3c45" stroke="#182228" stroke-width="1.5"/>' +
        '<rect x="46" y="18" width="16" height="13" rx="2" fill="#374b57"/><line x1="54" y1="18" x2="54" y2="11" stroke="' + accent + '" stroke-width="2"/>' +
        "</g>";
    }

    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 96">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' +
      bg1 +
      '"/><stop offset="100%" stop-color="' +
      bg2 +
      '"/></linearGradient></defs>' +
      '<rect width="144" height="96" fill="url(#g)"/>' +
      star +
      shape +
      (upgraded
        ? '<rect x="108" y="8" width="28" height="15" rx="2" fill="#c79e3b"/><text x="122" y="19" text-anchor="middle" font-size="10" font-weight="700" fill="#1d2219">II</text>'
        : "") +
      "</svg>";
    const dataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    svgPortraitCache.set(cacheKey, dataUrl);
    return dataUrl;
  }

  function getPortraitUrl(unitKey, faction, learned = []) {
    const fac = faction === "SOUTH" ? "SOUTH" : "NORTH";
    if (overlay && overlay.isWebGLActive()) {
      const baked = overlay.getPortraitUrl(fac, unitKey, learned);
      if (baked) return baked;
    }
    return fallbackSvgPortrait(fac, unitKey, learned);
  }

  function trackCityCaptures() {
    if (!live?.cities) return;
    const now = performance.now();
    for (const [name, city] of Object.entries(live.cities)) {
      const ownerTag = city.ownerNationId || (city.owned === false ? "enemy" : "own");
      const prev = cityOwnerSnapshot.get(name);
      if (prev && prev !== ownerTag) {
        const pt = typeof nodeByName !== "undefined" ? nodeByName.get(name) : null;
        if (pt) {
          capturePulses.push({
            lon: pt.lon,
            lat: pt.lat,
            startedAt: now,
            friendly: city.owned !== false,
          });
        }
      }
      cityOwnerSnapshot.set(name, ownerTag);
    }
    while (capturePulses.length > 0 && now - capturePulses[0].startedAt > 1500) {
      capturePulses.shift();
    }
  }

  function collectRenderableUnits() {
    if (benchmarkOverrideUnits) return benchmarkOverrideUnits;
    if (!live?.units || typeof pointAt !== "function" || typeof projectPoint !== "function") {
      return [];
    }
    const now = typeof simNow === "function" ? simNow() : Date.now();
    const groups = new Map();

    // Group units identically to army.js so 3D figure sits centered above the exact clickable pin
    for (const u of live.units) {
      const pos = pointAt(u, now);
      const [x, y] = projectPoint(pos.lon, pos.lat);
      const ownerTag = u.owned === false ? "enemy:" : "own:";
      const key = u.city
        ? ownerTag + "city:" + u.city
        : u.stackId
          ? ownerTag + "stack:" + u.stackId
          : ownerTag + "unit:" + u.id;

      let dx = 0;
      let dy = 0;
      if (u.trip && typeof travelSegment === "function") {
        const seg = travelSegment(u, now);
        const nextPt = seg.remaining?.[0];
        if (nextPt) {
          const [nx, ny] = projectPoint(nextPt.lon, nextPt.lat);
          dx = nx - x;
          dy = ny - y;
        }
      }

      if (!groups.has(key)) {
        groups.set(key, {
          id: u.id,
          key: u.key,
          faction: resolveUnitFaction(u),
          x,
          y,
          dx,
          dy,
          moving: Boolean(u.trip),
          selected: u.id === activeUnit,
          inCombat: Boolean(u.inCombat),
          hp: u.hp ?? 20,
          maxHp: u.maxHp ?? 20,
          stackCount: 1,
          learned: resolveLearnedForUnit(u),
        });
      } else {
        const g = groups.get(key);
        g.stackCount += 1;
        g.hp += u.hp ?? 20;
        g.maxHp += u.maxHp ?? 20;
        if (u.inCombat) g.inCombat = true;
        if (u.id === activeUnit) {
          // Promote selected member as hero 3D figure in the group!
          g.id = u.id;
          g.key = u.key;
          g.selected = true;
          g.learned = resolveLearnedForUnit(u);
          if (u.trip) {
            g.moving = true;
            g.dx = dx;
            g.dy = dy;
          }
        }
      }
    }
    return Array.from(groups.values());
  }

  function is3DVisibleNow() {
    if (!overlay || !overlay.isWebGLActive()) return false;
    const z = typeof camera !== "undefined" ? camera.z : 1;
    return z >= 1.55;
  }

  function renderFrame() {
    trackCityCaptures();
    const z = typeof camera !== "undefined" ? camera.z : 1;
    const now = performance.now();
    const renderUnits = collectRenderableUnits();

    if (!overlay) {
      lastMetrics = {
        ...lastMetrics,
        rendererMode: "fallback-2d",
        enabled: prefEnabled,
        zoom: Math.round(z * 100) / 100,
        activeLod: z < 1.55 ? "SYMBOL" : z < 2.45 ? "LOD2" : z < 3.6 ? "LOD1" : "LOD0",
        visibleUnits: renderUnits.length,
        rendered3dInstances: 0,
        drawCalls: 0,
        triangles: 0,
      };
      window.__VDN_VISUAL_METRICS = lastMetrics;
      return lastMetrics;
    }

    const screenPulses = capturePulses.map((p) => {
      const [px, py] = projectPoint(p.lon, p.lat);
      return { x: px, y: py, startedAt: p.startedAt, friendly: p.friendly };
    });

    lastMetrics = overlay.renderFrame(renderUnits, z, now, screenPulses);
    window.__VDN_VISUAL_METRICS = lastMetrics;
    return lastMetrics;
  }

  function tickLoop() {
    rafId = 0;
    if (document.hidden) return;
    const hasAnimated =
      Boolean(benchmarkOverrideUnits) ||
      capturePulses.length > 0 ||
      Boolean(
        live?.units?.some(
          (u) =>
            u.trip ||
            u.inCombat ||
            u.id === activeUnit ||
            (u.maxHp > 0 && u.hp / u.maxHp < 0.65),
        ),
      );

    if (is3DVisibleNow() && (hasAnimated || (live?.units?.length || 0) > 0)) {
      renderFrame();
      if (typeof drawUnits === "function" && live?.units?.some((u) => u.trip)) {
        drawUnits();
      }
      if (hasAnimated) {
        rafId = requestAnimationFrame(tickLoop);
      }
    } else if (capturePulses.length > 0) {
      if (typeof invalidate === "function") invalidate();
      rafId = requestAnimationFrame(tickLoop);
    }
  }

  function ensureAnimated() {
    if (!rafId && !document.hidden) {
      rafId = requestAnimationFrame(tickLoop);
    }
  }

  function initOverlay() {
    canvasEl = document.getElementById("unit3d");
    if (!canvasEl) return;

    const toggleEl = document.getElementById("toggle3dUnits");
    if (toggleEl instanceof HTMLInputElement) {
      toggleEl.checked = prefEnabled;
      toggleEl.onchange = () => {
        prefEnabled = toggleEl.checked;
        try {
          localStorage.setItem("vdn_t09_3d_units", prefEnabled ? "1" : "0");
        } catch {}
        if (overlay) overlay.setEnabled(prefEnabled);
        if (typeof drawUnits === "function") drawUnits();
        renderFrame();
      };
    }

    if (isForcedNoWebGL()) {
      canvasEl.style.display = "none";
      renderFrame();
      return;
    }

    const mount = () => {
      if (overlay || !window.VDNUnit3DEngine || !canvasEl) return;
      overlay = new window.VDNUnit3DEngine.CampaignUnit3DOverlay(canvasEl, {
        forceNoWebGL: isForcedNoWebGL(),
        onPortraitReady: () => {
          if (typeof renderMatch === "function") renderMatch();
          if (typeof renderArmy === "function") renderArmy();
        },
        onFallbackChange: () => {
          if (typeof drawUnits === "function") drawUnits();
          renderFrame();
        },
      });
      overlay.setEnabled(prefEnabled);
      if (typeof w !== "undefined" && typeof h !== "undefined") {
        overlay.resize(w, h, typeof dpr !== "undefined" ? dpr : window.devicePixelRatio || 1);
      }
      renderFrame();
      if (typeof drawUnits === "function") drawUnits();
      ensureAnimated();
    };

    if (window.VDNUnit3DEngine) {
      mount();
      return;
    }
    if (!scriptRequested) {
      scriptRequested = true;
      const script = document.createElement("script");
      script.src = "/assets/unit3d.bundle.js";
      script.async = true;
      script.onload = () => mount();
      script.onerror = () => {
        if (canvasEl) canvasEl.style.display = "none";
        renderFrame();
      };
      document.head.appendChild(script);
    }
  }

  function resize(width, height, ratio) {
    if (overlay) overlay.resize(width, height, ratio);
  }

  function drawFallbackEffects2D(ctx) {
    if (is3DVisibleNow() || capturePulses.length === 0) return;
    const now = performance.now();
    for (const p of capturePulses) {
      const age = (now - p.startedAt) / 1400;
      if (age < 0 || age > 1) continue;
      const [px, py] = projectPoint(p.lon, p.lat);
      ctx.save();
      ctx.strokeStyle = p.friendly
        ? "rgba(255,224,102," + (1 - age).toFixed(2) + ")"
        : "rgba(255,92,70," + (1 - age).toFixed(2) + ")";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(px, py, 8 + age * 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Non-destructive GPU/FPS stress benchmark (50 / 100 / 200 units) for T09 QA.
   * Never mutates game state, SQLite, or IndexedDB!
   */
  async function runStressBenchmark(unitCount, options = {}) {
    const durationFrames = options.frames || 45;
    const zoom = options.zoom || 2.6;
    const prevZoom = typeof camera !== "undefined" ? camera.z : 1;
    if (typeof camera !== "undefined") {
      camera.z = zoom;
      if (typeof draw === "function") draw();
    }

    const keys = ["reserve", "motor", "recon", "artillery", "tank", "sam", "fighter", "corvette", "submarine"];
    const synthetic = [];
    const pad = 70;
    const viewW = typeof w !== "undefined" ? w : window.innerWidth;
    const viewH = typeof h !== "undefined" ? h : window.innerHeight;
    const cols = Math.max(5, Math.ceil(Math.sqrt(unitCount * (viewW / Math.max(1, viewH)))));
    const rows = Math.max(1, Math.ceil(unitCount / cols));

    for (let i = 0; i < unitCount; i += 1) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = pad + ((col + 0.5) / cols) * Math.max(100, viewW - pad * 2);
      const y = pad + ((row + 0.5) / rows) * Math.max(100, viewH - pad * 2);
      const fac = i % 2 === 0 ? "NORTH" : "SOUTH";
      const k = keys[i % keys.length];
      synthetic.push({
        id: "bench_" + i,
        key: k,
        faction: fac,
        x,
        y,
        dx: Math.cos(i * 0.7),
        dy: Math.sin(i * 0.7),
        moving: i % 3 !== 0,
        selected: i === 0,
        inCombat: i % 7 === 0,
        hp: i % 5 === 0 ? 10 : 24,
        maxHp: 24,
        stackCount: 1,
        learned: i % 4 === 0 ? ["motor", "motor2"] : ["motor"],
      });
    }

    benchmarkOverrideUnits = synthetic;
    const frameDeltas = [];
    const renderTimes = [];
    let lastTs = performance.now();
    let sampleMetrics = null;

    await new Promise((resolve) => {
      let count = 0;
      const step = (ts) => {
        const dt = ts - lastTs;
        lastTs = ts;
        if (count > 2) frameDeltas.push(dt);
        // Slightly animate synthetic unit positions for realistic per-frame transform updates
        for (let i = 0; i < synthetic.length; i += 1) {
          synthetic[i].x += Math.sin(ts * 0.002 + i) * 0.15;
          synthetic[i].y += Math.cos(ts * 0.002 + i) * 0.15;
        }
        const t0 = performance.now();
        const m = renderFrame();
        const t1 = performance.now();
        if (count > 2) renderTimes.push(t1 - t0);
        // Clone metrics snapshot BEFORE restoring normal state after the loop!
        sampleMetrics = { ...m };
        count += 1;
        if (count >= durationFrames) {
          resolve();
        } else {
          requestAnimationFrame(step);
        }
      };
      requestAnimationFrame(step);
    });

    benchmarkOverrideUnits = null;
    if (typeof camera !== "undefined") {
      camera.z = prevZoom;
      if (typeof draw === "function") draw();
    }
    renderFrame();

    const avgMs = frameDeltas.length
      ? frameDeltas.reduce((a, b) => a + b, 0) / frameDeltas.length
      : 16.7;
    const avgRenderMs = renderTimes.length
      ? renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length
      : 0;
    const fps = Math.round((1000 / Math.max(1, avgMs)) * 10) / 10;
    const jsHeapMb =
      performance.memory && typeof performance.memory.usedJSHeapSize === "number"
        ? Math.round((performance.memory.usedJSHeapSize / (1024 * 1024)) * 10) / 10
        : null;
    return {
      unitCount,
      zoom,
      rendererMode: sampleMetrics?.rendererMode || "fallback-2d",
      activeLod: sampleMetrics?.activeLod || "SYMBOL",
      fps,
      avgFrameMs: Math.round(avgMs * 100) / 100,
      avgRenderSubmitMs: Math.round(avgRenderMs * 100) / 100,
      drawCalls: sampleMetrics?.drawCalls ?? 0,
      triangles: sampleMetrics?.triangles ?? 0,
      rendered3dInstances: sampleMetrics?.rendered3dInstances ?? 0,
      geometries: sampleMetrics?.geometries ?? 0,
      textures: sampleMetrics?.textures ?? 0,
      jsHeapMb,
      loadedGlbCount: sampleMetrics?.loadedGlbCount ?? 0,
      initialLod2LoadMs: sampleMetrics?.initialLod2LoadMs ?? null,
    };
  }

  const api = {
    init: initOverlay,
    resize,
    renderFrame,
    ensureAnimated,
    is3DVisibleNow,
    getPortraitUrl,
    getModelDisplayName,
    resolveUnitFaction,
    resolveViewerFaction,
    hasGlb: (key) => HAS_GLB_KEYS.has(key),
    drawFallbackEffects2D,
    getMetrics: () => lastMetrics,
    simulateContextLoss: () => (overlay ? overlay.simulateContextLossForTest() : false),
    simulateContextRestore: () => (overlay ? overlay.simulateContextRestoreForTest() : false),
    runStressBenchmark,
    getManifest: () => window.VDNUnit3DEngine?.manifest || null,
  };

  window.__VDN_UNIT3D = api;
  window.__VDN_VISUAL_METRICS = lastMetrics;
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) ensureAnimated();
  });

  return api;
})();
