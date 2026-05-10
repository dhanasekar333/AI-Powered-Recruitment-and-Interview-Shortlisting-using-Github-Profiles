// ==========================================
// GitRecruit – Dashboard Scripts
// ==========================================

const $ = (id) => document.getElementById(id);

// ================= AUTH CHECK =================
async function checkAuth() {
  try {
    const res = await fetch('/api/user');
    if (!res.ok) throw new Error();
  } catch { window.location.href = '/login.html'; }
}
checkAuth();

// ================= JOB PERSISTENCE =================
const JOBS_KEY = 'gitrecruit_jobs';

function loadJobs() {
  try { return JSON.parse(localStorage.getItem(JOBS_KEY) || '[]'); }
  catch { return []; }
}
function saveJobs() {
  try { localStorage.setItem(JOBS_KEY, JSON.stringify(jobs)); }
  catch (e) { console.warn('localStorage write failed:', e); }
}

let jobs = loadJobs();
let currentJobIndex = null;

// ================= RENDER JOBS =================
function renderJobs() {
  const container = $('jobsList');
  if (!container) return;

  if (jobs.length === 0) {
    container.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:#94a3b8;">
        <div style="font-size:48px;margin-bottom:12px;">💼</div>
        <div style="font-size:18px;font-weight:600;color:#64748b;margin-bottom:6px;">No jobs yet</div>
        <div style="font-size:14px;">Click "+ New Job" to create your first listing</div>
      </div>`;
  } else {
    container.innerHTML = jobs.map((j, i) => `
      <div class="jd-card">
        <div class="jd-card-content" onclick="openDetail(${i})">
          <div class="jd-title">${j.title}</div>
          <div class="jd-role">${j.role}</div>
          <div class="jd-location">${j.loc}</div>
        </div>
        <div class="jd-card-actions">
          <button class="btn-search-candidates" onclick="searchCandidates(${i})">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Search Candidates
          </button>
          <button class="jd-delete-btn" onclick="deleteJobFromCard(${i})">
            <svg viewBox="0 0 24 24">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    `).join('');
  }

  $('pos-count').textContent = jobs.length;
  $('s-jobs').textContent    = jobs.length;
  updateStats();
}

renderJobs();

// ================= SEARCH CANDIDATES =================
window.searchCandidates = async function(i) {
  const job = jobs[i];

  const queryMap = {
    'react': 'react developer', 'next': 'nextjs developer',
    'python': 'python developer', 'node': 'nodejs developer',
    'java': 'java developer', 'angular': 'angular developer',
    'vue': 'vue developer', 'flutter': 'flutter developer',
    'django': 'django developer', 'fastapi': 'fastapi developer',
  };
  const roleLower = job.role.toLowerCase();
  let job_query = job.role; // default to full role name
  for (const [key, val] of Object.entries(queryMap)) {
    if (roleLower.includes(key)) { job_query = val; break; }
  }

  showResultsPanel(job, null, 'loading');

  try {
    // Trigger n8n — get jobId back immediately
    const triggerRes = await fetch('/api/search-candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_query,
        job_description: job.desc,
        skill: job.role,
        location: 'india',
        limit: 30
      })
    });

    if (!triggerRes.ok) {
      const err = await triggerRes.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${triggerRes.status}`);
    }

    const { jobId } = await triggerRes.json();
    if (!jobId) throw new Error('Server did not return a job ID');

    console.log(`Search started. Job ID: ${jobId}`);

    // Poll every 15 seconds, up to 25 minutes
    const MAX_POLLS = 100;
    let polls = 0;
    let stepInterval = null;

    // Animate loading steps every 3 minutes
    stepInterval = setInterval(() => {
      const steps = document.querySelectorAll('.loading-steps .step');
      const nextStep = Array.from(steps).findIndex(s => !s.classList.contains('active'));
      if (nextStep !== -1) steps[nextStep].classList.add('active');
    }, 3 * 60 * 1000);

    const pollTimer = setInterval(async () => {
      polls++;
      const elapsed = Math.floor(polls * 15 / 60);

      // Update elapsed time in loading panel
      const elapsedEl = document.getElementById('loadingElapsed');
      if (elapsedEl) elapsedEl.textContent = `${elapsed} min elapsed`;

      try {
        const statusRes  = await fetch(`/api/job-status/${jobId}`);
        const statusData = await statusRes.json();

        if (statusData.status === 'done') {
          clearInterval(pollTimer);
          clearInterval(stepInterval);
          jobs[i].analyzed = statusData.data?.top_candidates?.length || 0;
          saveJobs(); renderJobs();
          showResultsPanel(job, statusData.data, 'results');

        } else if (statusData.status === 'empty' || statusData.status === 'error' || statusData.status === 'not_found') {
          clearInterval(pollTimer);
          clearInterval(stepInterval);
          showResultsPanel(job, null, 'error', statusData.error || 'Workflow completed but returned no data.');

        } else if (polls >= MAX_POLLS) {
          clearInterval(pollTimer);
          clearInterval(stepInterval);
          showResultsPanel(job, null, 'error', 'Timed out waiting for n8n (25 minutes). Check n8n executions to see if the workflow is still running.');
        }
        // else status === 'pending' — keep polling

      } catch (pollErr) {
        console.warn(`Poll ${polls} failed:`, pollErr.message);
        // Don't stop polling on network errors — Render free tier has brief gaps
      }
    }, 15000);

  } catch (err) {
    showResultsPanel(job, null, 'error', err.message);
  }
};

