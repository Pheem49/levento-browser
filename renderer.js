// --- Browser Web UI Logic ---
document.getElementById('btn-back').addEventListener('click', () => {
    window.browserAPI.goBack();
});

document.getElementById('btn-forward').addEventListener('click', () => {
    window.browserAPI.goForward();
});

document.getElementById('btn-reload').addEventListener('click', () => {
    window.browserAPI.reload();
});

document.getElementById('btn-dev-tools').addEventListener('click', () => {
    window.browserAPI.toggleDevTools();
});

const addressInput = document.getElementById('address-input');
const addressSuggestions = document.getElementById('address-suggestions');
const addressQuickSuggestions = [
    { title: 'Google', url: 'google.com' },
    { title: 'YouTube', url: 'youtube.com' },
    { title: 'GitHub', url: 'github.com' },
    { title: 'Stack Overflow', url: 'stackoverflow.com' },
    { title: 'Facebook', url: 'facebook.com' },
    { title: 'X', url: 'x.com' },
    { title: 'Wikipedia', url: 'wikipedia.org' },
    { title: 'Reddit', url: 'reddit.com' },
    { title: 'ChatGPT', url: 'chatgpt.com' },
    { title: 'Gmail', url: 'gmail.com' }
];
const historyStorageKey = 'levento-address-history-v1';
const historyLimit = 80;
let addressHistory = [];
let currentSuggestions = [];
let activeSuggestionIndex = -1;
let suppressSuggestionRefresh = false;
let lastAddressInsetSent = -1;

function reportAddressSuggestionsInset() {
    if (!window.browserAPI || !window.browserAPI.setAddressSuggestionsInset) return;

    let inset = 0;
    if (addressSuggestions && addressSuggestions.classList.contains('show')) {
        const webRoot = document.getElementById('browser-view');
        if (webRoot) {
            const dropdownRect = addressSuggestions.getBoundingClientRect();
            const webTop = webRoot.getBoundingClientRect().top;
            inset = Math.max(0, Math.ceil(dropdownRect.bottom - webTop + 8));
        }
    }

    if (inset === lastAddressInsetSent) return;
    lastAddressInsetSent = inset;
    window.browserAPI.setAddressSuggestionsInset(inset);
}

function loadAddressHistory() {
    try {
        const raw = localStorage.getItem(historyStorageKey);
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
            addressHistory = parsed
                .map(item => {
                    if (typeof item === 'string') {
                        return { url: item.trim(), title: '', favicon: '', lastVisited: Date.now() };
                    }
                    if (!item || typeof item !== 'object') return null;
                    return {
                        url: String(item.url || '').trim(),
                        title: String(item.title || '').trim(),
                        favicon: String(item.favicon || '').trim(),
                        lastVisited: Number(item.lastVisited) || Date.now()
                    };
                })
                .filter(item => item && item.url)
                .slice(0, historyLimit);
        }
    } catch (e) {
        addressHistory = [];
    }
}

function saveAddressHistory() {
    try {
        localStorage.setItem(historyStorageKey, JSON.stringify(addressHistory.slice(0, historyLimit)));
    } catch (e) { }
}

function addAddressHistory(url, meta = {}) {
    const clean = String(url || '').trim();
    if (!clean || clean === 'about:blank') return;
    const existing = addressHistory.find(item => item.url === clean);
    const next = {
        url: clean,
        title: String(meta.title || existing?.title || '').trim(),
        favicon: String(meta.favicon || existing?.favicon || '').trim(),
        lastVisited: Date.now()
    };
    addressHistory = [next, ...addressHistory.filter(item => item.url !== clean)].slice(0, historyLimit);
    saveAddressHistory();
}

