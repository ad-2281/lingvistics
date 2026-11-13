// public/js/teacherDashboard.js
// Teacher & Admin Dashboard: Publishing controls, Retake toggles, Evidence Inspector, and User Approvals.

import { supabase } from './supabaseClient.js';
import { getAppConfigData, updateRequireAdminValidation, updateUserRole, updateUserStatus } from './adminConfig.js';

let activeDashboardTab = 'curriculum'; // 'curriculum' | 'evidence' | 'users'

export async function renderTeacherDashboard(container, profile, onCurriculumUpdated) {
  if (!container) return;
  const isAdmin = profile?.role === 'admin';

  container.innerHTML = `
    <div class="teacher-dashboard-container max-w-6xl mx-auto pb-16">
      
      <!-- Top Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-6 mb-6 border-b border-slate-200 gap-4">
        <div>
          <span class="text-xs uppercase tracking-wider font-extrabold text-blue-600 block mb-1">
            ${isAdmin ? 'Panou Administrator & Profesor' : 'Panou Cadru Didactic'}
          </span>
          <h1 class="text-3xl font-black text-slate-900 tracking-tight">
            Gestionare Curs, Evaluări și Utilizatori
          </h1>
        </div>

        <!-- Navigation Tabs -->
        <div class="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200" id="dash-tabs">
          <button type="button" data-tab="curriculum" class="tab-btn px-4 py-2 rounded-lg text-xs font-bold transition ${activeDashboardTab === 'curriculum' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}">
            Curriculum & Reîncercări
          </button>
          <button type="button" data-tab="evidence" class="tab-btn px-4 py-2 rounded-lg text-xs font-bold transition ${activeDashboardTab === 'evidence' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}">
            Rezultate & Dovezi Elevi
          </button>
          <button type="button" data-tab="users" class="tab-btn px-4 py-2 rounded-lg text-xs font-bold transition ${activeDashboardTab === 'users' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}">
            Utilizatori & Aprobări
          </button>
        </div>
      </div>

      <!-- Tab Content Area -->
      <div id="dash-tab-content">
        <div class="text-center py-12 text-slate-400">
          <svg class="animate-spin h-8 w-8 mx-auto mb-2 text-blue-600" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
          <span class="text-sm">Se încarcă datele...</span>
        </div>
      </div>

      <!-- Evidence Inspector Modal Container -->
      <div id="evidence-modal-container" class="hidden fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"></div>

    </div>
  `;

  // Tab Switcher Listener
  const tabButtons = container.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      activeDashboardTab = btn.dataset.tab;
      tabButtons.forEach(b => {
        b.className = `tab-btn px-4 py-2 rounded-lg text-xs font-bold transition ${
          b.dataset.tab === activeDashboardTab ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
        }`;
      });
      loadActiveTab();
    });
  });

  async function loadActiveTab() {
    const contentEl = container.querySelector('#dash-tab-content');
    contentEl.innerHTML = `<div class="text-center py-12 text-slate-400"><svg class="animate-spin h-8 w-8 mx-auto mb-2 text-blue-600" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg><span class="text-sm">Se încarcă...</span></div>`;

    if (activeDashboardTab === 'curriculum') {
      await renderCurriculumTab(contentEl, onCurriculumUpdated);
    } else if (activeDashboardTab === 'evidence') {
      await renderEvidenceTab(contentEl, container.querySelector('#evidence-modal-container'));
    } else if (activeDashboardTab === 'users') {
      await renderUsersTab(contentEl, isAdmin);
    }
  }

  // Initial load
  await loadActiveTab();
}

/**
 * 1. Curriculum & Retake Management Tab
 */
