/* ---------- DOM ---------- */
const svg = document.getElementById("dial");
const trackArc = document.getElementById("trackArc");
const valueArc = document.getElementById("valueArc");
const handle = document.getElementById("handle");
const label = document.getElementById("valueLabel");

/* ---------- Geometry: single source of truth ---------- */
const CX = 100;
const CY = 100;
const R = 80;
const START_ANGLE = 135; // degrees; 0 = right, +90 = down (SVG y axis points down)
const SWEEP = 270;       // total arc length in degrees (gap = 360 - SWEEP)

function point(angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: CX + R * Math.cos(rad),
    y: CY + R * Math.sin(rad),
  };
}

function arcPathD() {
  const start = point(START_ANGLE);
  const end = point(START_ANGLE + SWEEP);
  const largeArc = SWEEP > 180 ? 1 : 0;
  const fmt = (n) => +n.toFixed(3);
  return `M ${fmt(start.x)} ${fmt(start.y)} A ${R} ${R} 0 ${largeArc} 1 ${fmt(end.x)} ${fmt(end.y)}`;
}

/* ---------- State ---------- */
let value = 0;
let dragging = false;

/* ---------- Backend bridge (Go) ---------- */
function backend() {
  return window.go?.main?.App ?? null;
}

// In dev-server/browser mode the Wails runtime is injected a moment after
// page load; poll briefly so we never miss it. Instant in the desktop app.
async function waitForBackend(timeoutMs = 3000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs) {
    const app = backend();
    if (app?.GetValue) return app;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

let sendInFlight = false;
let sendPending = false;

// Coalesce sends: at most one SetValue in flight, latest value wins.
async function sendToGo() {
  const app = backend();
  if (!app?.SetValue) return;

  if (sendInFlight) {
    sendPending = true;
    return;
  }

  sendInFlight = true;
  try {
    do {
      sendPending = false;
      await app.SetValue(Math.round(value));
    } while (sendPending);
  } catch (err) {
    console.error("SetValue failed:", err);
  } finally {
    sendInFlight = false;
  }
}

/* ---------- Rendering ---------- */
function render(nextValue) {
  value = Math.max(0, Math.min(100, nextValue));
  const shown = Math.round(value);

  // Hide a zero-length arc: round linecaps would draw it as a dot.
  valueArc.style.visibility = value > 0 ? "visible" : "hidden";
  valueArc.style.strokeDasharray = `${value} 100`;

  const p = point(START_ANGLE + (value / 100) * SWEEP);
  handle.setAttribute("cx", p.x);
  handle.setAttribute("cy", p.y);

  label.textContent = shown;
  svg.setAttribute("aria-valuenow", shown);
  svg.setAttribute("aria-valuetext", `${shown} out of 100`);
}

function renderFromPointer(event) {
  const rect = svg.getBoundingClientRect();

  // Map screen pixels to the 200x200 viewBox.
  const x = ((event.clientX - rect.left) / rect.width) * 200;
  const y = ((event.clientY - rect.top) / rect.height) * 200;

  let angle = (Math.atan2(y - CY, x - CX) * 180) / Math.PI;
  if (angle < 0) angle += 360;

  let rel = angle - START_ANGLE;
  if (rel < 0) rel += 360;

  // Inside the gap: snap to whichever end is nearer.
  if (rel > SWEEP) {
    rel = rel < SWEEP + (360 - SWEEP) / 2 ? SWEEP : 0;
  }

  render((rel / SWEEP) * 100);
}

/* ---------- Pointer input ---------- */
svg.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || event.button !== 0) return;
  event.preventDefault(); // no text selection
  dragging = true;
  svg.classList.add("dragging");
  try {
    svg.setPointerCapture(event.pointerId);
  } catch {
    /* pointer may already be gone */
  }
  renderFromPointer(event);
  sendToGo();
});

svg.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  renderFromPointer(event);
  sendToGo();
});

function stopDragging() {
  dragging = false;
  svg.classList.remove("dragging");
}

svg.addEventListener("pointerup", stopDragging);
svg.addEventListener("pointercancel", stopDragging);

/* ---------- Keyboard input ---------- */
svg.addEventListener("keydown", (event) => {
  const step = event.shiftKey ? 10 : 1;

  const apply = (next) => {
    render(next);
    sendToGo();
    event.preventDefault();
  };

  switch (event.key) {
    case "ArrowRight":
    case "ArrowUp":
      return apply(value + step);
    case "ArrowLeft":
    case "ArrowDown":
      return apply(value - step);
    case "PageUp":
      return apply(value + 10);
    case "PageDown":
      return apply(value - 10);
    case "Home":
      return apply(0);
    case "End":
      return apply(100);
  }
});

/* ---------- Init ---------- */
const d = arcPathD();
trackArc.setAttribute("d", d);
valueArc.setAttribute("d", d);

render(42); // optimistic paint; corrected below once Go answers

(async () => {
  const app = await waitForBackend();
  if (!app?.GetValue) return;
  try {
    render(await app.GetValue());
  } catch (err) {
    console.error("GetValue failed:", err);
  }
})();