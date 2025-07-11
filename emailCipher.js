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
            // Marker block (inside <pre> for formatting)
            html += `<pre style="background: #f8f9fa; border: 1px solid #1a73e8; border-radius: 6px; padding: 15px; font-family: monospace; font-size: 14px; color: #222;">
-----BEGIN RELY ENCRYPTED MESSAGE-----\n${encryptedContent}\n-----END RELY ENCRYPTED MESSAGE-----
`;
            if (preservedLinks.length > 0) {
                html += `\n\nGoogle Meet Links:\n`;
                html += preservedLinks.map(link => `${link}`).join('\n');
            }
            html += `</pre>`;
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
            if (!this.settings.AUTO_DECRYPT) return;
            try {
                const messageId = emailElement.getAttribute('data-message-id');
                if (!messageId || this.processedEmails.has(messageId)) return;
                this.processedEmails.add(messageId);
                
                const content = emailElement.innerHTML;
                if (!content.includes(this.contentManager.config.SETTINGS.ENCRYPTION_MARKER)) return;
                
                const encryptedMatch = content.match(/<div[^>]*font-family:\s*monospace[^>]*>([^<]+)<\/div>/i);
                if (!encryptedMatch) return;
                
                const encryptedText = encryptedMatch[1].trim();
                const decryptedContent = await window.relyCipher.decryptText(encryptedText, this.encryptionKey);
                if (decryptedContent) {
                    this.replaceEmailWithDecrypted(emailElement, decryptedContent);
                    this.contentManager.showNotification('Email decrypted successfully', 'success');
                    chrome.runtime.sendMessage({ type: 'DECRYPT_SUCCESS' });
                }
            } catch (error) {
                this.contentManager.log('Error processing email content:', error);
                this.contentManager.showNotification('Failed to decrypt email', 'error');
                chrome.runtime.sendMessage({ type: 'OPERATION_FAILED' });
            }
        }
        
        // Improved: Only add decrypt button to the main message action bar, and only if encrypted content is present
        addDecryptButtonToEmail(emailElement) {
            // Only target the main message, not reply/forward toolbars
            // Look for the main message body (where [ENCRYPTED] marker is present)
            const messageBody = emailElement.querySelector('div[dir="ltr"], .a3s');
            if (!messageBody) return;
            const content = messageBody.innerHTML;
            if (!content.includes(this.contentManager.config.SETTINGS.ENCRYPTION_MARKER)) return;
            // Only add to the main message's action bar (not every toolbar)
            // Find the closest action bar above the message body
            let actionButtonsContainer = null;
            let node = messageBody;
            while (node && !actionButtonsContainer) {
                node = node.parentElement;
                if (!node) break;
                actionButtonsContainer = node.querySelector('[role="toolbar"]');
            }
            if (!actionButtonsContainer) return;
            // Prevent multiple decrypt buttons
            if (actionButtonsContainer.querySelector('[data-rely-decrypt-button]')) return;
            // Create decrypt button
            const decryptButton = document.createElement('span');
            decryptButton.setAttribute('role', 'link');
            decryptButton.setAttribute('tabindex', '0');
            decryptButton.setAttribute('data-rely-decrypt-button', 'true');
            decryptButton.className = 'ams bkG';
            decryptButton.style.cssText = `
                cursor: pointer;
                color: #1a73e8;
                margin-left: 8px;
                padding: 4px 8px;
                border-radius: 4px;
                transition: background-color 0.2s;
                font-size: 14px;
                font-weight: 500;
                text-decoration: none;
                display: inline-flex;
                align-items: center;
                gap: 4px;
            `;
            decryptButton.innerHTML = '🔓 Decrypt';
            decryptButton.addEventListener('mouseenter', () => {
                decryptButton.style.backgroundColor = '#f1f3f4';
            });
            decryptButton.addEventListener('mouseleave', () => {
                decryptButton.style.backgroundColor = '';
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
            // Insert at the end of the action bar
            actionButtonsContainer.appendChild(decryptButton);
        }
        
        // Update decryption logic to robustly find and replace the marker block
        async decryptEmailWithButton(emailElement, decryptButton) {
            // Search the entire email body for the marker block
            let bodyNode = emailElement.querySelector('div[dir="ltr"], .a3s, .ii, .adn');
            if (!bodyNode) bodyNode = emailElement;
            let html = bodyNode.innerHTML;
            // Regex to match the marker block (tolerant of whitespace/line breaks)
            const markerRegex = /-----BEGIN RELY ENCRYPTED MESSAGE-----[\s\S]*?([A-Za-z0-9+/=:\n\r\-]+)[\s\S]*?-----END RELY ENCRYPTED MESSAGE-----/;
            const match = html.match(markerRegex);
            let encryptedText = null;
            if (match) {
                encryptedText = match[1].replace(/<br\s*\/?>/gi, '').replace(/\r?\n/g, '').trim();
            }
            // Fallback: look for visible encrypted block (legacy)
            if (!encryptedText) {
                const encryptedMatch = html.match(/<div[^>]*font-family:\s*monospace[^>]*>([^<]+)<\/div>/i);
                if (encryptedMatch) {
                    encryptedText = encryptedMatch[1].trim();
                }
            }
            if (!encryptedText) {
                this.contentManager.showNotification('No encrypted content found', 'error');
                return;
            }
            try {
                // Try with current key first
                const decryptedContent = await window.relyCipher.decryptText(encryptedText, this.encryptionKey);
                if (decryptedContent) {
                    // Replace the marker block with the decrypted content
                    if (match) {
                        bodyNode.innerHTML = html.replace(markerRegex, decryptedContent);
                    } else {
                        this.replaceEmailWithDecrypted(emailElement, decryptedContent);
                    }
                    this.contentManager.showNotification('Email decrypted successfully', 'success');
                    chrome.runtime.sendMessage({ type: 'DECRYPT_SUCCESS' });
                    return;
                }
            } catch (error) {
                this.contentManager.log('Decryption failed with current key:', error);
            }
            // If current key doesn't work, show custom key input
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