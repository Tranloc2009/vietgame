"use strict";
const SFX_STORAGE_KEY = "vdn_campaign_sfx_muted_v1";
const sfx = {
  ctx: null,
  muted: false,
  init() {
    try {
      this.muted = localStorage.getItem(SFX_STORAGE_KEY) === "1";
    } catch {}
    this.syncButton();
  },
  ensureContext() {
    if (this.muted) return null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!this.ctx) this.ctx = new AC();
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return this.ctx;
    } catch {
      return null;
    }
  },
  tone(freq, startOffset, duration, gainPeak = 0.045, type = "triangle") {
    const ac = this.ensureContext();
    if (!ac) return;
    try {
      const now = ac.currentTime + startOffset;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(gainPeak, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    } catch {}
  },
  play(kind) {
    if (this.muted) return;
    switch (kind) {
      case "build":
        this.tone(330, 0, 0.09, 0.04, "triangle");
        this.tone(440, 0.07, 0.12, 0.04, "triangle");
        break;
      case "mobilize":
        this.tone(392, 0, 0.08, 0.045, "sine");
        this.tone(523, 0.08, 0.14, 0.045, "sine");
        break;
      case "move":
        this.tone(587, 0, 0.06, 0.035, "sine");
        this.tone(740, 0.06, 0.09, 0.03, "sine");
        break;
      case "stack":
        this.tone(440, 0, 0.06, 0.04, "triangle");
        this.tone(554, 0.05, 0.06, 0.04, "triangle");
        this.tone(659, 0.1, 0.1, 0.04, "triangle");
        break;
      case "war":
        this.tone(196, 0, 0.2, 0.055, "sawtooth");
        this.tone(164, 0.18, 0.28, 0.055, "sawtooth");
        break;
      case "victory":
        this.tone(523, 0, 0.12, 0.05, "triangle");
        this.tone(659, 0.11, 0.12, 0.05, "triangle");
        this.tone(784, 0.22, 0.25, 0.055, "triangle");
        break;
      case "error":
        this.tone(180, 0, 0.09, 0.04, "square");
        this.tone(140, 0.1, 0.11, 0.04, "square");
        break;
      default:
        this.tone(520, 0, 0.035, 0.025, "sine");
        break;
    }
  },
  toggle() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(SFX_STORAGE_KEY, this.muted ? "1" : "0");
    } catch {}
    this.syncButton();
    if (!this.muted) this.play("click");
  },
  syncButton() {
    const btn = document.querySelector("#soundToggle");
    if (!btn) return;
    btn.setAttribute("aria-pressed", String(!this.muted));
    btn.classList.toggle("muted", this.muted);
    btn.title = this.muted ? "Bật âm thanh" : "Tắt âm thanh";
    const icon = btn.querySelector("i");
    if (icon && typeof icons !== "undefined") {
      icon.innerHTML =
        '<svg aria-hidden="true" viewBox="0 0 24 24">' +
        (this.muted ? icons.soundOff : icons.soundOn) +
        "</svg>";
    }
  },
};
