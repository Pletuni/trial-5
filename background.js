class BackgroundManager {
    constructor() {
        this.stats = { encrypted: 0, decrypted: 0, errors: 0 };
        this.init();
    }
    
    async init() {
        try {
            await this.loadStats();
            this.setupEventListeners();
            await this.initializeDefaultSettings();
            console.log('RelyHealth Email Cipher background script initialized');
        } catch (error) {
            console.error('Error initializing background script:', error);
        }
    }
    
    async loadStats() {
        try {
            const result = await chrome.storage.sync.get(['rely_stats']);
            if (result.rely_stats) this.stats = result.rely_stats;
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }
    
    async saveStats() {
        try {
            await chrome.storage.sync.set({ rely_stats: this.stats });
        } catch (error) {
            console.error('Error saving stats:', error);
        }
    }
    
    async initializeDefaultSettings() {
        try {
            const result = await chrome.storage.sync.get(['rely_settings', 'rely_encryption_key']);
            if (!result.rely_settings) {
                const defaultSettings = {
                    AUTO_ENCRYPT: true,
                    AUTO_DECRYPT: true,
                    PRESERVE_MEET_LINKS: true,
                    SHOW_NOTIFICATIONS: true,
                    DEBUG_ENABLED: (window.RELY_CONFIG && window.RELY_CONFIG.ENV === 'development') || false
                };
                await chrome.storage.sync.set({ rely_settings: defaultSettings });
            }
            if (!result.rely_encryption_key) {
                const defaultKey = window.RELY_CONFIG ? window.RELY_CONFIG.getCurrentKey() : 
                    'bbc54f4570b95072dad46029b762b984ec4204b56645ed4aca67e2cf68e9e741';
                await chrome.storage.sync.set({ rely_encryption_key: defaultKey });
            }
        } catch (error) {
            console.error('Error initializing default settings:', error);
        }
    }
    
    setupEventListeners() {
        chrome.runtime.onInstalled.addListener(details => this.handleInstallation(details));
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sender, sendResponse);
            return true;
        });
        chrome.storage.onChanged.addListener((changes, area) => this.handleStorageChange(changes, area));
    }
    
    async handleInstallation(details) {
        if (details.reason === 'install') {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon.png',
                title: 'RelyHealth Email Cipher',
                message: 'Extension installed! Open Gmail to start encrypting emails.'
            });
            chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
        }
    }
    
    async handleMessage(message, sender, sendResponse) {
        try {
            switch (message.type) {
                case 'ENCRYPT_SUCCESS':
                    this.stats.encrypted++;
                    await this.saveStats();
                    sendResponse({ success: true });
                    break;
                case 'DECRYPT_SUCCESS':
                    this.stats.decrypted++;
                    await this.saveStats();
                    sendResponse({ success: true });
                    break;
                case 'OPERATION_FAILED':
                    this.stats.errors++;
                    await this.saveStats();
                    sendResponse({ success: true });
                    break;
                case 'GET_STATS':
                    sendResponse({ stats: this.stats });
                    break;
                case 'RESET_STATS':
                    this.stats = { encrypted: 0, decrypted: 0, errors: 0 };
                    await this.saveStats();
                    sendResponse({ success: true });
                    break;
                default:
                    sendResponse({ error: 'Unknown message type' });
            }
        } catch (error) {
            console.error('Error handling message:', error);
            sendResponse({ error: error.message });
        }
    }
    
    async handleStorageChange(changes, area) {
        if (area === 'sync') {
            if (changes.rely_settings) {
                const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
                for (const tab of tabs) {
                    try {
                        await chrome.runtime.sendMessage({ 
                            type: 'SETTINGS_UPDATED', 
                            settings: changes.rely_settings.newValue, 
                            tabId: tab.id 
                        });
                    } catch (error) {
                        console.log('Could not notify tab:', error);
                    }
                }
            }
            if (changes.rely_encryption_key) {
                const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
                for (const tab of tabs) {
                    try {
                        await chrome.runtime.sendMessage({ 
                            type: 'KEY_UPDATED', 
                            key: changes.rely_encryption_key.newValue, 
                            tabId: tab.id 
                        });
                    } catch (error) {
                        console.log('Could not notify tab:', error);
                    }
                }
            }
        }
    }
}

new BackgroundManager();