const API = '';

// Translations
let translations = {};
const localeMap = { en: 'en-US', es: 'es-ES', cat: 'ca-ES' };

async function loadTranslations(lang) {
    try {
        const res = await fetch(`/static/translations/${lang}.json`);
        translations = await res.json();
    } catch (e) {
        console.warn('Translation load failed, fallback to EN');
        if (lang !== 'en') {
            return loadTranslations('en');
        }
    }
}

function t(key) {
    return translations[key] || key;
}

function tVars(key, vars = {}) {
    let str = t(key);
    for (const k in vars) {
        str = str.replace(`{${k}}`, vars[k]);
    }
    return str;
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = t(el.dataset.i18nTitle);
    });
    if (typeof renderHome === 'function') {
        renderHome();
    }
    if (typeof renderCalendar === 'function') {
        renderCalendar();
    }
    if (typeof renderHistory === 'function') {
        renderHistory();
    }
    if (typeof renderCycleHistogram === 'function') {
        renderCycleHistogram();
    }
    if (typeof buildSymptomGrid === 'function') {
        buildSymptomGrid();
    }
    if (typeof buildMoodRow === 'function') {
        buildMoodRow();
    }

}


// ── State ──────────────────────────────────────────────────────────────────
let cycles = [], symptoms = [], predictions = {};
let calYear, calMonth;
let selectedFlow = 0;
let selectedSymptoms = new Set();
let selectedMood = null;

let SYMPTOMS = [], MOODS = [];



// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const langSelect = document.getElementById('lang-select');

    // Set saved language or default
    langSelect.value = localStorage.getItem('lang') || 'en';

    // Load translations on page load
    await loadTranslations(langSelect.value);
    applyTranslations();

    // Handle language changes
    langSelect.addEventListener('change', async () => {
        localStorage.setItem('lang', langSelect.value);
        await loadTranslations(langSelect.value);
        applyTranslations();
    });

    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('quick-start-date').value = today;
    document.getElementById('log-date').value = today;
    document.getElementById('end-date').value = today;

    loadAll();
    setupNav();
    setupForms();
    setupServiceWorker();
    setupPWA();
    setupSettings();
    monitorOffline();
});

async function fetchWithTimeout(url, options = {}, timeout = 5000) {
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
    ]);
}

async function fetchWithRetry(url, options, timeout, retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fetchWithTimeout(url, options, timeout);
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
        }
    }
}

async function loadAll() {
    //showLoadingIndicator(true); // start your spinner or "loading..." message

    try {
        const results = await Promise.allSettled([
            fetchWithRetry(`${API}/api/cycles`).then(r => r.json()),
            fetchWithRetry(`${API}/api/symptoms`).then(r => r.json()),
            fetchWithRetry(`${API}/api/predictions`).then(r => r.json())
        ]);
        cycles = results[0].status === 'fulfilled' ? results[0].value : [];
        symptoms = results[1].status === 'fulfilled' ? results[1].value : [];
        predictions = results[2].status === 'fulfilled' ? results[2].value : [];

        if (results.every(r => r.status === 'rejected')) {
            console.warn('whoops, all data fetches failed', results.map(r => r.reason));
        }

        renderHome();
        calYear = new Date().getFullYear();
        calMonth = new Date().getMonth();
        renderCalendar();
        renderHistory();
        renderCycleHistogram();
    } catch (e) {
        console.warn('Unexpected error', e);
    }
    applyTranslations();
    //showLoadingIndicator(false); // hide spinner
}

// ── Nav ────────────────────────────────────────────────────────────────────
function setupNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('view-' + btn.dataset.view).classList.add('active');
        });
    });
}

