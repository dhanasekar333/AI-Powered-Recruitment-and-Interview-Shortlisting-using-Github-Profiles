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

const DEFAULT_JOBS = []; // Start empty — user creates their own

function loadJobs() {
  try {
    const saved = localStorage.getItem(JOBS_KEY);
    return saved ? JSON.parse(saved) : DEFAULT_JOBS;
  } catch {
    return DEFAULT_JOBS;
  }
}

function saveJobs() {
  try {
    localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
  } catch (e) {
    console.warn('Could not save jobs to localStorage:', e);
  }
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
      <div class="empty-state">
        <div class="empty-icon">💼</div>
        <div class="empty-title">No jobs yet</div>
        <div class="empty-sub">Click "+ New Job" to create your first listing</div>
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

// ================= SEARCH CANDIDATES — proxied through backend =================
window.searchCandidates = async function(i) {
  const job = jobs[i];

  // Build query from role title
  const queryMap = {
    'react':   'react developer',
    'next':    'nextjs developer',
    'python':  'python developer',
    'node':    'nodejs developer',
    'java':    'java developer',
    'angular': 'angular developer',
    'vue':     'vue developer',
    'flutter': 'flutter developer',
    'golang':  'golang developer',
    'rust':    'rust developer',
  };
  const roleLower = job.role.toLowerCase();
  let job_query = 'developer';
  for (const [key, val] of Object.entries(queryMap)) {
    if (roleLower.includes(key)) { job_query = val; break; }
  }

  // Show loading panel
  showResultsPanel(job, null, true);

  try {
    // ✅ Calls backend proxy — avoids CORS issues with direct n8n calls
    const res = await fetch('/api/search-candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_query:       job_query,
        job_description: job.desc,
        skill:           job.role,
        location:        'india',
        limit:           30
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    const raw = await res.json();

    // Parse n8n output — handles both string and object formats
    let data = raw;
    if (raw.output && typeof raw.output === 'string') {
      try { data = JSON.parse(raw.output); } catch { data = raw; }
    } else if (raw.output && typeof raw.output === 'object') {
      data = raw.output;
    }

    // Update job analyzed count and save
    jobs[i].analyzed = data.top_candidates?.length || 0;
    saveJobs();
    renderJobs();

    showResultsPanel(job, data, false);

  } catch (err) {
    showResultsPanel(job, null, false, err.message);
    showToast('Failed to fetch candidates: ' + err.message);
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
          <div class="loading-steps">
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
          <p style="font-size:13px;color:#64748b;margin-top:8px;">Check that your n8n workflow is active and the N8N_WEBHOOK_URL is set in Render.</p>
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
          <div class="rsb-item">
            <span class="rsb-val">${candidates.length}</span>
            <span class="rsb-label">Shortlisted</span>
          </div>
          <div class="rsb-item">
            <span class="rsb-val">${total}</span>
            <span class="rsb-label">Evaluated</span>
          </div>
          <div class="rsb-item">
            <span class="rsb-val">${candidates[0]?.final_score?.toFixed(1) || '—'}</span>
            <span class="rsb-label">Top Score</span>
          </div>
          <div class="rsb-item">
            <span class="rsb-val">${getAvgLevel(candidates)}</span>
            <span class="rsb-label">Avg Level</span>
          </div>
        </div>

        <div class="candidates-list">
          ${candidates.length > 0
            ? candidates.map((c, idx) => renderCandidateCard(c, idx)).join('')
            : '<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">No candidates found</div><div class="empty-sub">Try adjusting the job description or role</div></div>'
          }
        </div>

        <div class="results-ftr">
          <button class="btn-cancel" onclick="closeResults()">Close</button>
          <button class="btn-ok" onclick="exportResults(${JSON.stringify(data).replace(/"/g, '&quot;')})">
            Export Results
          </button>
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

  const skills = (c.matched_skills || []).map(s =>
    `<span class="skill-chip">${s}</span>`).join('');

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
        <div class="bar-row">
          <span class="bar-label">Match</span>
          <div class="bar-track"><div class="bar-fill match" style="width:${matchBar}%"></div></div>
          <span class="bar-val">${matchBar}</span>
        </div>
        <div class="bar-row">
          <span class="bar-label">Code</span>
          <div class="bar-track"><div class="bar-fill code" style="width:${codeBar}%"></div></div>
          <span class="bar-val">${codeBar}</span>
        </div>
        <div class="bar-row">
          <span class="bar-label">Cred</span>
          <div class="bar-track"><div class="bar-fill cred" style="width:${credBar}%"></div></div>
          <span class="bar-val">${credBar}</span>
        </div>
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
  const counts = { Advanced: 0, Intermediate: 0, Beginner: 0 };
  candidates.forEach(c => { if (counts[c.skill_level] !== undefined) counts[c.skill_level]++; });
  if (counts.Advanced >= counts.Intermediate && counts.Advanced >= counts.Beginner) return 'Advanced';
  if (counts.Intermediate >= counts.Beginner) return 'Intermediate';
  return 'Beginner';
}