function normalizeUrlForDisplay(url) {
    return String(url || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

function getHostname(url) {
    try {
        const resolved = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
        return new URL(resolved).hostname.replace(/^www\./, '');
    } catch (e) {
        return normalizeUrlForDisplay(url);
    }
}

function getDomainFavicon(url) {
    const host = getHostname(url);
    return host ? `https://www.google.com/s2/favicons?sz=32&domain=${encodeURIComponent(host)}` : '';
}

function buildSuggestions(query) {
    const raw = query.trim();
    const q = raw.toLowerCase();
    if (!q) return [];

    const seen = new Set();
    const output = [];
    const push = (item) => {
        const navigateValue = String(item.navigateValue || '').trim();
        if (!navigateValue) return;
        const key = navigateValue.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        output.push({
            navigateValue,
            title: String(item.title || navigateValue),
            subtitle: String(item.subtitle || ''),
            kind: String(item.kind || ''),
            icon: String(item.icon || ''),
            iconType: item.iconType === 'emoji' ? 'emoji' : 'image'
        });
    };
    const matches = (text) => String(text || '').toLowerCase().includes(q);

    const looksLikeUrl = q.includes('.') || q.includes(':') || q.includes('/');
    if (looksLikeUrl) {
        push({
            navigateValue: raw,
            title: `Go to ${normalizeUrlForDisplay(raw)}`,
            subtitle: raw,
            kind: 'Navigate',
            icon: '↗',
            iconType: 'emoji'
        });
    }

    if (!looksLikeUrl) {
        push({
            navigateValue: `https://www.google.com/search?q=${encodeURIComponent(raw)}`,
            title: `Search "${raw}"`,
            subtitle: 'Google Search',
            kind: 'Search',
            icon: '🔎',
            iconType: 'emoji'
        });
    }

    addressHistory
        .filter(item => matches(item.url) || matches(item.title))
        .sort((a, b) => (b.lastVisited || 0) - (a.lastVisited || 0))
        .slice(0, 6)
        .forEach(item => {
            const subtitle = normalizeUrlForDisplay(item.url);
            push({
                navigateValue: item.url,
                title: item.title || getHostname(item.url),
                subtitle,
                kind: 'History',
                icon: item.favicon || getDomainFavicon(item.url)
            });
        });

    addressQuickSuggestions
        .filter(item => matches(item.title) || matches(item.url))
        .slice(0, 8)
        .forEach(item => {
            push({
                navigateValue: item.url,
                title: item.title,
                subtitle: item.url,
                kind: 'Example',
                icon: getDomainFavicon(item.url)
            });
        });

    // Always append popular examples so dropdown does not collapse to a single row.
    addressQuickSuggestions.forEach(item => {
        push({
            navigateValue: item.url,
            title: item.title,
            subtitle: item.url,
            kind: 'Example',
            icon: getDomainFavicon(item.url)
        });
    });

    return output.slice(0, 8);
}

function hideAddressSuggestions() {
    currentSuggestions = [];
    activeSuggestionIndex = -1;
    if (addressSuggestions) {
        addressSuggestions.classList.remove('show');
        addressSuggestions.innerHTML = '';
    }
    reportAddressSuggestionsInset();
}

function applySelectedSuggestion(index) {
    if (index < 0 || index >= currentSuggestions.length) return false;
    const chosen = currentSuggestions[index];
    suppressSuggestionRefresh = true;
    addressInput.value = chosen.navigateValue;
    suppressSuggestionRefresh = false;
    hideAddressSuggestions();
    window.browserAPI.navigate(chosen.navigateValue);
    return true;
}

function renderAddressSuggestions(items) {
    if (!addressSuggestions) return;
    currentSuggestions = items;
    activeSuggestionIndex = -1;

    if (!items.length) {
        hideAddressSuggestions();
        return;
    }

    addressSuggestions.innerHTML = '';
    items.forEach((item, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'address-suggestion-item';
        button.setAttribute('role', 'option');
        const left = document.createElement('span');
        left.className = 'suggestion-left';
        const icon = document.createElement('span');
        icon.className = 'suggestion-icon';
        if (item.iconType === 'emoji') {
            icon.textContent = item.icon || '🌐';
        } else {
            const img = document.createElement('img');
            img.src = item.icon || '';
            img.alt = '';
            img.width = 16;
            img.height = 16;
            img.onerror = () => {
                icon.textContent = '🌐';
            };
            icon.appendChild(img);
        }
        const textWrap = document.createElement('span');
        textWrap.className = 'suggestion-text';
        const title = document.createElement('span');
        title.className = 'suggestion-label';
        title.textContent = item.title;
        const sub = document.createElement('span');
        sub.className = 'suggestion-subtitle';
        sub.textContent = item.subtitle;
        textWrap.appendChild(title);
        if (item.subtitle) textWrap.appendChild(sub);
        const kind = document.createElement('span');
        kind.className = 'suggestion-kind';
        kind.textContent = item.kind;
        left.appendChild(icon);
        left.appendChild(textWrap);
        button.appendChild(left);
        button.appendChild(kind);
        button.addEventListener('mousedown', (e) => {
            e.preventDefault();
            applySelectedSuggestion(index);
        });
        addressSuggestions.appendChild(button);
    });
    addressSuggestions.classList.add('show');
    reportAddressSuggestionsInset();
}

function refreshAddressSuggestions() {
    if (suppressSuggestionRefresh) return;
    const input = addressInput.value || '';
    renderAddressSuggestions(buildSuggestions(input));
}

loadAddressHistory();

function switchToRelativeTab(offset) {
    if (!tabOrder.length || activeTabId === null) return;
    const idx = tabOrder.indexOf(activeTabId);
    if (idx < 0) return;
    const nextIdx = (idx + offset + tabOrder.length) % tabOrder.length;
    const targetTabId = tabOrder[nextIdx];
    if (typeof targetTabId === 'number') {
        window.browserAPI.switchTab(targetTabId);
    }
}

document.addEventListener('keydown', (e) => {
    const withPrimaryMod = e.ctrlKey || e.metaKey;
    if (!withPrimaryMod || e.altKey) return;

    const key = e.key.toLowerCase();
    if (key === 'l' && !e.shiftKey) {
        e.preventDefault();
        addressInput.focus();
        addressInput.select();
        refreshAddressSuggestions();
        return;
    }
    if (key === 't' && !e.shiftKey) {
        e.preventDefault();
        window.browserAPI.newTab('https://google.com');
        return;
    }
    if (key === 'w' && !e.shiftKey) {
        e.preventDefault();
        if (activeTabId !== null) window.browserAPI.closeTab(activeTabId);
        return;
    }
    if (e.key === 'Tab') {
        e.preventDefault();
        switchToRelativeTab(e.shiftKey ? -1 : 1);
    }
});

addressInput.addEventListener('input', refreshAddressSuggestions);
addressInput.addEventListener('focus', refreshAddressSuggestions);
addressInput.addEventListener('blur', () => {
    setTimeout(hideAddressSuggestions, 100);
});
window.addEventListener('resize', reportAddressSuggestionsInset);
addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && currentSuggestions.length) {
        e.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex + 1) % currentSuggestions.length;
        const nodes = addressSuggestions.querySelectorAll('.address-suggestion-item');
        nodes.forEach((node, idx) => node.classList.toggle('active', idx === activeSuggestionIndex));
        return;
    }
    if (e.key === 'ArrowUp' && currentSuggestions.length) {
        e.preventDefault();
        activeSuggestionIndex = activeSuggestionIndex <= 0 ? currentSuggestions.length - 1 : activeSuggestionIndex - 1;
        const nodes = addressSuggestions.querySelectorAll('.address-suggestion-item');
        nodes.forEach((node, idx) => node.classList.toggle('active', idx === activeSuggestionIndex));
        return;
    }
    if (e.key === 'Escape') {
        hideAddressSuggestions();
        return;
    }
    if (e.key === 'Enter') {
        const typed = addressInput.value.trim();
        if (!typed) return;
        if (applySelectedSuggestion(activeSuggestionIndex)) return;
        hideAddressSuggestions();
        window.browserAPI.navigate(typed);
    }
});

