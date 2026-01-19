import { Clipboard, showHUD, showToast, Toast } from "@raycast/api";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import * as cheerio from "cheerio";
import * as cheerioTableparser from "cheerio-tableparser";

/**
 * Detects if a table is a layout table (used for positioning) vs a data table
 * Layout tables typically have single columns or contain complex nested structures
 */
function isLayoutTable($: cheerio.CheerioAPI, table: any): boolean {
  const $table = $(table);
  const rows = $table.find("tr");
  
  if (rows.length === 0) return false;
  
  // Single column tables are almost always layout tables
  const firstRowCells = rows.first().find("td, th").length;
  if (firstRowCells === 1) return true;
  
  // Check for complex nested structures that indicate a layout table
  // Layout tables typically contain headings (h1-h6) or lists (ul, ol) directly
  const hasHeadings = $table.find("h1, h2, h3, h4, h5, h6").length > 0;
  const hasLists = $table.find("ul, ol").length > 0;
  
  // If table has headings or lists, it's likely a layout table
  if (hasHeadings || hasLists) return true;
  
  // Check if table has very few rows compared to columns (wide but short = likely data table)
  const avgCellsPerRow = $table.find("td, th").length / rows.length;
  if (avgCellsPerRow >= 3 && rows.length >= 2) {
    // This looks like a data table (multiple columns, multiple rows)
    return false;
  }
  
  // Check if cells contain only simple content (even if wrapped in <p> tags)
  // Data table cells typically have short, simple content
  let hasComplexContent = false;
  $table.find("td, th").each((_, cell) => {
    const $cell = $(cell);
    // Check if cell contains nested tables or multiple block elements
    const nestedTables = $cell.find("table").length;
    const blockElements = $cell.find("p, div").length;
    
    if (nestedTables > 0 || blockElements > 2) {
      hasComplexContent = true;
      return false; // break the each loop
    }
  });
  
  if (hasComplexContent) return true;
  
  return false;
}

/**
 * Unwraps layout tables by extracting their content
 * This prevents Google Docs layout tables from being converted to Markdown tables
 */
function unwrapLayoutTables($: cheerio.CheerioAPI): void {
  // Process tables from innermost to outermost (to handle nested tables)
  const tables = $("table").toArray().reverse();
  
  let layoutTablesUnwrapped = 0;
  let dataTablesPreserved = 0;
  
  tables.forEach((table) => {
    if (isLayoutTable($, table)) {
      layoutTablesUnwrapped++;
      const $table = $(table);
      
      // Simply unwrap: remove the table element but keep all its descendants
      // Use Cheerio's native unwrap functionality on table structure elements
      $table.find("tbody, thead, tfoot").each((_, elem) => {
        $(elem).replaceWith($(elem).children());
      });
      
      $table.find("tr").each((_, elem) => {
        $(elem).replaceWith($(elem).children());
      });
      
      $table.find("td, th").each((_, elem) => {
        $(elem).replaceWith($(elem).children());
      });
      
      // Finally, unwrap the table itself
      $table.replaceWith($table.children());
    } else {
      dataTablesPreserved++;
    }
  });
  
  console.log(`Table analysis: ${layoutTablesUnwrapped} layout tables unwrapped, ${dataTablesPreserved} data tables preserved`);
}

/**
 * Transposes a table from column-major to row-major format
 */
function transposeTable(data: string[][]): string[][] {
  if (data.length === 0) return [];
  const rows: string[][] = [];
  const numRows = data[0].length;
  const numCols = data.length;
  
  for (let r = 0; r < numRows; r++) {
    const row: string[] = [];
    for (let c = 0; c < numCols; c++) {
      row.push(data[c][r] || "");
    }
    rows.push(row);
  }
  
  return rows;
}

/**
 * Escapes pipe characters in table cells to prevent breaking Markdown tables
 */
function escapePipes(text: string): string {
  return text.replace(/\|/g, "\\|");
}

/**
 * Renders a 2D array as a Markdown table
 * Handles empty cells and ensures proper formatting
 */
function renderMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  
  // Clean and escape all cells, replacing empty/whitespace-only cells with a space
  const escapedRows = rows.map((row) => 
    row.map((cell) => {
      const cleaned = cell.trim().replace(/^(&nbsp;|\s)+$/, "");
      return cleaned ? escapePipes(cleaned) : " ";
    })
  );
  
  const header = escapedRows[0];
  const divider = header.map(() => "---");
  const body = escapedRows.slice(1);
  
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${divider.join(" | ")} |`,
    ...body.map((r) => `| ${r.join(" | ")} |`),
  ];
  
  return "\n\n" + lines.join("\n") + "\n\n";
}

/**
 * Converts data tables to Markdown using cheerio-tableparser
 * Replaces tables with pre-rendered Markdown to prevent Turndown from processing them
 */
function convertDataTablesToMarkdown($: cheerio.CheerioAPI): void {
  // Initialize cheerio-tableparser
  cheerioTableparser.default($);
  
  const tablesFound = $("table").length;
  let tablesConverted = 0;
  let tablesFailed = 0;
  
  $("table").each((i, table) => {
    const $table = $(table);
    
    try {
      // Parse table using cheerio-tableparser
      const data = ($table as any).parsetable(true, true, true);
      
      // Transpose from column-major to row-major
      const rows = transposeTable(data);
      
      console.log(`Table ${i + 1}: ${rows.length} rows x ${rows[0]?.length || 0} columns`);
      
      // Render as Markdown table
      const mdTable = renderMarkdownTable(rows);
      
      // Replace with a special marker that Turndown won't process
      $table.replaceWith(`<pre data-md-table="true">${mdTable}</pre>`);
      tablesConverted++;
    } catch (error) {
      console.error(`Error parsing table ${i + 1}:`, error);
      tablesFailed++;
      // Leave table as-is if parsing fails
    }
  });
  
  console.log(`Converted ${tablesConverted}/${tablesFound} tables to Markdown (${tablesFailed} failed)`);
}

/**
 * Detects if HTML needs style-to-semantic conversion
 * Checks for Google Docs class patterns or inline font-weight styles
 */
function needsStyleConversion(html: string): boolean {
  // Google Docs uses class patterns like c1, c2, c11, c17, etc.
  const hasGoogleDocsClasses = /class="c\d+/.test(html);
  
  // Check for inline font-weight styles in spans
  const hasInlineStyles = /<span[^>]*style="[^"]*font-weight/.test(html);
  
  return hasGoogleDocsClasses || hasInlineStyles;
}

/**
 * Converts inline style-based and class-based styling to semantic HTML
 * Handles both Google Docs class patterns and inline font-weight styles
 * Memory-optimized: processes DOM directly without creating new cheerio instances
 */
function convertStylesToSemanticHtml($: cheerio.CheerioAPI): void {
  // Process all spans to detect bold text from styles or classes
  $("span").each((_, span) => {
    const $span = $(span);
    const classNames = $span.attr("class") || "";
    const style = $span.attr("style") || "";
    
    // Check if this span represents bold text
    // Covers: font-weight: 500, 600, 700, bold
    const isBold = 
      /font-weight\s*:\s*(500|600|700|bold)/.test(style) ||
      /c\d+.*c\d+/.test(classNames) || // Multiple classes often = bold (Google Docs)
      /c1[0-9]/.test(classNames); // c11, c17, etc. are often bold in Google Docs
    
    // Check if this span represents italic text
    const isItalic = 
      /font-style\s*:\s*italic/.test(style) ||
      classNames.includes("italic");
    
    if (isBold && !$span.parent().is("strong")) {
      // Wrap content in <strong> and replace the span (if not already in <strong>)
      const content = $span.html();
      $span.replaceWith(`<strong>${content}</strong>`);
    } else if (isItalic && !$span.parent().is("em, i")) {
      // Wrap content in <em> and replace the span (if not already in <em>/<i>)
      const content = $span.html();
      $span.replaceWith(`<em>${content}</em>`);
    } else if (!isBold && !isItalic && !style && !classNames) {
      // Remove empty/useless spans with no formatting
      const content = $span.html();
      $span.replaceWith(content || "");
    }
  });
}

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
 * Lightweight HTML cleaning using regex for large documents
 * Avoids memory issues with Cheerio on large HTML
 */
function cleanHtmlLightweight(html: string): string {
  let cleaned = html;
  
  console.log("Running lightweight cleaning");
  
  // Step 1: Remove colgroup entirely
  cleaned = cleaned.replace(/<colgroup>.*?<\/colgroup>/gis, "");
  
  // Step 2: Remove all attributes from all tags (aggressive but necessary)
  cleaned = cleaned.replace(/<(\w+)\s+[^>]*>/g, "<$1>");
  
  // Step 3: Remove nested wrapper tags that interfere with table recognition
  // Remove p, span, and br tags completely (run multiple times for nested structures)
  for (let i = 0; i < 5; i++) {
    cleaned = cleaned.replace(/<p[^>]*>/gi, "");
    cleaned = cleaned.replace(/<\/p>/gi, " ");
    cleaned = cleaned.replace(/<span[^>]*>/gi, "");
    cleaned = cleaned.replace(/<\/span>/gi, "");
    cleaned = cleaned.replace(/<br[^>]*\/?>/gi, " ");
    cleaned = cleaned.replace(/<div[^>]*>/gi, "");
    cleaned = cleaned.replace(/<\/div>/gi, "");
  }
  
  // Step 4: Clean whitespace around cell content
  cleaned = cleaned.replace(/<td>\s+/gi, "<td>");
  cleaned = cleaned.replace(/\s+<\/td>/gi, "</td>");
  cleaned = cleaned.replace(/<th>\s+/gi, "<th>");
  cleaned = cleaned.replace(/\s+<\/th>/gi, "</th>");
  
  // Step 5: Convert first row to headers
  cleaned = cleaned.replace(/<table><tbody><tr>/i, "<table><thead><tr>");
  cleaned = cleaned.replace(/(<table><thead><tr>)(.*?)(<\/tr>)/is, (match, start, row, end) => {
    const headerRow = row.replace(/<td>/gi, "<th>").replace(/<\/td>/gi, "</th>");
    return start + headerRow + end + "</thead><tbody>";
  });
  
  // Step 6: Clean up multiple spaces/newlines
  cleaned = cleaned.replace(/\s{2,}/g, " ");
  cleaned = cleaned.replace(/>\s+</g, "><");
  
  console.log("Lightweight cleaning complete");
  return cleaned.trim();
}

/**
 * Cleans HTML using Cheerio for proper DOM manipulation
 * For large documents, uses lightweight regex processing
 */
function cleanHtml(html: string): string {
  try {
    const htmlSize = html.length;
    console.log(`Processing HTML: ${(htmlSize / 1024).toFixed(1)} KB`);
    
    // For large HTML (>300KB), use lightweight regex processing to avoid OOM
    if (htmlSize > 300 * 1024) {
      console.log("Large document - using lightweight regex cleaning");
      return cleanHtmlLightweight(html);
    }
    
    // Normal processing for smaller documents
    const $ = cheerio.load(html, { xml: false });
    
    if (needsStyleConversion(html)) {
      console.log("Converting styles to semantic tags");
      convertStylesToSemanticHtml($);
    }
    
    unwrapLayoutTables($);
    convertDataTablesToMarkdown($);
    
    // Clean attributes
    $("div").each((_, elem) => $(elem).replaceWith($(elem).html() || ""));
    $("*").removeAttr("style").removeAttr("class").removeAttr("id");
    
    return $.html().trim();
  } catch (error) {
    console.error("Error in cleanHtml:", error);
    return cleanHtmlLightweight(html);
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

  // Custom rule: Preserve pre-converted Markdown tables
  turndownService.addRule("mdTablePlaceholder", {
    filter: (node: any) => {
      return (
        node.nodeName === "PRE" &&
        node.getAttribute("data-md-table") === "true"
      );
    },
    replacement: (content: string) => {
      // Return the Markdown table as-is (already has spacing from renderMarkdownTable)
      return content;
    },
  });

  // Custom rule: Preserve line breaks
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
 * Detects if text contains tables with tab-separated values
 * Relaxed detection to work with Google Docs plain text exports
 */
function isTsvContent(text: string): boolean {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return false;
  
  // Count lines with tabs
  const linesWithTabs = lines.filter((line) => line.includes("\t"));
  
  // Need at least 2 lines with tabs to be considered a table
  if (linesWithTabs.length < 2) return false;
  
  // Check if there are multiple consecutive lines with tabs (table rows)
  let consecutiveTabbedLines = 0;
  let maxConsecutive = 0;
  
  for (const line of lines) {
    if (line.includes("\t")) {
      consecutiveTabbedLines++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveTabbedLines);
    } else {
      consecutiveTabbedLines = 0;
    }
  }
  
  // If we have at least 2 consecutive tabbed lines, it's likely a table
  return maxConsecutive >= 2;
}

/**
 * Converts mixed content with embedded TSV tables to HTML
 * Handles Google Docs plain text exports with tables
 */
function convertMixedTsvToHtml(text: string): string {
  const lines = text.split("\n");
  let html = "";
  let inTable = false;
  let tableLines: string[] = [];
  let tableCount = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hasTab = line.includes("\t");
    
    // Check if next line also has tabs (table continues)
    const nextHasTab = i < lines.length - 1 && lines[i + 1].includes("\t");
    
    if (hasTab) {
      // We're in a table
      if (!inTable) {
        inTable = true;
        tableLines = [];
      }
      tableLines.push(line);
      
      // If next line doesn't have tabs or it's the last line, close the table
      if (!nextHasTab || i === lines.length - 1) {
        const tableHtml = convertTableLinesToHtml(tableLines);
        html += tableHtml;
        tableCount++;
        console.log(`Converted table ${tableCount}: ${tableLines.length} rows`);
        inTable = false;
        tableLines = [];
      }
    } else {
      // Regular text line
      if (line.trim()) {
        // Try to detect headings from formatting patterns
        if (line.match(/^\d+\.\s+[A-Z]/)) {
          // Numbered heading like "1. Executive Summary"
          html += `<h1>${escapeHtml(line.trim())}</h1>\n`;
        } else if (line.match(/^\d+\.\d+\s+/)) {
          // Sub-heading like "1.1 Core Methodology"
          html += `<h2>${escapeHtml(line.trim())}</h2>\n`;
        } else if (line.match(/^\d+\.\d+\.\d+\s+/)) {
          // Sub-sub-heading like "1.1.1 Target Population"
          html += `<h3>${escapeHtml(line.trim())}</h3>\n`;
        } else if (line.match(/^[A-Z][a-z]+.*:$/)) {
          // Bold-like heading that ends with colon like "Pilot sample:"
          html += `<p><strong>${escapeHtml(line.trim())}</strong></p>\n`;
        } else if (line.match(/^(●|•|-|\*)\s+/)) {
          // Bullet point
          const content = line.replace(/^(●|•|-|\*)\s+/, "").trim();
          html += `<ul><li>${escapeHtml(content)}</li></ul>\n`;
        } else {
          html += `<p>${escapeHtml(line.trim())}</p>\n`;
        }
      } else {
        html += "\n";
      }
    }
  }
  
  console.log(`Total tables converted from plain text: ${tableCount}`);
  return html;
}

/**
 * Converts a set of tab-separated lines to an HTML table
 */
function convertTableLinesToHtml(lines: string[]): string {
  if (lines.length === 0) return "";
  
  let html = '<table>\n';
  
  // First row as headers
  const headerCells = lines[0].split("\t");
  html += '<thead>\n<tr>\n';
  headerCells.forEach((cell) => {
    html += `<th>${escapeHtml(cell.trim())}</th>\n`;
  });
  html += '</tr>\n</thead>\n';
  
  // Rest of the rows as data
  if (lines.length > 1) {
    html += '<tbody>\n';
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split("\t");
      html += '<tr>\n';
      cells.forEach((cell) => {
        html += `<td>${escapeHtml(cell.trim())}</td>\n`;
      });
      html += '</tr>\n';
    }
    html += '</tbody>\n';
  }
  
  html += '</table>\n';
  return html;
}

/**
 * Escapes HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
      console.log("Using HTML from Raycast API");
    }
    // Smart fallback: check if plain text contains HTML tags (like when pasting into terminal)
    else if (clipboardContent.text && looksLikeHtml(clipboardContent.text)) {
      htmlContent = clipboardContent.text;
      console.log("Detected HTML in plain text");
    }
    // macOS fallback: Try to get HTML directly from system clipboard
    // Raycast API sometimes doesn't detect HTML from Google Docs
    else if (clipboardContent.text) {
      try {
        const { execSync } = require("child_process");
        const result = execSync("osascript -e 'the clipboard as «class HTML»'", {
          encoding: "buffer",
          timeout: 5000,
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large HTML
        });
        
        // The result is hex-encoded HTML data prefixed with «data HTML
        const htmlHex = result.toString().replace(/«data HTML|»/g, "").trim();
        
        if (htmlHex && htmlHex !== "missing value" && htmlHex.length > 20) {
          // Convert hex to string
          const htmlFromClipboard = Buffer.from(htmlHex, "hex").toString("utf-8");
          if (htmlFromClipboard && htmlFromClipboard.includes("<")) {
            htmlContent = htmlFromClipboard;
            console.log(`Retrieved HTML from macOS clipboard directly (${htmlFromClipboard.length} bytes)`);
          }
        }
      } catch (error: any) {
        // Even if there's an ENOBUFS error, the stdout might have the data
        if (error.stdout) {
          try {
            const htmlHex = error.stdout.toString().replace(/«data HTML|»/g, "").trim();
            if (htmlHex && htmlHex !== "missing value" && htmlHex.length > 20) {
              const htmlFromClipboard = Buffer.from(htmlHex, "hex").toString("utf-8");
              if (htmlFromClipboard && htmlFromClipboard.includes("<")) {
                htmlContent = htmlFromClipboard;
                console.log(`Retrieved HTML from error.stdout (${htmlFromClipboard.length} bytes)`);
              }
            }
          } catch (parseError) {
            console.log("Could not parse HTML from error.stdout");
          }
        } else {
          console.log("Could not retrieve HTML from macOS clipboard:", error.message);
        }
      }
    }
    // Spreadsheet/table fallback: check if plain text contains TSV (tab-separated values)
    else if (clipboardContent.text && isTsvContent(clipboardContent.text)) {
      console.log("Detected TSV/table content in plain text");
      htmlContent = convertMixedTsvToHtml(clipboardContent.text);
      await showHUD("📄 Converting formatted text with tables to Markdown...");
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
