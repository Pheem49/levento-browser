const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('browserAPI', {
    // Navigation
    goBack: () => ipcRenderer.send('browser-go-back'),
    goForward: () => ipcRenderer.send('browser-go-forward'),
    reload: () => ipcRenderer.send('browser-reload'),
    navigate: (url) => ipcRenderer.send('browser-navigate', url),
    toggleDevTools: () => ipcRenderer.send('browser-toggle-devtools'),
    onUrlChange: (cb) => ipcRenderer.on('browser-url-changed', (_e, url) => cb(url)),

    // Page Content
    getPageText: () => ipcRenderer.invoke('get-page-text'),

    // Modal
    openModal: () => ipcRenderer.send('modal-open'),
    closeModal: () => ipcRenderer.send('modal-close'),
    openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
    getGpuSafeMode: () => ipcRenderer.invoke('get-gpu-safe-mode'),
    setGpuSafeMode: (enabled) => ipcRenderer.invoke('set-gpu-safe-mode', enabled),

    // Sidebar
    sidebarToggle: (isOpen) => ipcRenderer.send('sidebar-toggle', isOpen),
    setAddressSuggestionsInset: (pixels) => ipcRenderer.send('address-suggestions-inset', pixels),

    // AI Context Menu
    onAIAction: (cb) => ipcRenderer.on('ai-action', (_e, data) => cb(data)),

    // Tabs
    newTab: (url) => ipcRenderer.send('tab-new', url),
    switchTab: (id) => ipcRenderer.send('tab-switch', id),
    closeTab: (id) => ipcRenderer.send('tab-close', id),
    onTabsChanged: (cb) => ipcRenderer.on('tabs-changed', (_e, data) => cb(data)),
    onTabSwitched: (cb) => ipcRenderer.on('tab-switched', (_e, id) => cb(id)),
    onTabUpdate: (cb) => ipcRenderer.on('tab-update', (_e, data) => cb(data)),
    onHtmlFullscreenChanged: (cb) => ipcRenderer.on('html-fullscreen-changed', (_e, isFullscreen) => cb(Boolean(isFullscreen))),
})
