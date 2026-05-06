import * as THREE from "https://esm.sh/three@0.160.0";

const saveSvgBtn = document.getElementById("saveSvgBtn");
const saveGifBtn = document.getElementById("saveGifBtn");
const resetBtn = document.getElementById("resetBtn");
const instabilityLayer = document.getElementById("instabilityLayer");

const input = document.getElementById("textInput");
const output = document.getElementById("output");
const outputBox = document.getElementById("outputBox");
const typeface = document.getElementById("typeface");
const effectCanvas = document.getElementById("effectCanvas");
const degradationCanvas = document.getElementById("degradationCanvas");
const breakdownCanvas = document.getElementById("breakdownCanvas");
const chromaticCanvas = document.getElementById("chromaticCanvas");

// All effect slider IDs
const EFFECT_SLIDERS = [
  'distortion_wave', 'distortion_chromatic', 'distortion_fluid',
  'instability_echo', 'instability_wireframe', 'instability_drift',
  'degradation_smear', 'degradation_gaussian', 'degradation_zoom',
  'breakdown_fragmentation', 'breakdown_density', 'breakdown_noise'
];

function sv(id) {
  const el = document.getElementById(id);
  return el ? Number(el.value) / 100 : 0;
}

// ------------------------
// BASIC TEXT
// ------------------------
function getDisplayText() {
  return input.value || "reality";
}

// Current font weight — default 400, updated by weight selector
let currentFontWeight = 400; // default: Regular

function syncPlainText() {
  const text = getDisplayText();
  const font = typeface.value;
  output.textContent = text;
  output.style.fontFamily = font;
  output.style.fontWeight = currentFontWeight;
  const r = document.getElementById("chromatic-r");
  const b = document.getElementById("chromatic-b");
  r.textContent = text;
  b.textContent = text;
  r.style.fontFamily = font;
  b.style.fontFamily = font;
  r.style.fontWeight = currentFontWeight;
  b.style.fontWeight = currentFontWeight;
}

// Wire weight selector buttons
document.querySelectorAll('.weight-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.weight-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFontWeight = parseInt(btn.dataset.weight);
    syncPlainText();
    if (typeof webglReady !== 'undefined' && webglReady) updateTextTexture();
  });
});

input.addEventListener("input", () => {
  syncPlainText();
  if (webglReady) updateTextTexture();
});

typeface.addEventListener("change", () => {
  syncPlainText();
  if (webglReady) updateTextTexture();
});

// ── SLIDER FILL UPDATE ──
const THUMB_W = 80;

function updateSliderFill(sliderId) {
  const sl = document.getElementById(sliderId);
  const fillId = sliderId.replace('_', 'Fill_');
  const fill = document.getElementById(fillId);
  if (!sl || !fill) return;
  const pct = Number(sl.value) / 100;
  const wrap = sl.closest('.slider-wrap');
  if (!wrap) return;
  const trackWidth = wrap.offsetWidth - 28;
  const travel = trackWidth - THUMB_W;
  fill.style.left = `${14 + pct * travel}px`;
}

EFFECT_SLIDERS.forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', () => {
      updateSliderFill(id);
      handleModeChange();
    });
    updateSliderFill(id);
  }
});

window.addEventListener('resize', () => {
  EFFECT_SLIDERS.forEach(updateSliderFill);
});

syncPlainText();

// ── Custom typeface dropdown wiring ──
(function() {
  const dropdown  = document.getElementById('typefaceDropdown');
  const menu      = document.getElementById('typefaceMenu');
  const selected  = document.getElementById('typefaceSelected');
  const nativeSelect = document.getElementById('typeface');
  if (!dropdown || !menu || !selected || !nativeSelect) return;

  // Toggle menu open/close
  selected.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });

  // Close when clicking outside
  document.addEventListener('click', () => menu.classList.remove('open'));

  // Handle option selection
  menu.querySelectorAll('.typeface-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const val = btn.dataset.value;
      const label = btn.textContent.trim();

      // Sync native select so all JS that reads typeface.value still works
      nativeSelect.value = val;

      // Update button label rendered in chosen font
      selected.innerHTML = `<span style="font-family:${val};">${label}</span>`;

      // Mark active
      menu.querySelectorAll('.typeface-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      menu.classList.remove('open');

      // Trigger existing typeface change logic
      syncPlainText();
      if (typeof webglReady !== 'undefined' && webglReady) updateTextTexture();
    });
  });

  // Mark first option active on load
  const firstOpt = menu.querySelector('.typeface-option');
  if (firstOpt) firstOpt.classList.add('active');
})();

// ------------------------
// WEBGL
// ------------------------
let renderer, scene, camera, material, mesh, uniforms;
let textTexture = null;
let textCanvas, textCtx;
let webglReady = false;
let clock;

initWebGL();

