const REFRESH_SECONDS = 300;

const FX_BASE = "USD";

const FX_HISTORY_DAYS = 30;

let countdown = REFRESH_SECONDS;

let soundEnabled = false;

let FX_QUOTES = [];

let spreadChart = null;

let macroChart = null;

const fxTrendCharts = {};

let selectedNewsCategory = "All";

 

function safeText(value) {

    return String(value ?? "").replace(/[&<>'"]/g, ch => ({

        "&": "&amp;",

        "<": "&lt;",

        ">": "&gt;",

        "'": "&#39;",

        '"': "&quot;"

    }[ch]));

}

 

function getMarketData() {

    return window.marketData || null;

}

 

function parseNumber(value) {

    if (value === null || value === undefined) return NaN;

    const n = Number(String(value).replace(/[%,$,bp\s]/g, ""));

    return Number.isFinite(n) ? n : NaN;

}

 

function getMetric(name) {

    const metrics = getMarketData()?.macro_data?.metrics || [];

    return metrics.find(x => String(x.name).toLowerCase() === String(name).toLowerCase()) || null;

}

 

function getMetricValue(name, fallback = "--") {

    return getMetric(name)?.value || fallback;

}

 

function getQuoteFromPair(pair) {

    const text = String(pair || "").trim().toUpperCase();

    return text.startsWith(FX_BASE) ? text.slice(FX_BASE.length) : text;

}

 

function buildFxCurrentMap() {

    const currencies = getMarketData()?.fx_rates?.currencies || [];

    const result = {};

    currencies.forEach(item => {

        const quote = getQuoteFromPair(item.pair);

        result[quote] = { pair: item.pair, quote: quote, current_value: Number(item.current_value) };

    });

    return result;

}

 

function initializeFxQuotesFromMarketData() {

    FX_QUOTES = Object.keys(buildFxCurrentMap());

}

 

function formatTime() { return new Date().toLocaleTimeString(); }

 

function updateRefreshDisplay(status = "Ready") {

    document.getElementById("lastRefresh").textContent = formatTime();

    document.getElementById("dashboardStatus").textContent = status;

    document.getElementById("monitorStatus").textContent = status === "Refreshing" ? "Refreshing" : "Monitoring";

}

 

function updateCountdown() { document.getElementById("countdown").textContent = countdown; }

 

function playBeep() {

    if (!soundEnabled) return;

    try {

        const audioContext = new (window.AudioContext || window.webkitAudioContext)();

        const oscillator = audioContext.createOscillator();

        const gain = audioContext.createGain();

        oscillator.type = "sine";

        oscillator.frequency.value = 880;

        gain.gain.setValueAtTime(0.07, audioContext.currentTime);

        gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.16);

        oscillator.connect(gain);

        gain.connect(audioContext.destination);

        oscillator.start();

        oscillator.stop(audioContext.currentTime + 0.16);

    } catch (error) { console.warn("Sound unavailable", error); }

}

 

function flashUpdatedPanels() {

    document.querySelectorAll(".card,.metric-card").forEach(card => {

        card.classList.remove("update-flash");

        void card.offsetWidth;

        card.classList.add("update-flash");

    });

}

 

function formatRate(value) {

    if (value === null || value === undefined || isNaN(value)) return "N/A";

    const n = Number(value);

    return Math.abs(n) >= 100 ? n.toFixed(2) : n.toFixed(4);

}

 

function formatSignedPercent(value) {

    if (value === null || value === undefined || isNaN(value)) return "N/A";

    const sign = value > 0 ? "+" : "";

    return sign + value.toFixed(2) + "%";

}

 

function directionClass(value) {

    if (value > 0) return "green";

    if (value < 0) return "red";

    return "yellow";

}

 

function getSnapshotDate() {

    const value = getMarketData()?.fx_rates?.last_updated;

    return value ? String(value).slice(0, 10) : null;

}

 

function getDateNDaysAgo(days) {

    const d = new Date();

    d.setDate(d.getDate() - days);

    return d.toISOString().split("T")[0];

}

 

function sortNewestFirst(series) {

    return series.slice().filter(x => x && x.date && !isNaN(Number(x.rate))).sort((a, b) => String(b.date).localeCompare(String(a.date)));

}

 

 

