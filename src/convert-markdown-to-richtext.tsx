import { Clipboard, showHUD, showToast, Toast } from "@raycast/api";
import { marked } from "marked";

/**
 * Checks if text looks like Markdown content
 * Looks for common Markdown patterns
 */
function looksLikeMarkdown(text: string): boolean {
  const markdownPatterns = [
    /^#{1,6}\s+/m,           // Headings: # Title
    /\*\*[^*]+\*\*/,         // Bold: **text**
    /\*[^*]+\*/,             // Italic: *text*
    /_[^_]+_/,               // Italic: _text_
    /\[[^\]]+\]\([^)]+\)/,   // Links: [text](url)
    /^[-*+]\s+/m,            // Unordered lists: - item
    /^\d+\.\s+/m,            // Ordered lists: 1. item
    /^>\s+/m,                // Blockquotes: > text
    /`[^`]+`/,               // Inline code: `code`
    /^```/m,                 // Code blocks: ```
    /^\|.+\|$/m,             // Tables: | col | col |
    /^[-*_]{3,}$/m,          // Horizontal rules: ---
  ];

  return markdownPatterns.some((pattern) => pattern.test(text));
}

/**
 * Converts Markdown to HTML with proper styling for rich text paste
 */
function convertMarkdownToHtml(markdown: string): string {
  // Configure marked for GFM (GitHub Flavored Markdown)
  marked.setOptions({
    gfm: true,
    breaks: true,
  });

  // Convert Markdown to HTML
  const html = marked.parse(markdown, { async: false }) as string;

  // Wrap in a basic HTML structure with minimal inline styles
  // These styles help ensure consistent rendering when pasted
  const styledHtml = `
<html>
<head>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; }
  h1, h2, h3, h4, h5, h6 { margin-top: 1em; margin-bottom: 0.5em; font-weight: 600; }
  h1 { font-size: 2em; }
  h2 { font-size: 1.5em; }
  h3 { font-size: 1.25em; }
  p { margin: 0.5em 0; }
  ul, ol { margin: 0.5em 0; padding-left: 2em; }
  li { margin: 0.25em 0; }
  code { font-family: 'SF Mono', Menlo, Monaco, 'Courier New', monospace; background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
  pre { background: #f4f4f4; padding: 1em; border-radius: 5px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #ddd; margin: 0.5em 0; padding-left: 1em; color: #666; }
  table { border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: 0.5em 1em; text-align: left; }
  th { background: #f4f4f4; font-weight: 600; }
  a { color: #0066cc; text-decoration: underline; }
  hr { border: none; border-top: 1px solid #ddd; margin: 1em 0; }
</style>
</head>
<body>
${html}
</body>
</html>
`.trim();

  return styledHtml;
}

/**
 * Copies HTML content to clipboard as rich text
 * Works on both macOS and Windows
 * This allows the content to be pasted as formatted text in apps like Google Docs
 */