// --- Sidebar Slide Toggle ---
let sidebarOpen = true;
const sidebar = document.getElementById('sidebar');
const toggleIcon = document.getElementById('sidebar-toggle-icon');
const toggleLabel = document.getElementById('sidebar-toggle-label');

document.getElementById('sidebar-toggle').addEventListener('click', () => {
    sidebarOpen = !sidebarOpen;
    sidebar.classList.toggle('collapsed', !sidebarOpen);
    if (toggleLabel) toggleLabel.textContent = sidebarOpen ? 'AI' : 'AI ›';
    if (window.browserAPI.sidebarToggle) window.browserAPI.sidebarToggle(sidebarOpen);
});

// ─── Tab System ───────────────────────────────────────────────────────────────
// Per-tab state: { title, url, favicon, cachedContext }
const tabsState = {};
let activeTabId = null;
let tabOrder = [];

function getCachedContext() {
    return tabsState[activeTabId]?.cachedContext || '';
}

function setCachedContext(text) {
    if (activeTabId !== null && tabsState[activeTabId]) {
        tabsState[activeTabId].cachedContext = text;
    }
}

function renderTabBar(tabs, currentId) {
    const tabList = document.getElementById('tab-list');
    if (!tabList) return;
    tabList.innerHTML = '';
    tabs.forEach(tab => {
        const pill = document.createElement('div');
        pill.className = 'tab-item' + (tab.id === currentId ? ' active' : '');
        if (tab.loading) pill.classList.add('loading');
        pill.dataset.tabId = tab.id;

        const statusIcon = document.createElement('span');
        statusIcon.className = 'tab-status-icon';
        if (tab.loading) {
            statusIcon.classList.add('loading-dot');
        } else if (tab.favicon) {
            const img = document.createElement('img');
            img.src = tab.favicon;
            img.width = 13; img.height = 13;
            img.style.borderRadius = '3px';
            img.onerror = () => { statusIcon.textContent = '🌐'; };
            statusIcon.appendChild(img);
        } else {
            statusIcon.textContent = '🌐';
        }

        const title = document.createElement('span');
        title.className = 'tab-title';
        title.textContent = tab.title || 'New Tab';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'tab-close';
        closeBtn.textContent = '✕';
        closeBtn.title = 'Close tab';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.browserAPI.closeTab(tab.id);
        });

        pill.appendChild(statusIcon);
        pill.appendChild(title);
        pill.appendChild(closeBtn);

        pill.addEventListener('click', () => {
            window.browserAPI.switchTab(tab.id);
        });

        tabList.appendChild(pill);
    });
}

