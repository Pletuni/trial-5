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
                SHOW_NOTIFICATIONS: true,
            }
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
            
            if (window.RELY_CONFIG.ENV === 'development') {
                const devPanel = document.getElementById('devPanel');
                if (devPanel) devPanel.style.display = 'block';
            }
        } catch (error) {
            this.showNotification('Failed to initialize extension', 'error');
        }
    }
    
    async loadSettings() {
        try {
            const result = await chrome.storage.sync.get([
                this.config.STORAGE_KEYS.ENCRYPTION_KEY,
                this.config.STORAGE_KEYS.SETTINGS
            ]);
            this.encryptionKey = result[this.config.STORAGE_KEYS.ENCRYPTION_KEY] || '';
            this.settings = result[this.config.STORAGE_KEYS.SETTINGS] || this.config.DEFAULT_SETTINGS;

            const encryptionKey = document.getElementById('encryptionKey');
            if (encryptionKey) encryptionKey.value = this.encryptionKey;

            const autoDecrypt = document.getElementById('autoDecrypt');
            if (autoDecrypt) autoDecrypt.checked = this.settings.AUTO_DECRYPT;

            const showNotifications = document.getElementById('showNotifications');
            if (showNotifications) showNotifications.checked = this.settings.SHOW_NOTIFICATIONS;

            const debugMode = document.getElementById('debugMode');
            if (debugMode) debugMode.checked = this.settings.DEBUG_ENABLED;
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }
    
    async loadStats() {
        try {
            const result = await chrome.storage.sync.get(this.config.STORAGE_KEYS.STATS);
            const stats = result[this.config.STORAGE_KEYS.STATS] || { encrypted: 0, decrypted: 0 };
            const emailsEncrypted = document.getElementById('emailsEncrypted');
            if (emailsEncrypted) emailsEncrypted.textContent = stats.encrypted;
            const emailsDecrypted = document.getElementById('emailsDecrypted');
            if (emailsDecrypted) emailsDecrypted.textContent = stats.decrypted;
        } catch (error) {
            console.error('Error loading stats:', error);
        }
    }
    
    async checkStatus() {
        try {
            const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
            const status = document.getElementById('status');
            if (status) status.textContent = tabs.length > 0 ? 'Active' : 'Inactive';
        } catch (error) {
            const status = document.getElementById('status');
            if (status) status.textContent = 'Error checking status';
        }
    }
    
    setupEventListeners() {
        const generateKey = document.getElementById('generateKey');
        if (generateKey) generateKey.addEventListener('click', () => this.generateKey());
        const saveKey = document.getElementById('saveKey');
        if (saveKey) saveKey.addEventListener('click', () => this.saveKey());
        const saveSettings = document.getElementById('saveSettings');
        if (saveSettings) saveSettings.addEventListener('click', () => this.saveSettings());
        const encryptBtn = document.getElementById('encryptBtn');
        if (encryptBtn) encryptBtn.addEventListener('click', () => this.testEncrypt());
        const decryptBtn = document.getElementById('decryptBtn');
        if (decryptBtn) decryptBtn.addEventListener('click', () => this.testDecrypt());
        const copyResult = document.getElementById('copyResult');
        if (copyResult) copyResult.addEventListener('click', () => this.copyResult());
        const previewResult = document.getElementById('previewResult');
        if (previewResult) previewResult.addEventListener('click', () => this.previewResult());
        const debugMode = document.getElementById('debugMode');
        if (debugMode) debugMode.addEventListener('change', () => this.saveSettings());
        const scanAndDecryptBtn = document.getElementById('scanAndDecryptBtn');
        if (scanAndDecryptBtn) scanAndDecryptBtn.addEventListener('click', async () => {
            // Send a message to the content script to scan and decrypt
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'SCAN_AND_DECRYPT' });
            });
        });
    }
    
    async generateKeymonKey() {
        try {
            const key = crypto.getRandomValues(new Uint8Array(32));
            const hexKey = Array.from(key).map(b => b.toString(16).padStart(2, '0')).join('');
            const encryptionKey = document.getElementById('encryptionKey');
            if (encryptionKey) encryptionKey.value = hexKey;
        } catch (error) {
            console.error('Error generating key:', error);
            this.showNotification('Failed to generate key', 'error');
        }
    }
    
    async saveKey() {
        try {
            const encryptionKey = document.getElementById('encryptionKey');
            const key = encryptionKey ? encryptionKey.value.trim() : '';
            if (!key.match(/^[0-9a-fA-F]{64}$/)) {
                this.showNotification('Invalid key: Must be a 64-character hex string', 'error');
                return;
            }
            await chrome.storage.sync.set({ [this.config.STORAGE_KEYS.ENCRYPTION_KEY]: key });
            this.encryptionKey = key;
            this.showNotification('Key saved successfully', 'success');
        } catch (error) {
            console.error('Error saving key:', error);
            this.showNotification('Failed to save key', 'error');
        }
    }
    
    async saveSettings() {
        try {
            // Only update settings if the elements exist
            const autoDecrypt = document.getElementById('autoDecrypt');
            if (autoDecrypt) this.settings.AUTO_DECRYPT = autoDecrypt.checked;
            const showNotifications = document.getElementById('showNotifications');
            if (showNotifications) this.settings.SHOW_NOTIFICATIONS = showNotifications.checked;
            const debugMode = document.getElementById('debugMode');
            if (debugMode) this.settings.DEBUG_ENABLED = debugMode.checked;
            await chrome.storage.sync.set({ [this.config.STORAGE_KEYS.SETTINGS]: this.settings });
            this.showNotification('Settings saved successfully', 'success');
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showNotification('Failed to save settings', 'error');
        }
    }
    
    async testEncrypt() {
        const input = document.getElementById('testInput').value;
        const keyInput = document.getElementById('testKey').value;
        const key = keyInput || this.encryptionKey;
        
        if (!key) {
            document.getElementById('testOutput').value = 'Error: No key provided';
            return;
        }
        
        try {
            const encrypted = await window.relyCipher.encryptText(input, key);
            document.getElementById('testOutput').value = encrypted;
        } catch (error) {
            document.getElementById('testOutput').value = 'Error: ' + error.message;
        }
    }
    
    async testDecrypt() {
        const input = document.getElementById('testInput').value;
        const keyInput = document.getElementById('testKey').value;
        const key = keyInput || this.encryptionKey;
        
        if (!key) {
            document.getElementById('testOutput').value = 'Error: No key provided';
            return;
        }
        
        try {
            const decrypted = await window.relyCipher.decryptText(input, key);
            document.getElementById('testOutput').value = decrypted;
        } catch (error) {
            document.getElementById('testOutput').value = 'Error: ' + error.message;
        }
    }
    
    copyResult() {
        const output = document.getElementById('testOutput');
        output.select();
        document.execCommand('copy');
        this.showNotification('Copied to clipboard', 'success');
    }
    
    previewResult() {
        const output = document.getElementById('testOutput').value;
        if (output) {
            const win = window.open('', '_blank');
            win.document.write(output);
            win.document.close();
        }
    }
    
    showNotification(message, type) {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.style.display = 'block';
        setTimeout(() => notification.style.display = 'none', 3000);
    }
}

// Add enableEncryption toggle logic outside the class
const enableEncryptionCheckbox = document.getElementById('enableEncryption');
// Load setting
chrome.storage.sync.get(['enableEncryption'], (result) => {
    if (enableEncryptionCheckbox) enableEncryptionCheckbox.checked = result.enableEncryption !== false;
});
enableEncryptionCheckbox && enableEncryptionCheckbox.addEventListener('change', (e) => {
    if (!e.target.checked) {
        const proceed = confirm(
            "⚠️ WARNING: Disabling encryption will allow unprotected emails to be sent.\n\n" +
            "This action may violate your organization's security policy and could expose sensitive data.\n\n" +
            "Proceed only if you understand the risks."
        );
        if (!proceed) {
            enableEncryptionCheckbox.checked = true;
            return;
        }
    }
    chrome.storage.sync.set({ enableEncryption: enableEncryptionCheckbox.checked });
});

new PopupManager();