async function renderCurriculumTab(container, onCurriculumUpdated) {
  try {
    // Fetch modules with their lessons and exercises
    const { data: modules, error: modErr } = await supabase
      .from('modules')
      .select(`
        *,
        lessons (
          *,
          exercises (*)
        )
      `)
      .order('order_index');

    if (modErr) throw modErr;

    if (!modules || modules.length === 0) {
      container.innerHTML = `
        <div class="bg-white border border-slate-200 rounded-2xl p-12 text-center">
          <p class="text-slate-500 font-medium">Nu există module sincronizate în baza de date. Rulați ingestia din folderul input_content/.</p>
        </div>
      `;
      return;
    }

    let html = `<div class="space-y-6">`;

    modules.forEach(mod => {
      html += `
        <div class="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden" id="mod-card-${mod.id}">
          
          <!-- Module Header -->
          <div class="p-5 bg-slate-50 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div class="flex items-center gap-2 mb-1">
                <span class="text-xs uppercase font-extrabold px-2 py-0.5 rounded bg-blue-100 text-blue-800">Modul</span>
                <span class="text-xs text-slate-400 font-mono">slug: ${mod.slug}</span>
              </div>
              <h2 class="text-xl font-black text-slate-900">${mod.title}</h2>
              <p class="text-xs text-slate-500 mt-0.5">${mod.description || 'Fără descriere'}</p>
            </div>

            <!-- Module Toggles -->
            <div class="flex items-center gap-4 bg-white px-4 py-2 rounded-xl border border-slate-200 text-xs">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" class="toggle-mod-pub rounded text-blue-600 focus:ring-blue-500" data-mod-id="${mod.id}" ${mod.is_published ? 'checked' : ''}>
                <span class="font-bold ${mod.is_published ? 'text-emerald-700' : 'text-slate-400'}">Publicat</span>
              </label>

              <label class="flex items-center gap-2 cursor-pointer border-l pl-4 border-slate-200">
                <input type="checkbox" class="toggle-mod-restr rounded text-amber-600 focus:ring-amber-500" data-mod-id="${mod.id}" ${mod.is_restricted ? 'checked' : ''}>
                <span class="font-bold ${mod.is_restricted ? 'text-amber-700' : 'text-slate-400'}">Restricționat</span>
              </label>
            </div>
          </div>

          <!-- Lessons List -->
          <div class="p-5 space-y-4">
      `;

      const lessons = (mod.lessons || []).sort((a, b) => a.order_index - b.order_index);

      if (lessons.length === 0) {
        html += `<p class="text-xs text-slate-400 italic">Nu există lecții în acest modul.</p>`;
      } else {
        lessons.forEach(les => {
          html += `
            <div class="p-4 bg-slate-50/70 border border-slate-200 rounded-xl space-y-3" id="les-card-${les.id}">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 class="font-bold text-slate-900 text-sm sm:text-base">${les.title}</h3>
                  <span class="text-xs text-slate-400 font-mono">slug: ${les.slug}</span>
                </div>

                <div class="flex items-center gap-3 text-xs">
                  <label class="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" class="toggle-les-pub rounded text-blue-600 focus:ring-blue-500" data-les-id="${les.id}" ${les.is_published ? 'checked' : ''}>
                    <span class="font-medium ${les.is_published ? 'text-emerald-700' : 'text-slate-400'}">Publicat</span>
                  </label>

                  <label class="flex items-center gap-1.5 cursor-pointer border-l pl-3 border-slate-200">
                    <input type="checkbox" class="toggle-les-restr rounded text-amber-600 focus:ring-amber-500" data-les-id="${les.id}" ${les.is_restricted ? 'checked' : ''}>
                    <span class="font-medium ${les.is_restricted ? 'text-amber-700' : 'text-slate-400'}">Restricționat</span>
                  </label>
                </div>
              </div>

              <!-- Exercises under lesson -->
              <div class="pt-2 border-t border-slate-200">
                <span class="text-[11px] uppercase tracking-wider font-extrabold text-slate-400 block mb-2">Exerciții & Politici de Reîncercare</span>
                <div class="space-y-2">
          `;

          const exercises = les.exercises || [];
          if (exercises.length === 0) {
            html += `<p class="text-xs text-slate-400 italic">Nu există exerciții asociate.</p>`;
          } else {
            exercises.forEach(ex => {
              html += `
                <div class="bg-white p-3 rounded-lg border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                  <div>
                    <span class="font-bold text-slate-800">${ex.title}</span>
                    <span class="ml-2 px-1.5 py-0.5 rounded text-[10px] font-mono ${ex.category === 'homework' ? 'bg-purple-100 text-purple-800' : 'bg-emerald-100 text-emerald-800'}">
                      ${ex.category}
                    </span>
                    <span class="text-slate-400 ml-1">(${ex.max_score} p.)</span>
                  </div>

                  <div class="flex items-center gap-4">
                    <label class="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" class="toggle-ex-retake rounded text-purple-600 focus:ring-purple-500" data-ex-id="${ex.id}" ${ex.allow_retakes ? 'checked' : ''}>
                      <span class="font-semibold text-slate-700">Permite Reîncercarea</span>
                    </label>

                    <div class="flex items-center gap-1">
                      <span class="text-slate-500">Max încercări:</span>
                      <input type="number" min="0" max="20" class="input-ex-attempts w-16 px-2 py-1 border border-slate-300 rounded text-center font-bold text-slate-800 focus:ring-1 focus:ring-purple-500" data-ex-id="${ex.id}" value="${ex.max_attempts}">
                      <span class="text-[10px] text-slate-400">(0 = nelimitat)</span>
                    </div>

                    <button type="button" class="btn-save-ex-settings px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded shadow-sm transition" data-ex-id="${ex.id}">
                      Salvează
                    </button>
                  </div>
                </div>
              `;
            });
          }

          html += `
                </div>
              </div>
            </div>
          `;
        });
      }

      html += `
          </div>
        </div>
      `;
    });

    html += `</div>`;
    container.innerHTML = html;

    // Attach Event Handlers for Module Toggles
    container.querySelectorAll('.toggle-mod-pub').forEach(cb => {
      cb.addEventListener('change', async () => {
        const modId = cb.dataset.modId;
        await supabase.from('modules').update({ is_published: cb.checked }).eq('id', modId);
        if (onCurriculumUpdated) onCurriculumUpdated();
      });
    });

    container.querySelectorAll('.toggle-mod-restr').forEach(cb => {
      cb.addEventListener('change', async () => {
        const modId = cb.dataset.modId;
        await supabase.from('modules').update({ is_restricted: cb.checked }).eq('id', modId);
        if (onCurriculumUpdated) onCurriculumUpdated();
      });
    });

    // Attach Lesson Toggles
    container.querySelectorAll('.toggle-les-pub').forEach(cb => {
      cb.addEventListener('change', async () => {
        const lesId = cb.dataset.lesId;
        await supabase.from('lessons').update({ is_published: cb.checked }).eq('id', lesId);
        if (onCurriculumUpdated) onCurriculumUpdated();
      });
    });

    container.querySelectorAll('.toggle-les-restr').forEach(cb => {
      cb.addEventListener('change', async () => {
        const lesId = cb.dataset.lesId;
        await supabase.from('lessons').update({ is_restricted: cb.checked }).eq('id', lesId);
        if (onCurriculumUpdated) onCurriculumUpdated();
      });
    });

    // Attach Exercise Retake Save Buttons
    container.querySelectorAll('.btn-save-ex-settings').forEach(btn => {
      btn.addEventListener('click', async () => {
        const exId = btn.dataset.exId;
        const row = btn.closest('div');
        const retakeCb = row.querySelector('.toggle-ex-retake');
        const attemptsInput = row.querySelector('.input-ex-attempts');

        btn.disabled = true;
        btn.textContent = '...';

        try {
          const { error } = await supabase.from('exercises').update({
            allow_retakes: retakeCb.checked,
            max_attempts: parseInt(attemptsInput.value, 10) || 1
          }).eq('id', exId);

          if (error) throw error;
          btn.textContent = '✓ Salvat';
          setTimeout(() => { btn.textContent = 'Salvează'; btn.disabled = false; }, 1500);
        } catch (err) {
          alert("Eroare la salvare: " + err.message);
          btn.textContent = 'Salvează';
          btn.disabled = false;
        }
      });
    });

  } catch (err) {
    container.innerHTML = `
      <div class="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-800">
        <h3 class="font-bold">Eroare la încărcarea curriculum-ului:</h3>
        <p class="text-sm mt-1">${err.message}</p>
      </div>
    `;
  }
}

