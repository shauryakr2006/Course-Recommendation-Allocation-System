/* ============================================================
   Course Recommendation & Allocation System — app.js
   All application logic. No external dependencies.
   ============================================================ */

let globalOverview = null;
let globalCourses = [];
let globalTags = [];
let allStudents = [];
let demoStudents = [];
let selectedStudentId = 1;
let currentCourseTagFilter = 'ALL';

// Allocations Pagination State
let allAllocations = [];
let filteredAllocations = [];
let allocCurrentPage = 1;
const allocPageSize = 15;

document.addEventListener('DOMContentLoaded', async () => {
  await loadTags();
  await loadCoursesCatalog();
  await loadOverview();
  await loadDemoStudents();
  await loadStudentsList();
  populateCourseDropdowns();
});

async function loadTags() {
  try {
    const res = await fetch('/api/tags');
    globalTags = await res.json();
    const container = document.getElementById('add-tag-checkboxes');
    container.innerHTML = globalTags.map(t => `
      <label class="tag-checkbox-label">
        <input type="checkbox" name="add_tags" value="${t.tag_id}">
        <span>${t.tag_name}</span>
      </label>
    `).join('');
  } catch (e) {
    console.error("Failed to load tags", e);
  }
}

function populateCourseDropdowns() {
  const dropdowns = document.querySelectorAll('.select-course-dropdown');
  dropdowns.forEach(dd => {
    const isOpt = dd.id.includes('3');
    dd.innerHTML = (isOpt ? `<option value="">-- Optional Choice 3 --</option>` : '') +
      globalCourses.map(c => `
        <option value="${c.course_id}">${c.course_code} - ${c.course_name} (Min ${c.min_cgpa_required})</option>
      `).join('');
  });
}

// =========================================================================
// DEMO SANDBOX TAB
// =========================================================================
async function loadDemoStudents() {
  try {
    const res = await fetch('/api/demo/students');
    demoStudents = await res.json();
    renderDemoCohort();
  } catch (e) {
    console.error("Failed to load demo students", e);
  }
}

function renderDemoCohort() {
  document.getElementById('demo-student-count').innerText = demoStudents.length;
  const tbody = document.getElementById('demo-students-table-body');

  if (demoStudents.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No students in cohort</td></tr>`;
    return;
  }

  tbody.innerHTML = demoStudents.map(s => {
    const isAllotted = s.allotted_status === 'ALLOTTED';
    const outcomeBadge = isAllotted
      ? `<span class="badge badge-allotted"><span class="dot dot-green"></span>ALLOTTED: ${s.allotted_course}</span>`
      : `<span class="badge badge-unallotted"><span class="dot dot-grey"></span>UNALLOTTED</span>`;

    const choicesList = s.course_preferences.map(cp => {
      let cls = 'choice-badge choice-allotted';
      if (cp.alloc_status === 'WAITLISTED') cls = 'choice-badge choice-waitlisted';
      if (cp.alloc_status === 'REJECTED') cls = 'choice-badge choice-rejected';
      return `<span class="${cls}">#${cp.preference_rank} ${cp.course_code} <span class="choice-status">(${cp.alloc_status.slice(0,4)})</span></span>`;
    }).join(' ');

    return `
      <tr class="trow-hover">
        <td class="td-pad">
          <div class="student-cell">
            <div class="avatar avatar-sm">${s.name.split(' ').map(n=>n[0]).join('')}</div>
            <div>
              <h4 class="student-name">${s.name}</h4>
              <p class="student-sub">${s.department}</p>
            </div>
          </div>
        </td>
        <td class="td-pad">
          <div class="cgpa-cell">
            <span class="mono font-bold cgpa-val">${s.cgpa}</span>
          </div>
        </td>
        <td class="td-pad">
          <div class="choices-wrap">${choicesList || '<span class="text-muted italic">No choices</span>'}</div>
        </td>
        <td class="td-pad">
          <div>${outcomeBadge}</div>
          ${s.allocation_reason ? `<div class="small text-muted" style="margin-top:0.25rem;font-size:0.67rem;line-height:1.35;max-width:240px">${s.allocation_reason}</div>` : ''}
        </td>
        <td class="td-pad td-right">
          <button onclick="openEditStudentModal(${s.student_id})" class="btn btn-xs btn-ghost">✎ Edit</button>
          <button onclick="deleteDemoStudent(${s.student_id}, '${s.name}')" class="btn btn-xs btn-danger" title="Delete">🗑</button>
        </td>
      </tr>
    `;
  }).join('');

  renderDemoCourseBars();
}

