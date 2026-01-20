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
 * Avoids memory issues with Cheerio on large HTML
 */
function cleanHtmlLightweight(html: string): string {
  console.log("Running lightweight cleaning...");
  let cleaned = html;
  
  // Step -2: Remove icon elements (Font Awesome, Material Icons, etc.)
  // These are empty <i> or <span> tags with icon classes, no text content
  cleaned = cleaned.replace(/<i[^>]*class="[^"]*fa[^"]*"[^>]*><\/i>/gi, "");
  cleaned = cleaned.replace(/<i[^>]*class="[^"]*icon[^"]*"[^>]*><\/i>/gi, "");
  cleaned = cleaned.replace(/<span[^>]*class="[^"]*icon[^"]*"[^>]*><\/span>/gi, "");
  
  // Step -1: Remove Google Docs wrapper elements at the very beginning
  // Google Docs adds meta tags and wraps in <b style="font-weight:normal;" id="docs-internal-guid-...">
  cleaned = cleaned.replace(/^(<meta[^>]*>)+/gi, "");
  cleaned = cleaned.replace(/^<b[^>]*docs-internal-guid[^>]*>/i, "");
  
  // Step 0: Convert inline styles to semantic tags FIRST (before removing attributes)
  cleaned = convertInlineStylesToSemantic(cleaned);
  console.log("Converted inline styles to semantic HTML");
  
  // Step 1: Expand colspan/rowspan BEFORE removing attributes
  cleaned = expandColspanRowspan(cleaned);
  console.log("Expanded colspan/rowspan attributes");
  
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
  
  console.log("Lightweight cleaning complete - sample:", cleaned.substring(cleaned.indexOf("<table>"), cleaned.indexOf("<table>") + 200));
  return cleaned.trim();
}

/**
 * Cleans HTML - ALWAYS use lightweight mode for Google Docs
 */
function cleanHtml(html: string): string {
  const htmlSize = html.length;
  console.log(`\n=== [v2026.01.20-FIXED] Processing HTML: ${(htmlSize / 1024).toFixed(1)} KB ===`);
  
  // ALWAYS use lightweight cleaning for Google Docs HTML (it's always messy)
  // Cheerio is too memory intensive and the lightweight version works fine
  const cleaned = cleanHtmlLightweight(html);
  
  console.log(`=== [v2026.01.20-FIXED] Cleaning complete, output size: ${(cleaned.length / 1024).toFixed(1)} KB ===\n`);
  return cleaned;
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

  const markdown = turndownService.turndown(html);
  
  // Post-process to fix common issues
  return postProcessMarkdown(markdown);
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
  console.log("\n\n🚀 [v2026.01.20-FIXED] === EXTENSION STARTED ===\n");
  
  // Debug: Write to file to prove execution
  try {
    const fs = require("fs");
    fs.writeFileSync("/tmp/raycast-debug.txt", `Extension started at ${new Date().toISOString()}\n`, { flag: "a" });
  } catch (e) {
    // Ignore file write errors
  }
  
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
    // Platform-specific fallback: Try to get HTML directly from system clipboard
    // Raycast API sometimes doesn't detect HTML from Google Docs
    else if (clipboardContent.text) {
      const { execSync } = require("child_process");
      const os = require("os");
      const platform = os.platform();
      
      if (platform === "darwin") {
        // macOS: Use AppleScript
        try {
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
      } else if (platform === "win32") {
        // Windows: Use PowerShell to get HTML from clipboard
        // Write script to temp file to avoid escaping issues
        const fs = require("fs");
        const path = require("path");
        const tempDir = os.tmpdir();
        const scriptPath = path.join(tempDir, "raycast-get-clipboard.ps1");
        const outputPath = path.join(tempDir, "raycast-clipboard-output.txt");
        
        const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$clip = [System.Windows.Forms.Clipboard]
if ($clip::ContainsText([System.Windows.Forms.TextDataFormat]::Html)) {
    $html = $clip::GetText([System.Windows.Forms.TextDataFormat]::Html)
    [System.IO.File]::WriteAllText("${outputPath.replace(/\\/g, "\\\\")}", $html, [System.Text.Encoding]::UTF8)
}
`;
        try {
          fs.writeFileSync(scriptPath, psScript, "utf-8");
          
          // Delete old output file if exists
          try { fs.unlinkSync(outputPath); } catch (e) { /* ignore */ }
          
          execSync(`powershell -sta -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, {
            timeout: 10000,
            windowsHide: true,
          });
          
          // Read the output file
          if (fs.existsSync(outputPath)) {
            const result = fs.readFileSync(outputPath, "utf-8");
            console.log("Windows clipboard result length:", result?.length || 0);
            
            if (result && result.includes("<")) {
              // Windows CF_HTML format includes a header - extract just the HTML
              const htmlMatch = result.match(/<html[^>]*>[\s\S]*<\/html>/i);
              if (htmlMatch) {
                htmlContent = htmlMatch[0];
                console.log(`Retrieved HTML from Windows clipboard (${htmlMatch[0].length} bytes)`);
              } else {
                // Try fragment markers (Google Docs uses these)
                const fragmentMatch = result.match(/<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i);
                if (fragmentMatch) {
                  htmlContent = fragmentMatch[1];
                  console.log(`Retrieved HTML fragment from Windows clipboard (${fragmentMatch[1].length} bytes)`);
                } else {
                  // Use everything after the header
                  const htmlStart = result.indexOf("<");
                  if (htmlStart >= 0) {
                    const extracted = result.substring(htmlStart);
                    htmlContent = extracted;
                    console.log(`Retrieved raw HTML from Windows clipboard (${extracted.length} bytes)`);
                  }
                }
              }
            }
            // Cleanup
            try { fs.unlinkSync(outputPath); } catch (e) { /* ignore */ }
          } else {
            console.log("No HTML output file created - clipboard may not contain HTML");
          }
          // Cleanup script
          try { fs.unlinkSync(scriptPath); } catch (e) { /* ignore */ }
        } catch (error: any) {
          console.log("Could not retrieve HTML from Windows clipboard:", error.message);
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

    // TypeScript guard: htmlContent is definitely defined here
    if (!htmlContent) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No Content",
        message: "No HTML content available to convert",
      });
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
    console.log("Markdown length:", markdown.length, "chars");
    console.log("Contains <table>?", markdown.includes("<table>"));
    console.log("Contains | --- |?", markdown.includes("| --- |"));

    // Debug: Write markdown to file to verify it was generated
    try {
      const fs = require("fs");
      fs.writeFileSync("/tmp/raycast-markdown-output.txt", markdown);
      fs.appendFileSync("/tmp/raycast-debug.txt", `Markdown generated: ${markdown.length} chars, contains tables: ${markdown.includes("| --- |")}\n`);
    } catch (e) {
      // Ignore file write errors
    }

    // Copy Markdown back to clipboard
    await Clipboard.copy(markdown);
    console.log("✅ Markdown copied to clipboard successfully!");

    // Show success message
    await showHUD("✅ Markdown copied to clipboard!");
  } catch (error) {
    console.error("❌ [v2026.01.20-FIXED] ERROR:", error);
    console.error("Error stack:", error instanceof Error ? error.stack : "No stack");

    await showToast({
      style: Toast.Style.Failure,
      title: "Conversion Failed",
      message:
        error instanceof Error ? error.message : "Unknown error occurred",
    });
  }
  console.log("\n🏁 [v2026.01.20-FIXED] === EXTENSION FINISHED ===\n\n");
}