// ── Home ───────────────────────────────────────────────────────────────────
function renderHome() {
    const activeCycle = cycles.find(c => !c.end_date);
    const lastCycle = cycles.find(c => c.start_date);

    let dayNum = '—', phase = t('unknown'), phaseLabel = t('no_data');

    if (activeCycle) {
        const start = new Date(activeCycle.start_date);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        dayNum = Math.floor((today - start) / 86400000) + 1;
        phase = 'menstrual'; phaseLabel = t('menstrual');
    } else if (predictions.next_period && predictions.cycle_length) {
        const next = new Date(predictions.next_period);
        const last = new Date(predictions.last_period);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const dayOfCycle = Math.floor((today - last) / 86400000) + 1;
        dayNum = dayOfCycle;
        const cl = predictions.cycle_length;
        if (dayOfCycle <= 5) { phase = 'menstrual'; phaseLabel = t('menstrual'); }
        else if (dayOfCycle <= cl * 0.4) { phase = 'follicular'; phaseLabel = t('follicular'); }
        else if (dayOfCycle <= cl * 0.55) { phase = 'ovulation'; phaseLabel = t('ovulation'); }
        else { phase = 'luteal'; phaseLabel = t('luteal'); }

        const progress = Math.min(dayOfCycle / cl, 1);
        document.getElementById('ring-progress').style.strokeDashoffset = 377 * (1 - progress);
    }

    document.getElementById('day-num').textContent = dayNum;
    const badge = document.getElementById('phase-badge');
    badge.textContent = phaseLabel;
    badge.className = `phase-badge phase-${phase}`;

    if (typeof dayNum === 'number' && predictions.cycle_length) {
        const progress = Math.min(dayNum / predictions.cycle_length, 1);
        document.getElementById('ring-progress').style.strokeDashoffset = 377 * (1 - progress);
    }

    if (predictions.next_period) {
        const np = new Date(predictions.next_period);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const days = Math.round((np - today) / 86400000);

        // Predicted next
        document.getElementById('pred-next').textContent =
            days === 0
                ? t('today')
                : days > 0
                    ? tVars('in_days', { days })
                    : tVars('days_ago', { days: Math.abs(days) });

        // Fertile window
        document.getElementById('pred-fertile').textContent =
            predictions.fertile_window
                ? `${fmtShort(predictions.fertile_window.start)} – ${fmtShort(predictions.fertile_window.end)}`
                : '—';

        // Cycle length
        document.getElementById('pred-cycle').textContent =
            predictions.cycle_length
                ? `${predictions.cycle_length} ${t('days_label')}`
                : '—';

    }
}

function fmtShort(iso) {
    const d = new Date(iso  /*+ 'T00:00:00' */);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Calendar ───────────────────────────────────────────────────────────────
function renderCalendar() {
    const MONTHS = t('months');
    const DOWS = t('dows');
    const weekStart = t('weekstart');
    // Rotate DOWS so first day matches locale
    const DOWS_LOCALE = [...DOWS.slice(weekStart), ...DOWS.slice(0, weekStart)];
    document.getElementById('cal-month-label').textContent = `${MONTHS[calMonth]} ${calYear}`;

    const dowEl = document.getElementById('cal-dow');
    dowEl.innerHTML = DOWS_LOCALE.map(d => `<div class="cal-dow">${d}</div>`).join('');

    let firstDay = new Date(calYear, calMonth, 1).getDay();
    firstDay = (firstDay - weekStart + 7) % 7;
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const today = new Date(); today.setHours(0, 0, 0, 0);

    // Build sets for fast lookup
    const periodDays = new Set(), periodStarts = new Set(), fertileDays = new Set(), predictedDays = new Set(), symptomDays = new Set();

    cycles.forEach(c => {
        const start = new Date(c.start_date /*+ 'T00:00:00' */);
        const end = c.end_date ? new Date(c.end_date  /*+ 'T00:00:00' */) : new Date(start.getTime() + 5 * 86400000);
        periodStarts.add(c.start_date);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1))
            periodDays.add(d.toISOString().slice(0, 10));
    });

    if (predictions.fertile_window) {
        const fs = new Date(predictions.fertile_window.start  /*+ 'T00:00:00' */);
        const fe = new Date(predictions.fertile_window.end  /*+ 'T00:00:00' */);
        for (let d = new Date(fs); d <= fe; d.setDate(d.getDate() + 1))
            fertileDays.add(d.toISOString().slice(0, 10));
    }
    if (predictions.next_period) {
        const np = new Date(predictions.next_period  /*+ 'T00:00:00' */);
        for (let i = 0; i < 6; i++) {
            const d = new Date(np); d.setDate(d.getDate() + i);
            predictedDays.add(d.toISOString().slice(0, 10));
        }
    }
    symptoms.forEach(s => symptomDays.add(s.log_date));

    const grid = document.getElementById('cal-days');
    grid.innerHTML = '';

    for (let i = 0; i < firstDay; i++) {
        const el = document.createElement('button'); el.className = 'cal-day empty'; el.textContent = ' '; grid.appendChild(el);
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const iso = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const el = document.createElement('button');
        el.className = 'cal-day';
        el.textContent = d;
        const dt = new Date(iso  /*+ 'T00:00:00' */);
        if (dt.getTime() === today.getTime()) el.classList.add('today');
        if (periodStarts.has(iso)) el.classList.add('period-start');
        else if (periodDays.has(iso)) el.classList.add('period');
        else if (fertileDays.has(iso)) el.classList.add('fertile');
        else if (predictedDays.has(iso)) el.classList.add('predicted');
        if (symptomDays.has(iso)) el.classList.add('has-symptoms');
        el.addEventListener('click', (e) => showDayMenu(e, iso));
        grid.appendChild(el);
    }
}

