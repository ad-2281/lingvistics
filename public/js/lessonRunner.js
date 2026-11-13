// public/js/lessonRunner.js
// Hydrates ingested lesson HTML, scoped CSS, and scoped interactive scripts safely.
// For teachers/admins, renders the isolated Teacher Notes drawer.
// Renders in-class practice exercises with instant feedback.

import { supabase } from './supabaseClient.js';

/**
 * Loads and renders a lesson into the container.
 * @param {HTMLElement} container
 * @param {Object} lesson
 * @param {Object} profile
 * @param {string} effectiveRole
 */
export async function renderLesson(container, lesson, profile, effectiveRole) {
  if (!container || !lesson) return;

  const isTeacherOrAdmin = (effectiveRole === 'teacher' || effectiveRole === 'admin');

  container.innerHTML = `
    <div class="lesson-runner-container max-w-4xl mx-auto pb-16">
      
      <!-- Top Bar: Lesson Navigation & Teacher Notes Toggle (if teacher) -->
      <div class="flex items-center justify-between pb-4 mb-6 border-b border-slate-200">
        <div>
          <span class="text-xs uppercase tracking-wider font-extrabold text-blue-600 block mb-1">
            Lecție Interactivă
          </span>
          <h1 class="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            ${lesson.title}
          </h1>
        </div>

        <div class="flex items-center gap-3">
          ${
            isTeacherOrAdmin
              ? `<button id="btn-toggle-teacher-drawer" class="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl shadow-sm transition inline-flex items-center gap-1.5">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
                  <span>Note Profesor (Izolate)</span>
                </button>`
              : ''
          }
        </div>
      </div>

      <!-- Teacher Notes Collapsible Drawer (Only rendered/queried for teachers/admins) -->
      ${
        isTeacherOrAdmin
          ? `<div id="teacher-notes-drawer" class="hidden mb-6 bg-amber-50/90 border-2 border-amber-300 rounded-2xl p-5 shadow-md">
              <div class="flex items-center justify-between pb-3 mb-3 border-b border-amber-200">
                <div class="flex items-center gap-2">
                  <span class="p-1.5 bg-amber-200 text-amber-900 rounded-lg">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>
                  </span>
                  <h3 class="text-sm font-extrabold text-amber-950 uppercase tracking-wide">
                    Note Pedagogice & Barem Profesor (Invizibile pentru elevi)
                  </h3>
                </div>
                <button type="button" id="btn-close-teacher-drawer" class="text-amber-800 hover:text-amber-950 p-1 text-sm font-bold">✕ Închide</button>
              </div>
              <div id="teacher-notes-content" class="text-sm text-amber-950 leading-relaxed prose prose-amber max-w-none">
                <span class="text-slate-500 italic">Se încarcă notele profesorului...</span>
              </div>
            </div>`
          : ''
      }

      <!-- Ingested Lesson Mount Container -->
      <div id="lesson-content-mount" class="prose max-w-none">
        ${lesson.student_html || '<p class="text-slate-500">Conținutul acestei lecții este în curs de pregătire.</p>'}
      </div>

      <!-- Class Practice Section (If any class_practice exercises exist) -->
      <div id="class-practice-section" class="mt-12 pt-8 border-t border-slate-200 hidden">
        <div class="mb-4">
          <span class="text-xs font-extrabold text-emerald-600 uppercase tracking-wider block">Exerciții în Clasă</span>
          <h2 class="text-2xl font-black text-slate-900">Aplicații Practice & Verificare Imediată</h2>
        </div>
        <div id="class-practice-list" class="space-y-6"></div>
      </div>

    </div>
  `;

  // 1. Inject Scoped CSS into dedicated <style> tag
  let scopedStyleEl = document.getElementById('lesson-scoped-css');
  if (!scopedStyleEl) {
    scopedStyleEl = document.createElement('style');
    scopedStyleEl.id = 'lesson-scoped-css';
    document.head.appendChild(scopedStyleEl);
  }
  scopedStyleEl.textContent = lesson.scoped_css || '';

  // 2. Re-hydrate and execute Scoped JS
  if (lesson.scoped_js && lesson.scoped_js.trim() !== '') {
    // Remove previous dynamic script tag if any
    const oldScript = document.getElementById('lesson-dynamic-script');
    if (oldScript) oldScript.remove();

    const scriptEl = document.createElement('script');
    scriptEl.id = 'lesson-dynamic-script';
    scriptEl.textContent = `
      (function() {
        try {
          ${lesson.scoped_js}
        } catch (err) {
          console.warn("Scoped lesson script execution error:", err);
        }
      })();
    `;
    container.appendChild(scriptEl);
  }

  // 3. Teacher Notes Drawer Interaction
  if (isTeacherOrAdmin) {
    const toggleBtn = container.querySelector('#btn-toggle-teacher-drawer');
    const closeBtn = container.querySelector('#btn-close-teacher-drawer');
    const drawer = container.querySelector('#teacher-notes-drawer');
    const contentEl = container.querySelector('#teacher-notes-content');

    let notesLoaded = false;

    async function loadTeacherNotes() {
      if (notesLoaded) return;
      try {
        const { data, error } = await supabase
          .from('lesson_teacher_notes')
          .select('teacher_notes_html')
          .eq('lesson_id', lesson.id)
          .maybeSingle();

        if (error) {
          contentEl.innerHTML = `<span class="text-red-700 font-semibold">Eroare la încărcarea notelor: ${error.message}</span>`;
          return;
        }

        if (data && data.teacher_notes_html) {
          contentEl.innerHTML = data.teacher_notes_html;
        } else {
          contentEl.innerHTML = `<span class="text-slate-500 italic">Nu există note speciale înregistrate pentru această lecție.</span>`;
        }
        notesLoaded = true;
      } catch (err) {
        contentEl.innerHTML = `<span class="text-red-700 font-semibold">Eroare: ${err.message}</span>`;
      }
    }

    if (toggleBtn && drawer) {
      toggleBtn.addEventListener('click', () => {
        drawer.classList.toggle('hidden');
        if (!drawer.classList.contains('hidden')) {
          loadTeacherNotes();
        }
      });
    }

    if (closeBtn && drawer) {
      closeBtn.addEventListener('click', () => {
        drawer.classList.add('hidden');
      });
    }
  }

  // 4. Fetch and render Class Practice exercises
  await loadClassPractice(lesson.id, container);
}

