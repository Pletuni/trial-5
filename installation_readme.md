# RelyHealth Email Cipher Extension

A Gmail extension that automatically encrypts outgoing emails and decrypts incoming emails using AES-GCM encryption while preserving Google Meet links.

## Features

- 🔒 **Automatic Encryption**: Automatically encrypts all outgoing emails
- 🔓 **Automatic Decryption**: Automatically decrypts incoming emails with matching keys
- 📅 **Google Meet Preservation**: Keeps Google Meet links unencrypted for accessibility
- 🔑 **Secure Key Management**: 256-bit AES encryption with secure key storage
- 📊 **Usage Statistics**: Track encryption/decryption statistics
- ⚙️ **Configurable Settings**: Customize encryption behavior

## Installation

### Prerequisites
- Google Chrome or Chromium-based browser
- Gmail account

### Steps

1. **Download the Extension Files**
   - Save all the provided files in a single directory
   - Ensure you have these files:
     - `manifest.json`
     - `config.js`
     - `relyCipher.js`
     - `content.js`
     - `background.js`
     - `popup.html`
     - `popup.js`

2. **Load the Extension**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the directory containing your extension files

3. **Configure the Extension**
   - Click the extension icon in the Chrome toolbar
   - The popup will open with configuration options
   - Set your encryption key (or generate a new one)
   - Configure your preferred settings

## Configuration

### Environment Variables

The extension uses configuration settings in `config.js`:

```javascript
const CONFIG = {
  ENV: 'development', // Change to 'production' for live use
  DEFAULT_KEY: 'your_dev_key_here',
  PRODUCTION_KEY: 'your_production_key_here',
  // ... other settings
};
```

### Key Settings

- **AUTO_ENCRYPT**: Automatically encrypt outgoing emails
- **AUTO_DECRYPT**: Automatically decrypt incoming emails
- **PRESERVE_MEET_LINKS**: Keep Google Meet links unencrypted
- **SHOW_NOTIFICATIONS**: Show encryption/decryption notifications

## Usage

### Sending Encrypted Emails

1. Compose an email in Gmail as usual
2. The extension will automatically encrypt the content when you click "Send"
3. Google Meet links will be preserved and remain accessible
4. Recipients with the same encryption key will see the decrypted content

### Receiving Encrypted Emails

1. Encrypted emails will be automatically detected
2. If you have the correct encryption key, the email will be decrypted automatically
3. A small indicator will show that the email was decrypted

### Managing Encryption Keys

1. Click the extension icon to open the popup
2. Use the "Generate New" button to create a new 256-bit key
3. Share the key securely with recipients who need to decrypt your emails
4. Keys are stored securely in Chrome's sync storage

## Security Features

- **AES-GCM Encryption**: Industry-standard 256-bit encryption
- **Random IV Generation**: Each email uses a unique initialization vector
- **Secure Key Storage**: Keys are stored in Chrome's encrypted sync storage
- **Link Preservation**: Google Meet links remain functional

## Troubleshooting

### Extension Not Working

1. Check that the extension is enabled in `chrome://extensions/`
2. Ensure you're on Gmail (`mail.google.com`)
3. Refresh the Gmail tab
4. Check the browser console for error messages

### Decryption Failures

1. Verify that the encryption key matches the sender's key
2. Check that the email is actually encrypted (look for the encryption marker)
3. Ensure the extension is active and configured properly

### Performance Issues

1. Large emails may take longer to encrypt/decrypt
2. Check the `MAX_EMAIL_SIZE` setting in config.js
3. Consider disabling auto-encryption for very large emails

## Development

### File Structure

```
extension/
├── manifest.json          # Extension manifest
├── config.js             # Configuration and environment variables
├── relyCipher.js         # Core encryption/decryption module
├── content.js            # Gmail interface integration
├── background.js         # Background service worker
├── popup.html           # Extension popup interface
├── popup.js             # Popup functionality
└── README.md            # This file
```

### Testing

1. Set `ENV: 'development'` in `config.js`
2. Enable debug logging by setting `DEBUG.ENABLED: true`
3. Check the browser console for detailed logging
4. Test with different Gmail accounts using the same key

### Production Deployment

1. Set `ENV: 'production'` in `config.js`
2. Update `PRODUCTION_KEY` with your secure key
3. Disable debug logging
4. Test thoroughly before distribution

## Security Considerations

- **Key Management**: Never share encryption keys through insecure channels
- **Backup Keys**: Keep secure backups of your encryption keys
- **Regular Updates**: Update keys periodically for enhanced security
- **Recipient Verification**: Ensure recipients are using the correct key

## Limitations

- Only works with Gmail web interface
- Requires recipients to have the same extension and key
- Attachments are not encrypted in this version
- Limited to text-based email content

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the browser console for error messages
3. Verify your configuration settings

## License

This extension is provided as-is for educational and personal use. Please ensure compliance with your organization's security policies before use.

## Version History

- **v1.0.0**: Initial release with basic encryption/decryption functionality
- Automatic Gmail integration
- Google Meet link preservation
- Configurable settings and key management