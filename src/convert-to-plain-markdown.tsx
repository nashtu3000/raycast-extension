import { Clipboard, showHUD, showToast, Toast } from "@raycast/api";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/**
 * Handles colspan and rowspan by duplicating cell content across columns
 * Must be called BEFORE removing attributes
 */
function expandColspanRowspan(html: string): string {
  // Process each table cell with colspan
  let expanded = html;
  
  // Match td/th tags with colspan attribute
  expanded = expanded.replace(/<(td|th)([^>]*colspan=["'](\d+)["'][^>]*)>(.*?)<\/\1>/gis, 
    (match, tagName, attrs, colspan, content) => {
      const count = parseInt(colspan);
      
      // If the cell content looks like a section header (has strong/b tags and is long)
      // OR if colspan is the entire table width (4+ columns), just use it once
      // This prevents "Non-Response Bias Analysis" from being duplicated 4 times
      const looksLikeHeader = /<(strong|b|h\d)/.test(content) && content.length > 30;
      
      if (looksLikeHeader || count >= 4) {
        // Don't duplicate section headers - just expand to first column
        return `<${tagName}>${content}</${tagName}>`;
      }
      
      // For regular cells, duplicate for each column
      const cells: string[] = [];
      for (let i = 0; i < count; i++) {
        cells.push(`<${tagName}>${content}</${tagName}>`);
      }
      
      return cells.join("");
    }
  );
  
  return expanded;
}

/**
 * Converts inline font-weight styles to semantic <strong> and <b> tags
 * Must be called BEFORE removing style attributes
 */
function convertInlineStylesToSemantic(html: string): string {
  let converted = html;
  
  // Convert spans with font-weight:700/bold to <strong>
  converted = converted.replace(/<span([^>]*style="[^"]*font-weight\s*:\s*(700|bold|600)[^"]*"[^>]*)>(.*?)<\/span>/gis, 
    (match, attrs, weight, content) => {
      // Skip if content is only <br> or whitespace - don't want <strong><br></strong>
      if (/^(<br\s*\/?>|\s)*$/i.test(content)) {
        return content; // Just return the br tag without wrapping
      }
      return `<strong>${content}</strong>`;
    }
  );
  
  // Convert spans with font-style:italic to <em>
  converted = converted.replace(/<span([^>]*style="[^"]*font-style\s*:\s*italic[^"]*"[^>]*)>(.*?)<\/span>/gis, 
    (match, attrs, content) => {
      if (/^(<br\s*\/?>|\s)*$/i.test(content)) {
        return content;
      }
      return `<em>${content}</em>`;
    }
  );
  
  // Also convert <b> tags to <strong> for consistency
  // Use word boundary to avoid matching <br> tags
  converted = converted.replace(/<b(\s|>)/gi, "<strong$1>");
  converted = converted.replace(/<\/b>/gi, "</strong>");
  
  // Convert <i> tags to <em>
  // Use word boundary to avoid matching <img>, <iframe>, etc.
  converted = converted.replace(/<i(\s|>)/gi, "<em$1>");
  converted = converted.replace(/<\/i>/gi, "</em>");
  
  return converted;
}

/**
 * Lightweight HTML cleaning using regex for large documents
 * EXACT SAME as convert-to-markdown.tsx
 */
function cleanHtmlLightweight(html: string): string {
  let cleaned = html;
  
  // Step -2: Remove icon elements (Font Awesome, Material Icons, etc.)
  cleaned = cleaned.replace(/<i[^>]*class="[^"]*fa[^"]*"[^>]*><\/i>/gi, "");
  cleaned = cleaned.replace(/<i[^>]*class="[^"]*icon[^"]*"[^>]*><\/i>/gi, "");
  cleaned = cleaned.replace(/<span[^>]*class="[^"]*icon[^"]*"[^>]*><\/span>/gi, "");
  
  // Step -1: Remove Google Docs wrapper elements at the very beginning
  cleaned = cleaned.replace(/^(<meta[^>]*>)+/gi, "");
  cleaned = cleaned.replace(/^<b[^>]*docs-internal-guid[^>]*>/i, "");
  
  // Step 0: Convert inline styles to semantic tags FIRST (before removing attributes)
  cleaned = convertInlineStylesToSemantic(cleaned);
  
  // Step 1: Expand colspan/rowspan BEFORE removing attributes
  cleaned = expandColspanRowspan(cleaned);
  
  // Step 2: Remove colgroup
  cleaned = cleaned.replace(/<colgroup[^>]*>.*?<\/colgroup>/gis, "");
  
  // Step 3: Preserve href attributes on <a> tags by using placeholder markers
  const linkPlaceholders: { marker: string; href: string }[] = [];
  let linkCounter = 0;
  
  // Replace <a href="..."> with a unique marker that won't be touched by attribute removal
  cleaned = cleaned.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi, (match, href) => {
    const marker = `___LINK_${linkCounter}___`;
    linkPlaceholders.push({ marker, href });
    linkCounter++;
    return `<a>${marker}`;
  });
  
  // Step 4: Now remove ALL other attributes (won't touch our ___LINK_X___ markers)
  cleaned = cleaned.replace(/<(\w+)(\s+[^>]+)>/g, "<$1>");
  
  // Step 5: Restore links with href attributes after the marker
  linkPlaceholders.forEach(({ marker, href }) => {
    cleaned = cleaned.replace(`<a>${marker}`, `<a href="${href}">`);
  });
  
  // Step 3: Remove wrapper tags but preserve block structure for Turndown
  // KEEP <p> and <br> tags OUTSIDE tables - Turndown needs them for proper spacing
  // But REMOVE <p> tags INSIDE table cells to prevent extra newlines
  
  // First, clean up table cells specifically
  cleaned = cleaned.replace(/<t([dh])>(<p>)*(.*?)(<\/p>)*<\/t\1>/gis, (match, tagType, _1, content, _2) => {
    // Remove all <p>, </p>, <br> tags from cell content
    let cellContent = content;
    for (let pass = 0; pass < 5; pass++) {
      cellContent = cellContent.replace(/<\/?p>/gi, " ");
      cellContent = cellContent.replace(/<br\s*\/?>/gi, " ");
      cellContent = cellContent.replace(/<\/?span>/gi, "");
      cellContent = cellContent.replace(/<\/?font>/gi, "");
    }
    cellContent = cellContent.replace(/\s{2,}/g, " ").trim();
    return `<t${tagType}>${cellContent}</t${tagType}>`;
  });
  
  // Then remove inline wrappers globally (multiple passes for deep nesting)
  for (let pass = 0; pass < 10; pass++) {
    cleaned = cleaned.replace(/<\/?span>/gi, "");
    cleaned = cleaned.replace(/<\/?font>/gi, "");
    cleaned = cleaned.replace(/<div[^>]*>/gi, "");
    cleaned = cleaned.replace(/<\/div>/gi, "");
  }
  
  // Step 4: Clean up whitespace (but preserve table cell whitespace)
  cleaned = cleaned.replace(/>\s+</g, "><");
  
  // Step 5: Add table headers - find first tr in EACH table and convert its td to th
  cleaned = cleaned.replace(/<table><tbody><tr>(.*?)<\/tr>/gis, (match, firstRow) => {
    const headerRow = firstRow.replace(/<td>/gi, "<th>").replace(/<\/td>/gi, "</th>");
    return `<table><thead><tr>${headerRow}</tr></thead><tbody>`;
  });
  
  return cleaned.trim();
}

/**
 * Post-processes Markdown to fix formatting issues
 */
function postProcessMarkdown(markdown: string): string {
  let fixed = markdown;
  
  // Fix 1: Remove lines that are ONLY ** (orphaned bold markers)
  fixed = fixed.replace(/^\*\*\s*$/gm, "");
  
  // Fix 2: Remove standalone ** at the very start or very end of document
  fixed = fixed.replace(/^\*\*\s*\n+/, "");
  fixed = fixed.replace(/\n+\s*\*\*\s*$/, "");
  
  // Fix 3: Un-escape dashes in regular text (not in code blocks)
  fixed = fixed.replace(/\\-/g, "-");
  
  // Fix 4: Remove empty numbered list items (lines with just numbers and whitespace)
  fixed = fixed.replace(/^\d+\.\s+$/gm, "");
  
  // Fix 5: Convert unicode bullets to markdown list items
  fixed = fixed.replace(/^●\s+(.+)$/gm, "-   $1");
  
  // Fix 6: Clean up excessive blank lines (more than 3 consecutive)
  fixed = fixed.replace(/\n{4,}/g, "\n\n\n");
  
  // Fix 7: Remove trailing whitespace on lines (BUT preserve double-space line breaks)
  // Markdown uses "  \n" (two spaces + newline) for line breaks
  // Remove 3+ spaces/tabs, or single space/tab, but NOT exactly 2 spaces
  fixed = fixed.replace(/[ \t]{3,}$/gm, "  "); // 3+ spaces → 2 spaces
  fixed = fixed.replace(/[ \t]{1}$/gm, ""); // Single space/tab → remove (won't match 2 spaces)
  
  return fixed.trim();
}

/**
 * Removes all image and media tags from Markdown
 */
function removeMediaFromMarkdown(markdown: string): string {
  let cleaned = markdown;
  
  // Remove image syntax: ![alt](url)
  cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
  
  // Remove image reference links: ![alt][ref]
  cleaned = cleaned.replace(/!\[[^\]]*\]\[[^\]]+\]/g, "");
  
  // Remove standalone image URLs that might remain
  cleaned = cleaned.replace(/^https?:\/\/[^\s]+\.(png|jpg|jpeg|gif|svg|webp).*$/gim, "");
  
  // Clean up extra blank lines left by removed images
  cleaned = cleaned.replace(/\n\n\n+/g, "\n\n");
  
  return cleaned.trim();
}

