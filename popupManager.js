import DOMPurify from 'dompurify';

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
            await this.restoreManualFields();
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
            const stats = result[this.config.STORAGE_KEYS.STATS] || { encrypted: 0, decrypted: 0 };
            document.getElementById('emailsEncrypted').textContent = stats.encrypted;
            document.getElementById('emailsDecrypted').textContent = stats.decrypted;
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
        // Manual fields persistence
        const manualEncryptInput = document.getElementById('manualEncryptInput');
        const manualDecryptInput = document.getElementById('manualDecryptInput');
        const manualKeyInput = document.getElementById('manualKeyInput');
        const manualResult = document.getElementById('manualResult');
        if (manualEncryptInput) manualEncryptInput.addEventListener('input', () => this.saveManualFields());
        if (manualDecryptInput) manualDecryptInput.addEventListener('input', () => this.saveManualFields());
        if (manualKeyInput) manualKeyInput.addEventListener('input', () => this.saveManualFields());
        if (manualResult) manualResult.addEventListener('input', () => this.saveManualFields());
        // Manual encrypt/decrypt buttons
        const manualEncryptBtn = document.getElementById('manualEncryptBtn');
        const manualDecryptBtn = document.getElementById('manualDecryptBtn');
        if (manualEncryptBtn) manualEncryptBtn.addEventListener('click', () => this.handleManualEncrypt());
        if (manualDecryptBtn) manualDecryptBtn.addEventListener('click', () => this.handleManualDecrypt());
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

    async saveManualFields() {
        const manualEncryptInput = document.getElementById('manualEncryptInput')?.value || '';
        const manualDecryptInput = document.getElementById('manualDecryptInput')?.value || '';
        const manualKeyInput = document.getElementById('manualKeyInput')?.value || '';
        const manualResult = document.getElementById('manualResult')?.value || '';
        await chrome.storage.local.set({
            rely_manual_encrypt: manualEncryptInput,
            rely_manual_decrypt: manualDecryptInput,
            rely_manual_key: manualKeyInput,
            rely_manual_result: manualResult
        });
    }
    async restoreManualFields() {
        const result = await chrome.storage.local.get([
            'rely_manual_encrypt',
            'rely_manual_decrypt',
            'rely_manual_key',
            'rely_manual_result'
        ]);
        if (document.getElementById('manualEncryptInput')) document.getElementById('manualEncryptInput').value = result.rely_manual_encrypt || '';
        if (document.getElementById('manualDecryptInput')) document.getElementById('manualDecryptInput').value = result.rely_manual_decrypt || '';
        if (document.getElementById('manualKeyInput')) document.getElementById('manualKeyInput').value = result.rely_manual_key || '';
        if (document.getElementById('manualResult')) document.getElementById('manualResult').value = result.rely_manual_result || '';
    }

    async handleManualEncrypt() {
        const input = document.getElementById('manualEncryptInput').value;
        let key = document.getElementById('manualKeyInput').value.trim();
        if (!key) key = this.encryptionKey;
        const resultBox = document.getElementById('manualResult');
        if (!key) {
            resultBox.value = 'Error: No key provided';
            return;
        }
        try {
            const encrypted = await window.relyCipher.encryptText(input, key);
            resultBox.value = encrypted;
            this.saveManualFields();
        } catch (error) {
            resultBox.value = 'Error: ' + error.message;
        }
    }

    async handleManualDecrypt() {
        const input = document.getElementById('manualDecryptInput').value;
        let key = document.getElementById('manualKeyInput').value.trim();
        if (!key) key = this.encryptionKey;
        const resultBox = document.getElementById('manualResult');
        const resultHtml = document.getElementById('manualResultHtml');
        if (!key) {
            resultBox.value = 'Error: No key provided';
            resultBox.style.display = '';
            if (resultHtml) resultHtml.style.display = 'none';
            return;
        }
        try {
            const decrypted = await window.relyCipher.decryptText(input, key);
            if (window.console) console.log('[RelyHealth Debug] Decrypted content:', decrypted);
            // Remove emoji image URLs and loading fragments
            function removeEmojiImgUrls(text) {
                return text.replace(/https?:\/\/fonts\.gstatic\.com\/s\/e\/notoemoji\/[^\"]+\" loading=\"lazy\">/g, '').replace(/https?:\/\/fonts\.gstatic\.com\/s\/e\/notoemoji\/[^\"]+/g, '');
            }
            let cleaned = removeEmojiImgUrls(decrypted);
            // Use linkifyHtml and DOMPurify for robust, safe HTML rendering (from window)
            const safeHtml = window.DOMPurify.sanitize(window.linkifyHtml(cleaned, {
                target: "_blank",
                rel: "noopener noreferrer"
            }));
            if (resultHtml) {
                resultHtml.innerHTML = safeHtml;
                resultHtml.style.display = '';
                resultBox.value = '';
                resultBox.style.display = 'none';
                if (window.console) console.log('[RelyHealth Debug] Rendered as HTML:', safeHtml);
            } else {
                resultBox.value = decrypted;
                resultBox.style.display = '';
            }
            this.saveManualFields();
        } catch (error) {
            resultBox.value = 'Error: ' + error.message;
            resultBox.style.display = '';
            if (resultHtml) resultHtml.style.display = 'none';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => new PopupManager());