// ================= RESULTS PANEL =================
function showResultsPanel(job, data, mode, errorMsg) {
  const existing = document.getElementById('resultsPanel');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = 'resultsPanel';
  panel.className = 'results-overlay open';

  if (mode === 'loading') {
    panel.innerHTML = `
      <div class="results-modal">
        <div class="results-hdr">
          <div>
            <div class="results-title">Searching Candidates</div>
            <div class="results-subtitle">${job.title}</div>
          </div>
          <div class="modal-x" onclick="closeResults()">✕</div>
        </div>
        <div class="loading-state" style="text-align:center;padding:40px 20px;">
          <div class="loading-spinner"></div>
          <div class="loading-text" style="font-size:16px;font-weight:600;margin:16px 0 8px;">
            AI is analyzing GitHub profiles
          </div>
          <div style="font-size:13px;color:#64748b;margin-bottom:4px;">
            This takes <strong>10–15 minutes</strong>. 
            This panel updates automatically — you don't need to do anything.
          </div>
          <div id="loadingElapsed" style="font-size:12px;color:#94a3b8;margin-bottom:24px;">0 min elapsed</div>
          <div class="loading-steps" style="text-align:left;display:inline-block;">
            <div class="step active">🔍 Searching GitHub profiles</div>
            <div class="step">📦 Fetching repository data</div>
            <div class="step">🧠 Running XGBoost scoring</div>
            <div class="step">✨ AI ranking & summarizing</div>
          </div>
        </div>
      </div>`;

  } else if (mode === 'error') {
    panel.innerHTML = `
      <div class="results-modal">
        <div class="results-hdr">
          <div class="results-title">Something went wrong</div>
          <div class="modal-x" onclick="closeResults()">✕</div>
        </div>
        <div style="padding:40px;text-align:center;">
          <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
          <div style="color:#ef4444;font-weight:600;margin-bottom:12px;">${errorMsg}</div>
          <div style="font-size:13px;color:#64748b;margin-bottom:24px;">
            Check: (1) n8n workflow is <strong>Active</strong> · 
            (2) <strong>N8N_WEBHOOK_URL</strong> is set in Render · 
            (3) HTTP Request callback node is the last node before "Respond to Webhook"
          </div>
          <button class="btn-ok" onclick="closeResults()">Close</button>
        </div>
      </div>`;

  } else {
    // mode === 'results'
    const candidates = data?.top_candidates || [];
    const total = data?.total_candidates_evaluated || 0;
    const role  = data?.role || job.title;

    panel.innerHTML = `
      <div class="results-modal">
        <div class="results-hdr">
          <div>
            <div class="results-title">Top Candidates Found</div>
            <div class="results-subtitle">${role} · ${total} profiles evaluated</div>
          </div>
          <div class="modal-x" onclick="closeResults()">✕</div>
        </div>

        <div class="results-summary-bar">
          <div class="rsb-item"><span class="rsb-val">${candidates.length}</span><span class="rsb-label">Shortlisted</span></div>
          <div class="rsb-item"><span class="rsb-val">${total}</span><span class="rsb-label">Evaluated</span></div>
          <div class="rsb-item"><span class="rsb-val">${candidates[0]?.final_score?.toFixed(1) || '—'}</span><span class="rsb-label">Top Score</span></div>
          <div class="rsb-item"><span class="rsb-val">${getAvgLevel(candidates)}</span><span class="rsb-label">Avg Level</span></div>
        </div>

        <div class="candidates-list">
          ${candidates.length > 0
            ? candidates.map((c, idx) => renderCandidateCard(c, idx)).join('')
            : `<div style="text-align:center;padding:60px 20px;color:#64748b;">
                <div style="font-size:48px;margin-bottom:12px;">🔍</div>
                <div style="font-size:18px;font-weight:600;margin-bottom:8px;">No candidates found</div>
                <div style="font-size:13px;">The n8n workflow ran successfully (${total} profiles evaluated) 
                but none passed the scoring threshold.<br>
                Try searching with a broader job description or different keywords.</div>
               </div>`
          }
        </div>

        <div class="results-ftr">
          <button class="btn-cancel" onclick="closeResults()">Close</button>
          ${candidates.length > 0 ? `<button class="btn-ok" onclick="exportResults('${encodeURIComponent(JSON.stringify(data))}')">Export Results</button>` : ''}
        </div>
      </div>`;
  }

  document.body.appendChild(panel);
  panel.addEventListener('click', e => { if (e.target === panel) closeResults(); });
}