export default async function PlainMarkdownCommand() {
  try {
    // Import the main command's processor
    const mainModule = await import("./convert-to-markdown");
    
    // Read and process clipboard using the main command logic
    const clipboardContent = await Clipboard.read();
    
    // Check if we have HTML content
    if (!clipboardContent.html && !clipboardContent.text) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Empty Clipboard",
        message: "Please copy some content first",
      });
      return;
    }
    
    // Get markdown using the main command (it will handle HTML retrieval)
    // For now, run the conversion inline with media removal
    let htmlContent: string | undefined = clipboardContent.html;
    
    // Platform-specific clipboard fallback if no HTML
    if (!htmlContent && clipboardContent.text) {
      const { execSync } = require("child_process");
      const os = require("os");
      const platform = os.platform();
      
      if (platform === "darwin") {
        // macOS: Use AppleScript
        try {
          const result = execSync("osascript -e 'the clipboard as «class HTML»'", {
            encoding: "buffer",
            timeout: 5000,
            maxBuffer: 10 * 1024 * 1024,
          });
          
          const htmlHex = result.toString().replace(/«data HTML|»/g, "").trim();
          if (htmlHex && htmlHex !== "missing value" && htmlHex.length > 20) {
            htmlContent = Buffer.from(htmlHex, "hex").toString("utf-8");
          }
        } catch (error: any) {
          if (error.stdout) {
            const htmlHex = error.stdout.toString().replace(/«data HTML|»/g, "").trim();
            if (htmlHex && htmlHex !== "missing value" && htmlHex.length > 20) {
              htmlContent = Buffer.from(htmlHex, "hex").toString("utf-8");
            }
          }
        }
      } else if (platform === "win32") {
        // Windows: Use PowerShell to get HTML from clipboard via temp file
        const fs = require("fs");
        const path = require("path");
        const tempDir = os.tmpdir();
        const scriptPath = path.join(tempDir, "raycast-get-clipboard-plain.ps1");
        const outputPath = path.join(tempDir, "raycast-clipboard-output-plain.txt");
        
        const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dataObj = [System.Windows.Forms.Clipboard]::GetDataObject()
if ($dataObj -and $dataObj.GetDataPresent("HTML Format")) {
    $stream = $dataObj.GetData("HTML Format")
    $content = $null
    if ($stream -is [System.IO.MemoryStream]) {
        # Read raw bytes and decode as UTF-8
        $bytes = $stream.ToArray()
        $utf8 = [System.Text.Encoding]::UTF8
        $content = $utf8.GetString($bytes)
    } elseif ($stream -is [string]) {
        # If it's already a string, try to fix encoding if it was read wrong
        # Check if it looks like it was read as Windows-1252 instead of UTF-8
        $bytes = [System.Text.Encoding]::GetEncoding(1252).GetBytes($stream)
        $content = [System.Text.Encoding]::UTF8.GetString($bytes)
    }
    if ($content) {
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText("${outputPath.replace(/\\/g, "\\\\")}", $content, $utf8NoBom)
    }
}
`;
        try {
          fs.writeFileSync(scriptPath, psScript, "utf-8");
          try { fs.unlinkSync(outputPath); } catch (e) { /* ignore */ }
          
          execSync(`powershell -sta -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, {
            timeout: 10000,
            windowsHide: true,
          });
          
          if (fs.existsSync(outputPath)) {
            const result = fs.readFileSync(outputPath, "utf-8");
            if (result && result.includes("<")) {
              const htmlMatch = result.match(/<html[^>]*>[\s\S]*<\/html>/i);
              if (htmlMatch) {
                htmlContent = htmlMatch[0];
              } else {
                const fragmentMatch = result.match(/<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i);
                if (fragmentMatch) {
                  htmlContent = fragmentMatch[1];
                } else {
                  htmlContent = result.substring(result.indexOf("<"));
                }
              }
            }
            try { fs.unlinkSync(outputPath); } catch (e) { /* ignore */ }
          }
          try { fs.unlinkSync(scriptPath); } catch (e) { /* ignore */ }
        } catch (error: any) {
          console.log("Could not retrieve HTML from Windows clipboard:", error.message);
        }
      }
    }
    
    if (!htmlContent) {
      await showHUD("⚠️ No rich text found");
      return;
    }
    
    // Remove images from HTML before processing
    htmlContent = htmlContent
      .replace(/<img[^>]*>/gi, "")
      .replace(/<video[^>]*>.*?<\/video>/gis, "")
      .replace(/<audio[^>]*>.*?<\/audio>/gis, "")
      .replace(/<iframe[^>]*>.*?<\/iframe>/gis, "");
    
    // Use the SAME cleaning logic as convert-to-markdown.tsx
    console.log(`[Plain Markdown] Processing HTML: ${(htmlContent.length / 1024).toFixed(1)} KB`);
    const cleaned = cleanHtmlLightweight(htmlContent);
    console.log(`[Plain Markdown] Cleaned HTML sample:`, cleaned.substring(0, 200));
    
    // Convert to Markdown
    const turndownService = new TurndownService({
      headingStyle: "atx",
      hr: "---",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
    });
    turndownService.use(gfm);
    
    const markdown = turndownService.turndown(cleaned);
    console.log(`[Plain Markdown] Generated ${markdown.length} chars, has tables: ${markdown.includes("| --- |")}`);
    
    // Post-process to fix formatting issues
    const processed = postProcessMarkdown(markdown);
    
    // Remove media from the processed markdown
    const cleanedMarkdown = removeMediaFromMarkdown(processed);
    
    await Clipboard.copy(cleanedMarkdown);
    await showHUD("✅ Plain Markdown copied (media removed)!");
  } catch (error) {
    console.error("Error:", error);
    await showToast({
      style: Toast.Style.Failure,
      title: "Conversion Failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