function animateLoadingSteps() {
  const steps = document.querySelectorAll('.loading-steps .step');
  let i = 1; // first step already active
  const interval = setInterval(() => {
    if (i < steps.length) {
      steps[i].classList.add('active');
      i++;
    } else {
      clearInterval(interval);
    }
  }, 8000);
}

window.closeResults = function() {
  const panel = document.getElementById('resultsPanel');
  if (panel) {
    panel.classList.remove('open');
    setTimeout(() => panel.remove(), 300);
  }
};

window.exportResults = function(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `candidates-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Results exported!');
};

// ================= STATS =================
function updateStats() {
  const totalAnalyzed = jobs.reduce((s, j) => s + (j.analyzed || 0), 0);
  $('s-cand').textContent  = totalAnalyzed;
  $('s-gh').textContent    = totalAnalyzed;
  $('s-short').textContent = totalAnalyzed > 0 ? Math.min(5, totalAnalyzed) : 0;
}

// ================= MODAL - VIEW JOB DETAILS =================
window.openDetail = function(i) {
  currentJobIndex = i;
  const j = jobs[i];
  $('detail-title').textContent = j.title;
  $('detail-role').textContent  = j.role;
  $('detail-desc').textContent  = j.desc;
  $('modal')?.classList.add('open');
};

// ================= DELETE =================
window.deleteJob = function() {
  if (currentJobIndex !== null) {
    jobs.splice(currentJobIndex, 1);
    saveJobs();
    renderJobs();
    currentJobIndex = null;
    $('modal')?.classList.remove('open');
    showToast('Job listing deleted!');
  }
};

window.deleteJobFromCard = function(i) {
  if (confirm('Delete this job listing?')) {
    jobs.splice(i, 1);
    saveJobs();
    renderJobs();
    showToast('Job listing deleted!');
  }
};

// ================= CREATE JOB =================
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
    loc: 'Remote', type: 'Full-time',
    analyzed: 0, skills: []
  });

  saveJobs(); // ✅ Persist to localStorage
  renderJobs();
  $('createJobModal')?.classList.remove('open');
  showToast('Job created! Click "Search Candidates" to find matches.');
};

// ================= MODAL CLOSE =================
const modal          = $('modal');
const createJobModal = $('createJobModal');

$('closeModal')?.addEventListener('click', () => { modal?.classList.remove('open'); currentJobIndex = null; });
$('closeModal2')?.addEventListener('click', () => { modal?.classList.remove('open'); currentJobIndex = null; });
$('closeCreateJobModal')?.addEventListener('click', () => createJobModal?.classList.remove('open'));
$('cancelCreateJob')?.addEventListener('click',     () => createJobModal?.classList.remove('open'));

modal?.addEventListener('click', e => {
  if (e.target === modal) { modal.classList.remove('open'); currentJobIndex = null; }
});
createJobModal?.addEventListener('click', e => {
  if (e.target === createJobModal) createJobModal.classList.remove('open');
});

// ================= TOAST =================
function showToast(message) {
  const toast = $('toast');
  if (toast) {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }
}