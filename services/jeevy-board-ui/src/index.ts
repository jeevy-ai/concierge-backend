/**
 * jeevy-board-ui — Wave 0 board test surface (YOU-573).
 *
 * Single Cloudflare Worker that:
 *  - GET / → serves self-contained HTML UI for all 3 product flows
 *  - POST /api/calendar/reschedule → proxies to ai-action-service-staging
 *  - POST /api/outreach/send → proxies to ai-action-service-staging
 *  - POST /api/interview/trigger → proxies to ai-action-service-staging
 *
 * Auth model: Path A (proxy). INTERNAL_API_SECRET held server-side only.
 * Board userId: board-noah (pre-provisioned, no Clerk account needed).
 */

export interface Env {
  INTERNAL_API_SECRET: string;
  AI_ACTION_SERVICE: Fetcher;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function proxyPost(
  service: Fetcher,
  path: string,
  secret: string,
  body: unknown,
  correlationId: string,
): Promise<Response> {
  const upstream = await service.fetch(`https://ai-action-service-staging${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": secret,
      "X-Correlation-Id": correlationId,
    },
    body: JSON.stringify(body),
  });
  const text = await upstream.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return json(parsed, upstream.status);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "POST") {
      const correlationId = `board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      if (url.pathname === "/api/calendar/reschedule") {
        const body = await request.json();
        return proxyPost(
          env.AI_ACTION_SERVICE,
          "/internal/workflow/calendar/reschedule",
          env.INTERNAL_API_SECRET,
          body,
          correlationId,
        );
      }

      if (url.pathname === "/api/outreach/send") {
        const body = (await request.json()) as Record<string, unknown>;
        return proxyPost(
          env.AI_ACTION_SERVICE,
          "/api/internal/outreach/send",
          env.INTERNAL_API_SECRET,
          { ...body, correlationId },
          correlationId,
        );
      }

      if (url.pathname === "/api/interview/trigger") {
        const body = await request.json();
        return proxyPost(
          env.AI_ACTION_SERVICE,
          "/internal/save-interview/trigger",
          env.INTERNAL_API_SECRET,
          body,
          correlationId,
        );
      }

      if (url.pathname === "/api/seed") {
        const body = await request.json();
        return proxyPost(
          env.AI_ACTION_SERVICE,
          "/api/demo/seed-nps-user",
          env.INTERNAL_API_SECRET,
          body,
          correlationId,
        );
      }
    }

    return json({ error: "Not found" }, 404);
  },
};

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Jeevy — Board Test Surface</title>
<style>
  :root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --border: #2d3048;
    --accent: #6c63ff;
    --accent-dim: #4a4580;
    --text: #e8e9f0;
    --muted: #8b8fa8;
    --ok: #22c55e;
    --err: #ef4444;
    --warn: #f59e0b;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.5; }
  .header { border-bottom: 1px solid var(--border); padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 16px; font-weight: 600; }
  .header .badge { background: var(--accent-dim); color: var(--accent); font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 500; }
  .header .uid { margin-left: auto; font-size: 12px; color: var(--muted); }
  .tabs { display: flex; border-bottom: 1px solid var(--border); padding: 0 24px; }
  .tab { padding: 12px 16px; cursor: pointer; color: var(--muted); font-size: 13px; font-weight: 500; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color 0.15s; }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .panel { display: none; padding: 24px; max-width: 800px; }
  .panel.active { display: block; }
  .section-title { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
  .section-desc { color: var(--muted); font-size: 13px; margin-bottom: 20px; }
  .form-group { margin-bottom: 16px; }
  label { display: block; font-size: 12px; font-weight: 500; color: var(--muted); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.04em; }
  input, select, textarea {
    width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
    color: var(--text); padding: 8px 12px; font-size: 13px; font-family: inherit;
    transition: border-color 0.15s;
  }
  input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); }
  textarea { resize: vertical; min-height: 80px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .btn {
    background: var(--accent); color: #fff; border: none; border-radius: 6px;
    padding: 9px 20px; font-size: 13px; font-weight: 600; cursor: pointer;
    transition: opacity 0.15s;
  }
  .btn:hover { opacity: 0.85; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-row { display: flex; gap: 10px; align-items: center; margin-top: 4px; }
  .status { font-size: 12px; color: var(--muted); }
  .result {
    margin-top: 20px; background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; overflow: hidden;
  }
  .result-header { padding: 8px 14px; font-size: 12px; font-weight: 600; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 8px; }
  .result-header.ok { color: var(--ok); }
  .result-header.err { color: var(--err); }
  .result-header.pending { color: var(--warn); }
  .result pre { padding: 14px; font-size: 12px; overflow-x: auto; font-family: 'SF Mono', 'Fira Code', monospace; white-space: pre-wrap; word-break: break-word; }
  .warn-box { background: #2d1f00; border: 1px solid #78350f; border-radius: 6px; padding: 10px 14px; font-size: 12px; color: var(--warn); margin-bottom: 16px; }
  .info-box { background: #0d1f2d; border: 1px solid #1e3a4f; border-radius: 6px; padding: 10px 14px; font-size: 12px; color: #7dd3fc; margin-bottom: 16px; }
  select option { background: var(--surface); }
  /* loading spinner */
  .btn { display:flex;align-items:center;justify-content:center;gap:8px; }
  .spinner { display:none;width:13px;height:13px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:spin .65s linear infinite;flex-shrink:0; }
  .btn.loading .spinner { display:inline-block; }
  .btn.loading .btn-label { opacity:.75; }
  @keyframes spin { to { transform:rotate(360deg); } }
  /* toasts */
  #toast-rack { position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none; }
  .toast { pointer-events:auto;background:#1e2130;border:1px solid var(--border);border-radius:8px;padding:10px 16px;font-size:13px;color:var(--text);display:flex;align-items:center;gap:10px;min-width:240px;max-width:380px;box-shadow:0 4px 20px rgba(0,0,0,.5);animation:toastIn .18s ease-out; }
  .toast.ok { border-left:3px solid var(--ok); }
  .toast.err { border-left:3px solid var(--err); }
  @keyframes toastIn { from { transform:translateX(16px);opacity:0; } to { transform:none;opacity:1; } }
  @keyframes toastOut { to { transform:translateX(16px);opacity:0; } }
</style>
</head>
<body>
<div class="header">
  <h1>Jeevy</h1>
  <span class="badge">Wave 0 Board Test</span>
  <span class="uid">userId: board-noah &nbsp;·&nbsp; env: staging</span>
</div>

<div class="tabs">
  <div class="tab" onclick="switchTab('calendar')">Calendar Reschedule</div>
  <div class="tab" onclick="switchTab('outreach')">Outreach Send</div>
  <div class="tab" onclick="switchTab('interview')">Interview Trigger</div>
  <div class="tab active" onclick="switchTab('demo')">🎬 Demo Flow</div>
</div>

<!-- CALENDAR RESCHEDULE -->
<div id="panel-calendar" class="panel">
  <div class="section-title">Calendar Reschedule</div>
  <div class="section-desc">
    POST /internal/workflow/calendar/reschedule via staging proxy.<br>
    Sandbox mode: Google Calendar API not called — fixture events used (CAL-01, CAL-02).
  </div>
  <div class="info-box">Sandbox mode active on staging. Event lookup uses fixtures, no real Google API calls.</div>

  <div class="form-group">
    <label>operatorId</label>
    <input id="cal-operator" value="board-noah" />
  </div>
  <div class="form-group">
    <label>eventId (sandbox fixtures: CAL-01, CAL-02)</label>
    <input id="cal-event" value="CAL-01" />
  </div>
  <div class="row">
    <div class="form-group">
      <label>newStartIso (ISO 8601)</label>
      <input id="cal-start" value="2026-05-28T10:00:00Z" />
    </div>
    <div class="form-group">
      <label>newEndIso (ISO 8601)</label>
      <input id="cal-end" value="2026-05-28T11:00:00Z" />
    </div>
  </div>
  <div class="form-group">
    <label>reason (optional)</label>
    <input id="cal-reason" placeholder="Board test reschedule" />
  </div>
  <div class="btn-row">
    <button class="btn" id="btn-calendar" onclick="submitCalendar()"><span class="btn-label">Run Reschedule</span><span class="spinner"></span></button>
    <span class="status" id="cal-status"></span>
  </div>
  <div id="cal-result"></div>
</div>

<!-- OUTREACH SEND -->
<div id="panel-outreach" class="panel">
  <div class="section-title">Outreach Send</div>
  <div class="section-desc">
    POST /api/internal/outreach/send via staging proxy.<br>
    Policy-gated: requires approvalToken (any non-empty value). Sends a real email via Resend.
  </div>
  <div class="warn-box">⚠ This sends a REAL email via Resend on staging. Use your own address for testing.</div>

  <div class="form-group">
    <label>to (email address)</label>
    <input id="out-to" placeholder="you@example.com" />
  </div>
  <div class="form-group">
    <label>subject</label>
    <input id="out-subject" value="Jeevy board test — outreach" />
  </div>
  <div class="form-group">
    <label>body</label>
    <textarea id="out-body">Hi,\n\nThis is a board test outreach send from Jeevy staging.\n\n— Jeevy</textarea>
  </div>
  <div class="row">
    <div class="form-group">
      <label>actionClass</label>
      <select id="out-class">
        <option value="outreach_send">outreach_send</option>
        <option value="calendar_write">calendar_write</option>
        <option value="travel_book">travel_book</option>
      </select>
    </div>
    <div class="form-group">
      <label>approvalToken (any non-empty string)</label>
      <input id="out-token" value="board-test-2026-05-21" />
    </div>
  </div>
  <div class="btn-row">
    <button class="btn" id="btn-outreach" onclick="submitOutreach()"><span class="btn-label">Send Outreach</span><span class="spinner"></span></button>
    <span class="status" id="out-status"></span>
  </div>
  <div id="out-result"></div>
</div>

<!-- INTERVIEW TRIGGER -->
<div id="panel-interview" class="panel">
  <div class="section-title">Interview Trigger (Save-Interview)</div>
  <div class="section-desc">
    POST /internal/save-interview/trigger via staging proxy.<br>
    Triggers the scheduling invite flow for a user. Sends a real email via Resend if dedup passes.
  </div>
  <div class="warn-box">⚠ Sends a REAL scheduling invite email if dedup passes. Use your own address.</div>

  <div class="form-group">
    <label>userId</label>
    <input id="int-uid" value="board-noah" />
  </div>
  <div class="form-group">
    <label>email</label>
    <input id="int-email" placeholder="you@example.com" />
  </div>
  <div class="form-group">
    <label>firstName (optional)</label>
    <input id="int-name" placeholder="Noah" />
  </div>
  <div class="btn-row">
    <button class="btn" id="btn-interview" onclick="submitInterview()"><span class="btn-label">Trigger Interview Invite</span><span class="spinner"></span></button>
    <span class="status" id="int-status"></span>
  </div>
  <div id="int-result"></div>
</div>

<!-- DEMO FLOW -->
<div id="panel-demo" class="panel active">
  <div class="section-title">NPS-Seed → Interview Trigger Demo</div>
  <div class="section-desc">
    End-to-end board demo: seed a test user with a low NPS score, then fire the interview invite.<br>
    Step 1 sets NPS=3 (detractor) and clears dedup. Step 2 sends the real invite email.
  </div>
  <div class="info-box">⚡ Staging only. Step 2 sends a <strong>real email</strong> via Resend. Use your own address.</div>

  <div class="form-group">
    <label>userId (unique per run to avoid dedup collisions)</label>
    <input id="demo-uid" value="" />
  </div>
  <div class="form-group">
    <label>email — where to receive the invite</label>
    <input id="demo-email" placeholder="you@example.com" />
  </div>
  <div class="form-group">
    <label>firstName (optional)</label>
    <input id="demo-name" placeholder="Noah" />
  </div>

  <div style="margin-bottom:12px;">
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Step 1</div>
    <div class="btn-row">
      <button class="btn" id="btn-seed" onclick="runSeed()"><span class="btn-label">Seed test user</span><span class="spinner"></span></button>
      <span class="status" id="seed-status"></span>
    </div>
    <div id="seed-result"></div>
  </div>

  <div id="step2-section" style="opacity:.35;pointer-events:none;">
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Step 2</div>
    <div class="btn-row">
      <button class="btn" id="btn-trigger" onclick="runTrigger()"><span class="btn-label">Trigger interview invite</span><span class="spinner"></span></button>
      <span class="status" id="trigger-status"></span>
    </div>
    <div id="trigger-result"></div>
  </div>
</div>

<div id="toast-rack"></div>

<script>
function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

function showToast(msg, type) {
  const rack = document.getElementById('toast-rack');
  const t = document.createElement('div');
  t.className = 'toast ' + (type || 'ok');
  t.textContent = msg;
  rack.appendChild(t);
  const remove = () => { t.style.animation = 'toastOut .18s ease-in forwards'; setTimeout(() => t.remove(), 180); };
  setTimeout(remove, 4000);
}

function friendlyError(status, data) {
  if (data && typeof data === 'object') {
    const e = String(data.error || data.message || '');
    if (e.includes('adapter') || e.includes('send_failed') || e.includes('Resend')) return 'Email delivery failed. Check the address and try again.';
    if (e.includes('policy') || e.includes('PolicyBlocked') || e.includes('approval')) return 'Action blocked by policy. Check your approval token.';
    if (e.includes('dedup') || e.includes('already sent')) return 'Invite already sent recently — dedup window active.';
    if (e.length > 0 && e.length < 200) return e;
  }
  if (status === 502 || status === 503) return 'Service temporarily unavailable. Try again in a moment.';
  if (status === 403) return 'Not authorised — policy may have blocked this action.';
  if (status === 400 || status === 422) return 'Invalid request. Check your inputs.';
  return 'Something went wrong (HTTP ' + status + '). See raw response below.';
}

const SUCCESS_MSGS = {
  'cal-result': 'Calendar reschedule queued',
  'out-result': 'Outreach email sent',
  'int-result': 'Interview invite triggered',
  'seed-result': 'Test user seeded',
  'trigger-result': 'Interview invite sent',
};

function switchTab(id) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    const ids = ['calendar', 'outreach', 'interview', 'demo'];
    t.classList.toggle('active', ids[i] === id);
  });
  document.querySelectorAll('.panel').forEach(p => {
    p.classList.toggle('active', p.id === 'panel-' + id);
  });
}

// Generate a default unique userId for the demo
(function() {
  const el = document.getElementById('demo-uid');
  if (el && !el.value) el.value = 'demo-' + Date.now().toString(36);
})();

function showResult(containerId, status, data) {
  const el = document.getElementById(containerId);
  const ok = status >= 200 && status < 300;
  const msg = ok ? (SUCCESS_MSGS[containerId] || 'Done') : friendlyError(status, data);
  el.innerHTML = \`
    <div class="result">
      <div class="result-header \${ok ? 'ok' : 'err'}">
        \${ok ? '✓' : '✗'} HTTP \${status} — \${msg}
      </div>
      <pre>\${JSON.stringify(data, null, 2)}</pre>
    </div>
  \`;
  showToast(msg, ok ? 'ok' : 'err');
}

async function callApi(path, body, statusEl) {
  const statusNode = document.getElementById(statusEl);
  statusNode.textContent = 'Calling…';
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    statusNode.textContent = '';
    return { status: res.status, data };
  } catch (err) {
    statusNode.textContent = 'Network error: ' + err.message;
    return null;
  }
}

async function submitCalendar() {
  const body = {
    operatorId: document.getElementById('cal-operator').value,
    eventId: document.getElementById('cal-event').value,
    newStartIso: document.getElementById('cal-start').value,
    newEndIso: document.getElementById('cal-end').value,
    isTest: true,
  };
  const reason = document.getElementById('cal-reason').value;
  if (reason) body.reason = reason;

  setLoading('btn-calendar', true);
  const r = await callApi('/api/calendar/reschedule', body, 'cal-status');
  setLoading('btn-calendar', false);
  if (r) showResult('cal-result', r.status, r.data);
}

async function submitOutreach() {
  const to = document.getElementById('out-to').value;
  if (!to) { showToast('Enter a recipient email', 'err'); return; }
  const body = {
    actionClass: document.getElementById('out-class').value,
    channel: 'email',
    to: [to],
    subject: document.getElementById('out-subject').value,
    body: document.getElementById('out-body').value,
    approvalToken: document.getElementById('out-token').value,
  };
  setLoading('btn-outreach', true);
  const r = await callApi('/api/outreach/send', body, 'out-status');
  setLoading('btn-outreach', false);
  if (r) showResult('out-result', r.status, r.data);
}

async function submitInterview() {
  const email = document.getElementById('int-email').value;
  if (!email) { showToast('Enter an email address', 'err'); return; }
  const body = {
    userId: document.getElementById('int-uid').value,
    email,
  };
  const firstName = document.getElementById('int-name').value;
  if (firstName) body.firstName = firstName;

  setLoading('btn-interview', true);
  const r = await callApi('/api/interview/trigger', body, 'int-status');
  setLoading('btn-interview', false);
  if (r) showResult('int-result', r.status, r.data);
}

async function runSeed() {
  const userId = document.getElementById('demo-uid').value;
  const email = document.getElementById('demo-email').value;
  if (!userId) { showToast('Enter a userId', 'err'); return; }
  if (!email) { showToast('Enter an email address', 'err'); return; }
  const body = { userId, email };
  const firstName = document.getElementById('demo-name').value;
  if (firstName) body.firstName = firstName;

  setLoading('btn-seed', true);
  const r = await callApi('/api/seed', body, 'seed-status');
  setLoading('btn-seed', false);
  if (!r) return;
  showResult('seed-result', r.status, r.data);
  if (r.status >= 200 && r.status < 300) {
    const step2 = document.getElementById('step2-section');
    step2.style.opacity = '1';
    step2.style.pointerEvents = 'auto';
  }
}

async function runTrigger() {
  const userId = document.getElementById('demo-uid').value;
  const email = document.getElementById('demo-email').value;
  const body = { userId, email };
  const firstName = document.getElementById('demo-name').value;
  if (firstName) body.firstName = firstName;

  setLoading('btn-trigger', true);
  const r = await callApi('/api/interview/trigger', body, 'trigger-status');
  setLoading('btn-trigger', false);
  if (r) showResult('trigger-result', r.status, r.data);
}
</script>
</body>
</html>`;