async function copyHtmlAsRichText(html: string): Promise<void> {
  const { execSync } = require("child_process");
  const os = require("os");
  const fs = require("fs");
  const platform = os.platform();

  if (platform === "darwin") {
    // macOS: Use AppleScript
    // Convert HTML string to hex for AppleScript
    const hexHtml = Buffer.from(html, "utf-8").toString("hex");

    // Use AppleScript to set clipboard with HTML type
    // This makes apps recognize it as rich text
    const script = `
      set theHTML to «data HTML${hexHtml}»
      set the clipboard to theHTML
    `;

    try {
      execSync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, {
        timeout: 5000,
      });
    } catch (error) {
      // Fallback: try writing to a temp file and using pbcopy approach
      const tempFile = "/tmp/raycast-richtext-temp.html";
      fs.writeFileSync(tempFile, html);

      // Use textutil to convert and copy
      try {
        execSync(
          `textutil -convert rtf -stdout "${tempFile}" | pbcopy -Prefer rtf`,
          { timeout: 5000 }
        );
      } catch (fallbackError) {
        // Last resort: copy as plain HTML (some apps will still render it)
        await Clipboard.copy(html);
        throw new Error(
          "Could not copy as rich text, copied as HTML instead"
        );
      }
    }
  } else if (platform === "win32") {
    // Windows: Use PowerShell to set HTML on clipboard
    const tempFile = os.tmpdir() + "\\raycast-richtext-temp.html";
    fs.writeFileSync(tempFile, html, "utf-8");

    // Windows clipboard HTML format requires a specific header
    const startHtml = html.indexOf("<html");
    const endHtml = html.length;
    const startFragment = html.indexOf("<body");
    const endFragment = html.lastIndexOf("</body>") + 7;

    const header = [
      "Version:0.9",
      "StartHTML:" + String(97).padStart(10, "0"),
      "EndHTML:" + String(97 + html.length).padStart(10, "0"),
      "StartFragment:" + String(97 + (startFragment >= 0 ? startFragment : 0)).padStart(10, "0"),
      "EndFragment:" + String(97 + (endFragment > 0 ? endFragment : html.length)).padStart(10, "0"),
    ].join("\r\n") + "\r\n";

    const clipboardHtml = header + html;
    const clipboardFile = os.tmpdir() + "\\raycast-clipboard.html";
    fs.writeFileSync(clipboardFile, clipboardHtml, "utf-8");

    try {
      // Use PowerShell to set HTML clipboard data
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        $html = [System.IO.File]::ReadAllText('${clipboardFile.replace(/\\/g, "\\\\")}')
        [System.Windows.Forms.Clipboard]::SetText($html, [System.Windows.Forms.TextDataFormat]::Html)
      `;
      execSync(`powershell -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
        timeout: 10000,
      });
    } catch (error) {
      // Fallback: just copy the HTML as text
      await Clipboard.copy(html);
      console.log("Windows clipboard fallback: copied HTML as text");
    }
  } else {
    // Linux or other: fallback to plain HTML copy
    await Clipboard.copy(html);
    console.log("Unsupported platform, copied HTML as text");
  }
}

export default async function Command() {
  console.log("\n\n🚀 === MARKDOWN TO RICH TEXT STARTED ===\n");

  try {
    // Read clipboard content
    const clipboardContent = await Clipboard.read();

    // Debug logging
    console.log("Clipboard content:", {
      hasText: !!clipboardContent.text,
      textLength: clipboardContent.text?.length,
    });

    // Check if we have text content
    if (!clipboardContent.text) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Empty Clipboard",
        message: "Please copy some Markdown text first",
      });
      return;
    }

    const text = clipboardContent.text.trim();

    // Validate that it looks like Markdown (optional, but helpful)
    if (!looksLikeMarkdown(text)) {
      // Still proceed, but warn - plain text will just become a paragraph
      console.log("Text doesn't look like Markdown, but proceeding anyway");
    }

    console.log("Input Markdown preview:", text.substring(0, 300));

    // Convert Markdown to styled HTML
    const html = convertMarkdownToHtml(text);

    console.log("Generated HTML preview:", html.substring(0, 500));
    console.log("HTML length:", html.length, "chars");

    // Copy HTML as rich text to clipboard
    await copyHtmlAsRichText(html);

    console.log("✅ Rich text copied to clipboard successfully!");

    // Show success message
    await showHUD("✅ Rich text copied to clipboard!");
  } catch (error) {
    console.error("❌ ERROR:", error);
    console.error("Error stack:", error instanceof Error ? error.stack : "No stack");

    await showToast({
      style: Toast.Style.Failure,
      title: "Conversion Failed",
      message: error instanceof Error ? error.message : "Unknown error occurred",
    });
  }

  console.log("\n🏁 === MARKDOWN TO RICH TEXT FINISHED ===\n\n");
}