// Listen for tab changes from main process
window.browserAPI.onTabsChanged((data) => {
    const { tabs, activeTabId: newActiveId } = data;
    tabOrder = tabs.map(t => t.id);
    // Sync tabsState
    tabs.forEach(t => {
        if (!tabsState[t.id]) tabsState[t.id] = { cachedContext: '' };
        tabsState[t.id].title = t.title;
        tabsState[t.id].url = t.url;
        tabsState[t.id].favicon = t.favicon;
        tabsState[t.id].loading = t.loading;
        tabsState[t.id].loadProgress = t.loadProgress;
    });
    activeTabId = newActiveId;
    renderTabBar(tabs, newActiveId);
});

window.browserAPI.onTabSwitched((id) => {
    activeTabId = id;
    // Update page info to match this tab's cached context
    updatePageInfoPanel();
});

window.browserAPI.onTabUpdate((data) => {
    if (!tabsState[data.id]) tabsState[data.id] = { cachedContext: '' };
    Object.assign(tabsState[data.id], data);
    if (data.url) {
        addAddressHistory(data.url, { title: data.title, favicon: data.favicon });
    }
});

function updatePageInfoPanel() {
    const state = tabsState[activeTabId];
    if (!state || !state.url) return;
    try {
        const pageInfo = document.getElementById('page-info');
        const domainEl = document.getElementById('page-domain');
        const wordsEl = document.getElementById('page-words');
        const readTimeEl = document.getElementById('page-read-time');
        const url = state.url;
        const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);
        if (domainEl) domainEl.textContent = urlObj.hostname.replace('www.', '');
        if (state.cachedContext && wordsEl && readTimeEl) {
            const words = state.cachedContext.trim().split(/\s+/).filter(w => w.length > 0).length;
            wordsEl.textContent = words.toLocaleString();
            readTimeEl.textContent = Math.ceil(words / 200);
        }
        if (pageInfo) pageInfo.style.display = state.cachedContext ? 'block' : 'none';
    } catch (e) { }
}

// New Tab button
document.getElementById('btn-new-tab').addEventListener('click', () => {
    window.browserAPI.newTab('https://google.com');
});

// --- Page Context Cache (tab-scoped) ---
async function refreshPageInfo(url) {
    try {
        const pageInfo = document.getElementById('page-info');
        const domainEl = document.getElementById('page-domain');
        const wordsEl = document.getElementById('page-words');
        const readTimeEl = document.getElementById('page-read-time');

        const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);
        if (domainEl) domainEl.textContent = urlObj.hostname.replace('www.', '');
        if (pageInfo) pageInfo.style.display = 'block';

        const text = await window.browserAPI.getPageText();
        setCachedContext(text);

        const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
        const readTime = Math.ceil(words / 200);
        if (wordsEl) wordsEl.textContent = words.toLocaleString();
        if (readTimeEl) readTimeEl.textContent = readTime;

    } catch (e) {
        console.error('Page info refresh error:', e);
    }
}

window.browserAPI.onUrlChange(async (newUrl) => {
    const tabMeta = activeTabId !== null ? tabsState[activeTabId] : null;
    addAddressHistory(newUrl, { title: tabMeta?.title, favicon: tabMeta?.favicon });
    addressInput.value = newUrl;
    hideAddressSuggestions();
    // Store URL in tab state
    if (activeTabId !== null && tabsState[activeTabId]) {
        tabsState[activeTabId].url = newUrl;
    }
    await refreshPageInfo(newUrl);
});


