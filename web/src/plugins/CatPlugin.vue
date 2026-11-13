<script setup>
/**
 * A cat that lives in the dashboard.
 *  - Its head and eyes follow the mouse pointer anywhere on the page.
 *  - Move the pointer close and it randomly swats at it with the paw on that side.
 *  - Click it: it jumps and mews. Keep clicking: it purrs and head-butts.
 * Drawn as inline SVG and animated with requestAnimationFrame; the sounds are synthesised with Web Audio
 * (no audio files). Settings: "sound" and "swat distance".
 */
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';

const props = defineProps({ config: { type: Object, required: true }, instanceId: { type: String, default: '' } });

const svg = ref(null);

// ---- animated pose (everything the template draws) ------------------------
const pose = reactive({
  lookX: 0, // -1..1  where the head/eyes are turned (smoothed)
  lookY: 0,
  excite: 0, // 0..1   how close the pointer is (dilates the pupils, makes the tail flick)
  blink: 0, // 0 open .. 1 closed
  swat: 0, // 0 paw down .. 1 paw fully extended at the pointer (overshoots a little)
  swatSide: 'l',
  swatTheta: 0, // radians, direction of the swat for the active paw
  bounce: 0, // >0 in the air, <0 landing squash
  butt: 0, // head-butt: <0 pulls back, 1 = full thrust
  buttDir: 1,
  mouth: 0, // 0 closed .. 1 wide open
  purr: 0, // 0..1 (eased) - squinting eyes, body trembles
  t: 0, // seconds, drives idle motion
});
const bubble = ref('');

// ---- keyframe tracks -------------------------------------------------------
/** tracks[name] = { t0, frames: [[ms, value], ...], onDone }. Values ease between frames. */
const tracks = {};
function play(name, frames, onDone) {
  tracks[name] = { t0: performance.now(), frames, onDone };
}
function stepTracks(now) {
  for (const [name, tr] of Object.entries(tracks)) {
    const t = now - tr.t0;
    const f = tr.frames;
    let v;
    if (t >= f[f.length - 1][0]) {
      v = f[f.length - 1][1];
      delete tracks[name];
      pose[name] = v;
      tr.onDone?.();
      continue;
    }
    let i = 1;
    while (f[i][0] < t) i++;
    const [t0, v0] = f[i - 1];
    const [t1, v1] = f[i];
    const u = (t - t0) / (t1 - t0);
    v = v0 + (v1 - v0) * (u * u * (3 - 2 * u)); // smoothstep
    pose[name] = v;
  }
}

// ---- pointer ---------------------------------------------------------------
let mouse = null; // { x, y } client coordinates, null when the pointer left the window
const onMove = (e) => (mouse = { x: e.clientX, y: e.clientY });
const onLeave = () => (mouse = null);

/** client px -> svg user units */
function toSvg(x, y) {
  const el = svg.value;
  const m = el?.getScreenCTM();
  if (!m) return null;
  const p = new DOMPoint(x, y).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}
const HEAD = { x: 100, y: 92 };