/**
 * 2. Student Scores & Evidence Inspector Tab
 */
async function renderEvidenceTab(container, modalContainer) {
  try {
    // Fetch submissions with profiles and exercises
    const { data: submissions, error: subErr } = await supabase
      .from('submissions')
      .select(`
        *,
        profiles (id, full_name, email, class_group),
        exercises (id, title, max_score, slug, category)
      `)
      .order('submitted_at', { ascending: false });

    if (subErr) throw subErr;

    container.innerHTML = `
      <div class="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        
        <!-- Filter Bar -->
        <div class="flex flex-col sm:flex-row gap-4 mb-6 pb-4 border-b border-slate-100">
          <div class="flex-1">
            <input type="text" id="sub-filter-input" placeholder="Filtrează după elev sau clasă..." class="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div class="text-xs text-slate-500 self-center">
            Total înregistrări: <strong id="sub-count" class="text-slate-800">${submissions ? submissions.length : 0}</strong>
          </div>
        </div>

        <!-- Submissions Table -->
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs border-collapse" id="submissions-table">
            <thead>
              <tr class="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-extrabold tracking-wider">
                <th class="py-3 px-3">Elev</th>
                <th class="py-3 px-3">Clasa</th>
                <th class="py-3 px-3">Exercițiu / Temă</th>
                <th class="py-3 px-3 text-center">Încercare</th>
                <th class="py-3 px-3 text-right">Auto</th>
                <th class="py-3 px-3 text-right">Revizuit</th>
                <th class="py-3 px-3 text-right">Notă Finală</th>
                <th class="py-3 px-3">Data / Ora</th>
                <th class="py-3 px-3 text-center">Acțiune</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              ${
                !submissions || submissions.length === 0
                  ? `<tr><td colspan="9" class="text-center py-8 text-slate-400 italic">Nu există trimiteri înregistrate.</td></tr>`
                  : submissions.map(sub => {
                      const studentName = sub.profiles?.full_name || 'Necunoscut';
                      const classGroup = sub.profiles?.class_group || '—';
                      const exTitle = sub.exercises?.title || 'Exercițiu';
                      const isOverridden = sub.manual_override_score !== null;
                      const submittedDate = new Date(sub.submitted_at).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' });

                      return `
                        <tr class="hover:bg-slate-50/80 transition sub-row" data-name="${studentName.toLowerCase()}" data-class="${classGroup.toLowerCase()}">
                          <td class="py-3 px-3 font-bold text-slate-900">${studentName}</td>
                          <td class="py-3 px-3 text-slate-600">${classGroup}</td>
                          <td class="py-3 px-3 text-slate-700">${exTitle}</td>
                          <td class="py-3 px-3 text-center font-mono font-semibold">#${sub.attempt_number}</td>
                          <td class="py-3 px-3 text-right font-mono text-slate-500">${sub.auto_score} p.</td>
                          <td class="py-3 px-3 text-right font-mono ${isOverridden ? 'text-amber-600 font-bold' : 'text-slate-400'}">
                            ${isOverridden ? `${sub.manual_override_score} p.` : '—'}
                          </td>
                          <td class="py-3 px-3 text-right font-mono font-black text-emerald-700">${sub.final_score} p.</td>
                          <td class="py-3 px-3 text-slate-500">${submittedDate}</td>
                          <td class="py-3 px-3 text-center">
                            <button type="button" class="btn-inspect-evidence px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition text-[11px]" data-sub-id="${sub.id}">
                              Vezi Dovada
                            </button>
                          </td>
                        </tr>
                      `;
                    }).join('')
              }
            </tbody>
          </table>
        </div>

      </div>
    `;

    // Filter interaction
    const filterInput = container.querySelector('#sub-filter-input');
    const rows = container.querySelectorAll('.sub-row');
    filterInput.addEventListener('input', () => {
      const q = filterInput.value.toLowerCase().trim();
      let matchCount = 0;
      rows.forEach(r => {
        const matches = r.dataset.name.includes(q) || r.dataset.class.includes(q);
        r.style.display = matches ? '' : 'none';
        if (matches) matchCount++;
      });
      container.querySelector('#sub-count').textContent = matchCount;
    });

    // Evidence Modal Trigger
    container.querySelectorAll('.btn-inspect-evidence').forEach(btn => {
      btn.addEventListener('click', () => {
        const subId = btn.dataset.subId;
        const sub = submissions.find(s => s.id === subId);
        if (sub) {
          openEvidenceModal(sub, modalContainer, () => renderEvidenceTab(container, modalContainer));
        }
      });
    });

  } catch (err) {
    container.innerHTML = `
      <div class="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-800">
        <h3 class="font-bold">Eroare la încărcarea rezultatelor:</h3>
        <p class="text-sm mt-1">${err.message}</p>
      </div>
    `;
  }
}

