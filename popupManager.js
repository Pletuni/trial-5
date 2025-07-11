class PopupManager {
    constructor() {
        this.config = {
            STORAGE_KEYS: {
                ENCRYPTION_KEY: 'rely_encryption_key',
                SETTINGS: 'rely_settings',
                STATS: 'rely_stats'
            },
            DEFAULT_SETTINGS: {
                AUTO_ENCRYPT: true,
                AUTO_DECRYPT: true,
                PRESERVE_MEET_LINKS: true,
                SHOW_NOTIFICATIONS: true,
                DEBUG_ENABLED: (window.RELY_CONFIG && window.RELY_CONFIG.ENV === 'development') || false
            },
            DEFAULT_KEY: 'bbc54f4570b95072dad46029b762b984ec4204b56645ed4aca67e2cf68e9e741'
        };
        this.encryptionKey = '';
        this.settings = {};
        
        this.init();
    }
    
    async init() {
        try {
            await this.loadSettings();
            await this.loadStats();
            await this.checkStatus();
            this.setupEventListeners();
            
            if (window.RELY_CONFIG && window.RELY_CONFIG.ENV === 'production' && 
                this.encryptionKey === this.config.DEFAULT_KEY) {
                this.showNotification('Warning: Using default key in production is insecure!', 'error');
            }
        } catch (error) {
            console.error('Error initializing popup:', error);
            this.showNotification('Failed to initialize extension', 'error');
        }
    }
    
    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get([
                this.config.STORAGE_KEYS.ENCRYPTION_KEY,
                this.config.STORAGE_KEYS.SETTINGS
            ]);
            this.encryptionKey = result[this.config.STORAGE_KEYS.ENCRYPTION_KEY] || 
                (window.RELY_CONFIG ? window.RELY_CONFIG.getCurrentKey() : this.config.DEFAULT_KEY);
            this.settings = result[this.config.STORAGE_KEYS.SETTINGS] || this.config.DEFAULT_SETTINGS;
            
            document.getElementById('encryptionKey').value = this.encryptionKey;
            document.getElementById('autoEncrypt').checked = this.settings.AUTO_ENCRYPT;
            document.getElementById('autoDecrypt').checked = this.settings.AUTO_DECRYPT;
            document.getElementById('preserveMeetLinks').checked = this.settings.PRESERVE_MEET_LINKS;
            document.getElementById('showNotifications').checked = this.settings.SHOW_NOTIFICATIONS;
            document.getElementById('debugMode').checked = this.settings.DEBUG_ENABLED;
            this.validateKeyInput(this.encryptionKey);
        } catch (error) {
            console.error('Error loading settings:', error);
            this.showNotification('Failed to load settings', 'error');
        }
    }
    
    async loadStats() {
        try {
            const result = await chrome.storage.sync.get(this.config.STORAGE_KEYS.STATS);
            const stats = result[this.config.STORAGE_KEYS.STATS] || { encrypted: 0, decrypted: 0, errors: 0 };
            document.getElementById('emailsEncrypted').textContent = stats.encrypted;
            document.getElementById('emailsDecrypted').textContent = stats.decrypted;
            document.getElementById('errorsEncountered').textContent = stats.errors;
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }
    
    async checkStatus() {
        try {
            const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
            const statusEl = document.getElementById('status');
            statusEl.textContent = tabs.length > 0 ? 'Active' : 'Inactive';
            statusEl.className = tabs.length > 0 ? 'status' : 'error-status';
        } catch (error) {
            console.error('Error checking status:', error);
            document.getElementById('status').textContent = 'Error';
            document.getElementById('status').className = 'error-status';
        }
    }
    
    setupEventListeners() {
        document.getElementById('generateKey').addEventListener('click', () => this.generateKey());
        document.getElementById('saveKey').addEventListener('click', () => this.saveKey());
        document.getElementById('saveSettings').addEventListener('click', () => this.saveSettings());
        document.getElementById('encryptionKey').addEventListener('input', (e) => this.validateKeyInput(e.target.value));
    }
    
    async generateKey() {
        try {
            const key = crypto.getRandomValues(new Uint8Array(32));
            const hexKey = Array.from(key).map(b => b.toString(16).padStart(2, '0')).join('');
            document.getElementById('encryptionKey').value = hexKey;
            this.validateKeyInput(hexKey);
            this.showNotification('New key generated', 'success');
        } catch (error) {
            console.error('Error generating key:', error);
            this.showNotification('Failed to generate key', 'error');
        }
    }
    
    async saveKey() {
        try {
            const key = document.getElementById('encryptionKey').value.trim();
            if (!key.match(/^[0-9a-fA-F]{64}$/)) {
                this.showNotification('Invalid key: Must be a 64-character hex string', 'error');
                return;
            }
            await chrome.storage.sync.set({ [this.config.STORAGE_KEYS.ENCRYPTION_KEY]: key });
            this.encryptionKey = key;
            this.showNotification('Key saved successfully', 'success');
            await this.checkStatus();
            const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
            for (const tab of tabs) {
                try {
                    await chrome.runtime.sendMessage({ type: 'KEY_UPDATED', key, tabId: tab.id });
                } catch (error) {
                    console.warn('Could not notify tab:', error);
                }
            }
        } catch (error) {
            console.error('Error saving key:', error);
            this.showNotification('Failed to save key', 'error');
        }
    }
    
    async saveSettings() {
        try {
            const settings = {
                AUTO_ENCRYPT: document.getElementById('autoEncrypt').checked,
                AUTO_DECRYPT: document.getElementById('autoDecrypt').checked,
                PRESERVE_MEET_LINKS: document.getElementById('preserveMeetLinks').checked,
                SHOW_NOTIFICATIONS: document.getElementById('showNotifications').checked,
                DEBUG_ENABLED: document.getElementById('debugMode').checked
            };
            await chrome.storage.sync.set({ [this.config.STORAGE_KEYS.SETTINGS]: settings });
            this.settings = settings;
            const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
            for (const tab of tabs) {
                try {
                    await chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings, tabId: tab.id });
                } catch (error) {
                    console.warn('Could not notify tab:', error);
                }
            }
            this.showNotification('Settings saved successfully', 'success');
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showNotification('Failed to save settings', 'error');
        }
    }
    
    validateKeyInput(key) {
        const keyInput = document.getElementById('encryptionKey');
        const keyStatus = document.getElementById('keyStatus');
        if (key && /^[0-9a-fA-F]{64}$/.test(key)) {
            keyInput.style.borderColor = '#28a745';
            keyStatus.textContent = 'Valid';
            keyStatus.style.color = '#28a745';
        } else {
            keyInput.style.borderColor = '#dc3545';
            keyStatus.textContent = 'Invalid (must be 64-character hex)';
            keyStatus.style.color = '#dc3545';
        }
    }
    
    showNotification(message, type) {
        if (!this.settings.SHOW_NOTIFICATIONS) return;
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.style.display = 'block';
        setTimeout(() => notification.style.display = 'none', 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => new PopupManager());