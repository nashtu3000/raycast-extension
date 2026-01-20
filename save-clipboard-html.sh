#!/bin/bash

# Save clipboard HTML to input.html for testing
# Usage: ./save-clipboard-html.sh

echo "📋 Reading HTML from clipboard..."

# Get HTML from macOS clipboard
osascript -e 'the clipboard as «class HTML»' > /tmp/clipboard-hex.txt 2>&1

if [ $? -ne 0 ]; then
  echo "❌ No HTML found in clipboard"
  echo "   Make sure you copied rich text content (from Google Docs, Sheets, etc.)"
  exit 1
fi

# Convert hex to actual HTML
hex_data=$(cat /tmp/clipboard-hex.txt | sed 's/«data HTML//g' | sed 's/»//g' | tr -d '\n' | tr -d ' ')

if [ -z "$hex_data" ] || [ "$hex_data" = "missingvalue" ]; then
  echo "❌ No HTML data in clipboard"
  exit 1
fi

# Convert hex to string and save to input.html
echo "$hex_data" | xxd -r -p > input.html 2>/dev/null

if [ $? -eq 0 ] && [ -s input.html ]; then
  size=$(wc -c < input.html | tr -d ' ')
  lines=$(wc -l < input.html | tr -d ' ')
  echo "✅ Saved HTML to input.html"
  echo "   Size: $((size / 1024)) KB"
  echo "   Lines: $lines"
  
  # Count tables and links
  tables=$(grep -o '<table' input.html | wc -l | tr -d ' ')
  links=$(grep -o '<a href=' input.html | wc -l | tr -d ' ')
  echo "   Tables: $tables"
  echo "   Links: $links"
else
  echo "❌ Failed to save HTML"
  exit 1
fi

# Clean up temp file
rm -f /tmp/clipboard-hex.txt

echo ""
echo "💡 Now you can test with: node test-conversion.js"