// --- AI Chatbed Logic ---
const promptInput = document.getElementById('prompt');
const btnAsk = document.getElementById('btn-ask');
const chatContainer = document.getElementById('chat-container');

// Settings Elements
const modelSelect = document.getElementById('model-select');
const btnSettings = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
const geminiKeyInput = document.getElementById('gemini-key-input');
const btnSettingsSave = document.getElementById('btn-settings-save');
const btnSettingsCancel = document.getElementById('btn-settings-cancel');
const btnOpenDataFolder = document.getElementById('btn-open-data-folder');

// Load stored settings on init
const storedKey = localStorage.getItem('levento-gemini-key') || "";
if (storedKey) geminiKeyInput.value = storedKey;
const storedModel = localStorage.getItem('levento-model') || "ollama";
modelSelect.value = storedModel;

// Settings Listeners
btnSettings.addEventListener('click', () => {
    if (window.browserAPI && window.browserAPI.openModal) window.browserAPI.openModal();
    settingsModal.style.display = 'flex';
});
btnSettingsCancel.addEventListener('click', () => {
    if (window.browserAPI && window.browserAPI.closeModal) window.browserAPI.closeModal();
    settingsModal.style.display = 'none';
});
btnSettingsSave.addEventListener('click', () => {
    localStorage.setItem('levento-gemini-key', geminiKeyInput.value.trim());
    if (window.browserAPI && window.browserAPI.closeModal) window.browserAPI.closeModal();
    settingsModal.style.display = 'none';
});
modelSelect.addEventListener('change', (e) => {
    localStorage.setItem('levento-model', e.target.value);
});
if (btnOpenDataFolder) {
    btnOpenDataFolder.addEventListener('click', async () => {
        try {
            await window.browserAPI.openDataFolder();
        } catch (e) {
            console.error('Open data folder failed:', e);
        }
    });
}


// --- Stats Panel Updater ---
let totalTokensUsed = 0;

function updateStats(responseText, elapsedMs) {
    const statSpeed = document.getElementById('stat-speed');
    const statTokens = document.getElementById('stat-tokens');

    if (statSpeed) {
        const seconds = (elapsedMs / 1000).toFixed(1);
        statSpeed.textContent = seconds;
        // Color: green if fast, yellow if medium, orange if slow  
        statSpeed.style.color = elapsedMs < 3000 ? '#4ade80' : elapsedMs < 8000 ? '#fbbf24' : '#f87171';
    }

    if (statTokens) {
        // Rough estimate: 1 token ≈ 4 characters (standard heuristic)
        const estimatedTokens = Math.round(responseText.length / 4);
        totalTokensUsed += estimatedTokens;
        statTokens.textContent = totalTokensUsed.toLocaleString();
    }
}

async function fetchAI(fullPrompt) {
    const activeModel = modelSelect.value;
    const startTime = Date.now();

    // Router: OLLAMA
    if (activeModel === 'ollama') {
        const res = await fetch("http://localhost:11434/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "gemma",
                prompt: fullPrompt,
                stream: false
            })
        });
        const data = await res.json();
        const answer = data.response || data.message?.content || "No response received";
        updateStats(answer, Date.now() - startTime);
        return answer;
    }

    // Router: GEMINI
    if (activeModel === 'gemini') {
        const apiKey = localStorage.getItem('levento-gemini-key');
        if (!apiKey) {
            settingsModal.style.display = 'flex';
            throw new Error("Gemini API Key is missing. Please configure it in settings.");
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: fullPrompt }] }]
            })
        });
        const data = await res.json();

        if (data.error) throw new Error(data.error.message);

        const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response received";
        updateStats(answer, Date.now() - startTime);
        return answer;
    }
}

async function askAI() {
    const promptText = promptInput.value.trim();
    if (!promptText) return;

    appendMessage('user-message', promptText);
    promptInput.value = '';

    const loadingElement = appendMessage('ai-message', 'Thinking...', 'loading');

    try {
        // Use cached context if available (AI-native: no need to click Summarize first!)
        const pageContext = getCachedContext() || await window.browserAPI.getPageText();
        const fullPrompt = `The user is currently browsing a web page. Here is the text of the page they are on:\n\n<PAGE_CONTEXT>\n${pageContext}\n</PAGE_CONTEXT>\n\nUser Question: ${promptText}`;

        const answer = await fetchAI(fullPrompt);
        setLoadingDone(loadingElement, answer);
    } catch (err) {
        setLoadingDone(loadingElement, err.message || "Error communicating with AI endpoint.");
        console.error(err);
    }
}

