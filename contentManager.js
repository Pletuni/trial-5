if (!window.ContentManager) {
    class ContentManager {
        constructor() {
            this.config = window.RELY_CONFIG || {
                ENV: 'development',
                SETTINGS: {
                    ENCRYPTION_MARKER: '[ENCRYPTED]',
                    AUTO_ENCRYPT: true,
                    AUTO_DECRYPT: true,
                    PRESERVE_MEET_LINKS: true,
                    SHOW_NOTIFICATIONS: true,
                    DEBUG_ENABLED: true,
                    MAX_EMAIL_SIZE: 50000
                },
                STORAGE_KEYS: {
                    ENCRYPTION_KEY: 'rely_encryption_key',
                    SETTINGS: 'rely_settings',
                    STATS: 'rely_stats'
                },
                MEET_PATTERNS: [
                    /https:\/\/meet\.google\.com\/[a-z0-9-]+/gi,
                    /https:\/\/[a-z0-9-]+\.meet\.google\.com\/[a-z0-9-]+/gi
                ],
                getCurrentKey: () => 'bbc54f4570b95072dad46029b762b984ec4204b56645ed4aca67e2cf68e9e741',
                validateKey: key => /^[0-9a-fA-F]{64}$/.test(key)
            };
            this.settings = this.config.SETTINGS;
            this.encryptionKey = null;
            this.isInitialized = false;
            this.emailCipher = null;
            
            this.init();
        }
        
        async init() {
            try {
                // Check if already initialized
                if (this.isInitialized) {
                    this.log('Already initialized, skipping...');
                    return;
                }
                
                await this.loadConfig();
                await this.waitForGmail();
                
                // Check if EmailCipher is available
                if (typeof EmailCipher === 'undefined') {
                    throw new Error('EmailCipher class not found');
                }
                
                this.emailCipher = new EmailCipher(this);
                this.setupObservers();
                this.initializeUI();
                this.addDecryptButtonsToExistingEmails();
                this.isInitialized = true;
                this.log('RelyHealth Email Cipher initialized successfully');
            } catch (error) {
                this.log('Error initializing extension:', error);
                this.showNotification('Extension initialization failed', 'error');
                // Reset initialization flag on error
                window.RelyHealthInitialized = false;
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
                this.showNotification('Failed to load configuration', 'error');
            }
        }
        
        async waitForGmail() {
            return new Promise(resolve => {
                const checkGmail = () => {
                    if (document.querySelector('[role="main"]') || document.querySelector('.nH')) {
                        resolve();
                    } else {
                        setTimeout(checkGmail, 100);
                    }
                };
                checkGmail();
            });
        }
        
        setupObservers() {
            const composeObserver = new MutationObserver(mutations => {
                mutations.forEach(mutation => {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE && node.matches('[role="dialog"]')) {
                            this.emailCipher.enhanceComposeWindow(node);
                        }
                    });
                });
            });
            composeObserver.observe(document.body, { childList: true, subtree: true });

            // Enhanced content observer: on any mutation, re-check all [data-message-id] elements
            const contentObserver = new MutationObserver(mutations => {
                // On any mutation, process all visible email elements
                const emailElements = document.querySelectorAll('[data-message-id]');
                emailElements.forEach(emailElement => {
                    this.emailCipher.processEmailContent(emailElement);
                    this.emailCipher.addDecryptButtonToEmail(emailElement);
                });
            });
            contentObserver.observe(document.body, { childList: true, subtree: true, characterData: true, subtree: true });

            document.addEventListener('click', event => {
                if (this.emailCipher.isSendButton(event.target)) {
                    this.emailCipher.handleSendClick(event);
                }
            }, true);
        }
        
        initializeUI() {
            const style = document.createElement('style');
            style.textContent = `
                .rely-notification {
                    position: fixed; top: 20px; right: 20px; padding: 10px 15px; border-radius: 4px;
                    font-size: 14px; color: white; animation: fadeIn 0.3s ease-in; z-index: 10000;
                }
                .rely-notification.success { background-color: #28a745; }
                .rely-notification.error { background-color: #dc3545; }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            `;
            document.head.appendChild(style);
        }
        
        showNotification(message, type) {
            if (!this.settings.SHOW_NOTIFICATIONS) return;
            const notification = document.createElement('div');
            notification.className = `rely-notification ${type}`;
            notification.textContent = message;
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 3000);
        }
        
        addDecryptButtonsToExistingEmails() {
            // Find all existing email elements and add decrypt buttons
            const emailElements = document.querySelectorAll('[data-message-id]');
            emailElements.forEach(emailElement => {
                this.emailCipher.addDecryptButtonToEmail(emailElement);
            });
            this.log(`Added decrypt buttons to ${emailElements.length} existing emails`);
        }
        
        log(message, ...args) {
            if (this.settings.DEBUG_ENABLED) {
                console.log(`[RelyHealth Cipher] ${message}`, ...args);
            }
        }
    }
    window.ContentManager = ContentManager;
    
    // Initialize the content manager
    new ContentManager();
}

// Listen for scan and decrypt message from popup
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.type === 'SCAN_AND_DECRYPT') {
        // Scan for marker blocks
        const blocks = Array.from(document.querySelectorAll('pre')).filter(pre => pre.textContent.includes('-----BEGIN RELY ENCRYPTED MESSAGE-----'));
        if (blocks.length === 0) {
            alert('No encrypted messages found on this page.');
            return;
        }
        for (const pre of blocks) {
            const match = pre.textContent.match(/-----BEGIN RELY ENCRYPTED MESSAGE-----\s*([\s\S]*?)\s*-----END RELY ENCRYPTED MESSAGE-----/);
            if (match) {
                const encryptedText = match[1].trim();
                try {
                    const decrypted = await window.relyCipher.decryptText(encryptedText, window.RELY_CONFIG.getCurrentKey());
                    if (decrypted) {
                        showDecryptedOverlay(decrypted);
                        return;
                    }
                } catch (e) {}
            }
        }
        alert('No encrypted messages could be decrypted with your current key.');
    }
});

function showDecryptedOverlay(decryptedHtml) {
    // Remove any existing overlay
    const old = document.getElementById('rely-decrypt-overlay');
    if (old) old.remove();
    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'rely-decrypt-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.style.cssText = 'background:white;padding:32px 24px;border-radius:12px;max-width:90vw;max-height:80vh;overflow:auto;box-shadow:0 8px 32px rgba(0,0,0,0.2);font-size:16px;';
    box.innerHTML = '<div style="font-size:20px;font-weight:bold;margin-bottom:16px;">Decrypted Message</div>' + decryptedHtml + '<div style="margin-top:24px;text-align:right;"><button id="closeRelyOverlay" style="padding:8px 20px;font-size:16px;background:#1a73e8;color:white;border:none;border-radius:6px;cursor:pointer;">Close</button></div>';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.getElementById('closeRelyOverlay').onclick = () => overlay.remove();
}