const { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog } = require('electron')
const path = require('path')

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

// ─── Tab State ───────────────────────────────────────────────────────────────
let tabs = [];       // [{ id, view, url, title }]
let activeTabId = null;
let nextTabId = 0;
let sidebarOpen = true;  // track sidebar state for resizing

function getActiveView() {
    const tab = tabs.find(t => t.id === activeTabId);
    return tab ? tab.view : null;
}

function getViewBounds() {
    if (!win) return { x: 0, y: 86, width: 1050, height: 814 };
    const b = win.getContentBounds();
    const sidebarWidth = sidebarOpen ? 350 : 0;
    return {
        x: 0,
        y: 86,          // toolbar (50px) + tab bar (36px)
        width: b.width - sidebarWidth,
        height: b.height - 86
    };
}

// ─── Tab creation ─────────────────────────────────────────────────────────────
function createTab(url = 'https://google.com', activate = true) {
    const id = nextTabId++;
    const view = new WebContentsView({
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    // Keep it hidden initially
    win.contentView.addChildView(view);
    view.setBounds(getViewBounds());

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }
    view.webContents.loadURL(url);

    // Wire URL events
    view.webContents.on('did-navigate', (event, newUrl) => {
        const tab = tabs.find(t => t.id === id);
        if (tab) tab.url = newUrl;
        if (id === activeTabId && win) {
            win.webContents.send('browser-url-changed', newUrl);
        }
    });
    view.webContents.on('did-navigate-in-page', (event, newUrl) => {
        const tab = tabs.find(t => t.id === id);
        if (tab) tab.url = newUrl;
        if (id === activeTabId && win) {
            win.webContents.send('browser-url-changed', newUrl);
        }
    });

    // Wire title / favicon events
    view.webContents.on('page-title-updated', (event, title) => {
        const tab = tabs.find(t => t.id === id);
        if (tab) tab.title = title;
        if (win) win.webContents.send('tab-update', { id, title, url: tab?.url, favicon: tab?.favicon });
    });
    view.webContents.on('page-favicon-updated', (event, favicons) => {
        const tab = tabs.find(t => t.id === id);
        if (tab && favicons.length) tab.favicon = favicons[0];
        if (win) win.webContents.send('tab-update', { id, title: tab?.title, url: tab?.url, favicon: favicons[0] });
    });

    // Context menu
    setupContextMenu(view.webContents);

    const tab = { id, view, url, title: 'New Tab', favicon: '' };
    tabs.push(tab);

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

    if (win) {
        win.webContents.send('browser-url-changed', tab.url || '');
        win.webContents.send('tab-switched', id);
        win.webContents.send('tabs-changed', getTabsSummary());
    }
}

// ─── Tab closing ──────────────────────────────────────────────────────────────
function closeTab(id) {
    if (tabs.length <= 1) return; // keep at least 1 tab

    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;

    const tab = tabs[idx];
    tab.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    win.contentView.removeChildView(tab.view);
    tab.view.webContents.destroy();
    tabs.splice(idx, 1);

    // Switch to nearest tab
    if (id === activeTabId) {
        const nextIdx = Math.min(idx, tabs.length - 1);
        switchTab(tabs[nextIdx].id);
    }

    if (win) win.webContents.send('tabs-changed', getTabsSummary());
}

function getTabsSummary() {
    return {
        activeTabId,
        tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, favicon: t.favicon }))
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
    win = new BrowserWindow({
        width: 1400,
        height: 900,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    win.loadFile('index.html');

    win.on('resize', () => {
        const view = getActiveView();
        if (view) view.setBounds(getViewBounds());
    });

    win.webContents.once('did-finish-load', () => {
        createTab('https://google.com');
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
    const view = getActiveView();
    if (view) view.setBounds(getViewBounds());
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
        if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
        view.webContents.loadURL(url);
        const tab = tabs.find(t => t.id === activeTabId);
        if (tab) tab.url = url;
    }
});

ipcMain.on('browser-toggle-devtools', () => {
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

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});