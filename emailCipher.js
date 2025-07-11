if (!window.EmailCipher) {
    class EmailCipher {
        constructor(contentManager) {
            this.contentManager = contentManager;
            this.settings = contentManager.settings;
            this.encryptionKey = contentManager.encryptionKey;
            this.processedEmails = new Set();
            this.encryptedComposeWindows = new WeakSet();
            this.originalEncryptedBlock = new WeakMap(); // Map composeWindow -> original encrypted block
        }
        
        isSendButton(element) {
            const sendSelectors = [
                '[data-tooltip="Send"]',
                '[aria-label*="Send"]',
                '.T-I-KE',
                'div[role="button"][tabindex="0"]'
            ];
            return sendSelectors.some(selector => element.matches(selector) || element.closest(selector));
        }
        
        isSendWithoutEncryptionButton(element) {
            // Check if it's our custom "Send without encryption" button
            return element.getAttribute('data-rely-send-without-encryption') === 'true';
        }
        
        async handleSendClick(event) {
            if (!this.settings.AUTO_ENCRYPT) return;
            
            const composeWindow = event.target.closest('[role="dialog"]');
            if (!composeWindow) return;
            
            // Check if this is our "Send without encryption" button
            if (this.isSendWithoutEncryptionButton(event.target)) {
                // Allow normal send behavior
                return;
            }
            
            // Check if content is already encrypted
            if (this.encryptedComposeWindows.has(composeWindow)) {
                // Tamper detection: check if the encrypted block was modified
                const contentArea = composeWindow.querySelector('[contenteditable="true"]');
                const pre = contentArea && contentArea.querySelector('pre');
                const original = this.originalEncryptedBlock.get(composeWindow);
                if (pre && original && pre.outerHTML !== original) {
                    // Block send, show warning, and provide Undo
                    this.showTamperWarning(composeWindow, contentArea, original);
                    return;
                }
                // Content is already encrypted and not tampered, allow normal send
                this.encryptedComposeWindows.delete(composeWindow); // Clean up
                return;
            }
            
            try {
                event.preventDefault();
                event.stopPropagation();
                
                const emailContent = this.getEmailContent(composeWindow);
                if (!emailContent) {
                    this.contentManager.showNotification('Email content too large or not found', 'error');
                    return;
                }
                
                const encryptedContent = await this.encryptEmailContent(emailContent);
                this.replaceEmailContent(composeWindow, encryptedContent);
                this.encryptedComposeWindows.add(composeWindow); // Mark as encrypted
                // Store original encrypted block for tamper detection
                const contentArea = composeWindow.querySelector('[contenteditable="true"]');
                const pre = contentArea && contentArea.querySelector('pre');
                if (pre) this.originalEncryptedBlock.set(composeWindow, pre.outerHTML);
                this.contentManager.showNotification('Email encrypted! Click send again to send.', 'success');
                chrome.runtime.sendMessage({ type: 'ENCRYPT_SUCCESS' });
            } catch (error) {
                this.contentManager.log('Error encrypting email:', error);
                this.contentManager.showNotification('Failed to encrypt email', 'error');
                chrome.runtime.sendMessage({ type: 'OPERATION_FAILED' });
            }
        }
        
        getEmailContent(composeWindow) {
            const contentArea = composeWindow.querySelector('[contenteditable="true"]');
            if (!contentArea || contentArea.textContent.length > this.settings.MAX_EMAIL_SIZE) return null;
            return {
                html: contentArea.innerHTML,
                text: contentArea.textContent || contentArea.innerText
            };
        }
        
        async encryptEmailContent(content) {
            try {
                const preservedLinks = this.extractPreservedLinks(content.html);
                const encryptedHtml = await window.relyCipher.encryptText(content.html, this.encryptionKey);
                const encryptedContent = {
                    html: this.createEncryptedEmailHtml(encryptedHtml, preservedLinks),
                    text: `${this.contentManager.config.SETTINGS.ENCRYPTION_MARKER} This email is encrypted.`
                };
                return encryptedContent;
            } catch (error) {
                this.contentManager.log('Error encrypting email content:', error);
                throw error;
            }
        }
        
        extractPreservedLinks(html) {
            if (!this.settings.PRESERVE_MEET_LINKS) return [];
            const links = [];
            this.contentManager.config.MEET_PATTERNS.forEach(pattern => {
                const matches = html.match(pattern);
                if (matches) links.push(...matches);
            });
            return [...new Set(links)];
        }
        
        createEncryptedEmailHtml(encryptedContent, preservedLinks) {
            // User-friendly explanation
            let html = `<div style="font-family: Arial, sans-serif; color: #444; margin-bottom: 12px;">This message is encrypted with Rely. To read it, use the Rely extension.</div>`;
            // Marker block with each part in its own element, encrypted content as a single line (no line breaks)
            html += `<div style="background: #f8f9fa; border: 1px solid #1a73e8; border-radius: 6px; padding: 15px; font-family: monospace; font-size: 14px; color: #222;">
<div>-----BEGIN RELY ENCRYPTED MESSAGE-----</div>`;
            html += `<div class="rely-encrypted-content" style="word-break:break-all;">${encryptedContent.replace(/\s+/g, '')}</div>`;
            html += `<div>-----END RELY ENCRYPTED MESSAGE-----</div>`;
            if (preservedLinks.length > 0) {
                html += `<div style="margin-top:10px;">Google Meet Links:<br>`;
                html += preservedLinks.map(link => `${link}`).join('<br>');
                html += `</div>`;
            }
            html += `</div>`;
            return html;
        }
        
        replaceEmailContent(composeWindow, encryptedContent) {
            const contentArea = composeWindow.querySelector('[contenteditable="true"]');
            if (contentArea) {
                contentArea.innerHTML = encryptedContent.html;
                contentArea.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
        
        async processEmailContent(emailElement) {
            // Always add decrypt button if marker is present
            this.addDecryptButtonToEmail(emailElement);
            if (!this.settings.AUTO_DECRYPT) return;

            const messageId = emailElement.getAttribute('data-message-id');
            if (!messageId || this.processedEmails.has(messageId)) return;
            
            let bodyNode = emailElement.querySelector('div[dir="ltr"], .a3s, .ii, .adn') || emailElement;
            let html = bodyNode.innerHTML;

            // Only auto-decrypt if not already decrypted (look for our indicator)
            if (bodyNode.querySelector('.rely-decrypted-indicator')) return;

            // Try to find encrypted content in <div class="rely-encrypted-content"> or <pre>
            let encryptedText = null;
            let encryptedDiv = bodyNode.querySelector('.rely-encrypted-content');
            if (encryptedDiv) {
                encryptedText = encryptedDiv.textContent.replace(/\s+/g, '').replace(/\n/g, '').replace(/<br\s*\/?>(?=\n|$)/gi, '');
            }
            if (!encryptedText) {
                const pre = bodyNode.querySelector('pre');
                if (pre) {
                    let raw = '';
                    pre.childNodes.forEach(node => {
                        if (node.nodeType === Node.TEXT_NODE) raw += node.textContent;
                        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') raw += '';
                    });
                    encryptedText = raw.replace(/\s+/g, '').replace(/\n/g, '');
                }
            }
            if (!encryptedText) {
                // Fallback: Try regex on HTML for BEGIN/END block
                const markerRegex = /<div>-----BEGIN RELY ENCRYPTED MESSAGE-----<\/div>\s*<div class=\"rely-encrypted-content\">([A-Za-z0-9+/=:]+)<\/div>\s*<div>-----END RELY ENCRYPTED MESSAGE-----<\/div>/;
                const match = html.match(markerRegex);
                if (match) {
                    encryptedText = match[1].replace(/\s+/g, '').replace(/\n/g, '');
                }
            }
            if (!encryptedText) return; // No encrypted content, do nothing
            try {
                const decryptedContent = await window.relyCipher.decryptText(encryptedText, this.encryptionKey);
                if (decryptedContent) {
                    // Emoji/image URL and linkify helpers
                    function removeEmojiImgUrls(text) {
                        return text.replace(/https?:\/\/fonts\.gstatic\.com\/s\/e\/notoemoji\/[^\"]+\" loading=\"lazy\">/g, '').replace(/https?:\/\/fonts\.gstatic\.com\/s\/e\/notoemoji\/[^\"]+/g, '');
                    }
                    function smartLinkify(text) {
                        text = text.replace(/(https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+)"?>?([\w\-.]+\.[a-z]{2,})(?![\w\-.])/gi, (m, url, label) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
                        return text.replace(/(^|\s)(https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+)/gi, (m, space, url) => {
                            if (/href=["']?${url}["']?/.test(text)) return m;
                            return `${space}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
                        });
                    }
                    let cleaned = removeEmojiImgUrls(decryptedContent);
                    let htmlWithLinks = smartLinkify(cleaned);
                    if (window.console) console.log('[RelyHealth Debug] Gmail decrypted output:', htmlWithLinks);
                    // Only replace the encrypted block, not the whole body
                    if (encryptedDiv) {
                        encryptedDiv.innerHTML = htmlWithLinks;
                        const indicator = document.createElement('div');
                        indicator.className = 'rely-decrypted-indicator';
                        indicator.style = 'color:#28a745;font-size:12px;margin-top:8px;';
                        indicator.textContent = '🔓 Decrypted';
                        encryptedDiv.parentElement.insertBefore(indicator, encryptedDiv.nextSibling);
                    } else if (pre) {
                        pre.innerHTML = htmlWithLinks;
                        const indicator = document.createElement('div');
                        indicator.className = 'rely-decrypted-indicator';
                        indicator.style = 'color:#28a745;font-size:12px;margin-top:8px;';
                        indicator.textContent = '🔓 Decrypted';
                        pre.parentElement.insertBefore(indicator, pre.nextSibling);
                    }
                    this.contentManager.showNotification('Email auto-decrypted successfully', 'success');
                    chrome.runtime.sendMessage({ type: 'DECRYPT_SUCCESS' });
                    this.addDecryptButtonToEmail(emailElement);
                }
            } catch (error) {
                this.contentManager.showNotification('Auto-decryption failed: ' + error.message, 'error');
                this.contentManager.log('Auto-decryption failed:', error);
            }
        }
        
        // Improved: Only add decrypt button to the main message action bar, and only if encrypted content is present
        addDecryptButtonToEmail(emailElement) {
            // Look for the main message body (where [ENCRYPTED] marker is present)
            const messageBody = emailElement.querySelector('div[dir="ltr"], .a3s');
            if (!messageBody) return;
            const content = messageBody.innerHTML;
            if (!content.includes('-----BEGIN RELY ENCRYPTED MESSAGE-----')) return;
            // Try to find the bottom toolbar (with Reply/Forward)
            let actionButtonsContainer = null;
            // Gmail's bottom toolbar often has role="toolbar" and is after the message body
            let node = messageBody;
            while (node && !actionButtonsContainer) {
                // Look for a toolbar sibling after the message body
                let sibling = node.nextElementSibling;
                while (sibling) {
                    if (sibling.getAttribute && sibling.getAttribute('role') === 'toolbar') {
                        actionButtonsContainer = sibling;
                        break;
                    }
                    sibling = sibling.nextElementSibling;
                }
                node = node.parentElement;
            }
            // Fallback: try the old method (above the message body)
            if (!actionButtonsContainer) {
                node = messageBody;
                while (node && !actionButtonsContainer) {
                    node = node.parentElement;
                    if (!node) break;
                    actionButtonsContainer = node.querySelector('[role="toolbar"]');
                }
            }
            if (!actionButtonsContainer) return;
            // Prevent multiple decrypt buttons
            if (actionButtonsContainer.querySelector('[data-rely-decrypt-button]')) return;
            // Create decrypt button
            const decryptButton = document.createElement('span');
            decryptButton.setAttribute('role', 'button');
            decryptButton.setAttribute('tabindex', '0');
            decryptButton.setAttribute('data-rely-decrypt-button', 'true');
            decryptButton.className = 'rely-decrypt-btn';
            decryptButton.style.cssText = `
                cursor: pointer;
                color: #fff;
                background: #1a73e8;
                margin-left: 8px;
                padding: 4px 14px;
                border-radius: 4px;
                transition: background-color 0.2s;
                font-size: 15px;
                font-weight: 500;
                text-decoration: none;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                border: none;
                outline: none;
                box-shadow: 0 1px 2px rgba(60,64,67,.08);
            `;
            decryptButton.innerHTML = '<span style="font-size:18px;">&#128274;</span> Decrypt';
            decryptButton.addEventListener('mouseenter', () => {
                decryptButton.style.backgroundColor = '#155ab6';
            });
            decryptButton.addEventListener('mouseleave', () => {
                decryptButton.style.backgroundColor = '#1a73e8';
            });
            decryptButton.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                try {
                    await this.decryptEmailWithButton(emailElement, decryptButton);
                } catch (error) {
                    this.contentManager.log('Error in decrypt button click:', error);
                }
            });
            // Insert at the end of the bottom toolbar
            actionButtonsContainer.appendChild(decryptButton);
        }
        
        // Update decryption logic to robustly find and replace the marker block
        async decryptEmailWithButton(emailElement, decryptButton) {
            let bodyNode = emailElement.querySelector('div[dir="ltr"], .a3s, .ii, .adn');
            if (!bodyNode) bodyNode = emailElement;
            let html = bodyNode.innerHTML;
            if (bodyNode.querySelector('.rely-decrypted-indicator')) {
                this.contentManager.showNotification('Already decrypted.', 'info');
                return;
            }
            let encryptedText = null;
            let encryptedDiv = bodyNode.querySelector('.rely-encrypted-content');
            if (encryptedDiv) {
                encryptedText = encryptedDiv.textContent.replace(/\s+/g, '').replace(/\n/g, '').replace(/<br\s*\/?>(?=\n|$)/gi, '');
            }
            if (!encryptedText) {
                const pre = bodyNode.querySelector('pre');
                if (pre) {
                    let raw = '';
                    pre.childNodes.forEach(node => {
                        if (node.nodeType === Node.TEXT_NODE) raw += node.textContent;
                        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') raw += '';
                    });
                    encryptedText = raw.replace(/\s+/g, '').replace(/\n/g, '');
                }
            }
            if (!encryptedText) {
                const markerRegex = /<div>-----BEGIN RELY ENCRYPTED MESSAGE-----<\/div>\s*<div class=\"rely-encrypted-content\">([A-Za-z0-9+/=:]+)<\/div>\s*<div>-----END RELY ENCRYPTED MESSAGE-----<\/div>/;
                const match = html.match(markerRegex);
                if (match) {
                    encryptedText = match[1].replace(/\s+/g, '').replace(/\n/g, '');
                }
            }
            if (!encryptedText) {
                this.contentManager.showNotification('No encrypted content found for manual decryption.', 'error');
                return;
            }
            try {
                const decryptedContent = await window.relyCipher.decryptText(encryptedText, this.encryptionKey);
                if (decryptedContent) {
                    function removeEmojiImgUrls(text) {
                        return text.replace(/https?:\/\/fonts\.gstatic\.com\/s\/e\/notoemoji\/[^\"]+\" loading=\"lazy\">/g, '').replace(/https?:\/\/fonts\.gstatic\.com\/s\/e\/notoemoji\/[^\"]+/g, '');
                    }
                    function smartLinkify(text) {
                        text = text.replace(/(https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+)"?>?([\w\-.]+\.[a-z]{2,})(?![\w\-.])/gi, (m, url, label) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
                        return text.replace(/(^|\s)(https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+)/gi, (m, space, url) => {
                            if (/href=["']?${url}["']?/.test(text)) return m;
                            return `${space}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
                        });
                    }
                    let cleaned = removeEmojiImgUrls(decryptedContent);
                    let htmlWithLinks = smartLinkify(cleaned);
                    if (window.console) console.log('[RelyHealth Debug] Gmail decrypted output:', htmlWithLinks);
                    const newTab = window.open('about:blank', '_blank');
                    if (newTab) {
                        let subject = '';
                        let sender = '';
                        let date = '';
                        const subjectNode = document.querySelector('h2.hP, .ha .hP');
                        if (subjectNode) subject = subjectNode.textContent;
                        const senderNode = document.querySelector('.gD, .go');
                        if (senderNode) sender = senderNode.textContent;
                        const dateNode = document.querySelector('.g3, .gH .gK');
                        if (dateNode) date = dateNode.textContent;
                        newTab.document.write(`<!DOCTYPE html><html><head><title>Decrypted Email - Rely</title><meta charset='utf-8'><style>body{font-family:sans-serif;background:#f6f8fa;margin:0;padding:0;} .container{max-width:700px;margin:40px auto;background:#fff;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,0.08);padding:32px;} .logo{text-align:center;margin-bottom:24px;} .logo img{width:64px;} .meta{margin-bottom:24px;} .meta strong{display:inline-block;width:80px;} .decrypted{background:#f8f9fa;border:1px solid #1a73e8;border-radius:6px;padding:18px;font-size:16px;}</style></head><body><div class='container'><div class='logo'><img src='https://www.gstatic.com/images/branding/product/1x/rely_2020q4_48dp.png' alt='Rely Logo'/></div><div class='meta'><div><strong>Subject:</strong> ${subject || '(unknown)'}</div><div><strong>From:</strong> ${sender || '(unknown)'}</div><div><strong>Date:</strong> ${date || '(unknown)'}</div></div><div class='decrypted'>${htmlWithLinks}</div></div></body></html>`);
                        newTab.document.close();
                    } else {
                        this.contentManager.showNotification('Popup blocked. Please allow popups for this site.', 'error');
                    }
                    this.contentManager.showNotification('Email decrypted in new tab', 'success');
                    chrome.runtime.sendMessage({ type: 'DECRYPT_SUCCESS' });
                    if (encryptedDiv) {
                        const indicator = document.createElement('div');
                        indicator.className = 'rely-decrypted-indicator';
                        indicator.style = 'color:#28a745;font-size:12px;margin-top:8px;';
                        indicator.textContent = '🔓 Decrypted';
                        encryptedDiv.parentElement.insertBefore(indicator, encryptedDiv.nextSibling);
                    }
                    return;
                }
            } catch (error) {
                this.contentManager.showNotification('Manual decryption failed: ' + error.message, 'error');
                this.contentManager.log('Decryption failed with current key:', error);
            }
            this.showCustomKeyInput(emailElement, encryptedText, decryptButton);
        }
        
        showCustomKeyInput(emailElement, encryptedText, decryptButton) {
            // Create dropdown container
            const dropdownContainer = document.createElement('div');
            dropdownContainer.style.cssText = `
                position: absolute;
                top: 100%;
                left: 0;
                background: white;
                border: 1px solid #dadce0;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                z-index: 1000;
                padding: 16px;
                min-width: 300px;
                margin-top: 4px;
            `;
            
            dropdownContainer.innerHTML = `
                <div style="margin-bottom: 12px;">
                    <div style="font-weight: bold; color: #202124; margin-bottom: 8px;">Custom Decryption Key</div>
                    <div style="font-size: 12px; color: #5f6368; margin-bottom: 12px;">
                        The current key doesn't work. Enter a different 256-bit hex key:
                    </div>
                </div>
                <div style="margin-bottom: 12px;">
                    <input type="text" id="custom-decrypt-key" 
                           placeholder="Enter 64-character hex key" 
                           style="width: 100%; padding: 8px; border: 1px solid #dadce0; border-radius: 4px; font-family: monospace; font-size: 12px;">
                </div>
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button id="cancel-custom-key" style="padding: 6px 12px; border: 1px solid #dadce0; background: white; border-radius: 4px; cursor: pointer;">
                        Cancel
                    </button>
                    <button id="try-custom-key" style="padding: 6px 12px; border: none; background: #1a73e8; color: white; border-radius: 4px; cursor: pointer;">
                        Try Key
                    </button>
                </div>
            `;
            
            // Position the dropdown
            const buttonRect = decryptButton.getBoundingClientRect();
            dropdownContainer.style.top = `${buttonRect.bottom + 5}px`;
            dropdownContainer.style.left = `${buttonRect.left}px`;
            
            // Add to page
            document.body.appendChild(dropdownContainer);
            
            // Focus on input
            const keyInput = dropdownContainer.querySelector('#custom-decrypt-key');
            keyInput.focus();
            
            // Handle cancel
            dropdownContainer.querySelector('#cancel-custom-key').addEventListener('click', () => {
                dropdownContainer.remove();
            });
            
            // Handle try key
            dropdownContainer.querySelector('#try-custom-key').addEventListener('click', async () => {
                const customKey = keyInput.value.trim();
                
                if (!customKey) {
                    this.contentManager.showNotification('Please enter a key', 'error');
                    return;
                }
                
                if (!/^[0-9a-fA-F]{64}$/.test(customKey)) {
                    this.contentManager.showNotification('Invalid key format. Must be 64-character hex string.', 'error');
                    return;
                }
                
                try {
                    const decryptedContent = await window.relyCipher.decryptText(encryptedText, customKey);
                    if (decryptedContent) {
                        this.replaceEmailWithDecrypted(emailElement, decryptedContent);
                        this.contentManager.showNotification('Email decrypted successfully with custom key', 'success');
                        chrome.runtime.sendMessage({ type: 'DECRYPT_SUCCESS' });
                        dropdownContainer.remove();
                        return;
                    } else {
                        this.contentManager.showNotification('Decryption failed with this key', 'error');
                    }
                } catch (error) {
                    this.contentManager.showNotification('Decryption failed with this key', 'error');
                    this.contentManager.log('Custom key decryption error:', error);
                }
            });
            
            // Handle Enter key
            keyInput.addEventListener('keypress', async (event) => {
                if (event.key === 'Enter') {
                    dropdownContainer.querySelector('#try-custom-key').click();
                }
            });
            
            // Close dropdown when clicking outside
            document.addEventListener('click', (event) => {
                if (!dropdownContainer.contains(event.target) && !decryptButton.contains(event.target)) {
                    dropdownContainer.remove();
                }
            });
        }
        
        replaceEmailWithDecrypted(emailElement, decryptedContent) {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = decryptedContent;
            const indicator = document.createElement('div');
            indicator.innerHTML = '<div style="color: #28a745; font-size: 12px;">🔓 Decrypted</div>';
            wrapper.insertBefore(indicator, wrapper.firstChild);
            emailElement.innerHTML = wrapper.innerHTML;
        }
        
        enhanceComposeWindow(composeWindow) {
            if (!this.settings.AUTO_ENCRYPT) return;
            
            // Add encryption indicator
            const indicator = document.createElement('div');
            indicator.innerHTML = '<div style="color: #1a73e8; font-size: 12px;">🔒 Auto-encryption enabled</div>';
            const toolbar = composeWindow.querySelector('[role="toolbar"]');
            if (toolbar) toolbar.parentNode.insertBefore(indicator, toolbar);
            
            // Add "Send without encryption" option to the dropdown
            this.addSendWithoutEncryptionOption(composeWindow);
        }
        
        addSendWithoutEncryptionOption(composeWindow) {
            // Wait a bit for Gmail's UI to fully load
            setTimeout(() => {
                const sendButton = composeWindow.querySelector('[data-tooltip="Send"], .T-I-KE');
                if (!sendButton) return;
                
                // Try multiple approaches to find the dropdown
                let dropdownMenu = null;
                let dropdownTrigger = null;
                
                // Method 1: Look for existing dropdown menu
                dropdownMenu = composeWindow.querySelector('[role="menu"]') ||
                             composeWindow.querySelector('.J-M') ||
                             composeWindow.querySelector('[aria-label*="menu"]') ||
                             composeWindow.querySelector('[data-tooltip*="More"]');
                
                // Method 2: Look for dropdown trigger
                dropdownTrigger = sendButton.nextElementSibling ||
                                sendButton.parentElement.querySelector('[aria-label*="More"]') ||
                                sendButton.parentElement.querySelector('[data-tooltip*="More"]') ||
                                sendButton.parentElement.querySelector('[aria-label*="Schedule"]');
                
                // Method 3: Create our own dropdown if none exists
                if (!dropdownMenu && !dropdownTrigger) {
                    this.createSimpleDropdown(composeWindow, sendButton);
                    return;
                }
                
                // Method 4: Enhance existing dropdown
                if (dropdownMenu) {
                    this.enhanceExistingDropdown(composeWindow, dropdownMenu);
                } else if (dropdownTrigger) {
                    this.createDropdownForTrigger(composeWindow, sendButton, dropdownTrigger);
                }
            }, 1500); // Increased delay to ensure Gmail UI is fully loaded
        }
        
        enhanceExistingDropdown(composeWindow, dropdownMenu) {
            // Check if we already added our option
            if (dropdownMenu.querySelector('[data-rely-send-without-encryption]')) {
                return;
            }
            
            // Create our custom option
            const sendWithoutEncryptionOption = document.createElement('div');
            sendWithoutEncryptionOption.setAttribute('role', 'menuitem');
            sendWithoutEncryptionOption.setAttribute('data-rely-send-without-encryption', 'true');
            sendWithoutEncryptionOption.style.cssText = `
                padding: 8px 16px;
                cursor: pointer;
                font-size: 14px;
                color: #202124;
                border-bottom: 1px solid #e8eaed;
                display: flex;
                align-items: center;
                gap: 8px;
            `;
            sendWithoutEncryptionOption.innerHTML = '<span>📤</span><span>Send without encryption</span>';
            
            // Add hover effect
            sendWithoutEncryptionOption.addEventListener('mouseenter', () => {
                sendWithoutEncryptionOption.style.backgroundColor = '#f1f3f4';
            });
            sendWithoutEncryptionOption.addEventListener('mouseleave', () => {
                sendWithoutEncryptionOption.style.backgroundColor = '';
            });
            
            // Handle click
            sendWithoutEncryptionOption.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                
                // Remove encryption state
                this.encryptedComposeWindows.delete(composeWindow);
                
                // Restore original content if it was encrypted
                const contentArea = composeWindow.querySelector('[contenteditable="true"]');
                if (contentArea && contentArea.innerHTML.includes(this.contentManager.config.SETTINGS.ENCRYPTION_MARKER)) {
                    // Try to decrypt and restore original content
                    this.restoreOriginalContent(composeWindow);
                }
                
                // Close the dropdown
                const closeEvent = new Event('click', { bubbles: true });
                document.body.dispatchEvent(closeEvent);
                
                // Trigger normal send after a short delay
                setTimeout(() => {
                    const sendButton = composeWindow.querySelector('[data-tooltip="Send"], .T-I-KE');
                    if (sendButton) sendButton.click();
                }, 200);
            });
            
            // Insert at the top of the menu
            dropdownMenu.insertBefore(sendWithoutEncryptionOption, dropdownMenu.firstChild);
        }
        
        createDropdownForTrigger(composeWindow, sendButton, dropdownTrigger) {
            // Create a dropdown container
            const dropdownContainer = document.createElement('div');
            dropdownContainer.style.cssText = `
                position: absolute;
                top: 100%;
                right: 0;
                background: white;
                border: 1px solid #dadce0;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                z-index: 1000;
                display: none;
                min-width: 200px;
                padding: 4px 0;
            `;
            
            // Create our custom option
            const sendWithoutEncryptionOption = document.createElement('div');
            sendWithoutEncryptionOption.setAttribute('role', 'menuitem');
            sendWithoutEncryptionOption.setAttribute('data-rely-send-without-encryption', 'true');
            sendWithoutEncryptionOption.style.cssText = `
                padding: 8px 16px;
                cursor: pointer;
                font-size: 14px;
                color: #202124;
                display: flex;
                align-items: center;
                gap: 8px;
            `;
            sendWithoutEncryptionOption.innerHTML = '<span>📤</span><span>Send without encryption</span>';
            
            // Add hover effect
            sendWithoutEncryptionOption.addEventListener('mouseenter', () => {
                sendWithoutEncryptionOption.style.backgroundColor = '#f1f3f4';
            });
            sendWithoutEncryptionOption.addEventListener('mouseleave', () => {
                sendWithoutEncryptionOption.style.backgroundColor = '';
            });
            
            // Handle click
            sendWithoutEncryptionOption.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                
                // Remove encryption state
                this.encryptedComposeWindows.delete(composeWindow);
                
                // Restore original content if it was encrypted
                const contentArea = composeWindow.querySelector('[contenteditable="true"]');
                if (contentArea && contentArea.innerHTML.includes(this.contentManager.config.SETTINGS.ENCRYPTION_MARKER)) {
                    // Try to decrypt and restore original content
                    this.restoreOriginalContent(composeWindow);
                }
                
                // Close dropdown
                dropdownContainer.style.display = 'none';
                
                // Trigger normal send
                setTimeout(() => {
                    sendButton.click();
                }, 100);
            });
            
            dropdownContainer.appendChild(sendWithoutEncryptionOption);
            
            // Position the dropdown relative to the send button
            const sendButtonRect = sendButton.getBoundingClientRect();
            dropdownContainer.style.top = `${sendButtonRect.bottom + 5}px`;
            dropdownContainer.style.right = '0px';
            
            // Add to compose window
            composeWindow.appendChild(dropdownContainer);
            
            // Show/hide dropdown when trigger is clicked
            dropdownTrigger.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                dropdownContainer.style.display = dropdownContainer.style.display === 'none' ? 'block' : 'none';
            });
            
            // Close dropdown when clicking outside
            document.addEventListener('click', (event) => {
                if (!dropdownContainer.contains(event.target) && 
                    !dropdownTrigger.contains(event.target) && 
                    !sendButton.contains(event.target)) {
                    dropdownContainer.style.display = 'none';
                }
            });
        }
        
        createSimpleDropdown(composeWindow, sendButton) {
            // Create a simple dropdown container
            const dropdownContainer = document.createElement('div');
            dropdownContainer.style.cssText = `
                position: absolute;
                top: 100%;
                right: 0;
                background: white;
                border: 1px solid #dadce0;
                border-radius: 8px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                z-index: 1000;
                display: none;
                min-width: 200px;
                padding: 4px 0;
            `;
            
            // Create our custom option
            const sendWithoutEncryptionOption = document.createElement('div');
            sendWithoutEncryptionOption.setAttribute('role', 'menuitem');
            sendWithoutEncryptionOption.setAttribute('data-rely-send-without-encryption', 'true');
            sendWithoutEncryptionOption.style.cssText = `
                padding: 8px 16px;
                cursor: pointer;
                font-size: 14px;
                color: #202124;
                display: flex;
                align-items: center;
                gap: 8px;
            `;
            sendWithoutEncryptionOption.innerHTML = '<span>📤</span><span>Send without encryption</span>';
            
            // Add hover effect
            sendWithoutEncryptionOption.addEventListener('mouseenter', () => {
                sendWithoutEncryptionOption.style.backgroundColor = '#f1f3f4';
            });
            sendWithoutEncryptionOption.addEventListener('mouseleave', () => {
                sendWithoutEncryptionOption.style.backgroundColor = '';
            });
            
            // Handle click
            sendWithoutEncryptionOption.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                
                // Remove encryption state
                this.encryptedComposeWindows.delete(composeWindow);
                
                // Restore original content if it was encrypted
                const contentArea = composeWindow.querySelector('[contenteditable="true"]');
                if (contentArea && contentArea.innerHTML.includes(this.contentManager.config.SETTINGS.ENCRYPTION_MARKER)) {
                    // Try to decrypt and restore original content
                    this.restoreOriginalContent(composeWindow);
                }
                
                // Close dropdown
                dropdownContainer.style.display = 'none';
                
                // Trigger normal send
                setTimeout(() => {
                    sendButton.click();
                }, 100);
            });
            
            dropdownContainer.appendChild(sendWithoutEncryptionOption);
            
            // Add a dropdown trigger button
            const dropdownTrigger = document.createElement('div');
            dropdownTrigger.innerHTML = '▼';
            dropdownTrigger.style.cssText = `
                cursor: pointer;
                padding: 4px;
                margin-left: 4px;
                font-size: 12px;
                color: #5f6368;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                border-radius: 4px;
            `;
            
            dropdownTrigger.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                dropdownContainer.style.display = dropdownContainer.style.display === 'none' ? 'block' : 'none';
            });
            
            // Insert after send button
            sendButton.parentElement.insertBefore(dropdownTrigger, sendButton.nextSibling);
            composeWindow.appendChild(dropdownContainer);
            
            // Close dropdown when clicking outside
            document.addEventListener('click', (event) => {
                if (!dropdownContainer.contains(event.target) && 
                    !dropdownTrigger.contains(event.target) && 
                    !sendButton.contains(event.target)) {
                    dropdownContainer.style.display = 'none';
                }
            });
        }
        
        async restoreOriginalContent(composeWindow) {
            try {
                const contentArea = composeWindow.querySelector('[contenteditable="true"]');
                if (!contentArea) return;
                
                const encryptedMatch = contentArea.innerHTML.match(/<div[^>]*font-family:\s*monospace[^>]*>([^<]+)<\/div>/i);
                if (encryptedMatch) {
                    const encryptedText = encryptedMatch[1].trim();
                    const decryptedContent = await window.relyCipher.decryptText(encryptedText, this.encryptionKey);
                    if (decryptedContent) {
                        contentArea.innerHTML = decryptedContent;
                        contentArea.dispatchEvent(new Event('input', { bubbles: true }));
                        this.contentManager.showNotification('Original content restored', 'success');
                    }
                }
            } catch (error) {
                this.contentManager.log('Error restoring original content:', error);
            }
        }

        showTamperWarning(composeWindow, contentArea, originalPreHtml) {
            // Show warning overlay in the compose window
            let warning = contentArea.querySelector('.rely-tamper-warning');
            if (warning) warning.remove();
            warning = document.createElement('div');
            warning.className = 'rely-tamper-warning';
            warning.style.cssText = 'background:#fff3cd;color:#856404;padding:16px;border:1px solid #ffeeba;border-radius:6px;margin-bottom:12px;font-size:15px;display:flex;align-items:center;gap:16px;';
            warning.innerHTML = '<span style="font-size:22px;">⚠️</span> <span>This email was modified after encryption</span> <button style="margin-left:auto;padding:6px 18px;font-size:15px;background:#1a73e8;color:white;border:none;border-radius:5px;cursor:pointer;" id="undoTamperBtn">Undo</button>';
            contentArea.prepend(warning);
            document.getElementById('undoTamperBtn').onclick = () => {
                // Restore original encrypted block
                const pre = contentArea.querySelector('pre');
                if (pre) pre.outerHTML = originalPreHtml;
                warning.remove();
            };
        }
    }
    window.EmailCipher = EmailCipher;
}