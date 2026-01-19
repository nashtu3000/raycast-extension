# Clipboard to Markdown Converter

A Raycast extension that converts rich text clipboard content from Google Sheets, Google Docs, websites, and other sources into clean Markdown format.

## Features

- 🎯 **Universal Support**: Works with content copied from any source (Sheets, Docs, websites, etc.)
- 🧹 **HTML Cleaning**: Automatically sanitizes and tidies HTML before conversion
- 📝 **GitHub Flavored Markdown**: Supports tables, task lists, and strikethrough
- 🖥️ **Cross-Platform**: Works on both macOS and Windows
- ⚡ **Fast & Silent**: No UI, just processes and copies instantly

## How to Use

1. **Copy rich text** from any source (Google Sheets, Google Docs, websites, etc.)
2. **Open Raycast** and search for `Convert Clipboard to Markdown`
3. **Press Enter** to run the command
4. **Done!** The cleaned Markdown is now in your clipboard, ready to paste anywhere

### Pro Tip: Assign a Hotkey

For even faster access:
1. In Raycast, search for "Convert Clipboard to Markdown"
2. Press `⌘+K` to open actions
3. Select "Configure Command"
4. Assign your preferred hotkey (e.g., `⌘+Shift+M`)

Now you can convert clipboard content instantly with a single keystroke!

## Technical Details

This extension uses:
- `turndown` for HTML to Markdown conversion
- `turndown-plugin-gfm` for GitHub Flavored Markdown support
- `sanitize-html` for cleaning HTML content
- Pure JavaScript (no native binaries) for cross-platform compatibility
- Smart HTML detection: Works even when HTML is copied as plain text

## Installation

### For Personal Use (Mac or Windows)

1. **Clone or download this repository:**
   ```bash
   git clone https://github.com/nashtu3000/raycast-extension.git
   cd raycast-extension
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Import into Raycast (One-Time Setup):**
   - Open Raycast
   - Go to **Settings** → **Extensions** tab
   - Click the **⋮** menu (three dots) in the top right
   - Select **"Import Extension"**
   - Navigate to the `raycast-extension` folder
   - Click **Import**

4. **Done!** The extension is now permanently installed. You don't need to keep any terminal running.

### For Development (Testing Changes)

If you want to modify the code and test it:

```bash
npm run dev
```

This starts a development server that auto-reloads when you make changes. Press `Ctrl+C` to stop.

## License

MIT
