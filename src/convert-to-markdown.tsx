import { Clipboard, showHUD, showToast, Toast, environment } from "@raycast/api";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { writeFileSync } from "fs";
import { join } from "path";
import { JSDOM } from "jsdom";

/**
 * Detects if HTML looks like it's from a spreadsheet (Google Sheets, Excel, etc.)
 */
function isSpreadsheetContent(html: string): boolean {
  // Check for Google Sheets specific attributes
  if (html.includes("data-sheets-")) {
    return true;
  }
  
  // Check if it's just a table with no other content (typical of copied spreadsheets)
  const stripped = html.replace(/\s+/g, " ").trim();
  const startsWithTable = /^<table/i.test(stripped);
  const hasOnlyTable = !/<(p|div|h[1-6]|article|section)[^>]*>/i.test(stripped);
  
  return startsWithTable && hasOnlyTable;
}

/**
 * Converts first row of table cells to header cells
 */
function convertFirstRowToHeaders(html: string): string {
  // Match the first <tr> and its contents
  return html.replace(
    /(<table[^>]*>(?:<colgroup>.*?<\/colgroup>)?(?:<caption>.*?<\/caption>)?(?:<tbody[^>]*>)?)\s*<tr[^>]*>(.*?)<\/tr>/is,
    (match, beforeFirstRow, firstRowContent) => {
      // Convert all <td> to <th> in the first row
      const headerRow = firstRowContent.replace(/<td([^>]*)>/gi, "<th$1>").replace(/<\/td>/gi, "</th>");
      
      // Wrap in <thead> if not already in one
      return `${beforeFirstRow}<thead><tr>${headerRow}</tr></thead><tbody>`;
    }
  );
}

/**
 * Extracts semantic content using DOM parsing, preserving document structure
 */
function cleanHtml(html: string): string {
  try {
    // Parse HTML with jsdom (minimal config to avoid resource loading errors)
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Remove all wrapper divs but keep their content
    const allDivs = document.querySelectorAll("div");
    allDivs.forEach((div) => {
      // Replace the div with its children
      while (div.firstChild) {
        div.parentNode?.insertBefore(div.firstChild, div);
      }
      div.remove();
    });
    
    // Remove inline styles, classes, and data attributes from all elements
    const allElements = document.querySelectorAll("*");
    allElements.forEach((el) => {
      el.removeAttribute("style");
      el.removeAttribute("class");
      // Remove data attributes
      Array.from(el.attributes).forEach((attr) => {
        if (attr.name.startsWith("data-")) {
          el.removeAttribute(attr.name);
        }
      });
    });
    
    // Get the cleaned HTML from body
    const body = document.body;
    return body ? body.innerHTML.trim() : html;
  } catch (error) {
    console.error("Error parsing HTML with jsdom:", error);
    // Fallback to simple regex cleaning
    let cleaned = html;
    cleaned = cleaned.replace(/<div[^>]*>/gi, "");
    cleaned = cleaned.replace(/<\/div>/gi, "");
    cleaned = cleaned.replace(/\s+style="[^"]*"/gi, "");
    cleaned = cleaned.replace(/\s+class="[^"]*"/gi, "");
    cleaned = cleaned.replace(/\s+data-[a-z-]+="[^"]*"/gi, "");
    return cleaned.trim();
  }
}

/**
 * Converts HTML to Markdown using Turndown with GitHub Flavored Markdown support
 */
function convertToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "_",
    strongDelimiter: "**",
  });

  // Add GitHub Flavored Markdown support (tables, strikethrough, task lists)
  turndownService.use(gfm);

  // Custom rules for better conversion
  turndownService.addRule("preserveLineBreaks", {
    filter: ["br"],
    replacement: () => "  \n",
  });

  return turndownService.turndown(html);
}

/**
 * Checks if a string contains HTML tags
 */
function looksLikeHtml(text: string): boolean {
  const htmlTagPattern = /<\s*([a-z][a-z0-9]*)\b[^>]*>/i;
  return htmlTagPattern.test(text);
}

/**
 * Detects if text is tab-separated values (TSV) from a spreadsheet
 */