/**
 * Loads exercises with category 'class_practice' for the lesson.
 */
async function loadClassPractice(lessonId, container) {
  if (!supabase) return;

  const practiceSection = container.querySelector('#class-practice-section');
  const practiceList = container.querySelector('#class-practice-list');
  if (!practiceSection || !practiceList) return;

  try {
    const { data: exercises, error } = await supabase
      .from('exercises')
      .select('*')
      .eq('lesson_id', lessonId)
      .eq('category', 'class_practice')
      .order('order_index');

    if (error || !exercises || exercises.length === 0) {
      return; // No class practice for this lesson
    }

    practiceSection.classList.remove('hidden');
    practiceList.innerHTML = '';

    exercises.forEach((ex) => {
      const exCard = document.createElement('div');
      exCard.className = "bg-white border border-slate-200 rounded-xl p-5 shadow-sm";
      exCard.innerHTML = `
        <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
          <h3 class="font-bold text-slate-800 text-lg">${ex.title}</h3>
          <span class="text-xs font-semibold px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-200">
            ${ex.max_score} puncte
          </span>
        </div>

        <div class="exercise-prompt mb-4">
          ${ex.prompt_html}
        </div>

        <div id="practice-feedback-${ex.id}" class="hidden mb-4 p-4 rounded-xl text-sm"></div>

        <button type="button" class="btn-check-practice px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-sm shadow transition inline-flex items-center gap-2" data-exercise-id="${ex.id}">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <span>Verifică în clasă</span>
        </button>
      `;

      practiceList.appendChild(exCard);

      // Handle Instant Validation
      const checkBtn = exCard.querySelector('.btn-check-practice');
      checkBtn.addEventListener('click', async () => {
        await submitClassPractice(ex.id, exCard);
      });
    });

  } catch (err) {
    console.warn("Could not load class practice:", err);
  }
}

/**
 * Submits a class practice exercise and displays immediate hints & scores.
 */
async function submitClassPractice(exerciseId, cardEl) {
  const btn = cardEl.querySelector('.btn-check-practice');
  const fbBox = cardEl.querySelector(`#practice-feedback-${exerciseId}`);
  
  // Collect inputs
  const answers = {};
  const inputs = cardEl.querySelectorAll('input, select, textarea');
  inputs.forEach(el => {
    const key = el.name || el.dataset.questionKey || el.id;
    if (key) {
      answers[key] = el.value.trim();
    }
  });

  btn.disabled = true;
  btn.innerHTML = `<span>Se verifică...</span>`;

  try {
    const { data, error } = await supabase.rpc('submit_exercise_attempt', {
      p_exercise_id: exerciseId,
      p_answers: answers
    });

    if (error) throw error;

    fbBox.classList.remove('hidden', 'bg-red-50', 'text-red-900', 'border-red-200', 'bg-emerald-50', 'text-emerald-900', 'border-emerald-200');
    
    let feedbackHtml = `
      <div class="flex items-center justify-between mb-2">
        <span class="font-bold text-base">Punctaj obținut: ${data.score} / ${data.max_score} puncte</span>
        <span class="text-xs uppercase font-extrabold px-2 py-0.5 rounded ${data.score >= data.max_score ? 'bg-emerald-200 text-emerald-900' : 'bg-amber-200 text-amber-900'}">
          ${data.score >= data.max_score ? 'Corect' : 'Parțial'}
        </span>
      </div>
    `;

    if (data.evidence) {
      feedbackHtml += `<div class="space-y-1 mt-2 text-xs border-t pt-2">`;
      for (const [key, ev] of Object.entries(data.evidence)) {
        feedbackHtml += `
          <div class="flex items-start gap-2">
            <span>${ev.is_correct ? '✅' : '❌'}</span>
            <div>
              <span class="font-bold">${key}:</span> ${ev.awarded_points} / ${ev.max_points} p.
              ${ev.hint ? `<div class="text-slate-600 italic">Indiciu: ${ev.hint}</div>` : ''}
            </div>
          </div>
        `;
      }
      feedbackHtml += `</div>`;
    }

    fbBox.className = `mb-4 p-4 rounded-xl text-sm border ${
      data.score >= data.max_score ? 'bg-emerald-50 text-emerald-950 border-emerald-300' : 'bg-amber-50 text-amber-950 border-amber-300'
    }`;
    fbBox.innerHTML = feedbackHtml;

  } catch (err) {
    fbBox.className = "mb-4 p-4 rounded-xl text-sm border bg-red-50 text-red-900 border-red-300";
    fbBox.textContent = `Eroare la verificare: ${err.message}`;
    fbBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>Verifică din nou</span>`;
  }
}
