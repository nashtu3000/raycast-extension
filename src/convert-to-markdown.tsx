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
  
  tables.forEach((table) => {
    if (isLayoutTable($, table)) {
      const $table = $(table);
      
      // Extract all content from table cells while preserving HTML structure
      // Use Cheerio to properly handle DOM nodes, not string manipulation
      const $replacement = $("<div></div>");
      
      $table.find("td, th").each((_, cell) => {
        // Append each cell's children (not the cell itself) to the replacement div
        $(cell).contents().each((_, node) => {
          $replacement.append($(node).clone());
        });
        // Add a line break between cells for spacing
        $replacement.append("\n");
      });
      
      // Replace the table with the extracted content
      $table.replaceWith($replacement.html() || "");
    }
  });
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
 */
function renderMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  
  const escapedRows = rows.map((row) => 
    row.map((cell) => escapePipes(cell.trim()))
  );
  
  const header = escapedRows[0];
  const divider = header.map(() => "---");
  const body = escapedRows.slice(1);
  
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${divider.join(" | ")} |`,
    ...body.map((r) => `| ${r.join(" | ")} |`),
  ];
  
  return lines.join("\n");
}

/**
 * Converts data tables to Markdown using cheerio-tableparser
 * Replaces tables with pre-rendered Markdown to prevent Turndown from processing them
 */
function convertDataTablesToMarkdown($: cheerio.CheerioAPI): void {
  // Initialize cheerio-tableparser
  cheerioTableparser.default($);
  
  $("table").each((i, table) => {
    const $table = $(table);
    
    try {
      // Parse table using cheerio-tableparser
      const data = ($table as any).parsetable(true, true, true);
      
      // Transpose from column-major to row-major
      const rows = transposeTable(data);
      
      // Render as Markdown table
      const mdTable = renderMarkdownTable(rows);
      
      // Replace with a special marker that Turndown won't process
      $table.replaceWith(`<pre data-md-table="true">${mdTable}</pre>`);
    } catch (error) {
      console.error("Error parsing table:", error);
      // Leave table as-is if parsing fails
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
 * Cleans HTML using Cheerio for proper DOM manipulation
 * Detects and unwraps layout tables, converts data tables to Markdown
 * Removes wrapper divs, inline styles, and non-semantic attributes
 */
function cleanHtml(html: string): string {
  try {
    // Load HTML with Cheerio (jQuery-like API for Node.js)
    const $ = cheerio.load(html, {
      xml: false,
    });
    
    // STEP 1: Unwrap layout tables (Google Docs wraps everything in tables)
    unwrapLayoutTables($);
    
    // STEP 2: Convert remaining data tables to Markdown
    convertDataTablesToMarkdown($);
    
    // STEP 3: Remove all wrapper divs - unwrap their content but keep the children
    $("div").each((i, elem) => {
      $(elem).replaceWith($(elem).html() || "");
    });
    
    // STEP 4: Remove inline styles from all elements
    $("*").removeAttr("style");
    
    // STEP 5: Remove class attributes (except our markdown table marker)
    $("*").each((i, elem) => {
      const $elem = $(elem);
      if (!$elem.attr("data-md-table")) {
        $elem.removeAttr("class");
      }
    });
    
    // STEP 6: Remove data-* attributes (except our markdown table marker)
    $("*").each((i, elem) => {
      const attribs = $(elem).attr();
      if (attribs) {
        Object.keys(attribs).forEach((attr) => {
          if (attr.startsWith("data-") && attr !== "data-md-table") {
            $(elem).removeAttr(attr);
          }
        });
      }
    });
    
    // STEP 7: Remove id attributes (except from links for anchors)
    $("*:not(a)").removeAttr("id");
    
    // Get the cleaned HTML
    return $.html().trim();
  } catch (error) {
    console.error("Error cleaning HTML with Cheerio:", error);
    // Fallback to basic regex cleaning
    return html
      .replace(/<div[^>]*>/gi, "")
      .replace(/<\/div>/gi, "")
      .replace(/\s+style="[^"]*"/gi, "")
      .replace(/\s+class="[^"]*"/gi, "")
      .trim();
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
      // Return the Markdown table as-is, with proper spacing
      return "\n\n" + content + "\n\n";
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