function renderDemoCourseBars() {
  const container = document.getElementById('demo-courses-bars');
  if (!globalOverview || !globalOverview.courses) return;

  const coursesToShow = globalOverview.courses.slice(0, 6);
  container.innerHTML = coursesToShow.map(c => {
    const isFull = parseInt(c.current_allocations) >= parseInt(c.max_allocations);
    const barCls = isFull ? 'bar-full' : 'bar-ok';
    const badgeCls = isFull ? 'badge-status-full' : 'badge-status-ok';
    const badgeText = isFull ? 'FULL' : `${c.seats_remaining} left`;

    return `
      <div class="course-bar-card">
        <div class="course-bar-header">
          <div>
            <span class="course-bar-code">${c.course_code}</span>
            <span class="course-bar-name" title="${c.course_name}">${c.course_name}</span>
          </div>
          <span class="badge ${badgeCls}">${badgeText}</span>
        </div>
        <div>
          <div class="bar-label-row">
            <span>Allocated: <strong>${c.current_allocations}</strong> / ${c.max_allocations}</span>
            <span>${c.fill_pct}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-bar ${barCls}" style="width: ${c.fill_pct}%"></div>
          </div>
        </div>
        <div class="bar-footer">
          <span>Min CGPA: <strong>${c.min_cgpa_required}</strong></span>
          <span>${c.credits} Credits</span>
        </div>
      </div>
    `;
  }).join('');
}

// Quick tune CGPA
async function quickTuneCGPA(studentId, currentCgpa, delta) {
  const newCgpa = Math.max(0.0, Math.min(10.0, parseFloat((currentCgpa + delta).toFixed(2))));
  try {
    const res = await fetch('/api/update-cgpa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: studentId, cgpa: newCgpa })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      await fetch('/api/run-cycle', { method: 'POST' });
      await refreshAllData();
    }
  } catch (e) {
    showToast("Failed to update CGPA", "error");
  }
}

// Scenario 1: Boost Kabir
async function demoBoostKabir() {
  await quickTuneCGPA(3, 6.80, 1.40);
}

// Scenario 2: Drop Anika
async function demoDropAnika() {
  await quickTuneCGPA(8, 6.50, -0.01);
}

// Scenario 3: Add Top Student
async function demoAddTopStudent() {
  try {
    const res = await fetch('/api/demo/add-student', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: "Priya Sharma",
        email: "priya.sharma@sjce.edu",
        semester: "V",
        department: "CSE",
        cgpa: 9.60,
        tag_ids: [1, 3],
        course_ids: [3, 1]
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      await refreshAllData();
    }
  } catch (e) {
    showToast("Error adding topper", "error");
  }
}

// Reset Demo to 10 Students
async function resetDemoTo10() {
  if (!confirm("Reset database to clean 10-student cohort baseline?")) return;
  try {
    showToast("Resetting to 10 demo students...", "info");
    const res = await fetch('/api/demo/reset-10-students', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      document.getElementById('select-dataset').value = '10_students';
      await refreshAllData();
    }
  } catch (e) {
    showToast("Reset error", "error");
  }
}

// Dynamic Preference Rows Helper
function renderPreferenceRows(modalType, selectedCourseIds = []) {
  const container = document.getElementById(`${modalType}-course-preferences-list`);
  if (!container) return;

  // Guarantee minimum 2 preferences
  while (selectedCourseIds.length < 2) {
    selectedCourseIds.push('');
  }

  container.innerHTML = selectedCourseIds.map((cid, idx) => `
    <div class="flex items-center gap-2 pref-row-item" data-index="${idx}">
      <span class="small font-bold text-muted" style="width:4.8rem">Choice #${idx + 1}:</span>
      <select class="form-select select-course-dropdown flex-1 ${modalType}-course-select" required>
        <option value="">-- Select Elective --</option>
        ${globalCourses.map(c => `
          <option value="${c.course_id}" ${String(c.course_id) === String(cid) ? 'selected' : ''}>
            ${c.course_code} - ${c.course_name} (Min ${c.min_cgpa_required})
          </option>
        `).join('')}
      </select>
      ${idx >= 2 ? `
        <button type="button" onclick="removePreferenceRow('${modalType}', ${idx})" class="btn btn-xs btn-danger" title="Remove Choice">✕</button>
      ` : `<span style="width:24px"></span>`}
    </div>
  `).join('');

  updateAddPrefButtonState(modalType);
}

