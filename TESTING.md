# Testing Scripts

Quick scripts to test the conversion logic without running the full Raycast extension.

## Workflow

### 1. Save Clipboard HTML
Copy rich text from Google Docs/Sheets, then run:
```bash
./save-clipboard-html.sh
```

This saves the HTML to `input.html`.

### 2. Test Conversion
Process `input.html` and generate `result.md`:
```bash
node test-convert.js
```

### 3. Check Result
Open `result.md` to verify:
- ✅ Tables converted to Markdown
- ✅ Links preserved
- ✅ No orphaned `**` or escaped `\-`
- ✅ Proper paragraph spacing

## Quick Test
```bash
# One-liner: save clipboard and convert
./save-clipboard-html.sh && node test-convert.js && code result.md
```

## Files
- `save-clipboard-html.sh` - Saves clipboard HTML to `input.html`
- `test-convert.js` - Converts `input.html` to `result.md` using extension logic
- `input.html` - Test input (git-ignored)
- `result.md` - Test output (git-ignored)
