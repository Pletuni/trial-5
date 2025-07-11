class RelyEmailCipher {
    constructor() {
        this.config = window.RELY_CONFIG || {
            ENV: 'development',
            SETTINGS: {
                ENCRYPTION_MARKER: '[ENCRYPTED]',
                AUTO_ENCRYPT: true,
                AUTO_DECRYPT: true,
                PRESERVE_MEET_LINKS: true,
                SHOW_NOTIFICATIONS: true,
                DEBUG_ENABLED: true
            },
            STORAGE_KEYS: {
                ENCRYPTION_KEY: 'rely_encryption_key',
                SETTINGS: 'rely_settings'
            },
            getCurrentKey: () => '0000000000000000000000000000000000000000000000000000000000000000',
            validateKey: key => /^[0-9a-fA-F]{64}$/.test(key)
        };
        this.settings = {};
        this.encryptionKey = null;
        this.isInitialized = false;
        this.processedEmails = new Set();
        
        this.init();
    }

    async init() {
        try {
            await this.loadConfig();
            await this.waitForGmail();
            this.setupObservers();
            this.initializeUI();
            this.isInitialized = true;
            this.log('RelyHealth Email Cipher initialized successfully');
        } catch (error) {
            this.log('Error initializing extension:', error);
        }
    }
    
    async loadConfig() {
        try {
            const result = await chrome.storage.sync.get([
                this.config.STORAGE_KEYS.ENCRYPTION_KEY,
                this.config.STORAGE_KEYS.SETTINGS
            ]);
            this.encryptionKey = result[this.config.STORAGE_KEYS.ENCRYPTION_KEY] || this.config.getCurrentKey();
            this.settings = result[this.config.STORAGE_KEYS.SETTINGS] || this.config.SETTINGS;
            if (!this.config.validateKey(this.encryptionKey)) {
                throw new Error('Invalid encryption key format');
            }
            this.log('Configuration loaded successfully');
        } catch (error) {
            this.log('Error loading configuration:', error);
            this.encryptionKey = this.config.getCurrentKey();
        }
    }
    
    async waitForGmail() {
        return new Promise(resolve => {
            const checkGmail = () => {
                chrome.tabs.query({ url: 'https://mail.google.com/*' }, tabs => {
                    if (tabs.length > 0) {
                        resolve();
                    } else {
                        setTimeout(checkGmail, 100);
                    }
                });
            };
            checkGmail();
        });
    }
    
    setupObservers() {
        const observer = new MutationObserver(() => {
            if (this.isInitialized) {
                this.processEmails();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    
    initializeUI() {
        // Example: Add UI without inline scripts
        const button = document.createElement('button');
        button.textContent = 'Encrypt Email';
        button.addEventListener('click', () => this.processEmails());
        document.body.appendChild(button);
    }
    
    log(message, ...args) {
        if (this.settings.DEBUG_ENABLED) {
            console.log(`[RelyHealth Cipher] ${message}`, ...args);
        }
    }
    
    async processEmails() {
        // Implement email processing logic here
        this.log('Processing emails...');
    }
}

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SETTINGS_UPDATED') {
        this.settings = message.settings;
    }
});

new RelyEmailCipher();