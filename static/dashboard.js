// ==========================================
// GitRecruit – Dashboard Scripts
// ==========================================

const $ = (id) => document.getElementById(id);

// ================= AUTH CHECK =================
async function checkAuth() {
  try {
    const res = await fetch('/api/user');
    if (!res.ok) throw new Error();
  } catch {
    window.location.href = '/login.html';
  }
}
checkAuth();

// ================= JOB PERSISTENCE (localStorage) =================
const JOBS_KEY = 'gitrecruit_jobs';

function loadJobs() {
  try {
    const saved = localStorage.getItem(JOBS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function saveJobs() {
  try { localStorage.setItem(JOBS_KEY, JSON.stringify(jobs)); }
  catch (e) { console.warn('localStorage write failed:', e); }
}

// ================= JOB DATA =================
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
          <button class="btn-search-candidates" onclick="searchCandidates(${i})" title="Search Candidates">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Search Candidates
          </button>
          <button class="jd-delete-btn" onclick="deleteJobFromCard(${i})" title="Delete Job">
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
  $('s-jobs').textContent = jobs.length;
  updateStats();
}

renderJobs();

// ================= SEARCH CANDIDATES — async polling =================
window.searchCandidates = async function(i) {
  const job = jobs[i];

  const queryMap = {
    'react': 'react developer', 'next': 'nextjs developer',
    'python': 'python developer', 'node': 'nodejs developer',
    'java': 'java developer', 'angular': 'angular developer',
    'vue': 'vue developer', 'flutter': 'flutter developer',
  };
  const roleLower = job.role.toLowerCase();
  let job_query = 'developer';
  for (const [key, val] of Object.entries(queryMap)) {
    if (roleLower.includes(key)) { job_query = val; break; }
  }

  // Show loading panel immediately
  showResultsPanel(job, null, true);

  try {
    // Step 1 — Trigger n8n and get a jobId back instantly
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
      throw new Error(err.error || `HTTP ${triggerRes.status}`);
    }

    const { jobId } = await triggerRes.json();

    if (!jobId) throw new Error('Server did not return a jobId');

    // Step 2 — Poll every 15 seconds for up to 20 minutes
    const MAX_POLLS   = 80;  // 80 × 15s = 20 minutes
    const POLL_INTERVAL = 15000;
    let   polls       = 0;

    const pollTimer = setInterval(async () => {
      polls++;

      try {
        const statusRes  = await fetch(`/api/job-status/${jobId}`);
        const statusData = await statusRes.json();

        if (statusData.status === 'done') {
          clearInterval(pollTimer);

          // Parse the result data from n8n
          let data = statusData.data;
          if (data && data.output && typeof data.output === 'string') {
            try { data = JSON.parse(data.output); } catch { /* use as-is */ }
          } else if (data && data.output && typeof data.output === 'object') {
            data = data.output;
          }

          jobs[i].analyzed = data.top_candidates?.length || 0;
          saveJobs();
          renderJobs();
          showResultsPanel(job, data, false);

        } else if (statusData.status === 'error') {
          clearInterval(pollTimer);
          showResultsPanel(job, null, false, statusData.error || 'n8n workflow failed');

        } else if (polls >= MAX_POLLS) {
          clearInterval(pollTimer);
          showResultsPanel(job, null, false, 'Timed out after 20 minutes. The n8n workflow may still be running — check n8n executions.');
        }
        // else still 'pending' — keep polling
      } catch (pollErr) {
        console.warn('Poll error:', pollErr);
      }
    }, POLL_INTERVAL);

  } catch (err) {
    showResultsPanel(job, null, false, err.message);
    showToast('Failed to start search: ' + err.message);
  }
};

// ================= RESULTS PANEL =================
function showResultsPanel(job, data, loading, error) {
  const existing = document.getElementById('resultsPanel');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = 'resultsPanel';
  panel.className = 'results-overlay open';

  if (loading) {
    panel.innerHTML = `
      <div class="results-modal">
        <div class="results-hdr">
          <div>
            <div class="results-title">Searching Candidates</div>
            <div class="results-subtitle">${job.title}</div>
          </div>
          <div class="modal-x" onclick="closeResults()">✕</div>
        </div>
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <div class="loading-text">AI is analyzing GitHub profiles...</div>
          <div style="font-size:13px;color:#64748b;margin-top:8px;text-align:center;">
            This takes 10–15 minutes. This panel will update automatically when done.<br>
            You can close this and come back — the search keeps running.
          </div>
          <div class="loading-steps" style="margin-top:20px;">
            <div class="step active">🔍 Searching GitHub</div>
            <div class="step">📦 Fetching repositories</div>
            <div class="step">🧠 Running XGBoost analysis</div>
            <div class="step">✨ Ranking candidates</div>
          </div>
        </div>
      </div>`;
    animateLoadingSteps();

  } else if (error) {
    panel.innerHTML = `
      <div class="results-modal">
        <div class="results-hdr">
          <div class="results-title">Something went wrong</div>
          <div class="modal-x" onclick="closeResults()">✕</div>
        </div>
        <div class="error-state">
          <div class="error-icon">⚠️</div>
          <div class="error-msg">${error}</div>
          <p style="font-size:13px;color:#64748b;margin-top:8px;">
            Make sure your n8n workflow is <strong>Active</strong> and 
            <strong>N8N_WEBHOOK_URL</strong> is set in Render environment variables.
          </p>
          <button class="btn-ok" onclick="closeResults()">Close</button>
        </div>
      </div>`;

  } else {
    const candidates = data.top_candidates || [];
    const role  = data.role || job.title;
    const total = data.total_candidates_evaluated || 0;

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
            : '<div style="text-align:center;padding:40px;color:#64748b;">No candidates found. Try adjusting the job description.</div>'}
        </div>
        <div class="results-ftr">
          <button class="btn-cancel" onclick="closeResults()">Close</button>
          <button class="btn-ok" onclick="exportResults(${JSON.stringify(data).replace(/"/g, '&quot;')})">Export Results</button>
        </div>
      </div>`;
  }

  document.body.appendChild(panel);
  panel.addEventListener('click', e => { if (e.target === panel) closeResults(); });
}

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
    <div class="candidate-card" style="--rank-color: ${color}">
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
  if (c.Intermediate >= c.Beginner) return 'Intermediate';
  return 'Beginner';
}

function animateLoadingSteps() {
  const steps = document.querySelectorAll('.loading-steps .step');
  let i = 1;
  const interval = setInterval(() => {
    if (i < steps.length) { steps[i].classList.add('active'); i++; }
    else clearInterval(interval);
  }, 3 * 60 * 1000); // advance a step every 3 minutes
}

window.closeResults = function() {
  const panel = document.getElementById('resultsPanel');
  if (panel) { panel.classList.remove('open'); setTimeout(() => panel.remove(), 300); }
};

window.exportResults = function(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `candidates-${Date.now()}.json`; a.click();
  URL.revokeObjectURL(url);
  showToast('Results exported!');
};

// ================= STATS =================
function updateStats() {
  const total = jobs.reduce((s, j) => s + (j.analyzed || 0), 0);
  $('s-cand').textContent  = total;
  $('s-gh').textContent    = total;
  $('s-short').textContent = total > 0 ? Math.min(5, total) : 0;
}

// ================= MODAL =================
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
    jobs.splice(currentJobIndex, 1);
    saveJobs(); renderJobs(); currentJobIndex = null;
    $('modal')?.classList.remove('open');
    showToast('Job listing deleted!');
  }
};

window.deleteJobFromCard = function(i) {
  if (confirm('Delete this job listing?')) {
    jobs.splice(i, 1); saveJobs(); renderJobs();
    showToast('Job listing deleted!');
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
    title: role, role: role, desc: desc,
    loc: 'Remote', type: 'Full-time', analyzed: 0, skills: []
  });

  saveJobs(); renderJobs();
  $('createJobModal')?.classList.remove('open');
  showToast('Job created! Click "Search Candidates" to find matches.');
};

// ================= MODAL CLOSE =================
const modal          = $('modal');
const createJobModal = $('createJobModal');
$('closeModal')?.addEventListener('click',         () => { modal?.classList.remove('open'); currentJobIndex = null; });
$('closeModal2')?.addEventListener('click',        () => { modal?.classList.remove('open'); currentJobIndex = null; });
$('closeCreateJobModal')?.addEventListener('click', () => createJobModal?.classList.remove('open'));
$('cancelCreateJob')?.addEventListener('click',    () => createJobModal?.classList.remove('open'));
modal?.addEventListener('click',         e => { if (e.target === modal)          { modal.classList.remove('open'); currentJobIndex = null; } });
createJobModal?.addEventListener('click', e => { if (e.target === createJobModal) createJobModal.classList.remove('open'); });

// ================= TOAST =================
function showToast(msg) {
  const t = $('toast');
  if (t) { t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); }
}