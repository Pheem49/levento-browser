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
addressInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const url = addressInput.value.trim();
        if (url) window.browserAPI.navigate(url);
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
        pill.dataset.tabId = tab.id;

        const favicon = document.createElement('span');
        favicon.className = 'tab-favicon';
        if (tab.favicon) {
            const img = document.createElement('img');
            img.src = tab.favicon;
            img.width = 13; img.height = 13;
            img.style.borderRadius = '2px';
            img.onerror = () => { favicon.textContent = '🌐'; };
            favicon.appendChild(img);
        } else {
            favicon.textContent = '🌐';
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

        pill.appendChild(favicon);
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
    // Sync tabsState
    tabs.forEach(t => {
        if (!tabsState[t.id]) tabsState[t.id] = { cachedContext: '' };
        tabsState[t.id].title = t.title;
        tabsState[t.id].url = t.url;
        tabsState[t.id].favicon = t.favicon;
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
    addressInput.value = newUrl;
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
