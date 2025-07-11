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
                document.getElementById('devPanel').style.display = 'block';
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
            
            document.getElementById('encryptionKey').value = this.encryptionKey;
            document.getElementById('autoEncrypt').checked = this.settings.AUTO_ENCRYPT;
            document.getElementById('autoDecrypt').checked = this.settings.AUTO_DECRYPT;
            document.getElementById('preserveMeetLinks').checked = this.settings.PRESERVE_MEET_LINKS;
            document.getElementById('showNotifications').checked = this.settings.SHOW_NOTIFICATIONS;
            document.getElementById('debugMode').checked = this.settings.DEBUG_ENABLED;
        } catch (error) {
            console.error('Error loading settings:', error);
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
            document.getElementById('status').textContent = tabs.length > 0 ? 'Active' : 'Inactive';
        } catch (error) {
            document.getElementById('status').textContent = 'Error checking status';
        }
    }
    
    setupEventListeners() {
        document.getElementById('generateKey').addEventListener('click', () => this.generateKey());
        document.getElementById('saveKey').addEventListener('click', () => this.saveKey());
        document.getElementById('saveSettings').addEventListener('click', () => this.saveSettings());
        document.getElementById('encryptBtn').addEventListener('click', () => this.testEncrypt());
        document.getElementById('decryptBtn').addEventListener('click', () => this.testDecrypt());
        document.getElementById('copyResult').addEventListener('click', () => this.copyResult());
        document.getElementById('previewResult').addEventListener('click', () => this.previewResult());
        document.getElementById('debugMode').addEventListener('change', () => this.saveSettings());
        document.getElementById('scanAndDecryptBtn').addEventListener('click', async () => {
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
            document.getElementById('encryptionKey').value = hexKey;
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

new PopupManager();