function addPreferenceRow(modalType) {
  const container = document.getElementById(`${modalType}-course-preferences-list`);
  const currentSelects = container.querySelectorAll(`.${modalType}-course-select`);
  if (currentSelects.length >= 5) {
    showToast("Maximum 5 course choices allowed", "info");
    return;
  }

  const selectedIds = Array.from(currentSelects).map(s => s.value);
  selectedIds.push('');
  renderPreferenceRows(modalType, selectedIds);
}

function removePreferenceRow(modalType, removeIdx) {
  const container = document.getElementById(`${modalType}-course-preferences-list`);
  const currentSelects = container.querySelectorAll(`.${modalType}-course-select`);
  if (currentSelects.length <= 2) {
    showToast("Minimum 2 course choices required", "info");
    return;
  }

  const selectedIds = Array.from(currentSelects)
    .filter((_, idx) => idx !== removeIdx)
    .map(s => s.value);
  renderPreferenceRows(modalType, selectedIds);
}

function updateAddPrefButtonState(modalType) {
  const container = document.getElementById(`${modalType}-course-preferences-list`);
  const btn = document.getElementById(`btn-add-pref-${modalType}`);
  if (!container || !btn) return;
  const count = container.querySelectorAll(`.${modalType}-course-select`).length;
  btn.style.display = count >= 5 ? 'none' : 'inline-flex';
}

// Open Add Student Modal
function openAddStudentModal() {
  document.getElementById('form-add-student').reset();
  renderPreferenceRows('add', ['', '']);
  document.getElementById('modal-add-student').classList.remove('hidden');
}

// Submit Add Student
async function submitAddStudent(e) {
  e.preventDefault();
  const name = document.getElementById('add-stu-name').value.trim();
  const cgpa = parseFloat(document.getElementById('add-stu-cgpa').value);
  const semester = document.getElementById('add-stu-sem').value;
  const department = document.getElementById('add-stu-dept').value;

  const tagCheckboxes = document.querySelectorAll('input[name="add_tags"]:checked');
  const tag_ids = Array.from(tagCheckboxes).map(cb => parseInt(cb.value));

  const courseSelects = document.querySelectorAll('.add-course-select');
  const course_ids = Array.from(courseSelects).map(s => parseInt(s.value)).filter(val => !isNaN(val) && val > 0);

  if (course_ids.length < 2) {
    showToast("Please choose at least 2 course choices", "error");
    return;
  }

  // Ensure unique course selections
  if (new Set(course_ids).size !== course_ids.length) {
    showToast("Each course choice must be distinct", "error");
    return;
  }

  try {
    const res = await fetch('/api/demo/add-student', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, semester, department, cgpa, tag_ids, course_ids })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      closeModal('modal-add-student');
      await refreshAllData();
    } else {
      showToast(`Error: ${data.error}`, "error");
    }
  } catch (e) {
    showToast("Failed to add student", "error");
  }
}

// Open Edit Student Modal
function openEditStudentModal(studentId) {
  const student = demoStudents.find(s => s.student_id == studentId);
  if (!student) return;

  document.getElementById('edit-stu-id').value = student.student_id;
  document.getElementById('edit-stu-name').value = student.name;
  document.getElementById('edit-stu-cgpa').value = student.cgpa;
  document.getElementById('edit-stu-dept').value = student.department;

  const existingCourseIds = student.course_preferences.map(cp => cp.course_id);
  renderPreferenceRows('edit', existingCourseIds);

  document.getElementById('modal-edit-student').classList.remove('hidden');
}