// ================= CANDIDATE CARD =================
function renderCandidateCard(c, idx) {
  const levelColor = { 'Advanced': '#22c55e', 'Intermediate': '#3b82f6', 'Beginner': '#f59e0b' };
  const color    = levelColor[c.skill_level] || '#3b82f6';
  const rankEmoji = ['🥇','🥈','🥉','4️⃣','5️⃣'][idx] || `#${c.rank}`;
  const ghUrl    = `https://github.com/${c.candidate}`;
  const matchBar = Math.min(100, c.match_score || 0);
  const codeBar  = Math.min(100, c.code_score || 0);
  const credBar  = Math.min(100, c.credibility_score || 0);
  const skills   = (c.matched_skills || []).map(s => `<span class="skill-chip">${s}</span>`).join('');

  return `
    <div class="candidate-card" style="--rank-color:${color}">
      <div class="cc-header">
        <div class="cc-rank">${rankEmoji}</div>
        <div class="cc-avatar">${c.candidate.charAt(0).toUpperCase()}</div>
        <div class="cc-info">
          <a href="${ghUrl}" target="_blank" class="cc-name">${c.candidate}</a>
          <div class="cc-level" style="color:${color}">${c.skill_level}</div>
        </div>
        <div class="cc-final-score">
          <div class="cfs-val">${c.final_score?.toFixed(1) ?? '—'}</div>
          <div class="cfs-label">Score</div>
        </div>
      </div>
      <div class="cc-summary">${c.summary || ''}</div>
      <div class="cc-skills">${skills}</div>
      <div class="cc-bars">
        <div class="bar-row"><span class="bar-label">Match</span><div class="bar-track"><div class="bar-fill match" style="width:${matchBar}%"></div></div><span class="bar-val">${matchBar}</span></div>
        <div class="bar-row"><span class="bar-label">Code</span><div class="bar-track"><div class="bar-fill code" style="width:${codeBar}%"></div></div><span class="bar-val">${codeBar}</span></div>
        <div class="bar-row"><span class="bar-label">Cred</span><div class="bar-track"><div class="bar-fill cred" style="width:${credBar}%"></div></div><span class="bar-val">${credBar}</span></div>
      </div>
      <div class="cc-footer">
        <span class="cc-meta">⭐ ${c.active_repo_count} active repos</span>
        <span class="cc-meta">🤖 XGB: ${c.xgb_confidence}% confident</span>
        <a href="${ghUrl}" target="_blank" class="cc-gh-link">View GitHub →</a>
      </div>
    </div>`;
}