document.getElementById('cal-prev').addEventListener('click', () => {
    calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar();
});
document.getElementById('cal-next').addEventListener('click', () => {
    calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar();
});


// ── Day-tap popup menu ─────────────────────────────────────────────────────
function showDayMenu(e, iso) {
    // Remove any existing menu
    const existing = document.getElementById('day-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'day-menu';
    menu.className = 'day-menu';

    const lang = localStorage.getItem('lang') || 'en';
    const fmtLabel = new Date(iso + 'T00:00:00').toLocaleDateString(localeMap[lang], { month: 'short', day: 'numeric' });

    const showLogToday = localStorage.getItem('setting-logtoday') !== 'false';
    const options = [
        { icon: '🌙', labelKey: 'start_period', action: () => navigateToForm('start-period', iso) },
        ...(showLogToday ? [{
            icon: '✦',
            labelKey: 'log_today',
            action: () => navigateToForm('log-today', iso)
        }] : []),
        { icon: '◎', labelKey: 'end_period', action: () => navigateToForm('end-period', iso) },
    ];

    menu.innerHTML = `<div class="day-menu-date">${fmtLabel}</div>` +
        options.map((o, i) =>
            `<button class="day-menu-item" data-idx="${i}">
                <span class="day-menu-icon">${o.icon}</span>
                <span>${t(o.labelKey)}</span>
            </button>`
        ).join('');

    document.body.appendChild(menu);

    // Wire up button clicks before positioning (avoids layout thrash)
    menu.querySelectorAll('.day-menu-item').forEach((btn, i) => {
        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            menu.remove();
            options[i].action();
        });
    });

    // Position near the tapped day cell
    const rect = e.currentTarget.getBoundingClientRect();
    const menuW = 200, menuH = 140;
    let top = rect.bottom + window.scrollY + 6;
    let left = rect.left + window.scrollX - menuW / 2 + rect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - menuW - 8));
    if (top + menuH > window.scrollY + window.innerHeight - 8) {
        top = rect.top + window.scrollY - menuH - 6;
    }
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    // Dismiss on outside click
    const dismiss = (ev) => {
        if (!menu.contains(ev.target)) {
            menu.remove();
            document.removeEventListener('click', dismiss, true);
        }
    };
    // Use capture + tiny delay so the originating click doesn't immediately dismiss
    setTimeout(() => document.addEventListener('click', dismiss, true), 0);
    document.addEventListener('scroll', dismiss, true);
}

function navigateToForm(form, iso) {
    // Switch to Log tab
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const logBtn = document.querySelector('.nav-btn[data-view="log"]');
    logBtn.classList.add('active');
    document.getElementById('view-log').classList.add('active');

    let targetEl;
    if (form === 'log-today') {
        document.getElementById('log-date').value = iso;
        targetEl = document.querySelector('.card:has(#log-date)') || document.getElementById('log-date');
    } else if (form === 'start-period') {
        document.getElementById('quick-start-date').value = iso;
        targetEl = document.querySelector('.card:has(#quick-start-date)') || document.getElementById('quick-start-date');
    } else if (form === 'end-period') {
        document.getElementById('end-date').value = iso;
        targetEl = document.querySelector('.card:has(#end-date)') || document.getElementById('end-date');
    }

    if (targetEl) {
        setTimeout(() => {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            // Focus the date input for good UX
            const inp = targetEl.matches('input') ? targetEl : targetEl.querySelector('input[type="date"]');
            if (inp) inp.focus();
        }, 60);
    }
}