function initWebGL() {
  renderer = new THREE.WebGLRenderer({
    canvas: effectCanvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true
  });

 renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  scene = new THREE.Scene();

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;

  textCanvas = document.createElement("canvas");
  textCtx = textCanvas.getContext("2d");

  uniforms = {
    uTexture: { value: null },
    uTime: { value: 0 },
    uIntensity: { value: 0.4 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTexResolution: { value: new THREE.Vector2(1, 1) },
    uMode: { value: 0.0 } // 0 = wave, 1 = fluid
  };

  const vertexShader = `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  const fragmentShader = `
    precision highp float;
    
    uniform sampler2D uTexture;
    uniform float uTime;
    uniform float uIntensity;
    uniform float uMode;
    uniform vec2 uResolution;
    uniform vec2 uTexResolution;

    varying vec2 vUv;

    float hash(vec2 p){
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p){
      vec2 i = floor(p);
      vec2 f = fract(p);

      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));

      vec2 u = f * f * (3.0 - 2.0 * f);

      return mix(a, b, u.x) +
             (c - a) * u.y * (1.0 - u.x) +
             (d - b) * u.x * u.y;
    }

    vec2 coverUv(vec2 uv, vec2 canvasSize, vec2 textureSize) {
      float canvasRatio = canvasSize.x / canvasSize.y;
      float textureRatio = textureSize.x / textureSize.y;
      vec2 newUv = uv;

      if (canvasRatio > textureRatio) {
        float scale = textureRatio / canvasRatio;
        newUv.y = newUv.y * scale + (1.0 - scale) * 0.5;
      } else {
        float scale = canvasRatio / textureRatio;
        newUv.x = newUv.x * scale + (1.0 - scale) * 0.5;
      }

      return newUv;
    }

    vec4 sampleText(vec2 uv){
      return texture2D(uTexture, uv);
    }

    vec4 waveEffect(vec2 uv){
      float intensity = uIntensity;
      
      float cutStart = 0.44;
      float wobbleLength = mix(0.0, 0.22, intensity);
      float sliceHeight = 0.0004;
      float wobbleWidth = mix(0.0, 0.02, intensity);

// FLIP IT
if (uv.y > cutStart) {
  return sampleText(uv); // TOP stays clean
}

      float distFromCut = cutStart - uv.y;

      if (distFromCut < wobbleLength) {
        float mapped = sin((distFromCut / max(wobbleLength * 2.0, 0.0001)) * 6.28318530718);
        float xOffset =
          mapped *
          sin(uTime * 1.5 + (distFromCut * 20.0 + 1.0) * cos(uTime * 0.4)) *
          wobbleWidth;

        float sourceY = cutStart - mod(distFromCut, sliceHeight);
        vec2 warpedUv = vec2(uv.x + xOffset, sourceY);
        return sampleText(warpedUv);
      }

      vec2 shiftedUv = vec2(uv.x, uv.y + wobbleLength);
      return sampleText(shiftedUv);
    }

    vec4 fluidEffect(vec2 uv){
      float intensity = uIntensity;

      float n1 = noise(vec2(uv.y * 80.0, uTime * 2.0));
      float n2 = noise(vec2(uv.y * 200.0, uTime * 4.0));
      float n3 = noise(vec2(uv.x * 150.0, uv.y * 150.0 + uTime));

      uv.x += (n1 - 0.5) * 0.15 * intensity;
      uv.x += (n2 - 0.5) * 0.2 * intensity;
      uv.y += (n3 - 0.5) * 0.05 * intensity;

      float glitch = step(0.93, noise(vec2(uv.y * 120.0, uTime * 3.0)));
      uv.x += glitch * (hash(uv + uTime) - 0.5) * 0.3 * intensity;

      vec4 color = sampleText(uv);

      float grain = (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.15 * intensity;
      color.rgb += grain;

      float edge = smoothstep(0.1, 0.9, noise(uv * 60.0));
      color.a *= mix(1.0, edge, 0.4 * intensity);

      return color;
    }
    
vec4 chromaticEffect(vec2 uv) {
  float intensity = uIntensity;

  // same movement
  float wave = sin(uv.y * 30.0 + uTime * 1.2) * 0.01 * intensity;
  uv.x += wave;

  float base = sampleText(uv).a;

  // edge thickness
  float spread = 0.002 + (0.012 * intensity);

  // helper: local outline at current uv
  float a1 = sampleText(uv + vec2(spread, 0.0)).a;
  float a2 = sampleText(uv - vec2(spread, 0.0)).a;
  float a3 = sampleText(uv + vec2(0.0, spread)).a;
  float a4 = sampleText(uv - vec2(0.0, spread)).a;

  float neighborMax = max(max(a1, a2), max(a3, a4));
  float outline = max(neighborMax - base, 0.0);
  outline = smoothstep(-0.02, 0.03, outline);

  // shifted outline masks — NOT shifted full text
  float shift = 0.0008 + (0.006 * intensity);

  vec2 uvR = uv + vec2( shift, 0.0);
  vec2 uvB = uv - vec2( shift, 0.0);

 float edgeBand = smoothstep(0.0, 0.03, neighborMax - base * 0.92);

float baseR = sampleText(uvR).a;
float r1 = sampleText(uvR + vec2(spread, 0.0)).a;
float r2 = sampleText(uvR - vec2(spread, 0.0)).a;
float r3 = sampleText(uvR + vec2(0.0, spread)).a;
float r4 = sampleText(uvR - vec2(0.0, spread)).a;
float yellowRaw = max(max(max(r1, r2), max(r3, r4)) - baseR, 0.0);
float yellowOutline = smoothstep(0.0, 0.06, yellowRaw) * edgeBand;

float baseB = sampleText(uvB).a;
float b1 = sampleText(uvB + vec2(spread, 0.0)).a;
float b2 = sampleText(uvB - vec2(spread, 0.0)).a;
float b3 = sampleText(uvB + vec2(0.0, spread)).a;
float b4 = sampleText(uvB - vec2(0.0, spread)).a;
float blueRaw = max(max(max(b1, b2), max(b3, b4)) - baseB, 0.0);
float blueOutline = smoothstep(0.0, 0.06, blueRaw) * edgeBand;

  vec3 yellow = vec3(1.0, 1.0, 0.0);
  vec3 blue   = vec3(0.0, 0.6, 1.0);

  vec3 color = vec3(0.0);

  // color only on separated outlines
  color += yellow * yellowOutline * 1.6;
  color += blue   * blueOutline * 1.6;

  // subtle grain only on color
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float glowMask = max(yellowOutline, blueOutline);
  color += (grain - 0.5) * 0.10 * glowMask;

  // black fill stays black
  color = mix(color, vec3(0.0), base);

  // alpha includes color edge too
  float alpha = max(base, glowMask);

  return vec4(color, alpha);
}
    void main() {
      vec2 uv = coverUv(vUv, uResolution, uTexResolution);

      vec4 color;
      if (uMode < 0.5) {
  color = waveEffect(uv);
}
else if (uMode < 1.5) {
  color = fluidEffect(uv);
}
else {
  color = chromaticEffect(uv);
}

      if (color.a < 0.1) discard;
      gl_FragColor = color;
    }
  `;

  material = new THREE.ShaderMaterial({
    transparent: true,
    uniforms,
    vertexShader,
    fragmentShader
  });

  mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(mesh);

  clock = new THREE.Clock();

  resizeWebGL();
  updateTextTexture();

  webglReady = true;
  handleModeChange();
  animate();

  window.addEventListener("resize", () => {
    resizeWebGL();
    updateTextTexture();
  });
}

function resizeWebGL() {
  const rect = outputBox.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  uniforms.uResolution.value.set(rect.width, rect.height);
}

function updateTextTexture() {
  const rect = outputBox.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio, 2);

  const w = Math.max(512, Math.floor(rect.width * dpr));
  const h = Math.max(256, Math.floor(rect.height * dpr));

  textCanvas.width = w;
textCanvas.height = h;

textCtx.clearRect(0, 0, w, h);

const fontFamily = typeface.value;
const baseSize = parseFloat(getComputedStyle(output).fontSize);
const fontSize = Math.floor(baseSize * dpr);

textCtx.font = `${currentFontWeight} ${fontSize}px ${fontFamily}`;
textCtx.textAlign = "center";
textCtx.textBaseline = "middle";
const text = getDisplayText();

  textCtx.fillStyle = "#000000";
  textCtx.fillText(text, w / 2, h / 2);
  if (textTexture) textTexture.dispose();

  textTexture = new THREE.CanvasTexture(textCanvas);
  textTexture.needsUpdate = true;
  textTexture.minFilter = THREE.LinearFilter;
  textTexture.magFilter = THREE.LinearFilter;
  textTexture.generateMipmaps = false;

  uniforms.uTexture.value = textTexture;
  uniforms.uTexResolution.value.set(w, h);
}

// Load any canvas as the WebGL texture source — used for chaining distortion passes
function loadCanvasIntoTexture(srcCanvas) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  if (textTexture) textTexture.dispose();
  textTexture = new THREE.CanvasTexture(srcCanvas);
  textTexture.needsUpdate = true;
  textTexture.minFilter = THREE.LinearFilter;
  textTexture.magFilter = THREE.LinearFilter;
  textTexture.generateMipmaps = false;
  uniforms.uTexture.value = textTexture;
  uniforms.uTexResolution.value.set(w, h);
}

function animate() {
  uniforms.uTime.value = clock.getElapsedTime();

  // Run all active distortion passes (wave + fluid only — chromatic is canvas-based now)
  const waveV = sv('distortion_wave');
  const fluidV = sv('distortion_fluid');
  const chromaticV = sv('distortion_chromatic');
  const anyWebGLDistortion = waveV > 0 || fluidV > 0;
  const anyDistortion = anyWebGLDistortion || chromaticV > 0;

  if (anyWebGLDistortion) {
    effectCanvas.style.display = "block";
    const rect = outputBox.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);

    const passes = [];
    if (waveV > 0) passes.push([0.0, waveV]);
    if (fluidV > 0) passes.push([1.0, fluidV]);

    if (passes.length > 1) {
      if (!animate._distCanvas) {
        animate._distCanvas = document.createElement('canvas');
        animate._distCtx = animate._distCanvas.getContext('2d');
      }
      const dc = animate._distCanvas;
      const dctx = animate._distCtx;
      dc.width = w; dc.height = h;
      dc.style.position = 'absolute';
      dc.style.inset = '0';
      dc.style.width = rect.width + 'px';
      dc.style.height = rect.height + 'px';
      dc.style.zIndex = '3';
      dc.style.pointerEvents = 'none';
      if (!dc.parentNode) outputBox.appendChild(dc);
      dc.style.display = 'block';

      // Chained passes: each pass feeds its output into the next pass as texture.
      // This means fluid distorts the already-wave-distorted pixels, not fresh text.
      // Start with fresh text texture for first pass.
      updateTextTexture();

      passes.forEach(([mode, intensity], i) => {
        uniforms.uMode.value = mode;
        uniforms.uIntensity.value = intensity;
        renderer.render(scene, camera);

        // Capture this pass result onto a temp canvas
        const passCapture = document.createElement('canvas');
        passCapture.width = w; passCapture.height = h;
        const pCtx = passCapture.getContext('2d');
        pCtx.clearRect(0, 0, w, h);
        pCtx.drawImage(effectCanvas, 0, 0, w, h);

        if (i < passes.length - 1) {
          // Feed this pass result as texture for the next pass
          loadCanvasIntoTexture(passCapture);
        }

        // Copy final pass to _distCanvas
        if (i === passes.length - 1) {
          dctx.clearRect(0, 0, w, h);
          dctx.drawImage(passCapture, 0, 0, w, h);
        }
      });

      effectCanvas.style.display = 'none';
    } else {
      if (animate._distCanvas) animate._distCanvas.style.display = 'none';
      uniforms.uMode.value = passes[0][0];
      uniforms.uIntensity.value = passes[0][1];
      updateTextTexture();
      renderer.render(scene, camera);
      effectCanvas.style.display = 'block';
    }
  } else {
    effectCanvas.style.display = 'none';
    if (animate._distCanvas) animate._distCanvas.style.display = 'none';
  }

  // ── CHAINED EFFECT PIPELINE ──
  // Each group passes its canvas output as the source for the next group.
  // This means effects compound on each other: text → distortion → degradation → breakdown
  // rather than each group independently redrawing fresh text.

  const rect2 = outputBox.getBoundingClientRect();
  const dpr2  = Math.min(window.devicePixelRatio, 2);
  const pw    = Math.floor(rect2.width  * dpr2);
  const ph    = Math.floor(rect2.height * dpr2);

  // Start with base text src
  let chainSrc = buildTextSrc(pw, ph);

  // Step 1: If WebGL distortion active, capture its output as the chain source
  if (anyWebGLDistortion) {
    const wglCapture = document.createElement('canvas');
    wglCapture.width = pw; wglCapture.height = ph;
    const wglCtx = wglCapture.getContext('2d');
    wglCtx.clearRect(0, 0, pw, ph);
    const activeDistCanvas = (animate._distCanvas && animate._distCanvas.style.display !== 'none')
      ? animate._distCanvas : effectCanvas;
    if (activeDistCanvas.style.display !== 'none') {
      wglCtx.drawImage(activeDistCanvas, 0, 0, pw, ph);
    }
    chainSrc = wglCapture;
  }

  // Step 2: Degradation — receives chain src, outputs to degradationCanvas
  const smearV = sv('degradation_smear');
  const gaussV = sv('degradation_gaussian');
  const zoomV  = sv('degradation_zoom');
  const anyDegradation = smearV > 0 || gaussV > 0 || zoomV > 0;
  if (anyDegradation) {
    const degResult = updateDegradation(chainSrc);
    if (degResult) chainSrc = degResult;
  } else {
    degradationCanvas.style.display = 'none';
  }

  // Step 3: Breakdown — receives chain src
  const fragV  = sv('breakdown_fragmentation');
  const densV  = sv('breakdown_density');
  const noiseV = sv('breakdown_noise');
  const anyBreakdown = fragV > 0 || densV > 0 || noiseV > 0;
  if (anyBreakdown) {
    const brkResult = updateBreakdown(chainSrc);
    if (brkResult) chainSrc = brkResult;
  } else {
    breakdownCanvas.style.display = 'none';
  }

  // Step 4: Chromatic — always uses the current chain src
  if (chromaticV > 0) {
    updateChromaticCanvas(chromaticV, chainSrc);
  } else {
    chromaticCanvas.style.display = 'none';
  }

  // Step 5: Instability — DOM-based, always on top
  const echoV  = sv('instability_echo');
  const wireV  = sv('instability_wireframe');
  const driftV = sv('instability_drift');
  const anyInstability = echoV > 0 || wireV > 0 || driftV > 0;
  if (anyInstability) {
    updateInstability();
    instabilityLayer.style.display = 'flex';
  } else {
    instabilityLayer.style.display = 'none';
  }

  // Show/hide plain text — hide when any canvas effect is active
  const anyEffect = anyDistortion || anyInstability || anyDegradation || anyBreakdown;
  output.style.opacity = anyEffect ? '0' : '1';

  requestAnimationFrame(animate);
}

function handleModeChange() {
  updateTextTexture();
}

function updateChromaticCanvas(intensity, srcOverride) {
  const rect = outputBox.getBoundingClientRect();
  const dpr  = Math.min(window.devicePixelRatio, 2);
  const w    = Math.floor(rect.width  * dpr);
  const h    = Math.floor(rect.height * dpr);

  chromaticCanvas.width  = w;
  chromaticCanvas.height = h;
  chromaticCanvas.style.width  = rect.width  + 'px';
  chromaticCanvas.style.height = rect.height + 'px';
  chromaticCanvas.style.display = 'block';

  const ctx      = chromaticCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  const t          = performance.now() * 0.001;
  const fontFamily = typeface.value;
  const baseSize   = parseFloat(getComputedStyle(output).fontSize);
  const fontSize   = Math.floor(baseSize * dpr);
  const text       = getDisplayText();

  // ── STEP 1: Source — use chained result or build fresh text ──
  let textC;
  if (srcOverride) {
    textC = srcOverride;
  } else {
    textC = document.createElement('canvas');
    textC.width = w; textC.height = h;
    const tc = textC.getContext('2d');
    tc.font = `${currentFontWeight} ${fontSize}px ${fontFamily}`;
    tc.textAlign = 'center'; tc.textBaseline = 'middle';
    tc.fillStyle = '#000';
    tc.fillText(text, w / 2, h / 2);
  }
  const srcPx = textC.getContext('2d').getImageData(0, 0, w, h).data;

  // ── STEP 2: Downward-only melt warp on "lity" ──
  // Key fix: displacement is ALWAYS positive (downward). No upward pull = no detaching.
  // We use abs() on the wave so the field never goes negative.
  const warpC = document.createElement('canvas');
  warpC.width = w; warpC.height = h;
  const wc = warpC.getContext('2d');
  const dstImg = wc.createImageData(w, h);
  const dstPx  = dstImg.data;

  // "lity" is roughly the right 45% of a centered word — ramp from 50%→62% canvas width
  const lityStartX = w * 0.50;
  const lityFullX  = w * 0.63;

  // Max downward stretch — strong but stays attached
  const maxYShift  = fontSize * 1.4 * intensity;
  const maxXDrift  = fontSize * 0.15 * intensity;  // very small X — mostly vertical

  const textMidY   = h * 0.5;
  const halfLetter = fontSize * 0.52;

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const di = (dy * w + dx) * 4;

      // Column warp factor — 0 for "rea", 1 for "lity"
      const colFactor = Math.max(0, Math.min(1,
        (dx - lityStartX) / (lityFullX - lityStartX)
      ));

      if (colFactor === 0) {
        // "rea" — straight copy, totally stable
        const si = di;
        dstPx[di]   = srcPx[si];
        dstPx[di+1] = srcPx[si+1];
        dstPx[di+2] = srcPx[si+2];
        dstPx[di+3] = srcPx[si+3];
        continue;
      }

      // yBias: 0 at and above letter midpoint, grows positively below it.
      // This anchors letter tops and only pulls downward from the waist.
      const distBelow = dy - textMidY;
      const yBias     = Math.max(0, distBelow / halfLetter);

      // Warp field — abs() ensures displacement is always downward (positive).
      // Different column phases give each letter its own melt shape.
      const colPhase = (dx / w) * Math.PI * 7.0;
      const wave1 = Math.abs(Math.sin(colPhase * 0.8  + t * 0.20)) * 0.55;
      const wave2 = Math.abs(Math.sin(colPhase * 1.5  + t * 0.27 + 1.0)) * 0.30;
      const wave3 = Math.abs(Math.sin(colPhase * 3.0  + t * 0.16 + 2.2)) * 0.15;
      const warpField = wave1 + wave2 + wave3; // always in [0, 1]

      // Small lateral wobble — also abs() so no leftward jerk
      const xField = Math.sin((dy / h) * Math.PI * 3.5 + (dx / w) * Math.PI * 2.5 + t * 0.22)
                     * maxXDrift * colFactor * Math.min(yBias, 1.2);

      const yDisplace = warpField * maxYShift * colFactor * Math.min(yBias, 1.6);

      // Inverse lookup — which source pixel maps to this destination?
      const sx = Math.round(dx - xField);
      const sy = Math.round(dy - yDisplace);

      if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;

      const si = (sy * w + sx) * 4;
      dstPx[di]   = srcPx[si];
      dstPx[di+1] = srcPx[si+1];
      dstPx[di+2] = srcPx[si+2];
      dstPx[di+3] = srcPx[si+3];
    }
  }
  wc.putImageData(dstImg, 0, 0);

  // ── STEP 3: Blue (up-left) and yellow (down-right) colour layers ──
  const blueOffX   = -Math.round(fontSize * 0.035 * intensity);
  const blueOffY   = -Math.round(fontSize * 0.07  * intensity);
  const yellowOffX =  Math.round(fontSize * 0.035 * intensity);
  const yellowOffY =  Math.round(fontSize * 0.08  * intensity);

  function makeColorLayer(offX, offY, r, g, b) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d');
    cx.drawImage(warpC, offX, offY);
    const img = cx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i+3] < 8) continue;
      d[i] = r; d[i+1] = g; d[i+2] = b;
    }
    cx.putImageData(img, 0, 0);
    return c;
  }

  const blueC   = makeColorLayer(blueOffX,   blueOffY,   20,  60, 255);
  const yellowC = makeColorLayer(yellowOffX, yellowOffY, 190, 255,   0);

  // ── STEP 4: Blur colour layers — tighter than before, less bleed ──
  const blurPx = (1.0 + intensity * 3.0).toFixed(1);

  function blurLayer(src) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d');
    cx.filter = `blur(${blurPx}px)`;
    cx.drawImage(src, 0, 0);
    return c;
  }

  // ── STEP 5: Composite colour layers — lower alpha = less bleed ──
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.drawImage(blurLayer(yellowC), 0, 0);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.50;
  ctx.drawImage(blurLayer(blueC), 0, 0);
  ctx.restore();

  // ── STEP 6: Grain on colour region only ──
  const grainData = ctx.getImageData(0, 0, w, h);
  const gd = grainData.data;
  const grainStr = 40 + intensity * 55;
  for (let i = 0; i < gd.length; i += 4) {
    if (gd[i+3] < 8) continue;
    const darkness = 1 - (gd[i] + gd[i+1] + gd[i+2]) / 765;
    const g = (Math.random() - 0.5) * grainStr * (0.4 + darkness * 0.7);
    gd[i]   = Math.max(0, Math.min(255, gd[i]   + g));
    gd[i+1] = Math.max(0, Math.min(255, gd[i+1] + g));
    gd[i+2] = Math.max(0, Math.min(255, gd[i+2] + g));
  }
  ctx.putImageData(grainData, 0, 0);

  // ── STEP 7: Black text with soft shadow-bleed into colours, then sharp black on top ──
  // Pass 1: blurred black — bleeds into colour halos like ink soaking into paper
  const bleedBlur = (1.5 + intensity * 3.5).toFixed(1);
  ctx.save();
  ctx.filter = `blur(${bleedBlur}px)`;
  ctx.globalAlpha = 0.6;
  ctx.drawImage(warpC, 0, 0);
  ctx.restore();

  // Pass 2: sharp black on top — keeps letterforms crisp and readable
  ctx.save();
  ctx.filter = 'none';
  ctx.globalAlpha = 1.0;
  ctx.drawImage(warpC, 0, 0);
  ctx.restore();
}

function updateDegradation(srcOverride) {
  const smearV = sv('degradation_smear');
  const gaussV = sv('degradation_gaussian');
  const zoomV = sv('degradation_zoom');
  const anyActive = smearV > 0 || gaussV > 0 || zoomV > 0;

  if (!anyActive) { degradationCanvas.style.display = 'none'; return null; }

  const rect = outputBox.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio, 2);
  const w = Math.floor(rect.width * dpr);
  const h = Math.floor(rect.height * dpr);

  degradationCanvas.width = w;
  degradationCanvas.height = h;
  degradationCanvas.style.width = rect.width + "px";
  degradationCanvas.style.height = rect.height + "px";
  degradationCanvas.style.display = "block";

  const dctx = degradationCanvas.getContext("2d");
  dctx.clearRect(0, 0, w, h);

  // Start chain: use distortion output or fresh text
  let chainSrc = srcOverride || buildTextSrc(w, h);

  // Helper: capture current canvas state into a new canvas for chaining
  function captureDeg() {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(degradationCanvas, 0, 0);
    return c;
  }

  // Each effect receives the previous effect's output as src.
  // After each runs, capture the canvas state for the next effect.
  if (smearV > 0) {
    applyMotionSmear(dctx, chainSrc, w, h, smearV);
    chainSrc = captureDeg();
  }
  if (gaussV > 0) {
    applyGaussianBlur(dctx, chainSrc, w, h, gaussV);
    chainSrc = captureDeg();
  }
  if (zoomV > 0) {
    applyZoomBlur(dctx, chainSrc, w, h, zoomV);
  }

  return degradationCanvas;
}

function buildTextSrc(w, h) {
  const src = document.createElement("canvas");
  src.width = w;
  src.height = h;
  const sctx = src.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio, 2);
  const fontFamily = typeface.value;
  const baseSize = parseFloat(getComputedStyle(output).fontSize);
  const fontSize = Math.floor(baseSize * dpr);
  sctx.font = `${currentFontWeight} ${fontSize}px ${fontFamily}`;
  sctx.textAlign = "center";
  sctx.textBaseline = "middle";
  sctx.fillStyle = "#000";
  sctx.fillText(getDisplayText(), w / 2, h / 2);
  return src;
}

function applyGaussianBlur(dctx, src, w, h, intensity) {
  // Render to offscreen canvas, then composite onto dctx
  const offscreen = document.createElement('canvas');
  offscreen.width = w; offscreen.height = h;
  const octx = offscreen.getContext('2d');
  // Replace all dctx references below with octx
  const _dctx = dctx;
  dctx = octx;
  dctx.save();
  const mainBlur = 5 + intensity * 24;
  const hazeBlur = 18 + intensity * 55;
  const smearLength = w * (0.12 + intensity * 0.38);
  const smearOpacity = 0.28 + intensity * 0.75;
  const smearBlur = 10 + intensity * 28;
  const mainBlurCanvas = document.createElement("canvas");
  mainBlurCanvas.width = w; mainBlurCanvas.height = h;
  const mainCtx = mainBlurCanvas.getContext("2d");
  mainCtx.filter = `blur(${mainBlur}px)`;
  mainCtx.drawImage(src, 0, 0);
  mainCtx.filter = "none";
  const hazeCanvas = document.createElement("canvas");
  hazeCanvas.width = w; hazeCanvas.height = h;
  const hazeCtx = hazeCanvas.getContext("2d");
  hazeCtx.filter = `blur(${hazeBlur}px)`;
  hazeCtx.globalAlpha = 0.45;
  hazeCtx.drawImage(src, 0, 0);
  hazeCtx.filter = "none";
  const edgeCanvas = document.createElement("canvas");
  edgeCanvas.width = w; edgeCanvas.height = h;
  const edgeCtx = edgeCanvas.getContext("2d");
  const srcCtx = src.getContext("2d");
  const srcData = srcCtx.getImageData(0, 0, w, h).data;
  edgeCtx.clearRect(0, 0, w, h);
  for (let y = 0; y < h; y += 1) {
    let leftEdge = -1, rightEdge = -1;
    for (let x = 0; x < w; x++) {
      const alpha = srcData[(y * w + x) * 4 + 3];
      if (alpha > 20) { if (leftEdge === -1) leftEdge = x; rightEdge = x; }
    }
    if (leftEdge === -1 || rightEdge === -1) continue;
    if (rightEdge - leftEdge < 8) continue;
    const rowNoise = 0.75 + Math.random() * 0.5;
    const rowSmearLength = smearLength * rowNoise;
    const centerY = h / 2;
    const verticalFalloff = Math.exp(-Math.pow((y - centerY) / (h * 0.22), 2));
    const alphaStrength = smearOpacity * verticalFalloff;
    if (alphaStrength < 0.015) continue;
    const leftGradient = edgeCtx.createLinearGradient(leftEdge - rowSmearLength, y, leftEdge + 8, y);
    leftGradient.addColorStop(0, `rgba(0,0,0,0)`);
    leftGradient.addColorStop(0.35, `rgba(0,0,0,${alphaStrength * 0.20})`);
    leftGradient.addColorStop(0.72, `rgba(0,0,0,${alphaStrength * 0.58})`);
    leftGradient.addColorStop(1, `rgba(0,0,0,${alphaStrength})`);
    edgeCtx.fillStyle = leftGradient;
    edgeCtx.fillRect(leftEdge - rowSmearLength, y, rowSmearLength + 12, 2);
    const rightGradient = edgeCtx.createLinearGradient(rightEdge - 8, y, rightEdge + rowSmearLength, y);
    rightGradient.addColorStop(0, `rgba(0,0,0,${alphaStrength})`);
    rightGradient.addColorStop(0.28, `rgba(0,0,0,${alphaStrength * 0.58})`);
    rightGradient.addColorStop(0.65, `rgba(0,0,0,${alphaStrength * 0.20})`);
    rightGradient.addColorStop(1, `rgba(0,0,0,0)`);
    edgeCtx.fillStyle = rightGradient;
    edgeCtx.fillRect(rightEdge - 12, y, rowSmearLength + 12, 2);
  }
  const softSmearCanvas = document.createElement("canvas");
  softSmearCanvas.width = w; softSmearCanvas.height = h;
  const softSmearCtx = softSmearCanvas.getContext("2d");
  softSmearCtx.filter = `blur(${smearBlur}px)`;
  softSmearCtx.drawImage(edgeCanvas, 0, 0);
  softSmearCtx.filter = "none";
  const finalSmearCanvas = document.createElement("canvas");
  finalSmearCanvas.width = w; finalSmearCanvas.height = h;
  const finalSmearCtx = finalSmearCanvas.getContext("2d");
  finalSmearCtx.filter = `blur(${6 + intensity * 18}px)`;
  finalSmearCtx.globalAlpha = 1;
  finalSmearCtx.drawImage(softSmearCanvas, 0, 0);
  finalSmearCtx.filter = "none";
  dctx.globalAlpha = 0.55;
  dctx.drawImage(hazeCanvas, 0, 0);
  dctx.globalAlpha = 1.0;
  dctx.drawImage(finalSmearCanvas, 0, 0);
  dctx.globalAlpha = 0.85;
  dctx.drawImage(mainBlurCanvas, 0, 0);
  if (intensity > 0.05) {
    const grain = dctx.createImageData(w, h);
    const grainAmount = 24 * intensity;
    const grainAlpha = 12 * intensity;
    for (let i = 0; i < grain.data.length; i += 4) {
      const v = 125 + (Math.random() - 0.5) * grainAmount;
      grain.data[i] = v; grain.data[i+1] = v; grain.data[i+2] = v; grain.data[i+3] = grainAlpha;
    }
    const grainCanvas = document.createElement("canvas");
    grainCanvas.width = w; grainCanvas.height = h;
    grainCanvas.getContext("2d").putImageData(grain, 0, 0);
    dctx.globalCompositeOperation = "multiply";
    dctx.globalAlpha = 0.35;
    dctx.drawImage(grainCanvas, 0, 0);
    dctx.globalCompositeOperation = "source-over";
  }
  dctx.globalAlpha = 1;
  dctx.restore();
  // Composite this effect onto the actual canvas
  _dctx.save();
  _dctx.globalAlpha = 1.0;
  _dctx.globalCompositeOperation = 'source-over';
  _dctx.drawImage(offscreen, 0, 0);
  _dctx.restore();
}
function applyMotionSmear(dctx, src, w, h, intensity) {
  const offscreen = document.createElement('canvas');
  offscreen.width = w; offscreen.height = h;
  const octx = offscreen.getContext('2d');
  const _dctx = dctx;
  dctx = octx;
  dctx.save();
  const t = performance.now() * 0.001;
  const smearX = intensity * w * 0.08;
  const smearY = intensity * h * 0.10;
  const blurAmount = 2 + intensity * 10;
  const hazeCanvas = document.createElement("canvas");
  hazeCanvas.width = w; hazeCanvas.height = h;
  const hazeCtx = hazeCanvas.getContext("2d");
  hazeCtx.filter = `blur(${12 + intensity * 28}px)`;
  hazeCtx.globalAlpha = 0.35;
  hazeCtx.drawImage(src, -smearX * 0.5, 0);
  hazeCtx.drawImage(src, smearX * 0.5, 0);
  hazeCtx.drawImage(src, 0, -smearY * 0.4);
  hazeCtx.drawImage(src, 0, smearY * 0.4);
  hazeCtx.filter = "none";
  dctx.globalAlpha = 0.75;
  dctx.drawImage(hazeCanvas, 0, 0);
  const passes = 34;
  for (let i = 0; i < passes; i++) {
    const p = i / (passes - 1);
    const alpha = Math.pow(1 - p, 1.7) * intensity * 0.18;
    const wave = Math.sin(p * Math.PI * 2 + t * 0.35) * intensity * 12;
    const offsetX = (p - 0.5) * smearX * 2 + wave;
    const offsetY = Math.sin(p * Math.PI) * smearY * 0.7 - intensity * h * 0.025;
    dctx.globalAlpha = alpha;
    dctx.filter = `blur(${blurAmount * p}px)`;
    dctx.drawImage(src, offsetX, offsetY);
  }
  dctx.filter = "none";
  const verticalCanvas = document.createElement("canvas");
  verticalCanvas.width = w; verticalCanvas.height = h;
  const vctx = verticalCanvas.getContext("2d");
  const verticalPasses = 28;
  for (let i = 0; i < verticalPasses; i++) {
    const p = i / verticalPasses;
    const offsetY = (p - 0.5) * smearY * 1.5;
    const offsetX = Math.sin(p * 8 + t * 0.2) * intensity * 12;
    const alpha = Math.pow(1 - Math.abs(p - 0.5) * 2, 0.7) * intensity * 0.12;
    vctx.globalAlpha = alpha;
    vctx.drawImage(src, offsetX, offsetY);
  }
  const verticalBlurCanvas = document.createElement("canvas");
  verticalBlurCanvas.width = w; verticalBlurCanvas.height = h;
  const vbctx = verticalBlurCanvas.getContext("2d");
  vbctx.filter = `blur(${3 + intensity * 12}px)`;
  vbctx.drawImage(verticalCanvas, 0, 0);
  vbctx.filter = "none";
  dctx.globalAlpha = 0.9;
  dctx.drawImage(verticalBlurCanvas, 0, 0);
  const streakCanvas = document.createElement("canvas");
  streakCanvas.width = w; streakCanvas.height = h;
  const sctx = streakCanvas.getContext("2d");
  const srcCtx = src.getContext("2d");
  const srcData = srcCtx.getImageData(0, 0, w, h).data;
  sctx.clearRect(0, 0, w, h);
  for (let y = 0; y < h; y += 2) {
    let left = -1, right = -1;
    for (let x = 0; x < w; x++) {
      const a = srcData[(y * w + x) * 4 + 3];
      if (a > 20) { if (left === -1) left = x; right = x; }
    }
    if (left === -1 || right === -1) continue;
    const rowWidth = right - left;
    if (rowWidth < 6) continue;
    const rowNoise = 0.6 + Math.random() * 0.8;
    const bandAlpha = intensity * 0.10 * rowNoise;
    const extend = intensity * w * (0.05 + Math.random() * 0.08);
    sctx.fillStyle = `rgba(0,0,0,${bandAlpha})`;
    sctx.fillRect(left - extend * 0.5, y, rowWidth + extend, 2);
  }
  const streakBlurCanvas = document.createElement("canvas");
  streakBlurCanvas.width = w; streakBlurCanvas.height = h;
  const sbctx = streakBlurCanvas.getContext("2d");
  sbctx.filter = `blur(${1.5 + intensity * 5}px)`;
  sbctx.drawImage(streakCanvas, 0, 0);
  sbctx.filter = "none";
  dctx.globalAlpha = 1;
  dctx.drawImage(streakBlurCanvas, 0, 0);
  if (intensity > 0.05) {
    const grain = dctx.createImageData(w, h);
    const grainAmount = 55 * intensity;
    const grainAlpha = 18 * intensity;
    for (let i = 0; i < grain.data.length; i += 4) {
      const v = 120 + (Math.random() - 0.5) * grainAmount;
      grain.data[i] = v; grain.data[i+1] = v; grain.data[i+2] = v; grain.data[i+3] = grainAlpha;
    }
    const grainCanvas = document.createElement("canvas");
    grainCanvas.width = w; grainCanvas.height = h;
    grainCanvas.getContext("2d").putImageData(grain, 0, 0);
    dctx.globalCompositeOperation = "multiply";
    dctx.globalAlpha = 0.55;
    dctx.drawImage(grainCanvas, 0, 0);
    dctx.globalCompositeOperation = "source-over";
  }
  dctx.globalAlpha = 1;
  dctx.filter = "none";
  dctx.restore();
  _dctx.save();
  _dctx.globalAlpha = 1.0;
  _dctx.globalCompositeOperation = 'source-over';
  _dctx.drawImage(offscreen, 0, 0);
  _dctx.restore();
}

function applyZoomBlur(dctx, src, w, h, intensity) {
  // Zoom blur: draw concentric scaled copies fading outward, like zooming into center
  const passes = Math.floor(16 + intensity * 20);
  const offscreen = document.createElement('canvas');
  offscreen.width = w; offscreen.height = h;
  const octx = offscreen.getContext('2d');
  const _dctx = dctx;
  dctx = octx;
  dctx.save();

  // Outer zoom halos (zoomed out = smaller, from center)
  for (let i = passes; i >= 1; i--) {
    const t = i / passes;
    // Scale goes from slightly smaller to slightly larger
    const scale = 1 - t * intensity * 0.3;
    if (scale <= 0) continue;
    const alpha = (1 - t) * 0.13 * intensity;
    const tx = w / 2 * (1 - scale);
    const ty = h / 2 * (1 - scale);
    dctx.globalAlpha = alpha;
    dctx.drawImage(src, tx, ty, w * scale, h * scale);
  }

  // Zoomed-in halos (larger than center)
  for (let i = 1; i <= Math.floor(passes * 0.6); i++) {
    const t = i / (passes * 0.6);
    const scale = 1 + t * intensity * 0.22;
    const alpha = (1 - t) * 0.10 * intensity;
    const tx = w / 2 * (1 - scale);
    const ty = h / 2 * (1 - scale);
    dctx.globalAlpha = alpha;
    dctx.drawImage(src, tx, ty, w * scale, h * scale);
  }

  // Grain noise for texture like the reference
  const grain = dctx.createImageData(w, h);
  for (let i = 0; i < grain.data.length; i += 4) {
    const v = Math.random() * 60 * intensity;
    grain.data[i] = v;
    grain.data[i+1] = v;
    grain.data[i+2] = v;
    grain.data[i+3] = 18 * intensity;
  }
  const grainCanvas = document.createElement("canvas");
  grainCanvas.width = w; grainCanvas.height = h;
  grainCanvas.getContext("2d").putImageData(grain, 0, 0);
  dctx.globalCompositeOperation = "multiply";
  dctx.globalAlpha = 0.6;
  dctx.drawImage(grainCanvas, 0, 0);

  dctx.globalCompositeOperation = "source-over";
  dctx.globalAlpha = 1;
  dctx.restore();
  _dctx.save();
  _dctx.globalAlpha = 1.0;
  _dctx.globalCompositeOperation = 'source-over';
  _dctx.drawImage(offscreen, 0, 0);
  _dctx.restore();
}

function updateBreakdown(srcOverride) {
  const fragV = sv('breakdown_fragmentation');
  const densV = sv('breakdown_density');
  const noiseV = sv('breakdown_noise');
  const anyActive = fragV > 0 || densV > 0 || noiseV > 0;

  if (!anyActive) { breakdownCanvas.style.display = 'none'; return null; }

  const rect = outputBox.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio, 2);
  const w = Math.floor(rect.width * dpr);
  const h = Math.floor(rect.height * dpr);

  breakdownCanvas.width = w;
  breakdownCanvas.height = h;
  breakdownCanvas.style.width = rect.width + "px";
  breakdownCanvas.style.height = rect.height + "px";
  breakdownCanvas.style.display = "block";

  const bctx = breakdownCanvas.getContext("2d");
  bctx.clearRect(0, 0, w, h);

  const src = srcOverride || buildTextSrc(w, h);

  // Chain src between breakdown effects — each receives previous output
  let bChainSrc = src;

  function captureBreak() {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(breakdownCanvas, 0, 0);
    return c;
  }

  if (fragV > 0) {
    applyFragmentation(bctx, bChainSrc, w, h, fragV);
    bChainSrc = captureBreak();
  }
  if (densV > 0) {
    applyDensityCollapse(bctx, bChainSrc, w, h, densV);
    // Density collapse needs text on top when running alone or as last effect
    if (fragV === 0 && noiseV === 0) {
      bctx.globalAlpha = 1.0;
      bctx.globalCompositeOperation = 'source-over';
      bctx.drawImage(bChainSrc, 0, 0);
    }
    bChainSrc = captureBreak();
  }
  if (noiseV > 0) {
    applyNoiseDisplacement(bctx, bChainSrc, w, h, noiseV);
  }

  return breakdownCanvas;
}

function applyFragmentation(bctx, src, w, h, intensity) {
  // Slice text into rectangular chunks and shift them — hard-edged, no blur
  const t = performance.now() * 0.001;

  // Seed canvas with src if empty (running solo or first in chain)
  const probe = bctx.getImageData(w >> 1, h >> 1, 1, 1).data;
  if (probe[3] === 0) bctx.drawImage(src, 0, 0);

  const srcData = bctx.getImageData(0, 0, w, h);

  bctx.save();

  // Number of horizontal slices — more at higher intensity
  const numSlices = Math.floor(4 + intensity * 12);
  const sliceH = Math.ceil(h / numSlices);

  for (let s = 0; s < numSlices; s++) {
    const sy = s * sliceH;
    const sh = Math.min(sliceH, h - sy);

    // Each slice gets a random-but-stable horizontal shift driven by intensity
    // Use sine of slice index + time for slow drift
    const seed = s * 7.3 + 1.1;
    const shiftX = Math.sin(t * 0.4 + seed) * intensity * w * 0.18
                 + Math.cos(t * 0.3 + seed * 1.7) * intensity * w * 0.08;

    // Some slices also get a vertical nudge
    const shiftY = 0; // No vertical nudge — prevents white horizontal gap

    // Skip tiny shifts — keep some slices anchored for contrast
    if (Math.abs(shiftX) < 2 && Math.abs(shiftY) < 1) continue;

    // Clear this row and re-draw offset from the seeded canvas state
    bctx.clearRect(0, sy, w, sh);
    // Redraw this slice shifted using a temp canvas from srcData
    const sliceImg = new ImageData(
      srcData.data.slice(sy * w * 4, (sy + sh) * w * 4), w, sh
    );
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = sh;
    tmp.getContext('2d').putImageData(sliceImg, 0, 0);
    bctx.drawImage(tmp, shiftX, sy + shiftY);
  }

  bctx.restore();
}

function applyDensityCollapse(bctx, src, w, h, intensity) {
  // Dense chaotic scribble lines emanating around the text bounding area
  // Text itself stays sharp and solid on top
  const t = performance.now() * 0.001;

  bctx.save();

  // Measure text to find its approximate bounding box
  const fontFamily = typeface.value;
  const baseSize = parseFloat(getComputedStyle(output).fontSize);
  const fontSize = Math.floor(baseSize * Math.min(window.devicePixelRatio, 2));
  bctx.font = `${currentFontWeight} ${fontSize}px ${fontFamily}`;
  const textW = bctx.measureText(getDisplayText()).width;
  const textH = fontSize * 0.85;

  const cx = w / 2;
  const cy = h / 2;
  const padX = textW * 0.55 * intensity;
  const padY = textH * 1.4 * intensity;

  // Number of scribble lines scales with intensity
  const lineCount = Math.floor(80 + intensity * 280);

  bctx.lineWidth = 2.2;
  bctx.strokeStyle = "#000";
  bctx.globalAlpha = 1.0;

  for (let i = 0; i < lineCount; i++) {
    // Each line: random start near text edge, random looping curve
    const angle = Math.random() * Math.PI * 2;
    const rStart = (0.3 + Math.random() * 0.7);

    const startX = cx + Math.cos(angle) * textW * 0.5 * rStart;
    const startY = cy + Math.sin(angle) * textH * 0.7 * rStart;

    // Control points extend outward with intensity
    const spread = (0.4 + Math.random() * 0.6) * intensity;
    const cp1x = startX + (Math.random() - 0.5) * textW * (0.8 + spread);
    const cp1y = startY + (Math.random() - 0.5) * textH * (2.0 + spread * 2);
    const cp2x = cx + (Math.random() - 0.5) * textW * (0.6 + spread);
    const cp2y = cy + (Math.random() - 0.5) * textH * (1.5 + spread * 2);

    const endAngle = angle + (Math.random() - 0.5) * Math.PI * 1.5;
    const rEnd = (0.3 + Math.random() * 0.7);
    const endX = cx + Math.cos(endAngle) * textW * 0.5 * rEnd;
    const endY = cy + Math.sin(endAngle) * textH * 0.7 * rEnd;

    bctx.beginPath();
    bctx.moveTo(startX, startY);
    bctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, endX, endY);
    bctx.stroke();
  }

  bctx.restore();
}

function applyNoiseDisplacement(bctx, src, w, h, intensity) {
  // Target: full-size bold word, each scanline shifted by an independent amount.
  // No wave, no warp, no sine pattern — pure hash-based per-row displacement.

  // If nothing has been drawn yet (running solo), seed the canvas with src first
  const probe = bctx.getImageData(w >> 1, h >> 1, 1, 1).data;
  const isEmpty = probe[3] === 0;
  if (isEmpty) bctx.drawImage(src, 0, 0);

  const t = performance.now() * 0.001; // animates slowly

  // Max shift: word stays legible, shifts are tight
  const maxPx = Math.round(intensity * w * 0.06);

  // Simple integer hash — deterministic, no patterns, no waves
  function hashInt(n) {
    n = ((n >> 16) ^ n) * 0x45d9f3b | 0;
    n = ((n >> 16) ^ n) * 0x45d9f3b | 0;
    n = (n >> 16) ^ n;
    return n;
  }

  // Seed changes slowly with time — creates the animated drift
  const timeSeed = Math.floor(t * 3); // changes ~3x per second

  // Read from the current canvas state (not src) so we displace whatever
  // previous effects (like density collapse) have already drawn
  const currentState = bctx.getImageData(0, 0, w, h);
  const srcData = currentState.data;
  const outImg = bctx.createImageData(w, h);
  const outData = outImg.data;

  // Build per-row shifts using hash noise
  // Each row gets its own hash value — no correlation between adjacent rows
  // Group rows into thin bands (1-4px) so adjacent rows often share a shift,
  // giving the thick/thin slice look from the reference.
  const rowShift = new Int32Array(h);
  let y = 0;
  while (y < h) {
    // Band height: 1px most of the time, occasionally 2-4px
    const bandH = Math.random() < 0.55 ? 1 : Math.random() < 0.6 ? 2 : Math.random() < 0.6 ? 3 : 4;
    
    // Hash this band using its y position + time seed
    const h1 = hashInt(y * 7919 + timeSeed * 1000003);
    const h2 = hashInt(y * 3491 + timeSeed * 999983 + 17);
    
    // Combine two hashes into [-1, 1] float
    const raw = ((h1 & 0xffff) / 0xffff - 0.5) * 2 * 0.7
              + ((h2 & 0xffff) / 0xffff - 0.5) * 2 * 0.3;
    
    const shift = Math.round(raw * maxPx);
    
    for (let dy = 0; dy < bandH && y + dy < h; dy++) {
      rowShift[y + dy] = shift;
    }
    y += bandH;
  }

  // Apply shifts pixel by pixel
  for (let row = 0; row < h; row++) {
    const shift = rowShift[row];
    const rowBase = row * w * 4;
    for (let x = 0; x < w; x++) {
      const sx = x - shift;
      if (sx < 0 || sx >= w) continue;
      const si = rowBase + sx * 4;
      const di = rowBase + x  * 4;
      outData[di]     = srcData[si];
      outData[di + 1] = srcData[si + 1];
      outData[di + 2] = srcData[si + 2];
      outData[di + 3] = srcData[si + 3];
    }
  }

  bctx.putImageData(outImg, 0, 0);
}

function updateInstability() {
  const echoV  = sv('instability_echo');
  const wireV  = sv('instability_wireframe');
  const driftV = sv('instability_drift');
  const text   = getDisplayText();

  instabilityLayer.innerHTML = "";

  const t   = performance.now() * 0.002;
  const td  = performance.now() * 0.001;

  // Key principle: when effects are combined, they share the same letter elements.
  // Drift splits into per-letter divs. Wireframe and Echo style those same letters.
  // This means wireframe text actually drifts, echo text actually drifts, etc.

  function makeEl(content, isWord) {
    const el = document.createElement("div");
    el.className = "instability-text";
    el.textContent = content;
    el.style.fontFamily = typeface.value;
    el.style.fontWeight = currentFontWeight;
    return el;
  }

  // Compute per-letter drift transform (used by all effects when drift is active)
  function getDriftTransform(i, letterCount, baseX, baseY) {
    if (driftV <= 0) return `translate(-50%, -50%) translate(${baseX}px, ${baseY}px)`;
    const spacing = (i - (letterCount - 1) / 2) * 45;
    const fall   = Math.max(0, Math.sin(td * 0.8 + i) * 40 * driftV);
    const rotate = Math.sin(td + i) * 10 * driftV;
    const dx     = Math.sin(td + i) * 10 * driftV;
    return `translate(-50%, -50%) translate(${spacing + dx + baseX}px, ${fall + baseY}px) rotate(${rotate}deg)`;
  }

  const letters = text.split("");
  const letterCount = letters.length;

  // When drift is active, we work letter-by-letter.
  // When drift is off, we work whole-word.
  const useLetter = driftV > 0;
  const items = useLetter ? letters : [text];

  // ---------------- ECHO SHIFT ----------------
  if (echoV > 0) {
    const echoTime = t * 60;
    const echoLayers = [
      { x: -38 * echoV, y:  7 * echoV, opacity: 0.16, color: "#b8b8b8", scale: 1.015, phase: 0.2 },
      { x: -24 * echoV, y: -5 * echoV, opacity: 0.20, color: "#9f9f9f", scale: 1.008, phase: 1.4 },
      { x:  22 * echoV, y:  5 * echoV, opacity: 0.17, color: "#a8a8a8", scale: 1.012, phase: 2.6 },
      { x:  36 * echoV, y: -6 * echoV, opacity: 0.13, color: "#c2c2c2", scale: 1.018, phase: 3.8 }
    ];
    echoLayers.forEach(layer => {
      const floatX = Math.sin(echoTime + layer.phase) * 3 * echoV;
      const floatY = Math.cos(echoTime * 0.9 + layer.phase) * 3 * echoV;
      const rotate = Math.sin(echoTime * 0.7 + layer.phase) * 0.6 * echoV;
      items.forEach((content, i) => {
        const el = makeEl(content);
        el.style.color = layer.color;
        el.style.opacity = layer.opacity;
        el.style.mixBlendMode = "multiply";
        const baseX = layer.x + floatX;
        const baseY = layer.y + floatY;
        el.style.transform = useLetter
          ? getDriftTransform(i, letterCount, baseX, baseY) + ` scale(${layer.scale}) rotate(${rotate}deg)`
          : `translate(-50%, -50%) translate(${baseX}px, ${baseY}px) scale(${layer.scale}) rotate(${rotate}deg)`;
        instabilityLayer.appendChild(el);
      });
    });

    // Main echo word
    const mainFloatX = Math.sin(echoTime + 0.6) * 1.5 * echoV;
    const mainFloatY = Math.cos(echoTime * 0.8 + 0.6) * 1.2 * echoV;
    items.forEach((content, i) => {
      const el = makeEl(content);
      el.style.color = "#000";
      el.style.opacity = "0.68";
      el.style.mixBlendMode = "multiply";
      el.style.transform = getDriftTransform(i, letterCount, mainFloatX, mainFloatY);
      instabilityLayer.appendChild(el);
    });

    // Dark echo
    const darkX = -12 * echoV + Math.sin(echoTime + 2.1) * 2 * echoV;
    const darkY =   4 * echoV + Math.cos(echoTime + 2.1) * 1.5 * echoV;
    items.forEach((content, i) => {
      const el = makeEl(content);
      el.style.color = "#000";
      el.style.opacity = "0.18";
      el.style.mixBlendMode = "multiply";
      el.style.transform = getDriftTransform(i, letterCount, darkX, darkY);
      instabilityLayer.appendChild(el);
    });
  }

  // ---------------- WIREFRAME OFFSET ----------------
  if (wireV > 0) {
    const wireTime = t * 0.28;

    // Gray offset layers
    const grayLayers = [
      { x: -28 * wireV, y:  10 * wireV, rotate: -5 * wireV, opacity: 0.28, phase: 0   },
      { x:  24 * wireV, y:  -8 * wireV, rotate:  4 * wireV, opacity: 0.22, phase: 2.4 }
    ];
    grayLayers.forEach(layer => {
      const subtleX = Math.sin(wireTime + layer.phase) * 3 * wireV;
      const subtleY = Math.cos(wireTime * 0.8 + layer.phase) * 2 * wireV;
      const subtleR = Math.sin(wireTime * 0.7 + layer.phase) * 1.2 * wireV;
      const baseX = layer.x + subtleX;
      const baseY = layer.y + subtleY;
      items.forEach((content, i) => {
        const el = makeEl(content);
        el.style.webkitTextStroke = `${1.2 + wireV * 0.4}px #777`;
        el.style.color = "transparent";
        el.style.opacity = layer.opacity;
        el.style.transform = getDriftTransform(i, letterCount, baseX, baseY)
          + ` rotate(${layer.rotate + subtleR}deg)`;
        instabilityLayer.appendChild(el);
      });
    });

    // Black wireframe oscillating layers
    for (let wi = 0; wi < 3; wi++) {
      const offset = Math.sin(wireTime + wi) * 10 * wireV;
      items.forEach((content, i) => {
        const el = makeEl(content);
        el.style.webkitTextStroke = "1px black";
        el.style.color = "transparent";
        el.style.opacity = "1";
        el.style.transform = getDriftTransform(i, letterCount, offset, 0);
        instabilityLayer.appendChild(el);
      });
    }

    // Rotated black layer
    const bsX = Math.sin(wireTime + 1.2) * 2.5 * wireV;
    const bsY = Math.cos(wireTime * 0.7 + 1.2) * 1.5 * wireV;
    const bsR = Math.sin(wireTime * 0.6 + 1.2) * 0.8 * wireV;
    items.forEach((content, i) => {
      const el = makeEl(content);
      el.style.webkitTextStroke = "1px black";
      el.style.color = "transparent";
      el.style.opacity = "0.65";
      el.style.transform = getDriftTransform(i, letterCount, 12 * wireV + bsX, -4 * wireV + bsY)
        + ` rotate(${2.5 * wireV + bsR}deg)`;
      instabilityLayer.appendChild(el);
    });
  }

  // ---------------- HORIZONTAL DRIFT (solo) ----------------
  // Only runs when drift is active but no other effect needs the letters
  // (when combined, getDriftTransform already applies drift above)
  if (driftV > 0 && echoV === 0 && wireV === 0) {
    letters.forEach((letter, i) => {
      const el = makeEl(letter);
      el.style.color = "#000";
      el.style.opacity = "1";
      el.style.transform = getDriftTransform(i, letterCount, 0, 0);
      instabilityLayer.appendChild(el);

      const ghost = makeEl(letter);
      const spacing = (i - (letterCount - 1) / 2) * 45;
      ghost.style.color = "#000";
      ghost.style.opacity = "0.2";
      ghost.style.transform = `translate(-50%, -50%) translate(${spacing}px, 0px)`;
      instabilityLayer.appendChild(ghost);
    });
  }

  // When drift combines with echo/wire, we need the solid black drifting letters too
  if (driftV > 0 && (echoV > 0 || wireV > 0)) {
    letters.forEach((letter, i) => {
      const el = makeEl(letter);
      el.style.color = "#000";
      el.style.opacity = "1";
      el.style.transform = getDriftTransform(i, letterCount, 0, 0);
      instabilityLayer.appendChild(el);
    });
  }
}

