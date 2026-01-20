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
 * Lightweight HTML cleaning using regex for large documents
 * EXACT SAME as convert-to-markdown.tsx
 */
function cleanHtmlLightweight(html: string): string {
  let cleaned = html;
  
  // Step 0: Expand colspan/rowspan BEFORE removing attributes
  cleaned = expandColspanRowspan(cleaned);
  
  // Step 1: Remove colgroup
  cleaned = cleaned.replace(/<colgroup[^>]*>.*?<\/colgroup>/gis, "");
  
  // Step 2: Remove ALL attributes from ALL opening tags
  cleaned = cleaned.replace(/<(\w+)(\s+[^>]+)>/g, "<$1>");
  
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
  
  // Fix 7: Remove trailing whitespace on lines
  fixed = fixed.replace(/[ \t]+$/gm, "");
  
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
    
    // Try macOS clipboard fallback if no HTML
    if (!htmlContent && clipboardContent.text) {
      try {
        const { execSync } = require("child_process");
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