// ---- main loop -------------------------------------------------------------
let raf = 0;
let last = 0;
let nextBlink = 0;
let swatCooldownUntil = 0;
let swatting = false;
let purrUntil = 0;

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - (last || now)) / 1000);
  last = now;
  pose.t += dt;
  stepTracks(now);

  // where is the pointer, relative to the cat?
  let tx = 0;
  let ty = 0;
  let near = 0;
  let sv = null;
  if (mouse && svg.value) {
    sv = toSvg(mouse.x, mouse.y);
    const head = svg.value.getScreenCTM();
    if (sv && head) {
      const dx = sv.x - HEAD.x;
      const dy = sv.y - HEAD.y;
      const len = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, len / 110);
      tx = (dx / len) * k;
      ty = (dy / len) * k;
      // proximity in screen pixels (so the setting means the same thing at any plugin size)
      const screenHead = new DOMPoint(HEAD.x, HEAD.y).matrixTransform(head);
      const px = Math.hypot(mouse.x - screenHead.x, mouse.y - screenHead.y);
      const range = Math.max(40, Number(props.config.swatDistance) || 130);
      near = px < range ? 1 - px / range : 0;
    }
  }
  const ease = 1 - Math.exp(-dt * 9);
  pose.lookX += (tx - pose.lookX) * ease;
  pose.lookY += (ty - pose.lookY) * ease;
  pose.excite += (near - pose.excite) * (1 - Math.exp(-dt * 6));

  const purring = now < purrUntil;
  pose.purr += ((purring ? 1 : 0) - pose.purr) * (1 - Math.exp(-dt * 7));
  if (!purring && audio.purr) stopPurr();

  // blink now and then (not while purring - the eyes are shut anyway)
  if (now > nextBlink) {
    if (nextBlink) play('blink', [[0, 0], [70, 1], [150, 0]]);
    nextBlink = now + 2500 + Math.random() * 3500;
  }

  // swat: only when the pointer is close, at random, and not while the cat is being petted
  if (swatting && sv) {
    const side = pose.swatSide;
    const dx = sv.x - (side === 'l' ? 79 : 121);
    const dy = sv.y - 138;
    const raw = Math.atan2(-dx, dy);
    pose.swatTheta = side === 'l' ? clamp(raw, 0.35, 2.6) : clamp(raw, -2.6, -0.35);
  }
  if (sv && near > 0 && !swatting && !purring && !tracks.butt && now > swatCooldownUntil) {
    if (Math.random() < dt * (0.5 + near * 1.6)) startSwat(sv);
  }
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function startSwat(sv) {
  swatting = true;
  pose.swatSide = sv.x < HEAD.x ? 'l' : 'r';
  const double = Math.random() < 0.4;
  play(
    'swat',
    double
      ? [[0, 0], [150, 0.5], [240, 1.15], [310, 1], [420, 0.35], [510, 1.15], [580, 1], [900, 0]]
      : [[0, 0], [160, 0.5], [250, 1.15], [330, 1], [640, 0]],
    () => {
      swatting = false;
      swatCooldownUntil = performance.now() + 500 + Math.random() * 900;
    }
  );
}

// ---- clicking --------------------------------------------------------------
let clicks = 0;
let lastClick = -Infinity;
let bubbleTimer;

function say(text, ms = 1100) {
  bubble.value = text;
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => (bubble.value = ''), ms);
}

function onClick() {
  const now = performance.now();
  clicks = now - lastClick < 2200 ? clicks + 1 : 1;
  lastClick = now;
  delete tracks.swat; // the cat forgets about swatting when it gets attention
  pose.swat = 0;
  swatting = false;
  swatCooldownUntil = now + 1500;

  if (clicks < 3) {
    play('bounce', [[0, 0], [110, 1], [260, 0], [330, -0.5], [450, 0]]);
    play('mouth', [[0, 0], [90, 1], [420, 1], [560, 0]]);
    say('Mew!');
    mew();
  } else {
    purrUntil = now + 3500;
    pose.buttDir = -pose.buttDir || 1;
    play('butt', [[0, 0], [130, -0.45], [250, 1], [340, 1], [700, 0]]);
    play('mouth', [[0, 0]]); // closed
    say('Prrr…', 1400);
    startPurr();
  }
}

// ---- sound (Web Audio, synthesised) ---------------------------------------
const audio = { ctx: null, master: null, purr: null };
const soundOn = () => props.config.sound !== false;