// Submit Edit Student
async function submitEditStudent(e) {
  e.preventDefault();
  const student_id = parseInt(document.getElementById('edit-stu-id').value);
  const name = document.getElementById('edit-stu-name').value.trim();
  const cgpa = parseFloat(document.getElementById('edit-stu-cgpa').value);
  const department = document.getElementById('edit-stu-dept').value;

  const courseSelects = document.querySelectorAll('.edit-course-select');
  const course_ids = Array.from(courseSelects).map(s => parseInt(s.value)).filter(val => !isNaN(val) && val > 0);

  if (course_ids.length < 2) {
    showToast("Please select at least 2 course choices", "error");
    return;
  }

  if (new Set(course_ids).size !== course_ids.length) {
    showToast("Each course choice must be distinct", "error");
    return;
  }

  try {
    const res = await fetch('/api/demo/update-student', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id, name, cgpa, department, course_ids })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      closeModal('modal-edit-student');
      await refreshAllData();
    } else {
      showToast(`Error: ${data.error}`, "error");
    }
  } catch (e) {
    showToast("Update failed", "error");
  }
}

// Delete Demo Student
async function deleteDemoStudent(studentId, name) {
  if (!confirm(`Delete student "${name}"? This also tests ON DELETE CASCADE referential cleanup!`)) return;
  try {
    const res = await fetch('/api/demo/delete-student', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: studentId })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      await refreshAllData();
    }
  } catch (e) {
    showToast("Delete failed", "error");
  }
}

// Refresh all state
async function refreshAllData() {
  await loadOverview();
  await loadDemoStudents();
  await loadCoursesCatalog();
  await loadStudentsList();
}

// Switch Dataset with real-time UI loading state
async function switchDataset(datasetType) {
  try {
    // Show visual allocating indicator so user doesn't see stale static data
    const tbodyDemo = document.getElementById('demo-students-table-body');
    if (tbodyDemo) {
      tbodyDemo.innerHTML = `<tr><td colspan="5" class="empty-row" style="padding:2.5rem;text-align:center;">
        <span class="spinner" style="border-color:var(--brand);border-top-color:transparent;width:24px;height:24px;margin-bottom:0.75rem;display:inline-block;"></span>
        <div style="font-weight:700;color:var(--slate-800);font-size:0.9rem;">Switching Dataset & Executing Allocation Engine...</div>
        <div style="font-size:0.75rem;color:var(--slate-500);margin-top:0.25rem;">Clearing previous state, loading cohort, and invoking run_full_allocation_cycle()</div>
      </td></tr>`;
    }
    const demoBars = document.getElementById('demo-courses-bars');
    if (demoBars) {
      demoBars.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--slate-400);font-size:0.75rem;font-style:italic;">Recalculating seat quotas...</div>`;
    }
    const allocTbody = document.getElementById('allocations-table-body');
    if (allocTbody) {
      allocTbody.innerHTML = `<tr><td colspan="7" class="empty-row" style="padding:2rem;text-align:center;">Recalculating allocations for new dataset...</td></tr>`;
    }
    const kpiPlaced = document.getElementById('kpi-allot-rate');
    if (kpiPlaced) kpiPlaced.innerText = 'Allocating...';

    showToast("Reallocating seats for selected dataset...", "info");
    const res = await fetch('/api/reset-database', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataset: datasetType })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      await refreshAllData();
      if (allStudents.length > 0) {
        selectStudent(allStudents[0].student_id);
      }
    } else {
      showToast(`Error: ${data.error}`, "error");
      await refreshAllData();
    }
  } catch (e) {
    showToast("Failed to switch dataset", "error");
    await refreshAllData();
  }
}

