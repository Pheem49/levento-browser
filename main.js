const { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, shell, session } = require('electron')
const path = require('path')
const fs = require('fs')

// ─── Auto-Updater ─────────────────────────────────────────────────────────────
let autoUpdater;
try {
    // Only runs when packaged as an AppImage/exe (not during dev)
    if (app.isPackaged) {
        const { autoUpdater: updater } = require('electron-updater');
        autoUpdater = updater;
    }
} catch (e) { }

function setupAutoUpdater() {
    if (!autoUpdater) return;

    autoUpdater.autoDownload = false;  // ask user first

    autoUpdater.on('update-available', (info) => {
        dialog.showMessageBox(win, {
            type: 'info',
            title: '🚀 Update Available',
            message: `Levento ${info.version} is available!`,
            detail: 'A new version is ready. Download it now?',
            buttons: ['Download', 'Later'],
            defaultId: 0
        }).then(result => {
            if (result.response === 0) {
                autoUpdater.downloadUpdate();
                // Notify renderer
                if (win) win.webContents.send('update-status', 'downloading');
            }
        });
    });

    autoUpdater.on('update-downloaded', () => {
        dialog.showMessageBox(win, {
            type: 'info',
            title: '✅ Update Ready',
            message: 'Update downloaded!',
            detail: 'Restart Levento to apply the update.',
            buttons: ['Restart Now', 'Later'],
            defaultId: 0
        }).then(result => {
            if (result.response === 0) autoUpdater.quitAndInstall();
        });
    });

    autoUpdater.on('error', (err) => {
        console.error('Auto-updater error:', err.message);
    });

    // Check for updates 3s after launch
    setTimeout(() => autoUpdater.checkForUpdates(), 3000);
}

let win;
let gpuCrashDetected = false;

const gpuFallbackMarkerPath = path.join(app.getPath('userData'), 'gpu-fallback.json');
const sessionStatePath = path.join(app.getPath('userData'), 'tabs-session.json');
let gpuFallbackEnabled = false;
let gpuFallbackManual = false;
let sessionSaveTimer = null;

function loadGpuFallbackState() {
    try {
        const raw = fs.readFileSync(gpuFallbackMarkerPath, 'utf8');
        const data = JSON.parse(raw);
        return {
            enabled: Boolean(data && data.enabled),
            manual: Boolean(data && data.manual),
            reason: String(data?.reason || '')
        };
    } catch (e) {
        return { enabled: false, manual: false, reason: '' };
    }
}