function ensureAudio() {
  if (!soundOn()) return null;
  try {
    if (!audio.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio.ctx = new AC();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.7;
      audio.master.connect(audio.ctx.destination);
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return audio.ctx;
  } catch {
    return null;
  }
}

/** A meow: a sawtooth with a rising-then-falling pitch, shaped by two vowel-like band-pass filters. */
function mew() {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t = ctx.currentTime;
  const base = 480 * (0.9 + Math.random() * 0.25);
  const dur = 0.5 + Math.random() * 0.18;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(base, t);
  osc.frequency.exponentialRampToValueAtTime(base * 1.8, t + dur * 0.35);
  osc.frequency.exponentialRampToValueAtTime(base * 1.1, t + dur);
  const vib = ctx.createOscillator(); // slight wobble
  const vibGain = ctx.createGain();
  vib.frequency.value = 6;
  vibGain.gain.value = 9;
  vib.connect(vibGain).connect(osc.frequency);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.32, t + 0.06);
  env.gain.setValueAtTime(0.32, t + dur * 0.55);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  env.connect(audio.master);

  for (const [freq, q, g] of [[900, 5, 1], [2300, 7, 0.55]]) {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq * 0.8, t);
    f.frequency.linearRampToValueAtTime(freq * 1.25, t + dur * 0.4); // "mee-ow": the vowel opens up
    f.frequency.linearRampToValueAtTime(freq * 0.9, t + dur);
    f.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = g;
    osc.connect(f).connect(gain).connect(env);
  }
  osc.start(t);
  vib.start(t);
  osc.stop(t + dur + 0.05);
  vib.stop(t + dur + 0.05);
}

/** A purr: low rumbling noise whose volume pulses ~25 times a second. */
function startPurr() {
  if (audio.purr) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let lastOut = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + 0.02 * white) / 1.02; // brown noise
    d[i] = lastOut * 3.5;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 160;
  band.Q.value = 0.8;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  const lfo = ctx.createOscillator();
  const lfoDepth = ctx.createGain();
  lfo.frequency.value = 25;
  lfoDepth.gain.value = 0.5;
  lfo.connect(lfoDepth).connect(amp.gain);
  const level = ctx.createGain();
  level.gain.setValueAtTime(0.0001, ctx.currentTime);
  level.gain.exponentialRampToValueAtTime(0.9, ctx.currentTime + 0.35);
  src.connect(band).connect(amp).connect(level).connect(audio.master);
  src.start();
  lfo.start();
  audio.purr = { src, lfo, level };
}

function stopPurr() {
  const p = audio.purr;
  if (!p) return;
  audio.purr = null;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  p.level.gain.cancelScheduledValues(t);
  p.level.gain.setValueAtTime(Math.max(0.0001, p.level.gain.value), t);
  p.level.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  p.src.stop(t + 0.55);
  p.lfo.stop(t + 0.55);
}

// ---- lifecycle -------------------------------------------------------------
onMounted(() => {
  window.addEventListener('pointermove', onMove, { passive: true });
  document.documentElement.addEventListener('mouseleave', onLeave);
  raf = requestAnimationFrame(frame);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  clearTimeout(bubbleTimer);
  window.removeEventListener('pointermove', onMove);
  document.documentElement.removeEventListener('mouseleave', onLeave);
  stopPurr();
  audio.ctx?.close().catch(() => {});
  audio.ctx = null;
});

// ---- template values -------------------------------------------------------
const deg = (rad) => (rad * 180) / Math.PI;

const rootTransform = computed(() => {
  const b = pose.bounce;
  const breathe = Math.sin(pose.t * 2.2) * 0.012;
  const sy = 1 + (b > 0 ? 0.06 * b : 0.14 * b) + breathe;
  const sx = 1 - (b > 0 ? 0.04 * b : 0.1 * b);
  const shake = Math.sin(pose.t * 70) * 0.7 * pose.purr; // purring trembles
  return `translate(${shake.toFixed(2)} ${(-14 * Math.max(0, b)).toFixed(2)}) translate(100 192) scale(${sx.toFixed(3)} ${sy.toFixed(3)}) translate(-100 -192)`;
});

const headTransform = computed(() => {
  const b = pose.butt;
  const s = 1 + 0.2 * b;
  const rot = pose.lookX * 9 + pose.buttDir * 7 * b;
  const x = pose.lookX * 5 + pose.buttDir * 4 * Math.max(0, b);
  const y = pose.lookY * 3 + 9 * Math.max(0, b) + 3 * Math.min(0, b);
  return `translate(${x.toFixed(2)} ${y.toFixed(2)}) translate(100 122) rotate(${rot.toFixed(2)}) scale(${s.toFixed(3)}) translate(-100 -122)`;
});