// ── History ────────────────────────────────────────────────────────────────
function renderHistory() {
    const el = document.getElementById('cycle-list');

    // Combine cycles and symptom logs into one timeline
    const entries = [
        ...cycles.map(c => ({ type: 'cycle', data: c })),
        ...symptoms.map(s => ({ type: 'symptom', data: s }))
    ];

    if (!entries.length) {
        el.innerHTML = `<p style="color:var(--text-muted);font-size:13px;">${t('no_cycles')}</p>`;
        return;
    }

    // Sort descending by date (latest first)
    entries.sort((a, b) => {
        const dateA = new Date(a.type === 'cycle' ? a.data.start_date : a.data.log_date);
        const dateB = new Date(b.type === 'cycle' ? b.data.start_date : b.data.log_date);
        return dateB - dateA;
    });

    function translateSymptom(idx) {
        const list = t('symptoms_list');
        return list[idx] ?? idx;
    }

    function translateMood(idx) {
        const moods = t('moods');
        return moods[idx]?.l ?? idx;
    }

    el.innerHTML = entries.map(entry => {
        if (entry.type === 'cycle') {
            const c = entry.data;
            const dur = c.end_date
                ? Math.round((new Date(c.end_date) - new Date(c.start_date)) / 86400000) + 1
                : '?';
            const FLOW_KEYS = [null, 'light', 'medium', 'heavy'];
            const flowText = c.flow_intensity
                ? ` · ${tVars('flow_label', { flow_intensity: t(FLOW_KEYS[c.flow_intensity]) })}`
                : '';
            return `<div class="cycle-item">
                        <div class="cycle-dates">
                        ${fmtShort(c.start_date)}${c.end_date ? ' – ' + fmtShort(c.end_date) : ` (${t('ongoing')})`}
                        <small>${dur} ${t('days_label')}${flowText}</small>
                        </div>
                        <button class="cycle-delete" onclick="deleteCycle(${c.id})">✕</button>
                    </div>`;
        } else {
            const s = entry.data;
            const symptomText = s.symptoms.map(translateSymptom).join(', ');
            const moodText = s.mood ? ` · ${t('mood')}: ${translateMood(s.mood)}` : '';
            const painText = s.pain_level ? ` · ${t('pain_level')}: ${s.pain_level}` : '';

            return `<div class="cycle-item symptom-item">
                        <div class="cycle-dates">
                        ${fmtShort(s.log_date)} (${t('day_log')})
                        <small>${symptomText}${moodText}${painText}</small>
                        </div>
                        <button class="cycle-delete" onclick="deleteSymptom(${s.id})">✕</button>
                    </div>`;
        }
    }).join('');
}

async function deleteCycle(id) {
    await fetch(`${API}/api/cycles/${id}`, { method: 'DELETE' });
    await loadAll();
    toast(t('cycle_removed'));
}

async function deleteSymptom(id) {
    await fetch(`${API}/api/symptoms/${id}`, { method: 'DELETE' });
    await loadAll();
    toast(t('log_removed'));
}

function getCycleLengths() {
    if (!cycles || cycles.length < 2) return [];

    return cycles
        .map(c => new Date(c.start_date))
        .sort((a, b) => a - b) // oldest → newest
        .map((date, i, arr) => {
            if (i === 0) return null;
            const prev = arr[i - 1];
            const diff = (date - prev) / (1000 * 60 * 60 * 24);
            return Math.round(diff);
        })
        .filter(Boolean);
}

function renderCycleHistogram() {
    const container = document.getElementById('cycles-histogram');
    const durations = getCycleLengths();


    if (!durations.length) {
        container.innerHTML = `<p class="histogram-empty" data-i18n="no_cycles">${t('no_cycles')}</p>`;
        return;
    }

    const max = Math.max(...durations);

    container.innerHTML = `
        <div class="histogram-scroll">
            <div class="histogram">
                ${durations.map((d, i) => {
                    const BASELINE = 10;
                    const height = Math.round(100 * Math.max(0, d - BASELINE) / (max - BASELINE));
                    return `
                        <div class="histogram-item">
                            <div class="histogram-bar" style="height:${height}px; animation-delay: ${i * 50}ms"></div>
                            <span class="histogram-label">${d} ${t('days_label')}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;

    const scroll = document.querySelector('.histogram-scroll');

    function updateFade() {
        const canScroll = scroll.scrollWidth > scroll.clientWidth;
        if (!canScroll) {
            container.classList.remove('show-left-fade', 'show-right-fade');
            return;
        }
        const atLeft = scroll.scrollLeft <= 0.5;
        const atRight = scroll.scrollLeft + scroll.clientWidth >= scroll.scrollWidth - 0.5;
        container.classList.toggle('show-left-fade', !atLeft);
        container.classList.toggle('show-right-fade', !atRight);
    }

    // Attach events
    scroll.addEventListener('scroll', updateFade);
    window.addEventListener('resize', updateFade);
    requestAnimationFrame(() => {
        scroll.scrollLeft = scroll.scrollWidth - scroll.clientWidth;
        updateFade();
    });
}