// Load Overview
async function loadOverview() {
  try {
    const res = await fetch('/api/overview');
    const data = await res.json();
    globalOverview = data;

    document.getElementById('kpi-students').innerText = data.counts.students;
    document.getElementById('kpi-courses').innerText = data.counts.courses;
    document.getElementById('kpi-total-seats').innerText = data.total_capacity;
    document.getElementById('kpi-allotted-students').innerText = data.allotted_students_count;
    document.getElementById('kpi-preferences').innerText = data.counts.preferences;
    document.getElementById('kpi-waitlisted').innerText = data.status_summary['WAITLISTED'] || 0;
    document.getElementById('kpi-rejected').innerText = data.status_summary['REJECTED'] || 0;

    const rate = Math.round((data.allotted_students_count / data.counts.students) * 100) || 0;
    document.getElementById('kpi-allot-rate').innerText = `${rate}% Placed`;
    document.getElementById('capacity-fill-summary').innerText =
      `${data.total_allotted} of ${data.total_capacity} seats taken (${Math.round((data.total_allotted/data.total_capacity)*100)}% utilization)`;

    // Update filter-course dropdown
    const cFilter = document.getElementById('filter-course');
    const currVal = cFilter.value;
    cFilter.innerHTML = `<option value="ALL">All Electives</option>` + data.courses.map(c =>
      `<option value="${c.course_code}">${c.course_code} (${c.course_name.split(' ')[0]})</option>`
    ).join('');
    cFilter.value = currVal;

    // Render course capacity cards
    const container = document.getElementById('course-cards-container');
    container.innerHTML = data.courses.map(c => {
      const isFull = parseInt(c.current_allocations) >= parseInt(c.max_allocations);
      const badgeText = isFull ? 'FULL (0 LEFT)' : `${c.seats_remaining} SEATS LEFT`;
      const barCls = isFull ? 'bar-full' : 'bar-ok';
      const badgeCls = isFull ? 'badge-status-full' : 'badge-status-ok';

      return `
        <div class="kpi-card hover-shadow">
          <div class="kpi-card-header">
            <div>
              <span class="course-code-label">${c.course_code}</span>
              <h4 class="course-name-label" title="${c.course_name}">${c.course_name}</h4>
            </div>
            <span class="badge ${badgeCls}">${badgeText}</span>
          </div>
          <div>
            <div class="bar-label-row">
              <span>Seats: ${c.current_allocations} / ${c.max_allocations}</span>
              <span>${c.fill_pct}%</span>
            </div>
            <div class="progress-track">
              <div class="progress-bar ${barCls}" style="width: ${c.fill_pct}%"></div>
            </div>
          </div>
          <div class="bar-footer">
            <span>Min CGPA: <strong>${c.min_cgpa_required}</strong></span>
            <span>Credits: ${c.credits}</span>
          </div>
        </div>
      `;
    }).join('');

    loadAllocations();
  } catch (e) {
    console.error("Error loading overview", e);
  }
}

// Load Course Catalog
async function loadCoursesCatalog() {
  try {
    const res = await fetch('/api/courses');
    globalCourses = await res.json();
    document.getElementById('nav-courses-count').innerText = globalCourses.length;

    const allTags = new Set();
    globalCourses.forEach(c => c.tags.forEach(t => allTags.add(t)));

    const tagFilterContainer = document.getElementById('course-tag-filters');
    tagFilterContainer.innerHTML =
      `<button onclick="filterCoursesByTag('ALL')" class="tag-filter-btn ${currentCourseTagFilter==='ALL' ? 'active' : ''}">All (${globalCourses.length})</button>` +
      Array.from(allTags).map(t =>
        `<button onclick="filterCoursesByTag('${t}')" class="tag-filter-btn ${currentCourseTagFilter===t ? 'active' : ''}">${t}</button>`
      ).join('');

    renderCoursesCatalog();
  } catch (e) {
    console.error("Failed to load catalog", e);
  }
}

function filterCoursesByTag(tag) {
  currentCourseTagFilter = tag;
  loadCoursesCatalog();
}

