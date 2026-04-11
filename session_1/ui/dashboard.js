let currentFilter = 'day';

function getStartOfPeriod(filter) {
    const d = new Date();
    d.setHours(0,0,0,0);
    if(filter === 'day') {
        return d;
    } else if (filter === 'week') {
        const day = d.getDay();
        const diff = d.getDate() - day + (day == 0 ? -6:1);
        d.setDate(diff); // Start of week (Monday)
        return d;
    } else if (filter === 'month') {
        d.setDate(1); // Start of month
        return d;
    }
}

async function loadDataAndRender() {
    if(!window.pywebview || !window.pywebview.api) {
        setTimeout(loadDataAndRender, 100);
        return;
    }

    try {
        const stats = await window.pywebview.api.get_stats(currentFilter);
        processAndRender(stats);
    } catch(e) {
        console.error("Error fetching stats:", e);
    }
}

function getLocalDateStr(d) {
    // Returns date in YYYY-MM-DD in local time (matching Python's datetime.now().strftime)
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off * 60000);
    return local.toISOString().split('T')[0];
}

function processAndRender(data) {
    const now = new Date();
    let startDate;
    if(currentFilter === 'day') {
        startDate = getLocalDateStr(now);
    } else if(currentFilter === 'week') {
        const d = new Date(now);
        d.setDate(d.getDate() - 6);
        startDate = getLocalDateStr(d);
    } else {
        const d = new Date(now);
        d.setDate(d.getDate() - 29);
        startDate = getLocalDateStr(d);
    }

    // Simple string comparison works because dates are YYYY-MM-DD
    const validUsage = data.usage.filter(item => item.date >= startDate);

    // Build day list
    const latestDays = [];
    if(currentFilter === 'day') {
        latestDays.push(getLocalDateStr(now));
    } else if (currentFilter === 'week') {
        for(let i=6; i>=0; i--) {
            const d_obj = new Date(now);
            d_obj.setDate(d_obj.getDate() - i);
            latestDays.push(getLocalDateStr(d_obj));
        }
    } else {
        for(let i=29; i>=0; i--) {
            const d_obj = new Date(now);
            d_obj.setDate(d_obj.getDate() - i);
            latestDays.push(getLocalDateStr(d_obj));
        }
    }

    if (currentFilter === 'day') {
        // --- Today: aggregate totals as before ---
        const websiteMap = {};
        const appMap = {};
        validUsage.forEach(item => {
            if(item.type === 'website') {
                websiteMap[item.name] = (websiteMap[item.name] || 0) + item.seconds;
            } else {
                appMap[item.name] = (appMap[item.name] || 0) + item.seconds;
            }
        });
        renderNativeBars('websiteChart', websiteMap, ['#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6', '#10b981', '#22c55e', '#84cc16', '#eab308']);
        renderNativeBars('appChart', appMap, ['#ec4899', '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#eab308', '#d946ef', '#a855f7', '#6366f1', '#3b82f6']);
    } else {
        // --- Week / Month: show per-day breakdown grouped by name ---
        // Build: { name -> { date -> seconds } }
        const websiteDayMap = {};
        const appDayMap = {};
        validUsage.forEach(item => {
            if (!latestDays.includes(item.date)) return;
            if (item.type === 'website') {
                if (!websiteDayMap[item.name]) websiteDayMap[item.name] = {};
                websiteDayMap[item.name][item.date] = (websiteDayMap[item.name][item.date] || 0) + item.seconds;
            } else {
                if (!appDayMap[item.name]) appDayMap[item.name] = {};
                appDayMap[item.name][item.date] = (appDayMap[item.name][item.date] || 0) + item.seconds;
            }
        });
        renderDailyBreakdown('websiteChart', websiteDayMap, latestDays, ['#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6', '#10b981', '#22c55e', '#84cc16', '#eab308']);
        renderDailyBreakdown('appChart', appDayMap, latestDays, ['#ec4899', '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#eab308', '#d946ef', '#a855f7', '#6366f1', '#3b82f6']);
    }

    // Aggregate Deep Work by Date
    const dwMap = {};
    latestDays.forEach(d => { dwMap[d] = 0; });
    data.deep_work.forEach(item => {
        if(dwMap[item.date] !== undefined) {
            dwMap[item.date] += item.seconds;
        }
    });

    // Accumulate total device usage per active day (app-only to avoid double-counting browsers)
    const deviceMap = {};
    latestDays.forEach(d => { deviceMap[d] = 0; });
    validUsage.filter(item => item.type === 'app').forEach(item => {
        if(deviceMap[item.date] !== undefined) {
            deviceMap[item.date] += item.seconds;
        }
    });

    const dwValues = latestDays.map(d => (dwMap[d] / 60)); // Minutes
    const deviceValues = latestDays.map(d => (deviceMap[d] / 60)); // Minutes

    renderNativeBarsArray('deepWorkChart', latestDays, dwValues, 'rgba(45, 212, 191, 0.8)');
    renderNativeBarsArray('deviceTimeChart', latestDays, deviceValues, 'rgba(139, 92, 246, 0.8)');
}