function appendMessage(className, text, extraClass = '') {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${className} ${extraClass}`.trim();
    msgDiv.innerText = text;
    chatContainer.appendChild(msgDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return msgDiv;
}

function setLoadingDone(element, text) {
    element.classList.remove('loading');
    element.innerText = text;
}

btnAsk.addEventListener('click', askAI);
promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        askAI();
    }
});

// --- Summarize Feature (3-state UX) ---
const btnSummarize = document.getElementById('btn-summarize');
document.getElementById('btn-summarize').addEventListener('click', async () => {
    // State 2: Loading
    btnSummarize.textContent = '⏳ Reading page...';
    btnSummarize.disabled = true;
    btnSummarize.style.opacity = '0.7';
    btnSummarize.style.cursor = 'not-allowed';

    appendMessage('user-message', '✨ Summarize this page');
    const loadingElement = appendMessage('ai-message', 'Reading page...', 'loading');

    try {
        const pageContext = getCachedContext() || await window.browserAPI.getPageText();
        const fullPrompt = `The user wants you to summarize the following web page content. Be concise and highlight the main points:\n\n<PAGE_CONTEXT>\n${pageContext}\n</PAGE_CONTEXT>\n\nPlease provide a clear, structured summary in Thai.`;

        const answer = await fetchAI(fullPrompt);
        setLoadingDone(loadingElement, answer);
    } catch (err) {
        setLoadingDone(loadingElement, err.message || "Error communicating with AI endpoint.");
        console.error(err);
    } finally {
        // State 1: Idle (restore)
        btnSummarize.textContent = '✨ Summarize This Page';
        btnSummarize.disabled = false;
        btnSummarize.style.opacity = '1';
        btnSummarize.style.cursor = 'pointer';
    }
});

// --- Context Menu AI Actions ---
if (window.browserAPI && window.browserAPI.onAIAction) {
    window.browserAPI.onAIAction(async (data) => {
        const { type, payload } = data;

        if (type === 'inspect-dom') {
            appendMessage('user-message', '🔍 Inspect Element');
            const loadingElement = appendMessage('ai-message', 'Analyzing...', 'loading');
            try {
                const fullPrompt = `The user right-clicked an HTML element to inspect it. Please explain what this element does, its purpose, and any notable attributes. Be concise. \n\n<DOM_NODE>\n${payload}\n</DOM_NODE>\n\nPlease reply in Thai.`;
                const answer = await fetchAI(fullPrompt);
                setLoadingDone(loadingElement, answer);
            } catch (err) {
                setLoadingDone(loadingElement, err.message || "Error analyzing DOM.");
                console.error(err);
            }
        }

        else if (type === 'generate-tailwind') {
            appendMessage('user-message', '🎨 Convert to Tailwind');
            const loadingElement = appendMessage('ai-message', 'Generating...', 'loading');
            try {
                const fullPrompt = `The user right-clicked an HTML element. Convert its computed CSS styles into utility Tailwind CSS classes. Return ONLY the new HTML string with the tailwind classes applied. Do not wrap it in markdown blockquotes, just the raw HTML.\n\n<DOM_NODE>\n${payload.html}\n</DOM_NODE>\n\n<COMPUTED_CSS>\n${payload.css}\n</COMPUTED_CSS>`;
                const answer = await fetchAI(fullPrompt);
                setLoadingDone(loadingElement, answer);
            } catch (err) {
                setLoadingDone(loadingElement, err.message || "Error generating Tailwind.");
                console.error(err);
            }
        }

        else if (type === 'ask-selection') {
            const short = payload.length > 60 ? payload.slice(0, 60) + '...' : payload;
            appendMessage('user-message', `💬 "${short}"`);
            const loadingElement = appendMessage('ai-message', 'Asking AI...', 'loading');
            try {
                const fullPrompt = `The user selected the following text on a webpage and wants to ask Levento AI about it. Explain it clearly and concisely in Thai:\n\n<SELECTED_TEXT>\n${payload}\n</SELECTED_TEXT>`;
                const answer = await fetchAI(fullPrompt);
                setLoadingDone(loadingElement, answer);
            } catch (err) {
                setLoadingDone(loadingElement, err.message || "Error querying AI.");
                console.error(err);
            }
        }
    });
}