/**
 * Opens Evidence Inspector Modal for a single submission.
 */
function openEvidenceModal(submission, modalContainer, onUpdated) {
  const student = submission.profiles || {};
  const exercise = submission.exercises || {};
  const evidence = submission.evidence_json || {};
  const answers = submission.answers_json || {};

  modalContainer.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-150">
      
      <!-- Modal Header -->
      <div class="p-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
        <div>
          <span class="text-xs uppercase font-extrabold text-blue-600 block mb-0.5">Inspector de Dovezi & Corectare</span>
          <h2 class="text-xl font-black text-slate-900">${exercise.title || 'Exercițiu'}</h2>
          <p class="text-xs text-slate-500">Elev: <strong>${student.full_name}</strong> (${student.class_group || 'Fără clasă'}) | Încercarea #${submission.attempt_number}</p>
        </div>
        <button type="button" id="btn-close-modal" class="text-slate-400 hover:text-slate-700 p-2 rounded-xl text-xl font-bold">✕</button>
      </div>

      <!-- Modal Body (Scrollable side-by-side evidence) -->
      <div class="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
        
        <!-- Score Overview Banner -->
        <div class="p-4 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
          <div>
            <span class="text-slate-500 block">Scor Automat Generat:</span>
            <strong class="text-lg font-black text-slate-800">${submission.auto_score} / ${exercise.max_score} p.</strong>
          </div>
          <div>
            <span class="text-slate-500 block">Scor Curent Final:</span>
            <strong class="text-lg font-black text-emerald-700">${submission.final_score} / ${exercise.max_score} p.</strong>
          </div>
        </div>

        <!-- Per-field Evidence Breakdown -->
        <div class="space-y-4">
          <h3 class="font-extrabold text-slate-800 text-sm uppercase tracking-wide">Audit detaliat pe câmpuri (evidence_json)</h3>
          
          ${
            Object.keys(evidence).length === 0
              ? `<p class="text-slate-400 italic">Nu există dovezi structurate pentru această trimitere.</p>`
              : Object.entries(evidence).map(([key, item]) => {
                  const rawAnswer = answers[key] || item.student_value || '—';
                  const needsReview = item.requires_teacher_review === true;

                  return `
                    <div class="p-4 rounded-xl border ${item.is_correct ? 'bg-emerald-50/50 border-emerald-200' : 'bg-rose-50/50 border-rose-200'}">
                      <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-2">
                          <span class="font-mono font-bold text-slate-900">${key}</span>
                          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
                            item.is_correct ? 'bg-emerald-200 text-emerald-900' : 'bg-rose-200 text-rose-900'
                          }">
                            ${item.is_correct ? 'CORECT' : 'INCORECT / PARȚIAL'}
                          </span>
                          ${needsReview ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-200 text-amber-900">NECESITĂ REVIZUIRE</span>` : ''}
                        </div>
                        <div class="font-mono font-bold text-slate-800">
                          ${item.awarded_points} / ${item.max_points} puncte
                        </div>
                      </div>

                      <div class="bg-white p-3 rounded-lg border border-slate-200 space-y-1">
                        <div><span class="text-slate-500 font-semibold">Răspuns elev:</span> <code class="bg-slate-100 px-1 py-0.5 rounded text-slate-900 font-mono">${rawAnswer}</code></div>
                        <div><span class="text-slate-500 font-semibold">Tip regulă aplicată:</span> <span class="font-mono text-slate-700">${item.rule_type}</span></div>
                        ${item.hint ? `<div><span class="text-slate-500 font-semibold">Indiciu configurat:</span> <span class="text-slate-600 italic">${item.hint}</span></div>` : ''}
                      </div>
                    </div>
                  `;
                }).join('')
          }
        </div>

        <!-- Teacher Manual Grading Form -->
        <div class="p-5 bg-amber-50/70 border border-amber-300 rounded-xl space-y-4">
          <h3 class="font-extrabold text-amber-950 text-sm uppercase tracking-wide">Revizuire Manuală & Notare Finală</h3>
          
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block font-bold text-amber-900 mb-1" for="modal-override-score">Punctaj Manual Suprascris (Opțional):</label>
              <input type="number" step="0.5" min="0" max="${exercise.max_score}" id="modal-override-score" class="w-full px-3 py-2 bg-white border border-amber-300 rounded-lg font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-500" value="${submission.manual_override_score !== null ? submission.manual_override_score : ''}" placeholder="Ex: 85.0">
            </div>

            <div>
              <label class="block font-bold text-amber-900 mb-1" for="modal-teacher-feedback">Feedback pentru Elev:</label>
              <textarea id="modal-teacher-feedback" rows="2" class="w-full px-3 py-2 bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500" placeholder="Comentarii, explicații barem...">${submission.teacher_feedback || ''}</textarea>
            </div>
          </div>

          <div class="flex items-center justify-between pt-2">
            <button type="button" id="btn-reset-student-attempts" class="px-3.5 py-2 bg-rose-100 hover:bg-rose-200 text-rose-800 font-bold rounded-lg transition inline-flex items-center gap-1.5">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              <span>Resetează Încercările Elevului</span>
            </button>

            <button type="button" id="btn-save-modal-grade" class="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shadow transition">
              Salvează Nota Finală
            </button>
          </div>
        </div>

      </div>

    </div>
  `;

  modalContainer.classList.remove('hidden');

  // Close handlers
  const closeModal = () => modalContainer.classList.add('hidden');
  modalContainer.querySelector('#btn-close-modal').addEventListener('click', closeModal);

  // Save manual score & feedback
  const saveBtn = modalContainer.querySelector('#btn-save-modal-grade');
  saveBtn.addEventListener('click', async () => {
    const overrideVal = modalContainer.querySelector('#modal-override-score').value.trim();
    const feedbackVal = modalContainer.querySelector('#modal-teacher-feedback').value.trim();
    const manualScore = overrideVal !== '' ? parseFloat(overrideVal) : null;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Se salvează...';

    try {
      const { error } = await supabase.rpc('grade_submission', {
        p_submission_id: submission.id,
        p_manual_override_score: manualScore,
        p_teacher_feedback: feedbackVal
      });

      if (error) throw error;
      closeModal();
      onUpdated();
    } catch (err) {
      alert("Eroare la salvare: " + err.message);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Salvează Nota Finală';
    }
  });

  // Reset student attempts button
  const resetBtn = modalContainer.querySelector('#btn-reset-student-attempts');
  resetBtn.addEventListener('click', async () => {
    if (!confirm(`Sigur doriți să ștergeți toate încercările elevului ${student.full_name} pentru acest exercițiu? Această acțiune îi va permite o nouă trimitere.`)) {
      return;
    }

    resetBtn.disabled = true;
    resetBtn.textContent = 'Se resetează...';

    try {
      const { error } = await supabase.rpc('reset_student_attempts', {
        p_user_id: student.id,
        p_exercise_id: exercise.id
      });

      if (error) throw error;
      alert("Încercările au fost resetate cu succes.");
      closeModal();
      onUpdated();
    } catch (err) {
      alert("Eroare la resetare: " + err.message);
      resetBtn.disabled = false;
      resetBtn.textContent = 'Resetează Încercările Elevului';
    }
  });
}

/**
 * 3. User Registration Approval & Global Settings Tab
 */
async function renderUsersTab(container, isAdmin) {
  try {
    const appConfig = await getAppConfigData();
    const { data: users, error: userErr } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });

    if (userErr) throw userErr;

    container.innerHTML = `
      <div class="space-y-6">
        
        <!-- Global Validation Config Card -->
        <div class="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs uppercase font-extrabold px-2 py-0.5 rounded bg-amber-100 text-amber-900">Setare Globală</span>
            </div>
            <h2 class="text-base font-black text-slate-900">Validare Manuală Înregistrări Noi</h2>
            <p class="text-xs text-slate-500 mt-0.5">
              Când este activată, conturile noi primesc starea <code>pending</code> și necesită aprobare manuală înainte de accesarea conținutului.
            </p>
          </div>

          <div>
            <label class="relative inline-flex items-center cursor-pointer ${isAdmin ? '' : 'opacity-60 cursor-not-allowed'}">
              <input type="checkbox" id="toggle-global-validation" class="sr-only peer" ${appConfig?.require_admin_validation ? 'checked' : ''} ${isAdmin ? '' : 'disabled'}>
              <div class="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              <span class="ml-3 text-xs font-bold text-slate-700" id="validation-toggle-label">
                ${appConfig?.require_admin_validation ? 'Activată' : 'Dezactivată'}
              </span>
            </label>
            ${!isAdmin ? `<div class="text-[10px] text-slate-400 mt-1">Doar administratorii pot modifica această setare.</div>` : ''}
          </div>
        </div>

        <!-- Users Table Card -->
        <div class="bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <div class="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
            <h2 class="text-lg font-black text-slate-900">Gestionare Conturi Utilizatori</h2>
            <div class="text-xs text-slate-500">Total utilizatori: <strong class="text-slate-800">${users ? users.length : 0}</strong></div>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs border-collapse">
              <thead>
                <tr class="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-extrabold tracking-wider">
                  <th class="py-3 px-3">Nume & Prenume</th>
                  <th class="py-3 px-3">Email</th>
                  <th class="py-3 px-3">Clasa</th>
                  <th class="py-3 px-3">Rol</th>
                  <th class="py-3 px-3">Stare Cont</th>
                  <th class="py-3 px-3 text-center">Acțiuni</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                ${
                  !users || users.length === 0
                    ? `<tr><td colspan="6" class="text-center py-8 text-slate-400 italic">Nu există utilizatori înregistrați.</td></tr>`
                    : users.map(u => {
                        return `
                          <tr class="hover:bg-slate-50/80 transition" id="user-row-${u.id}">
                            <td class="py-3 px-3 font-bold text-slate-900">${u.full_name}</td>
                            <td class="py-3 px-3 text-slate-600 font-mono">${u.email}</td>
                            <td class="py-3 px-3 text-slate-700">${u.class_group || '—'}</td>
                            <td class="py-3 px-3">
                              ${
                                isAdmin
                                  ? `<select class="user-role-select px-2 py-1 bg-slate-50 border border-slate-300 rounded font-bold text-[11px] focus:outline-none" data-user-id="${u.id}">
                                      <option value="student" ${u.role === 'student' ? 'selected' : ''}>student</option>
                                      <option value="teacher" ${u.role === 'teacher' ? 'selected' : ''}>teacher</option>
                                      <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
                                    </select>`
                                  : `<span class="px-2 py-0.5 rounded font-mono font-bold text-[11px] bg-slate-100 text-slate-800">${u.role}</span>`
                              }
                            </td>
                            <td class="py-3 px-3">
                              <span class="px-2 py-0.5 rounded font-bold text-[11px] ${
                                u.status === 'approved' 
                                  ? 'bg-emerald-100 text-emerald-800' 
                                  : u.status === 'rejected' 
                                    ? 'bg-rose-100 text-rose-800' 
                                    : 'bg-amber-100 text-amber-800'
                              }">
                                ${u.status.toUpperCase()}
                              </span>
                            </td>
                            <td class="py-3 px-3 text-center">
                              <div class="inline-flex gap-1.5">
                                ${
                                  u.status === 'pending'
                                    ? `
                                      <button type="button" class="btn-approve-user px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded transition text-[11px]" data-user-id="${u.id}">
                                        Aprobă
                                      </button>
                                      <button type="button" class="btn-reject-user px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded transition text-[11px]" data-user-id="${u.id}">
                                        Respinge
                                      </button>
                                    `
                                    : u.status === 'rejected'
                                      ? `
                                        <button type="button" class="btn-approve-user px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded transition text-[11px]" data-user-id="${u.id}">
                                          Re-aprobă
                                        </button>
                                      `
                                      : `
                                        <button type="button" class="btn-reject-user px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded transition text-[11px]" data-user-id="${u.id}">
                                          Blochează
                                        </button>
                                      `
                                }
                              </div>
                            </td>
                          </tr>
                        `;
                      }).join('')
                }
              </tbody>
            </table>
          </div>

        </div>

      </div>
    `;

    // Global Validation Toggle Handler (Admin)
    if (isAdmin) {
      const toggle = container.querySelector('#toggle-global-validation');
      const label = container.querySelector('#validation-toggle-label');
      toggle.addEventListener('change', async () => {
        toggle.disabled = true;
        try {
          await updateRequireAdminValidation(toggle.checked);
          label.textContent = toggle.checked ? 'Activată' : 'Dezactivată';
        } catch (err) {
          alert("Eroare la actualizarea setării globale: " + err.message);
          toggle.checked = !toggle.checked;
        } finally {
          toggle.disabled = false;
        }
      });
    }

    // Role Select Handlers (Admin)
    if (isAdmin) {
      container.querySelectorAll('.user-role-select').forEach(sel => {
        sel.addEventListener('change', async () => {
          const userId = sel.dataset.userId;
          const newRole = sel.value;
          sel.disabled = true;
          try {
            await updateUserRole(userId, newRole);
          } catch (err) {
            alert("Eroare la modificarea rolului: " + err.message);
          } finally {
            sel.disabled = false;
          }
        });
      });
    }

    // Approve / Reject Actions
    container.querySelectorAll('.btn-approve-user').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userId;
        btn.disabled = true;
        try {
          await updateUserStatus(userId, 'approved');
          renderUsersTab(container, isAdmin);
        } catch (err) {
          alert("Eroare la aprobare: " + err.message);
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('.btn-reject-user').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.userId;
        btn.disabled = true;
        try {
          await updateUserStatus(userId, 'rejected');
          renderUsersTab(container, isAdmin);
        } catch (err) {
          alert("Eroare: " + err.message);
          btn.disabled = false;
        }
      });
    });

  } catch (err) {
    container.innerHTML = `
      <div class="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-800">
        <h3 class="font-bold">Eroare la încărcarea utilizatorilor:</h3>
        <p class="text-sm mt-1">${err.message}</p>
      </div>
    `;
  }
}