function saveGpuFallbackState(enabled, reason = '', manual = false) {
    try {
        const payload = {
            enabled,
            manual,
            reason,
            updatedAt: new Date().toISOString()
        };
        fs.mkdirSync(path.dirname(gpuFallbackMarkerPath), { recursive: true });
        fs.writeFileSync(gpuFallbackMarkerPath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to persist GPU fallback state:', e.message);
    }
}

const initialGpuFallbackState = loadGpuFallbackState();
gpuFallbackEnabled = initialGpuFallbackState.enabled;
gpuFallbackManual = initialGpuFallbackState.manual;
if (gpuFallbackEnabled) {
    app.disableHardwareAcceleration();
    console.warn('GPU fallback enabled: hardware acceleration is disabled for this launch.');
}

function loadSessionState() {
    try {
        const raw = fs.readFileSync(sessionStatePath, 'utf8');
        const data = JSON.parse(raw);
        const urls = Array.isArray(data?.tabs)
            ? data.tabs
                .map(item => String(item?.url || '').trim())
                .filter(Boolean)
                .slice(0, 20)
            : [];
        const activeIndex = Number.isInteger(data?.activeIndex) ? data.activeIndex : 0;
        return { tabs: urls, activeIndex };
    } catch (e) {
        return { tabs: [], activeIndex: 0 };
    }
}

function persistSessionState() {
    try {
        const tabsPayload = tabs
            .map(t => ({ url: String(t.url || '').trim() }))
            .filter(t => t.url);
        const activeIndex = Math.max(0, tabs.findIndex(t => t.id === activeTabId));
        const payload = {
            tabs: tabsPayload,
            activeIndex,
            updatedAt: new Date().toISOString()
        };
        fs.mkdirSync(path.dirname(sessionStatePath), { recursive: true });
        fs.writeFileSync(sessionStatePath, JSON.stringify(payload, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to persist session state:', e.message);
    }
}

function scheduleSessionSave() {
    if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
    sessionSaveTimer = setTimeout(() => {
        sessionSaveTimer = null;
        persistSessionState();
    }, 250);
}

function restoreSessionOrDefault() {
    const state = loadSessionState();
    if (!state.tabs.length) {
        createTab('https://google.com');
        return;
    }

    const restoredIds = state.tabs.map(url => createTab(url, false));
    const fallbackIndex = Math.min(restoredIds.length - 1, Math.max(0, state.activeIndex));
    const restoreId = restoredIds[fallbackIndex] || restoredIds[0];
    if (restoreId !== undefined) switchTab(restoreId);
}

// ─── Tab State ───────────────────────────────────────────────────────────────
let tabs = [];       // [{ id, view, url, title }]
let activeTabId = null;
let nextTabId = 0;
let sidebarOpen = true;  // track sidebar state for resizing
let addressSuggestionsInsetTarget = 0;
let addressSuggestionsInsetCurrent = 0;
let insetAnimationTimer = null;

function getActiveView() {
    const tab = tabs.find(t => t.id === activeTabId);
    return tab ? tab.view : null;
}

function isActiveTabInHtmlFullscreen() {
    const tab = tabs.find(t => t.id === activeTabId);
    return Boolean(tab && tab.htmlFullscreen);
}

function emitHtmlFullscreenState() {
    if (!win) return;
    win.webContents.send('html-fullscreen-changed', isActiveTabInHtmlFullscreen());
}

function resolveNavigationTarget(rawInput) {
    const input = String(rawInput || '').trim();
    if (!input) return '';

    if (/^https?:\/\//i.test(input)) {
        return input;
    }

    if (/^about:blank$/i.test(input)) {
        return input;
    }

    const hasSpaces = /\s/.test(input);
    const hasDot = input.includes('.');
    const isLocalhost = /^localhost(?::\d+)?(\/.*)?$/i.test(input);
    const isIPv4 = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(\/.*)?$/.test(input);
    const isLikelyUrl = (hasDot && !hasSpaces) || isLocalhost || isIPv4;

    if (isLikelyUrl) {
        return `https://${input}`;
    }

    return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

function isAllowedNavigationUrl(rawUrl) {
    try {
        const url = new URL(String(rawUrl || ''));
        if (url.protocol === 'http:' || url.protocol === 'https:') return true;
        if (url.protocol === 'about:' && String(rawUrl).toLowerCase() === 'about:blank') return true;
        return false;
    } catch (e) {
        return false;
    }
}

function applyWebContentsSecurityGuards(webContents) {
    // Block embedded webviews from untrusted pages.
    webContents.on('will-attach-webview', (event) => {
        event.preventDefault();
    });

    // Restrict top-level navigations to safe schemes.
    webContents.on('will-navigate', (event, url) => {
        if (!isAllowedNavigationUrl(url)) {
            event.preventDefault();
            console.warn('Blocked unsafe navigation:', url);
        }
    });

    // Disallow in-app popups; open safe links externally instead.
    webContents.setWindowOpenHandler(({ url }) => {
        if (isAllowedNavigationUrl(url)) {
            shell.openExternal(url).catch(() => { });
        }
        return { action: 'deny' };
    });
}

function setupPermissionSecurity() {
    const ses = session.defaultSession;
    if (!ses) return;

    // Baseline: deny powerful permissions by default.
    ses.setPermissionRequestHandler((_webContents, permission, callback) => {
        const allowed = permission === 'fullscreen';
        callback(allowed);
    });

    ses.setPermissionCheckHandler((_webContents, permission) => {
        return permission === 'fullscreen';
    });
}

const adHostSuffixDenylist = [
    'doubleclick.net',
    'googlesyndication.com',
    'googleadservices.com',
    'adservice.google.com',
    '2mdn.net',
    'adnxs.com',
    'taboola.com',
    'outbrain.com',
    'criteo.com',
    'adsrvr.org',
    'rubiconproject.com',
    'openx.net',
    'pubmatic.com',
    'scorecardresearch.com',
    'moatads.com',
    'zedo.com',
    'yieldmo.com',
    'advertising.com',
    'smartadserver.com'
];

const adBlockedResourceTypes = new Set([
    'script',
    'image',
    'subFrame',
    'sub_frame',
    'xmlhttprequest',
    'media',
    'font'
]);

function parseHostname(rawUrl) {
    try {
        return new URL(String(rawUrl || '')).hostname.toLowerCase();
    } catch (e) {
        return '';
    }
}

function isYouTubeHostname(host) {
    if (!host) return false;
    return host === 'youtube.com'
        || host.endsWith('.youtube.com')
        || host === 'youtu.be'
        || host.endsWith('.googlevideo.com')
        || host.endsWith('.ytimg.com');
}

function isYouTubeContext(details) {
    const urlHost = parseHostname(details?.url);
    const initiatorHost = parseHostname(details?.initiator);
    const referrerHost = parseHostname(details?.referrer);
    return isYouTubeHostname(urlHost) || isYouTubeHostname(initiatorHost) || isYouTubeHostname(referrerHost);
}

function shouldBlockAdRequest(details) {
    if (!details || !details.url) return false;
    if (isYouTubeContext(details)) return false;
    if (!adBlockedResourceTypes.has(details.resourceType)) return false;

    const host = parseHostname(details.url);
    if (!host) return false;
    return adHostSuffixDenylist.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

function setupAdblockFiltering() {
    const ses = session.defaultSession;
    if (!ses) return;

    ses.webRequest.onBeforeRequest((details, callback) => {
        callback({ cancel: shouldBlockAdRequest(details) });
    });
}

function emitTabUpdate(id, patch = {}) {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    Object.assign(tab, patch);
    if ('url' in patch) scheduleSessionSave();
    if (!win) return;
    win.webContents.send('tab-update', {
        id,
        title: tab.title,
        url: tab.url,
        favicon: tab.favicon,
        loading: Boolean(tab.loading),
        loadProgress: Math.max(0, Math.min(100, Math.round(tab.loadProgress || 0)))
    });
}

function stopTabLoadingProgress(id) {
    const tab = tabs.find(t => t.id === id);
    if (!tab || !tab.loadingInterval) return;
    clearInterval(tab.loadingInterval);
    tab.loadingInterval = null;
}

function beginTabLoading(id) {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;

    tab.loadingToken = (tab.loadingToken || 0) + 1;
    stopTabLoadingProgress(id);
    tab.loading = true;
    tab.loadProgress = Math.max(8, Math.min(35, Math.round(tab.loadProgress || 8)));
    emitTabUpdate(id, { loading: true, loadProgress: tab.loadProgress });

    tab.loadingInterval = setInterval(() => {
        const current = Math.max(0, Math.min(98, Math.round(tab.loadProgress || 0)));
        const next = current + Math.max(1, Math.round((92 - current) * 0.14));
        tab.loadProgress = Math.min(92, next);
        emitTabUpdate(id, { loadProgress: tab.loadProgress, loading: true });
    }, 120);
}

function completeTabLoading(id) {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;
    const tokenAtComplete = tab.loadingToken || 0;

    stopTabLoadingProgress(id);
    tab.loading = true;
    tab.loadProgress = 100;
    emitTabUpdate(id, { loading: true, loadProgress: 100 });

    setTimeout(() => {
        const latestTab = tabs.find(t => t.id === id);
        if (!latestTab) return;
        if ((latestTab.loadingToken || 0) !== tokenAtComplete) return;
        emitTabUpdate(id, { loading: false, loadProgress: 0 });
    }, 180);
}

function getCurrentAddressInset() {
    return Math.max(0, Math.floor(addressSuggestionsInsetCurrent || 0));
}

function getViewBounds() {
    if (!win) return { x: 0, y: 100, width: 1050, height: 800 };
    const b = win.getContentBounds();
    const htmlFullscreen = isActiveTabInHtmlFullscreen();
    const sidebarWidth = (sidebarOpen && !htmlFullscreen) ? 350 : 0;
    const baseTop = htmlFullscreen ? 0 : 100; // toolbar (56px) + tab bar (44px)
    const topInset = htmlFullscreen ? 0 : getCurrentAddressInset();
    const y = baseTop + topInset;
    return {
        x: 0,
        y,          // chrome top bars + temporary suggestions inset
        width: b.width - sidebarWidth,
        height: Math.max(0, b.height - y)
    };
}

function applyActiveViewBounds() {
    const view = getActiveView();
    if (view) view.setBounds(getViewBounds());
}

function animateAddressInsetTo(nextInset) {
    addressSuggestionsInsetTarget = Math.max(0, Math.floor(nextInset || 0));
    if (insetAnimationTimer) return;

    insetAnimationTimer = setInterval(() => {
        const delta = addressSuggestionsInsetTarget - addressSuggestionsInsetCurrent;
        if (Math.abs(delta) < 1) {
            addressSuggestionsInsetCurrent = addressSuggestionsInsetTarget;
            applyActiveViewBounds();
            clearInterval(insetAnimationTimer);
            insetAnimationTimer = null;
            return;
        }
        addressSuggestionsInsetCurrent += delta * 0.28;
        applyActiveViewBounds();
    }, 16);
}

// ─── Tab creation ─────────────────────────────────────────────────────────────
function createTab(url = 'https://google.com', activate = true) {
    const id = nextTabId++;
    const view = new WebContentsView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false
        }
    });

    // Keep it hidden initially
    win.contentView.addChildView(view);
    view.setBounds(getViewBounds());

    url = resolveNavigationTarget(url);
    view.webContents.loadURL(url);

    // Wire URL events
    view.webContents.on('did-navigate', (event, newUrl) => {
        emitTabUpdate(id, { url: newUrl });
        if (id === activeTabId && win) {
            win.webContents.send('browser-url-changed', newUrl);
        }
    });
    view.webContents.on('did-navigate-in-page', (event, newUrl) => {
        emitTabUpdate(id, { url: newUrl });
        if (id === activeTabId && win) {
            win.webContents.send('browser-url-changed', newUrl);
        }
    });

    // Wire title / favicon events
    view.webContents.on('page-title-updated', (event, title) => {
        emitTabUpdate(id, { title });
    });
    view.webContents.on('page-favicon-updated', (event, favicons) => {
        if (favicons.length) emitTabUpdate(id, { favicon: favicons[0] });
    });
    view.webContents.on('did-start-loading', () => beginTabLoading(id));
    view.webContents.on('did-stop-loading', () => completeTabLoading(id));
    view.webContents.on('did-fail-load', () => completeTabLoading(id));
    view.webContents.on('enter-html-full-screen', () => {
        emitTabUpdate(id, { htmlFullscreen: true });
        if (id === activeTabId) {
            applyActiveViewBounds();
            emitHtmlFullscreenState();
        }
    });
    view.webContents.on('leave-html-full-screen', () => {
        emitTabUpdate(id, { htmlFullscreen: false });
        if (id === activeTabId) {
            applyActiveViewBounds();
            emitHtmlFullscreenState();
        }
    });
    applyWebContentsSecurityGuards(view.webContents);

    // Context menu
    setupContextMenu(view.webContents);

    const tab = { id, view, url, title: 'New Tab', favicon: '', loading: true, loadProgress: 8, loadingInterval: null, loadingToken: 0, htmlFullscreen: false };
    tabs.push(tab);
    scheduleSessionSave();

    if (activate) {
        switchTab(id);
    } else {
        // keep it invisible
        view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    }

    // Notify renderer of new tab list
    if (win) win.webContents.send('tabs-changed', getTabsSummary());
    return id;
}

// ─── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(id) {
    // Hide all views
    tabs.forEach(t => {
        if (t.view) t.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    });

    activeTabId = id;
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;

    tab.view.setBounds(getViewBounds());
    scheduleSessionSave();

    if (win) {
        win.webContents.send('browser-url-changed', tab.url || '');
        win.webContents.send('tab-switched', id);
        win.webContents.send('tabs-changed', getTabsSummary());
        emitHtmlFullscreenState();
    }
}

// ─── Tab closing ──────────────────────────────────────────────────────────────
function closeTab(id) {
    if (tabs.length <= 1) return; // keep at least 1 tab

    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;

    const tab = tabs[idx];
    if (tab.loadingInterval) clearInterval(tab.loadingInterval);
    tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    win.contentView.removeChildView(tab.view);
    tab.view.webContents.destroy();
    tabs.splice(idx, 1);
    scheduleSessionSave();

    // Switch to nearest tab
    if (id === activeTabId) {
        const nextIdx = Math.min(idx, tabs.length - 1);
        switchTab(tabs[nextIdx].id);
    } else {
        emitHtmlFullscreenState();
    }

    if (win) win.webContents.send('tabs-changed', getTabsSummary());
}

function getTabsSummary() {
    return {
        activeTabId,
        tabs: tabs.map(t => ({
            id: t.id,
            title: t.title,
            url: t.url,
            favicon: t.favicon,
            loading: Boolean(t.loading),
            loadProgress: Math.max(0, Math.min(100, Math.round(t.loadProgress || 0)))
        }))
    };
}

// ─── Context Menu ─────────────────────────────────────────────────────────────
function setupContextMenu(webContents) {
    webContents.on('context-menu', (event, params) => {
        const { x, y, selectionText } = params;
        const menuItems = [];

        if (selectionText && selectionText.trim().length > 0) {
            const preview = selectionText.length > 30 ? selectionText.slice(0, 30) + '…' : selectionText;
            menuItems.push({
                label: `💬 Ask Levento: "${preview}"`,
                click: () => {
                    if (!win) return;
                    win.webContents.send('ai-action', { type: 'ask-selection', payload: selectionText });
                }
            });
            menuItems.push({ type: 'separator' });
        }

        const view = getActiveView();
        menuItems.push(
            {
                label: '✨ Inspect Element with AI',
                click: async () => {
                    if (!view || !win) return;
                    const codeSnippet = await view.webContents.executeJavaScript(`
                        (function() {
                            const el = document.elementFromPoint(${x}, ${y});
                            return el ? el.outerHTML : null;
                        })();
                    `);
                    if (codeSnippet) win.webContents.send('ai-action', { type: 'inspect-dom', payload: codeSnippet });
                }
            },
            {
                label: '🎨 Convert to Tailwind',
                click: async () => {
                    if (!view || !win) return;
                    const cssSnippet = await view.webContents.executeJavaScript(`
                        (function() {
                            const el = document.elementFromPoint(${x}, ${y});
                            if (!el) return null;
                            return { html: el.outerHTML, css: el.style.cssText || "No inline styles. Classes: " + el.className };
                        })();
                    `);
                    if (cssSnippet) win.webContents.send('ai-action', { type: 'generate-tailwind', payload: cssSnippet });
                }
            },
            { type: 'separator' },
            { role: 'copy' },
            { role: 'selectAll' }
        );

        Menu.buildFromTemplate(menuItems).popup();
    });
}

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
    const windowIconPath = path.join(__dirname, 'assets', 'icon.png');
    win = new BrowserWindow({
        width: 1400,
        height: 900,
        icon: windowIconPath,
        backgroundColor: '#0b0f16',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    if (process.platform === 'linux') {
        win.setIcon(windowIconPath);
    }

    win.loadFile('index.html');

    win.on('resize', () => {
        applyActiveViewBounds();
    });

    win.webContents.once('did-finish-load', () => {
        restoreSessionOrDefault();
        setupAutoUpdater();  // check for updates after UI is ready
    });
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
ipcMain.on('tab-new', (event, url) => {
    createTab(url || 'https://google.com');
});

ipcMain.on('tab-switch', (event, id) => {
    switchTab(id);
});

ipcMain.on('tab-close', (event, id) => {
    closeTab(id);
});

ipcMain.on('modal-open', () => {
    const view = getActiveView();
    if (win && view) win.contentView.removeChildView(view);
});

ipcMain.on('modal-close', () => {
    const view = getActiveView();
    if (win && view) win.contentView.addChildView(view);
});

ipcMain.on('sidebar-toggle', (event, isOpen) => {
    sidebarOpen = isOpen;
    applyActiveViewBounds();
});

ipcMain.on('address-suggestions-inset', (event, insetPx) => {
    const parsed = Number(insetPx);
    const nextInset = Number.isFinite(parsed) ? Math.max(0, Math.min(320, Math.floor(parsed))) : 0;
    if (nextInset === addressSuggestionsInsetTarget) return;
    animateAddressInsetTo(nextInset);
});

ipcMain.on('browser-go-back', () => {
    const view = getActiveView();
    if (view && view.webContents.canGoBack()) view.webContents.goBack();
});

ipcMain.on('browser-go-forward', () => {
    const view = getActiveView();
    if (view && view.webContents.canGoForward()) view.webContents.goForward();
});

ipcMain.on('browser-reload', () => {
    const view = getActiveView();
    if (view) view.webContents.reload();
});

ipcMain.on('browser-navigate', (event, url) => {
    const view = getActiveView();
    if (view) {
        url = resolveNavigationTarget(url);
        view.webContents.loadURL(url);
        emitTabUpdate(activeTabId, { url });
    }
});

ipcMain.on('browser-toggle-devtools', () => {
    if (app.isPackaged) return;
    const view = getActiveView();
    if (view) {
        if (view.webContents.isDevToolsOpened()) view.webContents.closeDevTools();
        else view.webContents.openDevTools({ mode: 'detach' });
    }
});

ipcMain.handle('get-page-text', async () => {
    const view = getActiveView();
    if (view) {
        try {
            const text = await view.webContents.executeJavaScript('document.body.innerText');
            return text.substring(0, 15000);
        } catch (e) {
            return 'Unable to read page content.';
        }
    }
    return '';
});

ipcMain.handle('open-data-folder', async () => {
    try {
        const dataDir = app.getPath('userData');
        const result = await shell.openPath(dataDir);
        if (result) {
            return { ok: false, error: result };
        }
        return { ok: true, path: dataDir };
    } catch (e) {
        return { ok: false, error: e.message || 'Unable to open data folder' };
    }
});

ipcMain.handle('get-gpu-safe-mode', async () => {
    const state = loadGpuFallbackState();
    return { enabled: Boolean(state.enabled) };
});

ipcMain.handle('set-gpu-safe-mode', async (_event, enabled) => {
    const nextEnabled = Boolean(enabled);
    saveGpuFallbackState(nextEnabled, nextEnabled ? 'Manually enabled from Settings' : 'Manually disabled from Settings', nextEnabled);
    gpuFallbackEnabled = nextEnabled;
    gpuFallbackManual = nextEnabled;
    return { ok: true, enabled: nextEnabled, restartRequired: true };
});

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
    setupPermissionSecurity();
    setupAdblockFiltering();
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('child-process-gone', (event, details) => {
    if (details.type === 'GPU' && details.reason !== 'clean-exit') {
        gpuCrashDetected = true;
        console.error('GPU process crashed:', details);
    }
});

app.on('before-quit', () => {
    if (sessionSaveTimer) {
        clearTimeout(sessionSaveTimer);
        sessionSaveTimer = null;
    }
    persistSessionState();

    if (gpuCrashDetected) {
        saveGpuFallbackState(true, 'Detected GPU process crash', false);
        return;
    }

    if (gpuFallbackEnabled && !gpuFallbackManual) {
        // If we launched in fallback mode and stayed stable, try GPU again next run.
        saveGpuFallbackState(false, 'Cleared after stable fallback launch', false);
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