// ── Forms ──────────────────────────────────────────────────────────────────
function setupForms() {
    function onEnter(elementId, callback) {
        document.getElementById(elementId).addEventListener('keydown', e => {
                if (e.key === 'Enter') callback();
            });
    }
    // Flow buttons
    document.querySelectorAll('.flow-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.flow-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedFlow = parseInt(btn.dataset.index);
        });
    });

    // Quick log
    const quickLogBtn = document.getElementById('quick-log-btn');
    quickLogBtn.addEventListener('click', async () => {
        const date = document.getElementById('quick-start-date').value;
        if (!date) return toast(t('invalid_date'));
        const res = await fetch(`${API}/api/cycles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                start_date: date,
                flow_intensity: selectedFlow ?? 0  // always send, default 0
            })
        });
        if (res.ok) { await loadAll(); toast(t('period_logged')); }
    });
    onEnter('quick-start-date', () => quickLogBtn.click());

    // End period
    const endPeriodBtn = document.getElementById('end-period-btn');
    endPeriodBtn.addEventListener('click', async () => {
        const endDate = document.getElementById('end-date').value;
        const active = cycles.find(c => !c.end_date);
        if (!active) return toast(t('no_active_period'));
        const res = await fetch(`${API}/api/cycles/${active.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ end_date: endDate })
        });
        if (res.ok) { await loadAll(); toast(t('period_ended')); }
    });
    onEnter('end-date', () => endPeriodBtn.click());

    // Symptom save
    const saveLogBtn = document.getElementById('save-log-btn');
    saveLogBtn.addEventListener('click', async () => {
        const date = document.getElementById('log-date').value;
        if (!date) return toast(t('invalid_date'));
        const res = await fetch(`${API}/api/symptoms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                log_date: date,
                symptoms: [...selectedSymptoms],   // now a Set of ints
                mood: selectedMood,                // make sure this is also an int now
                pain_level: parseInt(document.getElementById('pain-level').value),
                notes: document.getElementById('log-notes').value
            })
        });
        if (res.ok) {
            await loadAll();
            toast(t('symptoms_logged'));
            selectedSymptoms.clear();
            selectedMood = null;
            document.querySelectorAll('.symptom-chip').forEach(c => c.classList.remove('selected'));
            document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
            document.getElementById('pain-level').value = 0;
            document.getElementById('log-notes').value = '';
        }
    });
    onEnter('log-date', () => saveLogBtn.click());
    onEnter('log-notes', () => saveLogBtn.click());
}

function buildSymptomGrid() {
    const SYMPTOMS = t('symptoms_list');
    const grid = document.getElementById('symptom-grid');
    grid.innerHTML = SYMPTOMS.map((s, i) =>
        `<button class="symptom-chip" data-index="${i}">${s}</button>`
    ).join('');
    grid.querySelectorAll('.symptom-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            chip.classList.toggle('selected');
            const idx = parseInt(chip.dataset.index);
            if (chip.classList.contains('selected')) selectedSymptoms.add(idx);
            else selectedSymptoms.delete(idx);
        });
    });
}

function buildMoodRow() {
    const MOODS = t('moods');
    const row = document.getElementById('mood-row');
    row.innerHTML = MOODS.map((m, i) =>
        `<button class="mood-btn" data-index="${i}"><span>${m.e}</span><span>${m.l}</span></button>`
    ).join('');
    row.querySelectorAll('.mood-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            row.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedMood = parseInt(btn.dataset.index);
        });
    });
}

// ── Service Worker & PWA ───────────────────────────────────────────────────
function setupServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('SW registered', reg.scope))
            .catch(e => console.warn('SW error', e));
    }
}

let deferredPrompt = null;
function setupPWA() {
    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        deferredPrompt = e;
        document.getElementById('install-btn').style.display = 'flex';
        document.getElementById('install-banner').classList.add('visible');
    });

    const install = () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(c => {
                if (c.outcome === 'accepted') {
                    document.getElementById('install-btn').style.display = 'none';
                    document.getElementById('install-banner').classList.remove('visible');
                    toast(t('install_success'));
                }
                deferredPrompt = null;
            });
        }
    };
    document.getElementById('install-btn').addEventListener('click', install);
    document.getElementById('install-banner-btn').addEventListener('click', install);

}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function subscribePush() {
    if (!('PushManager' in window)) return console.warn('PushManager not available');
    try {
        const { public_key } = await fetch(`${API}/api/push/vapid-public-key`).then(r => r.json());
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(public_key)
        });
        await fetch(`${API}/api/push/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subscription: sub.toJSON(),
                strings: {
                    title: t('push_title'),
                    body_singular: t('push_body_singular'),
                    body_plural: t('push_body_plural')
                }
            })
        });
    } catch (e) { console.error('Push subscribe error', e); }
}