function renderNativeBars(containerId, dataMap, colors) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    let sortedEntries = Object.entries(dataMap).sort((a,b) => b[1] - a[1]);
    
    // Lock 'Others' to the absolute bottom of the rendered list
    const othersIdx = sortedEntries.findIndex(e => e[0] === 'Others');
    let othersData = null;
    if (othersIdx !== -1) {
        othersData = sortedEntries.splice(othersIdx, 1)[0];
    }
    
    // Grab top 9 actual items to make room for 'Others'
    sortedEntries = sortedEntries.slice(0, 9);
    if (othersData) {
        sortedEntries.push(othersData);
    }
    
    if (sortedEntries.length === 0) {
        container.innerHTML = '<span style="color:#94a3b8;">No data</span>';
        return;
    }
    
    // Scale widths dynamically relative to the largest bar
    let maxVal = sortedEntries[0][1] / 60;
    if (maxVal === 0) maxVal = 1;

    sortedEntries.forEach((e, idx) => {
        let mins = e[1] / 60;
        let pct = (mins / maxVal) * 100;
        let cColor = colors[idx % colors.length];
        let label = e[0] || 'Unknown';
        
        container.innerHTML += `
        <div class="simple-bar-item">
            <span class="bar-label" title="${label}">${label}</span>
            <div class="bar-track">
                <div class="bar-fill" style="width: ${pct}%; background: ${cColor};"></div>
            </div>
            <span class="bar-value">${Math.round(mins)} min</span>
        </div>
        `;
    });
}

// Renders top names with per-day sub-rows for week/month views
function renderDailyBreakdown(containerId, dayMap, latestDays, colors) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    const names = Object.keys(dayMap);
    if (names.length === 0) {
        container.innerHTML = '<span style="color:#94a3b8;">No data</span>';
        return;
    }

    // Rank names by total seconds
    let sortedTotals = names.map(n => ({
        name: n,
        total: Object.values(dayMap[n]).reduce((a, b) => a + b, 0)
    }));
    sortedTotals.sort((a, b) => b.total - a.total);

    // Lock 'Others' to the bottom of the top 5
    const othersIdx = sortedTotals.findIndex(t => t.name === 'Others');
    let othersData = null;
    if (othersIdx !== -1) {
        othersData = sortedTotals.splice(othersIdx, 1)[0];
    }

    // Keep top 4 (+ 'Others') or top 5
    let topNames = sortedTotals.slice(0, othersData ? 4 : 5).map(t => t.name);
    if (othersData) {
        topNames.push(othersData.name);
    }

    // Find global max minutes for consistent scale across all names
    let globalMax = 0;
    topNames.forEach(n => {
        latestDays.forEach(d => {
            const v = (dayMap[n][d] || 0) / 60;
            if (v > globalMax) globalMax = v;
        });
    });
    if (globalMax === 0) globalMax = 1;

    const shortDay = d => {
        // Parse YYYY-MM-DD safely without timezone shifts
        const [y, m, day] = d.split('-').map(Number);
        const dt = new Date(y, m - 1, day);
        return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
    };

    topNames.forEach((name, idx) => {
        const color = colors[idx % colors.length];

        // Group header showing website/app name
        const header = document.createElement('div');
        header.className = 'daily-group-header';
        header.style.cssText = `
            font-size: 12px;
            font-weight: 700;
            color: ${color};
            margin-top: ${idx === 0 ? '0' : '14px'};
            margin-bottom: 5px;
            padding-bottom: 4px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        `;
        header.title = name;
        header.textContent = name;
        container.appendChild(header);

        // Only show days that actually have data for this name
        const activeDays = latestDays.filter(d => (dayMap[name][d] || 0) > 0);
        if (activeDays.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'font-size:11px; color:#94a3b8; padding: 2px 0 4px 0;';
            empty.textContent = 'No activity';
            container.appendChild(empty);
            return;
        }

        activeDays.forEach(d => {
            const mins = (dayMap[name][d] || 0) / 60;
            const pct = (mins / globalMax) * 100;
            const row = document.createElement('div');
            row.className = 'simple-bar-item daily-sub-row';
            row.innerHTML = `
                <span class="bar-label" style="font-size:11px; color:#94a3b8; width:90px;">${shortDay(d)}</span>
                <div class="bar-track">
                    <div class="bar-fill" style="width: ${pct}%; background: ${color};"></div>
                </div>
                <span class="bar-value" style="font-size:12px;">${Math.round(mins)} min</span>
            `;
            container.appendChild(row);
        });
    });
}

function renderNativeBarsArray(containerId, labels, data, defaultColor) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    if (labels.length === 0) {
        container.innerHTML = '<span style="color:#94a3b8;">No data</span>';
        return;
    }
    
    let maxVal = Math.max(...data.map(v => parseFloat(v)));
    if (maxVal === 0) maxVal = 1;
    
    for (let i = 0; i < labels.length; i++) {
        let val = parseFloat(data[i]);
        let pct = (val / maxVal) * 100;
        
        container.innerHTML += `
        <div class="simple-bar-item">
            <span class="bar-label">${labels[i]}</span>
            <div class="bar-track">
                <div class="bar-fill" style="width: ${pct}%; background: ${defaultColor};"></div>
            </div>
            <span class="bar-value">${Math.round(val)} min</span>
        </div>
        `;
    }
}

// Event Listeners
document.querySelectorAll('.time-filters button').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.time-filters button').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentFilter = e.target.getAttribute('data-filter');
        loadDataAndRender();
    });
});

document.getElementById('launch-timer-btn').addEventListener('click', () => {
    const mins = parseInt(document.getElementById('timer-minutes').value) || 25;
    if(window.pywebview && window.pywebview.api) {
        window.pywebview.api.launch_timer(mins * 60).then(() => {
            console.log('Timer launched');
        });
    }
});

// Init
window.addEventListener('pywebviewready', loadDataAndRender);
setInterval(loadDataAndRender, 10000); // 10s refresh