function drawInstabilityToCanvas(ctx, canvasW, canvasH) {
  if (instabilityLayer.style.display === "none") return;

  const boxRect = outputBox.getBoundingClientRect();
  const scaleX = canvasW / boxRect.width;
  const scaleY = canvasH / boxRect.height;

  const els = instabilityLayer.querySelectorAll(".instability-text");

  els.forEach(el => {
    const elRect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);

    // Center of this element in outputBox space
    const cx = (elRect.left - boxRect.left + elRect.width / 2) * scaleX;
    const cy = (elRect.top - boxRect.top + elRect.height / 2) * scaleY;

    const fontSize = parseFloat(cs.fontSize) * scaleX;
    const fontFamily = cs.fontFamily || typeface.value;
    const opacity = parseFloat(el.style.opacity != null && el.style.opacity !== "" ? el.style.opacity : cs.opacity) || 1;
    const color = el.style.color || cs.color || "#000";
    const stroke = el.style.webkitTextStroke || "";
    const text = el.textContent;

    // Extract rotation from transform matrix
    const transform = new DOMMatrix(getComputedStyle(el).transform);
    const angle = Math.atan2(transform.b, transform.a);

    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = "multiply";
    ctx.font = `${currentFontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.translate(cx, cy);
    if (angle) ctx.rotate(angle);

    if (stroke) {
      const parts = stroke.match(/([\d.]+)px\s+(.+)/);
      if (parts) {
        ctx.strokeStyle = parts[2];
        ctx.lineWidth = parseFloat(parts[1]) * scaleX;
        ctx.strokeText(text, 0, 0);
      }
      ctx.fillStyle = "transparent";
    } else {
      ctx.fillStyle = color;
      ctx.fillText(text, 0, 0);
    }

    ctx.restore();
  });
}

function captureOutputAsCanvas(transparent = false) {
  const rect = outputBox.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio, 2);
  const w = Math.floor(rect.width * dpr);
  const h = Math.floor(rect.height * dpr);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");

  if (transparent) {
    ctx.clearRect(0, 0, w, h);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.globalCompositeOperation = 'source-over';

  // WebGL distortion (wave/fluid) — replaces text entirely
  if (effectCanvas.style.display !== "none") {
    ctx.drawImage(effectCanvas, 0, 0, w, h);
  }
  if (animate._distCanvas && animate._distCanvas.style.display !== "none") {
    ctx.drawImage(animate._distCanvas, 0, 0, w, h);
  }

  // Degradation — transparent canvas, effect + base text already composited inside
  if (degradationCanvas.style.display !== "none") {
    ctx.drawImage(degradationCanvas, 0, 0, w, h);
  }

  // Breakdown — transparent canvas, effect + base text already composited inside
  if (breakdownCanvas.style.display !== "none") {
    ctx.drawImage(breakdownCanvas, 0, 0, w, h);
  }

  // Chromatic — source-over on top
  if (chromaticCanvas.style.display !== "none") {
    ctx.drawImage(chromaticCanvas, 0, 0, w, h);
  }

  // If no canvas effect active, draw plain base text
  const anyCanvas = (effectCanvas.style.display !== "none") ||
    (animate._distCanvas && animate._distCanvas.style.display !== "none") ||
    (degradationCanvas.style.display !== "none") ||
    (breakdownCanvas.style.display !== "none");
  if (!anyCanvas) {
    const textSrc = buildTextSrc(w, h);
    ctx.drawImage(textSrc, 0, 0);
  }

  // Instability
  drawInstabilityToCanvas(ctx, w, h);

  return canvas;
}

function loadOmggif() {
  return new Promise((resolve, reject) => {
    if (window.GifWriter) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/omggif@1.0.10/omggif.js";
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// ── SIGNAL ARCHIVE ──
// Reads/writes to localStorage key 'signalArchive'.
// Each entry: { id, title, effect, date, pngDataUrl }

const ARCHIVE_KEY = 'signalArchive';

function getArchive() {
  try { return JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]'); }
  catch(e) { return []; }
}

const ARCHIVE_MAX_ENTRIES = 30;
const ARCHIVE_SIZE_WARN_BYTES = 3.5 * 1024 * 1024; // warn at 3.5 MB

function getArchiveSizeBytes(arr) {
  return new Blob([JSON.stringify(arr)]).size;
}

function trimArchiveToFit(arr) {
  // Remove oldest entries until we're under the warn threshold
  while (arr.length > 1 && getArchiveSizeBytes(arr) > ARCHIVE_SIZE_WARN_BYTES) {
    arr.shift(); // remove oldest (array is chronological)
  }
  return arr;
}

function saveArchive(arr) {
  // Strip video data — never store it; too large for localStorage
  const stripped = arr.map(e => {
    const copy = { ...e };
    delete copy.videoDataUrl;
    return copy;
  });

  // Cap entry count
  while (stripped.length > ARCHIVE_MAX_ENTRIES) stripped.shift();

  // If still too large, trim oldest entries
  const trimmed = trimArchiveToFit(stripped);

  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(trimmed));
  } catch(e) {
    // Last resort: keep only the 5 newest entries
    const minimal = trimmed.slice(-5);
    try {
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify(minimal));
      console.warn('Archive trimmed to 5 entries to fit storage.');
    } catch(e2) {
      alert('Archive storage is completely full. Please clear your browser storage and try again.');
    }
  }
}

function getActiveEffectLabel() {
  const labels = [];
  if (sv('distortion_wave')       > 0) labels.push('Wave Displacement');
  if (sv('distortion_chromatic')  > 0) labels.push('Chromatic Distortion');
  if (sv('distortion_fluid')      > 0) labels.push('Fluid Distortion');
  if (sv('instability_echo')      > 0) labels.push('Echo Shift');
  if (sv('instability_wireframe') > 0) labels.push('Wireframe Offset');
  if (sv('instability_drift')     > 0) labels.push('Horizontal Drift');
  if (sv('degradation_smear')     > 0) labels.push('Motion Smear');
  if (sv('degradation_gaussian')  > 0) labels.push('Gaussian Blur');
  if (sv('degradation_zoom')      > 0) labels.push('Zoom Blur');
  if (sv('breakdown_fragmentation')> 0) labels.push('Fragmentation');
  if (sv('breakdown_density')     > 0) labels.push('Density Collapse');
  if (sv('breakdown_noise')       > 0) labels.push('Noise Displacement');
  return labels.length ? labels.join(', ') : 'No Effect';
}

function renderArchive() {
  const grid  = document.getElementById('archiveGrid');
  const empty = document.getElementById('archiveEmpty');
  if (!grid || !empty) return;

  const archive = getArchive();
  grid.innerHTML = '';

  if (archive.length === 0) {
    empty.classList.add('visible');
    return;
  }
  empty.classList.remove('visible');

  // Newest first
  [...archive].reverse().forEach(entry => {
    const card = document.createElement('div');
    card.className = 'archive-card';

    const date = new Date(entry.date);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    const authorLine = entry.author
      ? `<div class="archive-card-author">by ${entry.author}</div>`
      : '';

    const slug = (entry.title || 'signal').replace(/\s+/g, '-').toLowerCase();

    card.innerHTML = `
      <img class="archive-card-thumb" src="${entry.pngDataUrl}" alt="${entry.title}" />
      <div class="archive-card-body">
        <div class="archive-card-title">${entry.title}</div>
        ${authorLine}
        <div class="archive-card-effect">${entry.effect}</div>
        <div class="archive-card-meta">${dateStr} &middot; ${timeStr}</div>
        <div class="archive-card-actions">
          <button data-id="${entry.id}" data-action="png">DOWNLOAD PNG</button>
          <button data-id="${entry.id}" data-action="delete" class="archive-delete-btn">DELETE</button>
        </div>
      </div>
    `;

    // PNG download
    card.querySelector('[data-action="png"]').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = entry.pngDataUrl;
      a.download = `${slug}.png`;
      a.click();
    });

    // Delete
    card.querySelector('[data-action="delete"]').addEventListener('click', () => {
      const archive = getArchive().filter(e => e.id !== entry.id);
      saveArchive(archive);
      renderArchive();
    });

    grid.appendChild(card);
  });
}

// ADD TO ARCHIVE button
document.getElementById('addToArchiveBtn').addEventListener('click', async () => {
  const titleInput  = document.getElementById('signalTitle');
  const authorInput = document.getElementById('signalAuthor');
  const title       = (titleInput.value.trim())  || 'Untitled Signal';
  const author      = (authorInput.value.trim())  || null;
  const effect      = getActiveEffectLabel();
  const btn         = document.getElementById('addToArchiveBtn');
  const slug        = title.replace(/\s+/g, '-').toLowerCase();

  btn.disabled    = true;
  btn.textContent = 'SAVING…';

  // ── Capture high-res PNG for the archive card (4× scale) ──
  const SCALE  = 4;
  const rect2  = outputBox.getBoundingClientRect();
  const hw     = Math.floor(rect2.width  * SCALE);
  const hh     = Math.floor(rect2.height * SCALE);

  renderer.setSize(hw, hh, false);
  uniforms.uResolution.value.set(hw, hh);
  updateTextTexture();
  renderer.render(scene, camera);

  const hiResCanvas = document.createElement('canvas');
  hiResCanvas.width  = hw;
  hiResCanvas.height = hh;
  const hiCtx = hiResCanvas.getContext('2d');
  hiCtx.fillStyle = '#ffffff';
  hiCtx.fillRect(0, 0, hw, hh);
  hiCtx.globalCompositeOperation = 'source-over';
  if (effectCanvas.style.display !== 'none') hiCtx.drawImage(effectCanvas, 0, 0, hw, hh);
  if (animate._distCanvas && animate._distCanvas.style.display !== 'none') hiCtx.drawImage(animate._distCanvas, 0, 0, hw, hh);
  if (degradationCanvas.style.display !== 'none') hiCtx.drawImage(degradationCanvas, 0, 0, hw, hh);
  if (breakdownCanvas.style.display   !== 'none') hiCtx.drawImage(breakdownCanvas,   0, 0, hw, hh);
  if (chromaticCanvas.style.display   !== 'none') hiCtx.drawImage(chromaticCanvas,   0, 0, hw, hh);
  const anyCanvasHi = (effectCanvas.style.display !== 'none') ||
    (animate._distCanvas && animate._distCanvas.style.display !== 'none') ||
    (degradationCanvas.style.display !== 'none') ||
    (breakdownCanvas.style.display   !== 'none');
  if (!anyCanvasHi) {
    const src = document.createElement('canvas');
    src.width = hw; src.height = hh;
    const sctx = src.getContext('2d');
    const baseSize = parseFloat(getComputedStyle(output).fontSize);
    sctx.font = `${currentFontWeight} ${Math.floor(baseSize * SCALE)}px ${typeface.value}`;
    sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
    sctx.fillStyle = '#000';
    sctx.fillText(getDisplayText(), hw / 2, hh / 2);
    hiCtx.drawImage(src, 0, 0);
  }
  drawInstabilityToCanvas(hiCtx, hw, hh);
  resizeWebGL();
  updateTextTexture();

  const imgDataUrl = hiResCanvas.toDataURL('image/png');

  // ── Save card to archive ──
  const entry = {
    id:         Date.now().toString(),
    title,
    author,
    effect,
    date:       new Date().toISOString(),
    pngDataUrl: imgDataUrl,
  };

  const archive = getArchive();
  archive.push(entry);
  saveArchive(archive);

  // Clear inputs
  titleInput.value  = '';
  authorInput.value = '';

  btn.textContent = 'ADD TO ARCHIVE';
  btn.disabled    = false;

  renderArchive();

  // Show toast
  const toast    = document.getElementById('archiveSavedToast');
  const viewBtn  = document.getElementById('viewArchiveBtn');
  const toastMsg = document.getElementById('toastMsg');
  toastMsg.textContent = `"${entry.title}" saved to archive.`;
  toast.style.display  = 'flex';

  viewBtn.onclick = () => {
    toast.style.display = 'none';
    const archiveTab = document.querySelector('[data-tab="examples"]');
    if (archiveTab) archiveTab.click();
  };

  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => { toast.style.display = 'none'; }, 8000);
});

// Render archive whenever the tab is opened
document.querySelectorAll('[data-tab="examples"]').forEach(el => {
  el.addEventListener('click', () => setTimeout(renderArchive, 50));
});

// Initial render
renderArchive();

resetBtn.onclick = () => {
  EFFECT_SLIDERS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = 0;
    updateSliderFill(id);
  });
  degradationCanvas.style.display = "none";
  breakdownCanvas.style.display = "none";
  chromaticCanvas.style.display = "none";
  instabilityLayer.style.display = "none";
  if (animate._distCanvas) animate._distCanvas.style.display = "none";
  output.style.opacity = "1";
  if (webglReady) {
    uniforms.uIntensity.value = 0;
    effectCanvas.style.display = "none";
  }
};

saveSvgBtn.onclick = async () => {
  saveSvgBtn.disabled = true;
  saveSvgBtn.textContent = "Saving...";

  const rect = outputBox.getBoundingClientRect();
  const SCALE = 4; // 4× resolution — crisp at any print/screen size
  const w = Math.floor(rect.width  * SCALE);
  const h = Math.floor(rect.height * SCALE);

  // Resize WebGL renderer to high-res, render, then restore
  renderer.setSize(w, h, false);
  uniforms.uResolution.value.set(w, h);
  updateTextTexture(); // re-rasterise text at 4× so it's sharp
  renderer.render(scene, camera);

  // Build high-res composite canvas
  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  // WebGL layers — already rendered at high-res
  if (effectCanvas.style.display !== 'none') ctx.drawImage(effectCanvas, 0, 0, w, h);
  if (animate._distCanvas && animate._distCanvas.style.display !== 'none') ctx.drawImage(animate._distCanvas, 0, 0, w, h);

  // Re-render canvas effects at high-res by temporarily overriding buildTextSrc
  const _origBuildTextSrc = buildTextSrc;
  const hiResBuildTextSrc = (bw, bh) => {
    const src = document.createElement('canvas');
    src.width = bw; src.height = bh;
    const sctx = src.getContext('2d');
    const fontFamily = typeface.value;
    const baseSize = parseFloat(getComputedStyle(output).fontSize);
    const fontSize = Math.floor(baseSize * SCALE);
    sctx.font = `${currentFontWeight} ${fontSize}px ${fontFamily}`;
    sctx.textAlign = 'center';
    sctx.textBaseline = 'middle';
    sctx.fillStyle = '#000';
    sctx.fillText(getDisplayText(), bw / 2, bh / 2);
    return src;
  };

  // Degradation / Breakdown / Chromatic — re-draw from their live canvases scaled up
  if (degradationCanvas.style.display !== 'none') ctx.drawImage(degradationCanvas, 0, 0, w, h);
  if (breakdownCanvas.style.display   !== 'none') ctx.drawImage(breakdownCanvas,   0, 0, w, h);
  if (chromaticCanvas.style.display   !== 'none') ctx.drawImage(chromaticCanvas,   0, 0, w, h);

  // Plain text if no canvas effects
  const anyCanvas = (effectCanvas.style.display !== 'none') ||
    (animate._distCanvas && animate._distCanvas.style.display !== 'none') ||
    (degradationCanvas.style.display !== 'none') ||
    (breakdownCanvas.style.display   !== 'none');
  if (!anyCanvas) ctx.drawImage(hiResBuildTextSrc(w, h), 0, 0);

  // Instability
  drawInstabilityToCanvas(ctx, w, h);

  // Restore renderer to screen size
  resizeWebGL();
  updateTextTexture();

  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = 'signal-type.png';
    a.click();
    URL.revokeObjectURL(url);
    saveSvgBtn.disabled    = false;
    saveSvgBtn.textContent = 'EXPORT PNG';
  }, 'image/png');
};

saveGifBtn.onclick = async () => {
  saveGifBtn.disabled = true;

  const rect = outputBox.getBoundingClientRect();
  const dpr  = Math.min(window.devicePixelRatio, 2);
  const w    = Math.floor(rect.width  * dpr);
  const h    = Math.floor(rect.height * dpr);

  // Offscreen canvas as the MediaRecorder source — no background fill = transparent
  const captureCanvas = document.createElement('canvas');
  captureCanvas.width  = w;
  captureCanvas.height = h;
  const captureCtx = captureCanvas.getContext('2d');

  // VP9 supports alpha channel (transparent WebM). Fall back gracefully.
  const alphaTypes = ['video/webm;codecs=vp9'];
  const fallbackTypes = ['video/webm;codecs=vp8','video/webm','video/mp4'];
  const mimeType = [...alphaTypes, ...fallbackTypes].find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
  const ext      = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';

  const stream   = captureCanvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks   = [];

  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    const url  = URL.createObjectURL(blob);

    // Show preview modal with white background so transparent video is visible
    const modal    = document.getElementById('videoPreviewModal');
    const videoEl  = document.getElementById('videoPreviewEl');
    const dlBtn    = document.getElementById('videoDownloadBtn');

    videoEl.src  = url;
    videoEl.loop = true;
    videoEl.play();
    modal.style.display = 'flex';

    // Wire download button
    dlBtn.onclick = () => {
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `signal-type.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    };

    // Close modal (both X button and backdrop click)
    const closeModal = () => {
      modal.style.display = 'none';
      videoEl.pause();
      URL.revokeObjectURL(url);
    };
    document.getElementById('videoModalClose').onclick = closeModal;
    document.getElementById('videoModalBackdrop').onclick = closeModal;

    saveGifBtn.disabled    = false;
    saveGifBtn.textContent = 'EXPORT VIDEO';
  };

  const totalFrames = 60;
  const frameDelay  = 1000 / 30;

  recorder.start();
  saveGifBtn.textContent = 'Recording...';

  for (let i = 0; i < totalFrames; i++) {
    await new Promise(r => setTimeout(r, frameDelay));
    if (typeof renderer !== 'undefined' && renderer) renderer.render(scene, camera);
    // Clear to transparent each frame — no white fill
    captureCtx.clearRect(0, 0, w, h);
    const frame = captureOutputAsCanvas(true);
    captureCtx.drawImage(frame, 0, 0, w, h);
    saveGifBtn.textContent = `Recording... ${Math.round((i+1)/totalFrames*100)}%`;
  }

  recorder.stop();
};