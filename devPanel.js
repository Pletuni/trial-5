class DevPanel {
    constructor(popupManager) {
        this.popupManager = popupManager;
        this.init();
    }
    
    init() {
        if ((window.RELY_CONFIG && window.RELY_CONFIG.ENV === 'development') || 
            this.popupManager.settings.DEBUG_ENABLED) {
            document.getElementById('devPanel').style.display = 'block';
        }
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        document.getElementById('encryptBtn').addEventListener('click', () => this.testEncrypt());
        document.getElementById('decryptBtn').addEventListener('click', () => this.testDecrypt());
        document.getElementById('copyResult').addEventListener('click', () => this.copyResult());
        document.getElementById('previewResult').addEventListener('click', () => this.previewResult());
        document.getElementById('debugMode').addEventListener('change', () => this.popupManager.saveSettings());
    }
    
    async testEncrypt() {
        const input = document.getElementById('testInput').value;
        const keyInput = document.getElementById('testKey').value || this.popupManager.encryptionKey;
        if (!keyInput) {
            document.getElementById('testOutput').value = 'Error: No key provided';
            this.popupManager.showNotification('No key provided', 'error');
            return;
        }
        try {
            const encrypted = await window.relyCipher.encryptText(input, keyInput);
            document.getElementById('testOutput').value = encrypted;
            this.popupManager.showNotification('Encryption successful', 'success');
        } catch (error) {
            document.getElementById('testOutput').value = 'Error: ' + error.message;
            this.popupManager.showNotification('Encryption failed', 'error');
        }
    }
    
    async testDecrypt() {
        const input = document.getElementById('testInput').value;
        const keyInput = document.getElementById('testKey').value || this.popupManager.encryptionKey;
        if (!keyInput) {
            document.getElementById('testOutput').value = 'Error: No key provided';
            this.popupManager.showNotification('No key provided', 'error');
            return;
        }
        try {
            const decrypted = await window.relyCipher.decryptText(input, keyInput);
            document.getElementById('testOutput').value = decrypted;
            this.popupManager.showNotification('Decryption successful', 'success');
        } catch (error) {
            document.getElementById('testOutput').value = 'Error: ' + error.message;
            this.popupManager.showNotification('Decryption failed', 'error');
        }
    }
    
    copyResult() {
        const output = document.getElementById('testOutput');
        output.select();
        document.execCommand('copy');
        this.popupManager.showNotification('Copied to clipboard', 'success');
    }
    
    previewResult() {
        const output = document.getElementById('testOutput').value;
        if (output) {
            const win = window.open('', '_blank');
            win.document.write(output);
            win.document.close();
        } else {
            this.popupManager.showNotification('No result to preview', 'error');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const popupManager = new PopupManager();
    new DevPanel(popupManager);
});