function sortOldestFirst(series) {

    return series.slice().filter(x => x && x.date && !isNaN(Number(x.rate))).sort((a, b) => String(a.date).localeCompare(String(b.date)));

}

 

function filterHistoryToSnapshot(series) {

    const snapshotDate = getSnapshotDate();

    const ordered = sortOldestFirst(series);

    if (!snapshotDate) return ordered;

    const filtered = ordered.filter(x => String(x.date) <= snapshotDate);

    return filtered.length ? filtered : ordered;

}

 

function findPreviousBenchmarkRate(history, snapshotDate) {

    const ordered = sortNewestFirst(history);

    if (!snapshotDate) return ordered.length > 1 ? ordered[1] : null;

    const prior = ordered.find(x => String(x.date) < snapshotDate);

    return prior || (ordered.length > 1 ? ordered[1] : null);

}

 

function calculatePercent(latestRate, previousRate) {

    if (latestRate === null || latestRate === undefined || previousRate === null || previousRate === undefined || isNaN(latestRate) || isNaN(previousRate)) {

        return { pctText: "N/A", pctValue: null, direction: "yellow" };

    }

    const pct = ((Number(latestRate) - Number(previousRate)) / Number(previousRate)) * 100;

    return { pctText: formatSignedPercent(pct), pctValue: pct, direction: directionClass(pct) };

}

 

async function loadFXHistory() {

    const grouped = {};

    FX_QUOTES.forEach(q => grouped[q] = []);

    if (!FX_QUOTES.length) return grouped;

    const startDate = getDateNDaysAgo(FX_HISTORY_DAYS);

    const quotes = FX_QUOTES.join(",");

    const url = `https://api.frankfurter.dev/v2/rates?from=${startDate}&base=${FX_BASE}&quotes=${quotes}`;

    try {

        const response = await fetch(url, { cache: "no-store" });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const records = await response.json();

        records.forEach(row => {

            if (!grouped[row.quote]) grouped[row.quote] = [];

            if (row.base !== row.quote) grouped[row.quote].push({ date: row.date, rate: Number(row.rate) });

        });

    } catch (error) { console.error("FX history loading failed", error); }

    return grouped;

}

 

function buildTickerRibbon(groupedHistory = {}) {

    const data = getMarketData();

    const fxMap = buildFxCurrentMap();

    const snapshotDate = getSnapshotDate();

    const fxParts = FX_QUOTES.map(quote => {

        const item = fxMap[quote];

        const previous = findPreviousBenchmarkRate(groupedHistory[quote] || [], snapshotDate);

        const change = calculatePercent(item?.current_value, previous?.rate);

        const arrow = change.pctValue > 0 ? "▲" : change.pctValue < 0 ? "▼" : "■";

        return `${item?.pair || FX_BASE + quote} ${formatRate(item?.current_value)} ${arrow} ${change.pctText}`;

    });

    const macroParts = [

        `Fed ${getMetricValue("Fed Funds Rate")}`,

        `2Y ${getMetricValue("2Y Treasury")}`,

        `10Y ${getMetricValue("10Y Treasury")}`,

        `30Y ${getMetricValue("30Y Treasury")}`,

        `CPI ${getMetricValue("CPI YoY")}`,

        `DXY ${getMetricValue("USD Index (DXY)")}`

    ];

    document.getElementById("tickerRibbon").textContent = [...fxParts, ...macroParts].join(" • ") + " • ";

    const generated = document.getElementById("generatedInfo");

    if (generated && data) generated.textContent = `Generated: ${data.generated_time || "--"} | Source loaded: ${data.source_loaded || "--"}`;

}

 

function buildExecutiveKpis() {

    const mappings = { kpiFedFunds: "Fed Funds Rate", kpi2s10s: "2s10s Spread", kpi10y: "10Y Treasury", kpi30y: "30Y Treasury", kpiCpi: "CPI YoY", kpiDxy: "USD Index (DXY)" };

    Object.entries(mappings).forEach(([id, name]) => {

        const el = document.getElementById(id);

        if (el) el.textContent = getMetricValue(name);

    });

    const spread = parseNumber(getMetricValue("2s10s Spread", "0"));

    const chip = document.getElementById("kpi2s10sChip");

    const sub = document.getElementById("kpi2s10sSub");

    if (chip) { chip.textContent = spread >= 0 ? "▲ Positive" : "▼ Inverted"; chip.className = `trend-chip ${spread >= 0 ? "green" : "red"}`; }

    if (sub) sub.textContent = spread >= 0 ? "Curve slope: positive bias" : "Curve slope: inversion risk";

}

 