async function unsubscribePush() {
    try {
        const reg = navigator.serviceWorker.controller
            ? await navigator.serviceWorker.ready
            : await navigator.serviceWorker.getRegistration();

        if (!reg) return;

        const sub = await reg.pushManager.getSubscription();
        if (!sub) return;

        // Tell the server first, then unsubscribe locally
        await fetch(`${API}/api/push/unsubscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: sub.toJSON() })
        });

        await sub.unsubscribe();
    } catch (e) { console.warn('Push unsubscribe error', e); }
}

function monitorOffline() {
    const bar = document.getElementById('offline-bar');
    window.addEventListener('offline', () => bar.classList.add('show'));
    window.addEventListener('online', () => bar.classList.remove('show'));
    if (!navigator.onLine) bar.classList.add('show');
}

// ── Settings ───────────────────────────────────────────────────────────────
function applyFormVisibility() {
    const showFlow = localStorage.getItem('setting-flow') !== 'false';
    const showLogToday = localStorage.getItem('setting-logtoday') !== 'false';

    const flowCard = document.querySelector('.form-section:has(.flow-row)');
    const logTodayCard = document.querySelector('.card:has(#save-log-btn)');
    if (flowCard) flowCard.style.display = showFlow ? '' : 'none';
    selectedFlow = 0;
    if (logTodayCard) logTodayCard.style.display = showLogToday ? '' : 'none';
}

function setupSettings() {
    const overlay = document.getElementById('settings-overlay');
    const langSelect = document.getElementById('lang-select');

    // Load saved values into controls
    const loadSettingsUI = () => {
        langSelect.value = localStorage.getItem('lang') || 'en';
        document.getElementById('setting-flow').checked = localStorage.getItem('setting-flow') !== 'false';
        document.getElementById('setting-logtoday').checked = localStorage.getItem('setting-logtoday') !== 'false';
        // Use saved pref, but cap it at actual browser permission
        const savedNotif = localStorage.getItem('setting-notif') !== 'false';
        const browserGranted = 'Notification' in window && Notification.permission === 'granted';
        document.getElementById('setting-notif').checked = savedNotif && browserGranted;
    };

    // Open
    document.getElementById('settings-btn').addEventListener('click', () => {
        loadSettingsUI();
        overlay.classList.add('open');
    });

    // Close without saving
    document.getElementById('settings-close').addEventListener('click', () => {
        overlay.classList.remove('open');
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('open');
    });

    // Language change live-previews the UI
    langSelect.addEventListener('change', async () => {
        localStorage.setItem('lang', langSelect.value);
        await loadTranslations(langSelect.value);
        applyTranslations();
    });

    // Save button
    document.getElementById('settings-save').addEventListener('click', () => {
    const wantsNotif = document.getElementById('setting-notif').checked;

    // Fire and forget — don't await push operations
    if (wantsNotif) {
        if ('Notification' in window && Notification.permission !== 'granted') {
            Notification.requestPermission().then(perm => {
                if (perm === 'granted') subscribePush();
                else document.getElementById('setting-notif').checked = false;
            });
        } else if (Notification.permission === 'granted') {
            subscribePush();
        }
    } else {
        unsubscribePush(); // no await
    }

    localStorage.setItem('setting-notif', wantsNotif);
    localStorage.setItem('setting-flow', document.getElementById('setting-flow').checked);
    localStorage.setItem('setting-logtoday', document.getElementById('setting-logtoday').checked);
    applyFormVisibility();
    overlay.classList.remove('open');
    toast(t('settings_saved'));
});

    // Apply on load
    applyFormVisibility();
}


// ── Toast ──────────────────────────────────────────────────────────────────
function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
}