const tailTransform = computed(() => {
  const a = Math.sin(pose.t * 1.7) * 8 + Math.sin(pose.t * 8) * 12 * pose.excite + Math.sin(pose.t * 2.6) * 5 * pose.purr;
  return `rotate(${a.toFixed(2)} 142 178)`;
});

const arm = (side) =>
  computed(() => {
    const px = side === 'l' ? 79 : 121;
    const active = pose.swatSide === side;
    const k = active ? pose.swat : 0;
    const angle = deg(pose.swatTheta) * k;
    const ext = 1 + 0.3 * Math.max(0, k);
    return `translate(${px} 138) rotate(${angle.toFixed(2)}) scale(1 ${ext.toFixed(3)}) translate(${-px} -138)`;
  });
const armL = arm('l');
const armR = arm('r');

const happy = computed(() => pose.purr > 0.5);
const eyeScale = computed(() => Math.max(0.08, 1 - pose.blink));
const pupilW = computed(() => 3.4 + 3.2 * pose.excite);
const pupilDx = computed(() => pose.lookX * 3.2);
const pupilDy = computed(() => pose.lookY * 3.2);
const mouthH = computed(() => pose.mouth * 8);
</script>

<template>
  <div class="relative h-full min-h-0 w-full select-none">
    <svg
      ref="svg"
      viewBox="0 0 200 200"
      preserveAspectRatio="xMidYMax meet"
      class="absolute inset-0 h-full w-full cursor-pointer"
      role="img"
      aria-label="A cat that follows the mouse. Click it."
      @click="onClick"
    >
      <ellipse cx="100" cy="194" rx="62" ry="6" fill="#000" opacity="0.28" />

      <g :transform="rootTransform">
        <!-- tail -->
        <g :transform="tailTransform">
          <path d="M142 178 C 180 184, 194 150, 178 116" fill="none" stroke="#7a3f17" stroke-width="15" stroke-linecap="round" />
          <path d="M142 178 C 180 184, 194 150, 178 116" fill="none" stroke="#e8964a" stroke-width="12" stroke-linecap="round" />
          <path d="M184 142 l-9 3 M187 158 l-10 1" stroke="#b8672a" stroke-width="3" stroke-linecap="round" />
        </g>

        <!-- body + haunches -->
        <ellipse cx="62" cy="168" rx="21" ry="23" fill="#e8964a" stroke="#7a3f17" stroke-width="1.5" />
        <ellipse cx="138" cy="168" rx="21" ry="23" fill="#e8964a" stroke="#7a3f17" stroke-width="1.5" />
        <ellipse cx="100" cy="150" rx="50" ry="42" fill="#e8964a" stroke="#7a3f17" stroke-width="1.5" />
        <ellipse cx="100" cy="158" rx="26" ry="30" fill="#fbe3c2" />
        <path d="M54 134 l9 4 M52 148 l10 2 M146 134 l-9 4 M148 148 l-10 2" stroke="#b8672a" stroke-width="3.5" stroke-linecap="round" />
        <ellipse cx="62" cy="191" rx="15" ry="6" fill="#e8964a" stroke="#7a3f17" stroke-width="1.5" />
        <ellipse cx="138" cy="191" rx="15" ry="6" fill="#e8964a" stroke="#7a3f17" stroke-width="1.5" />

        <!-- front legs (the one on the pointer's side does the swatting) -->
        <g :transform="armL">
          <rect x="70" y="136" width="18" height="48" rx="9" fill="#e8964a" stroke="#7a3f17" stroke-width="1.5" />
          <ellipse cx="79" cy="186" rx="11.5" ry="7" fill="#fbe3c2" stroke="#7a3f17" stroke-width="1.5" />
          <path d="M75 187 v3 M79 188 v3 M83 187 v3" stroke="#7a3f17" stroke-width="1" stroke-linecap="round" />
        </g>
        <g :transform="armR">
          <rect x="112" y="136" width="18" height="48" rx="9" fill="#e8964a" stroke="#7a3f17" stroke-width="1.5" />
          <ellipse cx="121" cy="186" rx="11.5" ry="7" fill="#fbe3c2" stroke="#7a3f17" stroke-width="1.5" />
          <path d="M117 187 v3 M121 188 v3 M125 187 v3" stroke="#7a3f17" stroke-width="1" stroke-linecap="round" />
        </g>

        <!-- head -->
        <g :transform="headTransform">
          <path d="M60 72 L54 32 L90 54 Z" fill="#e8964a" stroke="#7a3f17" stroke-width="1.5" stroke-linejoin="round" />
          <path d="M140 72 L146 32 L110 54 Z" fill="#e8964a" stroke="#7a3f17" stroke-width="1.5" stroke-linejoin="round" />
          <path d="M63 64 L60 42 L80 55 Z" fill="#f4a3a3" />
          <path d="M137 64 L140 42 L120 55 Z" fill="#f4a3a3" />
          <ellipse cx="100" cy="90" rx="47" ry="38" fill="#e8964a" stroke="#7a3f17" stroke-width="1.5" />
          <path d="M100 54 v13 M89 56 l2 11 M111 56 l-2 11" stroke="#b8672a" stroke-width="3.2" stroke-linecap="round" />
          <ellipse cx="100" cy="106" rx="19" ry="12" fill="#fbe3c2" />

          <!-- eyes -->
          <template v-if="!happy">
            <g v-for="cx in [80, 120]" :key="cx" :transform="`translate(${cx} 86) scale(1 ${eyeScale}) translate(${-cx} -86)`">
              <ellipse :cx="cx" cy="86" rx="11" ry="12" fill="#f6f3e4" stroke="#7a3f17" stroke-width="1" />
              <ellipse :cx="cx + pupilDx" :cy="86 + pupilDy" rx="7.2" ry="9.4" fill="#8fd16a" />
              <ellipse :cx="cx + pupilDx" :cy="86 + pupilDy" :rx="pupilW" ry="8.6" fill="#15110d" />
              <circle :cx="cx + pupilDx - 2.5" :cy="86 + pupilDy - 3.5" r="1.8" fill="#fff" />
            </g>
          </template>
          <template v-else>
            <path d="M69 89 Q80 76 91 89" fill="none" stroke="#3b1c08" stroke-width="3.2" stroke-linecap="round" />
            <path d="M109 89 Q120 76 131 89" fill="none" stroke="#3b1c08" stroke-width="3.2" stroke-linecap="round" />
          </template>

          <!-- nose, mouth, whiskers -->
          <path d="M94 98 h12 l-6 7 z" fill="#e87a8a" stroke="#7a3f17" stroke-width="0.8" stroke-linejoin="round" />
          <path d="M100 105 v4 M100 109 q-6 7 -13 2 M100 109 q6 7 13 2" fill="none" stroke="#3b1c08" stroke-width="1.8" stroke-linecap="round" />
          <ellipse v-if="mouthH > 0.4" cx="100" cy="115" rx="6.5" :ry="mouthH" fill="#7a1f2b" />
          <path d="M80 104 L42 97 M80 108 L40 109 M80 112 L44 121 M120 104 L158 97 M120 108 L160 109 M120 112 L156 121" stroke="#fff" stroke-opacity="0.75" stroke-width="1.2" stroke-linecap="round" />
        </g>
      </g>
    </svg>

    <Transition
      enter-active-class="transition duration-150"
      enter-from-class="scale-75 opacity-0"
      leave-active-class="transition duration-300"
      leave-to-class="opacity-0"
    >
      <div
        v-if="bubble"
        class="pointer-events-none absolute right-1 top-1 rounded-2xl rounded-bl-sm border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-sm font-medium text-zinc-100 shadow-lg"
      >{{ bubble }}</div>
    </Transition>
  </div>
</template>