function buildFxTiles(groupedHistory = {}) {

    const container = document.getElementById("fxTiles");

    if (!container) return;

    const fxMap = buildFxCurrentMap();

    const snapshotDate = getSnapshotDate();

    container.innerHTML = FX_QUOTES.map(quote => {

        const item = fxMap[quote];

        const previous = findPreviousBenchmarkRate(groupedHistory[quote] || [], snapshotDate);

        const change = calculatePercent(item?.current_value, previous?.rate);

        const historyCount = (groupedHistory[quote] || []).length;

        return `<div class="fx-tile">

            <div class="fx-pair">${safeText(item?.pair || FX_BASE + quote)}</div>

            <div class="fx-rate">${safeText(formatRate(item?.current_value))}</div>

            <div class="fx-change ${change.direction}">${safeText(change.pctText)}</div>

            <div class="fx-date">${safeText(snapshotDate || "")}</div>

            <div class="fx-sparkline-box"><canvas id="fxTrend_${quote}"></canvas></div>

            <div class="fx-trend-note"><span>30-day trend</span><span>${historyCount} obs.</span></div>

        </div>`;

    }).join("");

    const data = getMarketData();

    const fxSource = document.getElementById("fxSource");

    if (fxSource && data?.fx_rates) fxSource.textContent = `Source: ${data.fx_rates.source || ""} | Last updated: ${data.fx_rates.last_updated || ""}`;

}

 

function chartOptions(title) {

    return { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: "#cbd5e1", usePointStyle: true, pointStyle: "circle", font: { size: 12, weight: "600" } } }, tooltip: { backgroundColor: "#0f172a", titleColor: "#fff", bodyColor: "#e2e8f0", borderColor: "#38bdf8", borderWidth: 1, padding: 12, cornerRadius: 10 }, title: { display: true, text: title, color: "#e0f2fe", font: { size: 14, weight: "800" } } }, scales: { x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,.10)" } }, y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(148,163,184,.10)" } } } };

}

 

function renderSpreadChart() {

    const ctx = document.getElementById("spreadChart");

    if (!ctx) return;

    const twoTen = parseNumber(getMetricValue("2s10s Spread", "0"));

    const twoThirty = parseNumber(getMetricValue("2s30s Spread", "0"));

    if (spreadChart) spreadChart.destroy();

    spreadChart = new Chart(ctx, { type: "bar", data: { labels: ["2s10s", "2s30s"], datasets: [{ label: "Spread, bp", data: [twoTen, twoThirty], backgroundColor: ["rgba(56,189,248,.75)", "rgba(34,197,94,.75)"], borderRadius: 8 }] }, options: chartOptions("Yield Curve Spread Snapshot") });

}

 

function renderMacroChart() {

    const ctx = document.getElementById("macroChart");

    if (!ctx) return;

    const values = [ parseNumber(getMetricValue("10Y Treasury", "0")), parseNumber(getMetricValue("30Y Treasury", "0")), parseNumber(getMetricValue("CPI YoY", "0")) ];

    if (macroChart) macroChart.destroy();

    macroChart = new Chart(ctx, { type: "bar", data: { labels: ["10Y", "30Y", "CPI"], datasets: [{ label: "%", data: values, backgroundColor: ["rgba(250,204,21,.75)", "rgba(251,146,60,.75)", "rgba(239,68,68,.75)"], borderRadius: 8 }] }, options: chartOptions("Macro Snapshot") });

}

 

function loadBrief() {

    const brief = getMarketData()?.wealth_intelligence_brief;

    const source = document.getElementById("briefSource");

    if (source && brief) source.textContent = `Source: ${brief.source || ""} | Last updated: ${brief.last_updated || ""}`;

    const el = document.getElementById("brief");

    if (!el) return;

    if (!brief?.sections?.length) {

        el.innerHTML = `<div class="insight"><strong>No brief found</strong><p>No Wealth Intelligence Brief found in marketData.js.</p></div>`;

        return;

    }

    el.innerHTML = brief.sections.map(section => `<div class="insight"><strong>${safeText(section.heading)}</strong><ul>${(section.bullets || []).map(b => `<li>${safeText(b)}</li>`).join("")}</ul></div>`).join("");

}

 