function getAvgLevel(candidates) {
  if (!candidates.length) return '—';
  const c = { Advanced: 0, Intermediate: 0, Beginner: 0 };
  candidates.forEach(x => { if (c[x.skill_level] !== undefined) c[x.skill_level]++; });
  if (c.Advanced >= c.Intermediate && c.Advanced >= c.Beginner) return 'Advanced';
  return c.Intermediate >= c.Beginner ? 'Intermediate' : 'Beginner';
}

window.closeResults = function() {
  const panel = document.getElementById('resultsPanel');
  if (panel) { panel.classList.remove('open'); setTimeout(() => panel.remove(), 300); }
};

window.exportResults = function(encodedData) {
  try {
    const data = JSON.parse(decodeURIComponent(encodedData));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `candidates-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    showToast('Results exported!');
  } catch(e) { showToast('Export failed'); }
};

// ================= STATS =================
function updateStats() {
  const total = jobs.reduce((s, j) => s + (j.analyzed || 0), 0);
  $('s-cand').textContent  = total;
  $('s-gh').textContent    = total;
  $('s-short').textContent = total > 0 ? Math.min(5, total) : 0;
}

// ================= MODALS =================
window.openDetail = function(i) {
  currentJobIndex = i;
  const j = jobs[i];
  $('detail-title').textContent = j.title;
  $('detail-role').textContent  = j.role;
  $('detail-desc').textContent  = j.desc;
  $('modal')?.classList.add('open');
};

window.deleteJob = function() {
  if (currentJobIndex !== null) {
    jobs.splice(currentJobIndex, 1); saveJobs(); renderJobs();
    currentJobIndex = null;
    $('modal')?.classList.remove('open');
    showToast('Job deleted!');
  }
};

window.deleteJobFromCard = function(i) {
  if (confirm('Delete this job listing?')) {
    jobs.splice(i, 1); saveJobs(); renderJobs();
    showToast('Job deleted!');
  }
};

window.openCreateJobModal = function() {
  $('jobRoleInput').value = '';
  $('jobDescInput').value = '';
  $('createJobModal')?.classList.add('open');
};

window.submitNewJob = function() {
  const role = $('jobRoleInput').value.trim();
  const desc = $('jobDescInput').value.trim();
  if (!role || !desc) { showToast('Please fill in all fields!'); return; }

  const colors = [
    { bg: 'rgba(34,197,94,0.15)',  color: '#22c55e' },
    { bg: 'rgba(59,130,246,0.15)', color: '#3b82f6' },
    { bg: 'rgba(239,68,68,0.15)',  color: '#ef4444' },
    { bg: 'rgba(168,85,247,0.15)', color: '#a855f7' },
    { bg: 'rgba(236,72,153,0.15)', color: '#ec4899' }
  ];
  const rc = colors[Math.floor(Math.random() * colors.length)];

  jobs.push({
    initials: role.charAt(0).toUpperCase(),
    bg: rc.bg, color: rc.color,
    title: role, role, desc,
    loc: 'Remote', type: 'Full-time', analyzed: 0, skills: []
  });

  saveJobs(); renderJobs();
  $('createJobModal')?.classList.remove('open');
  showToast('Job created! Click "Search Candidates" to find matches.');
};

const modal          = $('modal');
const createJobModal = $('createJobModal');
$('closeModal')?.addEventListener('click',          () => { modal?.classList.remove('open'); currentJobIndex = null; });
$('closeModal2')?.addEventListener('click',         () => { modal?.classList.remove('open'); currentJobIndex = null; });
$('closeCreateJobModal')?.addEventListener('click', () => createJobModal?.classList.remove('open'));
$('cancelCreateJob')?.addEventListener('click',     () => createJobModal?.classList.remove('open'));
modal?.addEventListener('click',          e => { if (e.target === modal)          { modal.classList.remove('open'); currentJobIndex = null; } });
createJobModal?.addEventListener('click', e => { if (e.target === createJobModal)  createJobModal.classList.remove('open'); });

// ================= TOAST =================
function showToast(msg) {
  const t = $('toast');
  if (t) { t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); }
}