function renderCoursesCatalog() {
  const filtered = (currentCourseTagFilter === 'ALL')
    ? globalCourses
    : globalCourses.filter(c => c.tags.includes(currentCourseTagFilter));

  const container = document.getElementById('catalog-cards-container');
  container.innerHTML = filtered.map(c => {
    const isFull = parseInt(c.current_allocations) >= parseInt(c.max_allocations);
    const enrolled = c.enrolled_students || [];

    return `
      <div class="catalog-card hover-shadow">
        <div class="catalog-card-header">
          <div>
            <span class="course-dept-label">${c.course_code} • ${c.department}</span>
            <h3 class="catalog-course-name">${c.course_name}</h3>
          </div>
          <span class="badge ${isFull ? 'badge-status-full' : 'badge-status-ok'}">
            ${c.current_allocations} / ${c.max_allocations} Seats
          </span>
        </div>

        <div class="tag-row">
          ${c.tags.map(t => `<span class="tag-pill">${t}</span>`).join('')}
        </div>

        <div class="catalog-meta-grid">
          <div>Credits: <strong>${c.credits}</strong></div>
          <div>Min CGPA: <strong>${c.min_cgpa_required}</strong></div>
        </div>

        <div class="catalog-enrolled-section">
          <div class="catalog-enrolled-header">
            <span>Allotted Students (${enrolled.length}):</span>
            ${enrolled.length > 0 ? `<span class="text-muted small">Ranked by CGPA</span>` : ''}
          </div>
          <div class="catalog-enrolled-list">
            ${enrolled.length === 0
              ? `<p class="text-muted italic small">No students allotted yet</p>`
              : enrolled.map((s, idx) => `
                  <div class="enrolled-row">
                    <span>${idx+1}. ${s.name}</span>
                    <span class="mono font-bold cgpa-label">${s.cgpa}</span>
                  </div>
                `).join('')
            }
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Load Allocations Table
async function loadAllocations() {
  try {
    const res = await fetch('/api/allocations');
    allAllocations = await res.json();
    applyAllocFilters();
  } catch (e) {
    console.error("Error loading allocations", e);
  }
}

function onAllocSearchChange() {
  allocCurrentPage = 1;
  applyAllocFilters();
}

function applyAllocFilters() {
  const courseFilter = document.getElementById('filter-course').value;
  const statusFilter = document.getElementById('filter-status').value;
  const search = document.getElementById('alloc-search').value.toLowerCase().trim();

  filteredAllocations = allAllocations.filter(a => {
    const matchC = courseFilter === 'ALL' || a.course_code === courseFilter;
    const matchS = statusFilter === 'ALL' || a.status === statusFilter;
    const matchSearch = !search ||
      a.student_name.toLowerCase().includes(search) ||
      a.course_code.toLowerCase().includes(search) ||
      a.course_name.toLowerCase().includes(search);
    return matchC && matchS && matchSearch;
  });

  document.getElementById('allocations-showing-count').innerText = filteredAllocations.length;
  document.getElementById('allocations-total-count').innerText = allAllocations.length;

  renderAllocationsPage();
}

function renderAllocationsPage() {
  const totalPages = Math.ceil(filteredAllocations.length / allocPageSize) || 1;
  if (allocCurrentPage > totalPages) allocCurrentPage = totalPages;

  const start = (allocCurrentPage - 1) * allocPageSize;
  const pageData = filteredAllocations.slice(start, start + allocPageSize);

  const tbody = document.getElementById('allocations-table-body');
  if (pageData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">No allocations matching filters</td></tr>`;
  } else {
    tbody.innerHTML = pageData.map(a => {
      let badge = 'badge-allotted';
      if (a.status === 'WAITLISTED') badge = 'badge-waitlisted';
      if (a.status === 'REJECTED') badge = 'badge-rejected';

      return `
        <tr class="trow-hover">
          <td class="td-pad mono text-muted small">#${a.allocation_id}</td>
          <td class="td-pad">
            <span class="font-bold">${a.course_code}</span>
            <span class="text-muted small block">${a.course_name}</span>
          </td>
          <td class="td-pad font-semibold">${a.student_name}</td>
          <td class="td-pad mono font-bold">${a.cgpa}</td>
          <td class="td-pad text-muted">Choice #${a.student_choice_rank}</td>
          <td class="td-pad"><span class="badge ${badge}">${a.status}</span></td>
          <td class="td-pad mono text-muted small">${a.allocated_at}</td>
        </tr>
      `;
    }).join('');
  }

  document.getElementById('alloc-page-info').innerText =
    `Page ${allocCurrentPage} of ${totalPages} (${filteredAllocations.length} total rows)`;

  const btns = document.getElementById('alloc-pagination-btns');
  btns.innerHTML = `
    <button onclick="changeAllocPage(${allocCurrentPage - 1})" ${allocCurrentPage === 1 ? 'disabled class="pag-btn disabled"' : 'class="pag-btn"'}>‹</button>
    <span class="pag-info">${allocCurrentPage} / ${totalPages}</span>
    <button onclick="changeAllocPage(${allocCurrentPage + 1})" ${allocCurrentPage >= totalPages ? 'disabled class="pag-btn disabled"' : 'class="pag-btn"'}>›</button>
  `;
}

function changeAllocPage(page) {
  const totalPages = Math.ceil(filteredAllocations.length / allocPageSize) || 1;
  if (page >= 1 && page <= totalPages) {
    allocCurrentPage = page;
    renderAllocationsPage();
  }
}

// Load Students Roster
async function loadStudentsList() {
  try {
    const res = await fetch('/api/students');
    allStudents = await res.json();
    document.getElementById('nav-students-count').innerText = allStudents.length;
    renderStudentsRoster();
    if (allStudents.length > 0) {
      selectStudent(allStudents[0].student_id);
    }
  } catch (e) {
    console.error("Failed to load students", e);
  }
}

function onStudentSearchChange() {
  renderStudentsRoster();
}

function renderStudentsRoster() {
  const search = document.getElementById('stu-search').value.toLowerCase().trim();
  const dept = document.getElementById('stu-filter-dept').value;
  const status = document.getElementById('stu-filter-status').value;

  const filtered = allStudents.filter(s => {
    const matchSearch = !search ||
      s.name.toLowerCase().includes(search) ||
      String(s.student_id) === search;
    const matchDept = (dept === 'ALL') || (s.department === dept);
    const matchStatus = (status === 'ALL') ||
      (status === 'ALLOTTED' && s.allotted_status === 'ALLOTTED') ||
      (status === 'UNALLOTTED' && s.allotted_status !== 'ALLOTTED');
    return matchSearch && matchDept && matchStatus;
  });

  document.getElementById('students-filtered-count').innerText = filtered.length;
  const container = document.getElementById('stu-list-container');

  if (filtered.length === 0) {
    container.innerHTML = `<p class="text-muted italic small" style="padding:1rem;text-align:center">No students found matching search</p>`;
    return;
  }

  container.innerHTML = filtered.map(s => {
    const isSelected = s.student_id == selectedStudentId;
    const isAllotted = s.allotted_status === 'ALLOTTED';
    const badge = isAllotted
      ? `<span class="badge badge-allotted small">${s.allotted_course}</span>`
      : `<span class="badge badge-unallotted small">Unallotted</span>`;

    return `
      <div onclick="selectStudent(${s.student_id})" class="stu-list-item ${isSelected ? 'selected' : ''}">
        <div class="student-cell">
          <div class="avatar avatar-sm ${isSelected ? 'avatar-selected' : ''}">
            ${s.name.split(' ').map(n=>n[0]).join('')}
          </div>
          <div>
            <h4 class="student-name">${s.name}</h4>
            <p class="student-sub">${s.department} • CGPA <strong>${s.cgpa}</strong></p>
          </div>
        </div>
        <div>${badge}</div>
      </div>
    `;
  }).join('');
}

async function selectStudent(studentId) {
  selectedStudentId = studentId;
  renderStudentsRoster();

  try {
    const res = await fetch(`/api/student/${studentId}`);
    const data = await res.json();
    const p = data.profile;

    document.getElementById('stu-avatar').innerText = p.name.split(' ').map(n=>n[0]).join('');
    document.getElementById('stu-name').innerText = p.name;
    document.getElementById('stu-sem-dept').innerText = `Sem ${p.semester} • ${p.department}`;
    document.getElementById('stu-cgpa-badge').innerText = `CGPA ${p.cgpa}`;

    const tagContainer = document.getElementById('stu-tag-badges');
    tagContainer.innerHTML = data.tag_preferences.map(t =>
      `<span class="tag-pref-badge">#${t.preference_rank} ${t.tag_name}</span>`
    ).join('');

    const isAllotted = data.allotted_course && data.allotted_course !== 'UNALLOTTED';
    const statusBadge = document.getElementById('stu-status-badge');

    if (isAllotted) {
      statusBadge.innerText = 'ALLOTTED';
      statusBadge.className = 'badge badge-allotted';
      document.getElementById('stu-allotted-course-text').innerHTML = `Allotted: <strong>${data.allotted_course}</strong>`;
    } else {
      statusBadge.innerText = 'UNALLOTTED';
      statusBadge.className = 'badge badge-unallotted';
      document.getElementById('stu-allotted-course-text').innerText = 'No seat allotted in current cycle';
    }

    // Allocation explanation description
    const reasonEl = document.getElementById('stu-allocation-reason-text');
    if (reasonEl) {
      reasonEl.innerText = data.allocation_reason || '';
    }

    const sBody = document.getElementById('shortlist-table-body');
    document.getElementById('shortlist-count-badge').innerText = `${data.shortlist.length} Eligible Courses`;

    if (data.shortlist.length === 0) {
      sBody.innerHTML = `<tr><td colspan="4" class="empty-row">No courses match tag preferences and CGPA cutoff</td></tr>`;
    } else {
      sBody.innerHTML = data.shortlist.map(s => `
        <tr class="trow-hover">
          <td class="td-pad font-bold">${s.course_code}</td>
          <td class="td-pad">${s.course_name}</td>
          <td class="td-pad"><span class="badge badge-teal">Tag Priority #${s.tag_preference_rank}</span></td>
          <td class="td-pad text-success font-semibold small">✓ Meets Cutoff</td>
        </tr>
      `).join('');
    }

    const cpBody = document.getElementById('stu-course-prefs-body');
    cpBody.innerHTML = data.course_preferences.map(cp => {
      let badge = 'badge-allotted';
      if (cp.allocation_status === 'WAITLISTED') badge = 'badge-waitlisted';
      if (cp.allocation_status === 'REJECTED') badge = 'badge-rejected';

      return `
        <tr class="trow-hover">
          <td class="td-pad font-bold" style="color:var(--indigo)">Choice #${cp.preference_rank}</td>
          <td class="td-pad">
            <span class="font-bold">${cp.course_code}</span>
            <span class="text-muted small block">${cp.course_name}</span>
          </td>
          <td class="td-pad mono text-muted">${cp.min_cgpa_required}</td>
          <td class="td-pad mono text-muted small">${cp.submitted_at}</td>
          <td class="td-pad"><span class="badge ${badge}">${cp.allocation_status || 'PENDING'}</span></td>
        </tr>
      `;
    }).join('');

  } catch (e) {
    console.error("Error loading student inspector", e);
  }
}

// Run Full Cycle
async function runAllocationCycle() {
  const btn = document.getElementById('btn-run-cycle');
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span><span>Allocating...</span>`;

  try {
    const res = await fetch('/api/run-cycle', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast("Allocation cycle executed successfully! Results updated.", "success");
      await refreshAllData();
      selectStudent(selectedStudentId);
    } else {
      showToast(`Error: ${data.error}`, "error");
    }
  } catch (e) {
    showToast("Server request failed", "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `▶ Run Allocation`;
  }
}

// Boundary Test: Anika CGPA
async function setAnikaCGPA(cgpa) {
  try {
    const res = await fetch('/api/update-cgpa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: 8, cgpa: cgpa })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('anika-cur-cgpa').innerText = cgpa.toFixed(2);
      document.getElementById('anika-shortlist-count').innerText = data.shortlist_count;
      showToast(data.message, "success");
      await fetch('/api/run-cycle', { method: 'POST' });
      await refreshAllData();
    }
  } catch (e) {
    showToast("Failed to update CGPA", "error");
  }
}

// Trigger Test Modal
async function testTriggerModal() {
  try {
    const res = await fetch('/api/test-trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ course_id: 2 })
    });
    const data = await res.json();

    if (data.success && data.triggered) {
      document.getElementById('modal-err-text').innerText = data.raw_mysql_error;
      document.getElementById('modal-course-name').innerText = `${data.course_code} ${data.course_name} (Cap: ${data.max_allocations})`;
      document.getElementById('trigger-result-box').innerHTML = `
        <div class="trigger-ok">
          ✓ Trigger successfully blocked over-allocation! (SQLSTATE 45000)
        </div>
      `;
      document.getElementById('modal-trigger').classList.remove('hidden');
    } else {
      showToast("Trigger test did not fire as expected", "error");
    }
  } catch (e) {
    showToast("Trigger execution error", "error");
  }
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// Reset Current Database
async function resetCurrentDatabase() {
  const curDataset = document.getElementById('select-dataset').value;
  if (!confirm(`Reset database with ${curDataset}?`)) return;
  try {
    showToast("Resetting database...", "info");
    const res = await fetch('/api/reset-database', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataset: curDataset })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, "success");
      await refreshAllData();
    } else {
      showToast(`Reset failed: ${data.error}`, "error");
    }
  } catch (e) {
    showToast("Reset request error", "error");
  }
}

// Tab Switching
function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  const activeNav = document.getElementById(`nav-${tabId}`);
  if (activeNav) activeNav.classList.add('active');
}

// Toast Helper
function showToast(msg, type = "info") {
  const toast = document.getElementById('toast');
  toast.innerText = msg;
  toast.className = `toast toast-${type}`;
  toast.style.transform = "translateY(0)";
  toast.style.opacity = "1";
  setTimeout(() => {
    toast.style.transform = "translateY(20px)";
    toast.style.opacity = "0";
  }, 3500);
}