function normalizeCategory(value) {

    return String(value || "General").trim();

}

 

function getNewsCategoryOptions(news) {

    const configured = Array.isArray(news?.category_options) ? news.category_options.map(normalizeCategory).filter(Boolean) : [];

    const fromArticles = Array.isArray(news?.articles) ? news.articles.map(x => normalizeCategory(x.category)).filter(Boolean) : [];

    return [...new Set(["All", ...configured, ...fromArticles])];

}

 

function buildNewsTabs() {

    const news = getMarketData()?.news_headlines;

    const tabs = document.getElementById("newsTabs");

    if (!tabs || !news) return;

    const categories = getNewsCategoryOptions(news);

    if (!categories.includes(selectedNewsCategory)) selectedNewsCategory = "All";

    tabs.innerHTML = categories.map(category => `<button type="button" class="news-tab ${category === selectedNewsCategory ? "active" : ""}" data-category="${safeText(category)}">${safeText(category)}</button>`).join("");

    tabs.querySelectorAll(".news-tab").forEach(button => {

        button.addEventListener("click", () => {

            selectedNewsCategory = button.getAttribute("data-category") || "All";

            buildNewsTabs();

            loadNews();

        });

    });

}

 

function getFilteredNewsArticles(news) {

    const articles = Array.isArray(news?.articles) ? news.articles : [];

    if (selectedNewsCategory === "All") return articles;

    return articles.filter(item => normalizeCategory(item.category).toLowerCase() === selectedNewsCategory.toLowerCase());

}

 

function loadNews() {

    const news = getMarketData()?.news_headlines;

    const source = document.getElementById("newsSource");

    if (source && news) source.textContent = `Source: ${news.source || ""} | Last updated: ${news.last_updated || ""}`;

    const container = document.getElementById("newsContainer");

    const count = document.getElementById("newsCount");

    if (!container || !news?.articles) return;

    const filtered = getFilteredNewsArticles(news);

    if (count) count.textContent = `${filtered.length} of ${news.articles.length} articles`;

    if (!filtered.length) {

        container.innerHTML = `<div class="news-card"><div class="news-title">No news found</div><div class="news-summary">No articles are available for the selected category: ${safeText(selectedNewsCategory)}.</div></div>`;

        return;

    }

    container.innerHTML = filtered.map(item => {

        const category = normalizeCategory(item.category);

        return `<div class="news-card"><div class="news-title">${safeText(item.number)}. ${safeText(item.title)}</div><div class="news-meta">${safeText(item.source)}</div><div class="news-category-badge">${safeText(category)}</div><div class="news-summary">${safeText(item.content || "No summary provided.")}</div></div>`;

    }).join("");

}

 

function loadMacroTable() {

    const macro = getMarketData()?.macro_data;

    const src = document.getElementById("macroSource");

    if (src && macro) src.textContent = `Source: ${macro.source || ""} | Last updated: ${macro.last_updated || ""}`;

    const table = document.getElementById("macroTable");

    if (!table || !macro?.metrics) return;

    table.innerHTML = macro.metrics.map(item => `<tr><td>${safeText(item.name)}</td><td>${safeText(item.value)}</td><td class="accent">Loaded</td></tr>`).join("");

}

 

function buildSignalSummary() {

    const spread = parseNumber(getMetricValue("2s10s Spread", "0"));

    const tenY = parseNumber(getMetricValue("10Y Treasury", "0"));

    const cpi = parseNumber(getMetricValue("CPI YoY", "0"));

    const dxy = parseNumber(getMetricValue("USD Index (DXY)", "0"));

    const rows = [ ["Curve Structure", spread >= 0 ? "Positive" : "Inverted", spread >= 0 ? "green" : "red"], ["Duration Risk", tenY >= 4 ? "Elevated" : "Moderate", tenY >= 4 ? "yellow" : "green"], ["Inflation Pressure", cpi >= 3 ? "Policy-Relevant" : "Moderating", cpi >= 3 ? "orange" : "green"], ["USD Momentum", dxy >= 100 ? "Firm" : "Soft", dxy >= 100 ? "accent" : "yellow"] ];

    const container = document.getElementById("signalSummary");

    if (container) container.innerHTML = rows.map(r => `<div class="signal-item"><span>${r[0]}</span><span class="${r[2]}">${r[1]}</span></div>`).join("");

}

 