function isTsvContent(text: string): boolean {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return false;
  
  // Check if at least 2 lines have tabs
  const linesWithTabs = lines.filter((line) => line.includes("\t")).length;
  return linesWithTabs >= 2;
}

/**
 * Converts TSV (tab-separated values) to HTML table with first row as headers
 */
function tsvToHtmlTable(tsv: string): string {
  const lines = tsv.trim().split("\n");
  if (lines.length === 0) return "";
  
  let html = '<table>\n';
  
  // First row as headers
  const headerCells = lines[0].split("\t");
  html += '<thead>\n<tr>\n';
  headerCells.forEach((cell) => {
    html += `<th>${cell.trim()}</th>\n`;
  });
  html += '</tr>\n</thead>\n';
  
  // Rest of the rows as data
  if (lines.length > 1) {
    html += '<tbody>\n';
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split("\t");
      html += '<tr>\n';
      cells.forEach((cell) => {
        html += `<td>${cell.trim()}</td>\n`;
      });
      html += '</tr>\n';
    }
    html += '</tbody>\n';
  }
  
  html += '</table>';
  return html;
}

export default async function Command() {
  try {
    // Read clipboard content
    const clipboardContent = await Clipboard.read();

    let htmlContent: string | undefined;

    // Debug: Log what's in the clipboard
    console.log("Clipboard content available:", {
      hasHtml: !!clipboardContent.html,
      hasText: !!clipboardContent.text,
      hasFile: !!clipboardContent.file,
      textLength: clipboardContent.text?.length,
      htmlLength: clipboardContent.html?.length,
    });

    // Check if HTML content is available as rich format
    if (clipboardContent.html) {
      htmlContent = clipboardContent.html;
      console.log("Using HTML from rich format");
    }
    // Smart fallback: check if plain text contains HTML tags
    else if (clipboardContent.text && looksLikeHtml(clipboardContent.text)) {
      htmlContent = clipboardContent.text;
      console.log("Detected HTML in plain text");
    }
    // Spreadsheet fallback: check if plain text is TSV (tab-separated values)
    else if (clipboardContent.text && isTsvContent(clipboardContent.text)) {
      console.log("Detected TSV content from spreadsheet");
      htmlContent = tsvToHtmlTable(clipboardContent.text);
      await showHUD("📊 Detected spreadsheet data, converting to Markdown...");
    }
    // No HTML found anywhere
    else {
      if (clipboardContent.text) {
        console.log("Plain text only, no HTML or TSV detected");
        console.log("Text preview:", clipboardContent.text.substring(0, 200));
        await showHUD(
          "⚠️ No rich text or HTML found - clipboard contains plain text only",
        );
      } else {
        await showToast({
          style: Toast.Style.Failure,
          title: "Empty Clipboard",
          message: "Please copy some rich text content first",
        });
      }
      return;
    }

    // Detect if this is spreadsheet content and enhance it
    let processedHtml = htmlContent;
    if (isSpreadsheetContent(htmlContent)) {
      console.log("Detected spreadsheet content, converting first row to headers");
      processedHtml = convertFirstRowToHeaders(htmlContent);
    }

    // Clean the HTML
    const cleanedHtml = cleanHtml(processedHtml);
    
    // DEBUG: Save cleaned HTML to temp file for inspection
    try {
      const debugPath = join(environment.supportPath, "debug-cleaned.html");
      writeFileSync(debugPath, cleanedHtml, "utf-8");
      console.log("Saved cleaned HTML to:", debugPath);
    } catch (e) {
      console.log("Could not save debug file:", e);
    }
    
    console.log("Cleaned HTML preview:", cleanedHtml.substring(0, 500));

    // Convert to Markdown - Turndown handles messy HTML well
    const markdown = convertToMarkdown(cleanedHtml);
    
    console.log("Markdown preview:", markdown.substring(0, 500));

    // Copy Markdown back to clipboard
    await Clipboard.copy(markdown);

    // Show success message
    await showHUD("✅ Markdown copied to clipboard!");
  } catch (error) {
    console.error("Error converting clipboard to Markdown:", error);

    await showToast({
      style: Toast.Style.Failure,
      title: "Conversion Failed",
      message:
        error instanceof Error ? error.message : "Unknown error occurred",
    });
  }
}