function buildSourcesList() {

    const data = getMarketData();

    const sources = [ data?.fx_rates?.source, data?.macro_data?.source, data?.news_headlines?.source, data?.wealth_intelligence_brief?.source ].filter(Boolean);

    const unique = [...new Set(sources)];

    const el = document.getElementById("sourcesList");

    if (el) el.innerHTML = unique.map(s => `<div class="source-item">${safeText(s)}</div>`).join("");

}

 

function renderFxTrendCharts(groupedHistory = {}) {

    FX_QUOTES.forEach(quote => {

        const canvas = document.getElementById(`fxTrend_${quote}`);

        if (!canvas) return;

 

        const series = filterHistoryToSnapshot(groupedHistory[quote] || []);

        if (!series.length) return;

 

        const labels = series.map(x => x.date);

        const values = series.map(x => Number(x.rate));

        const first = values[0];

        const latest = values[values.length - 1];

        const isUp = latest >= first;

        const lineColor = isUp ? "#22c55e" : "#ef4444";

        const fillColor = isUp ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.14)";

 

        if (fxTrendCharts[quote]) {

            fxTrendCharts[quote].destroy();

        }

 

        fxTrendCharts[quote] = new Chart(canvas.getContext("2d"), {

            type: "line",

            data: {

                labels,

                datasets: [{

                    data: values,

                    borderColor: lineColor,

                    backgroundColor: fillColor,

                    borderWidth: 2,

                    pointRadius: 0,

                    pointHoverRadius: 3,

                    tension: 0.35,

                    fill: true

                }]

            },

            options: {

                responsive: true,

                maintainAspectRatio: false,

                animation: false,

                plugins: {

                    legend: { display: false },

                    tooltip: {

                        enabled: true,

                        backgroundColor: "#0f172a",

                        titleColor: "#ffffff",

                        bodyColor: "#e2e8f0",

                        borderColor: lineColor,

                        borderWidth: 1,

                        callbacks: {

                            label: ctx => `${FX_BASE}/${quote}: ${formatRate(ctx.raw)}`

                        }

                    }

                },

                scales: {

                    x: { display: false },

                    y: { display: false }

                }

            }

        });

    });

}

 

function loadMarketDataSections() {

    const data = getMarketData();

    if (!data) {

        const brief = document.getElementById("brief");

        if (brief) brief.innerHTML = `<div class="insight"><strong>marketData.js not loaded</strong><p>Confirm index.html loads data/marketData.js before src/dashboard.js.</p></div>`;

        return;

    }

    document.getElementById("pageTitle").textContent = "MarketPulse";

    buildExecutiveKpis();

    loadBrief();

    buildNewsTabs();

    loadNews();

    loadMacroTable();

    buildSignalSummary();

    buildSourcesList();

    renderSpreadChart();

    renderMacroChart();

}

 

async function refreshDashboard() {

    updateRefreshDisplay("Refreshing");

    initializeFxQuotesFromMarketData();

    const groupedHistory = await loadFXHistory();

    buildTickerRibbon(groupedHistory);

    buildFxTiles(groupedHistory);

    renderFxTrendCharts(groupedHistory);

    loadMarketDataSections();

    playBeep();

    flashUpdatedPanels();

    updateRefreshDisplay("Ready");

}

 

function setupSoundToggle() {

    const btn = document.getElementById("soundToggle");

    if (!btn) return;

    btn.addEventListener("click", function() {

        soundEnabled = !soundEnabled;

        this.textContent = soundEnabled ? "🔊 Sound ON" : "🔇 Sound OFF";

        if (soundEnabled) playBeep();

    });

}

 

function startCountdown() {

    updateCountdown();

    setInterval(() => {

        countdown -= 1;

        if (countdown <= 0) {

            refreshDashboard();

            countdown = REFRESH_SECONDS;

        }

        updateCountdown();

    }, 1000);

}

 

console.log("dashboard.js loaded");

console.log("marketData:", window.marketData);

setupSoundToggle();

refreshDashboard();

startCountdown();