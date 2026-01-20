#!/usr/bin/env node

// Test script to convert input.html to markdown
const fs = require("fs");
const TurndownService = require("turndown");
const { gfm } = require("turndown-plugin-gfm");

if (!fs.existsSync("input.html")) {
  console.error("❌ input.html not found");
  console.error("   Run ./save-clipboard-html.sh first");
  process.exit(1);
}

const inputHtml = fs.readFileSync("input.html", "utf-8");
console.log("📄 Input:", (inputHtml.length / 1024).toFixed(1), "KB");

// === CONVERSION FUNCTIONS (same as extension) ===

function expandColspanRowspan(html) {
  let expanded = html;
  expanded = expanded.replace(/<(td|th)([^>]*colspan=["'](\d+)["'][^>]*)>(.*?)<\/\1>/gis, 
    (match, tagName, attrs, colspan, content) => {
      const count = parseInt(colspan);
      const looksLikeHeader = /<(strong|b|h\d)/.test(content) && content.length > 30;
      if (looksLikeHeader || count >= 4) {
        return `<${tagName}>${content}</${tagName}>`;
      }
      const cells = [];
      for (let i = 0; i < count; i++) {
        cells.push(`<${tagName}>${content}</${tagName}>`);
      }
      return cells.join("");
    }
  );
  return expanded;
}

function cleanHtmlLightweight(html) {
  let cleaned = html;
  cleaned = expandColspanRowspan(cleaned);
  cleaned = cleaned.replace(/<colgroup[^>]*>.*?<\/colgroup>/gis, "");
  
  // Preserve links
  const linkPlaceholders = [];
  let linkCounter = 0;
  
  cleaned = cleaned.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>/gi, (match, href) => {
    const marker = `___LINK_${linkCounter}___`;
    linkPlaceholders.push({ marker, href });
    linkCounter++;
    return `<a>${marker}`;
  });
  
  // Remove attributes
  cleaned = cleaned.replace(/<(\w+)(\s+[^>]+)>/g, "<$1>");
  
  // Restore links
  linkPlaceholders.forEach(({ marker, href }) => {
    cleaned = cleaned.replace(`<a>${marker}`, `<a href="${href}">`);
  });
  
  // Clean table cells
  cleaned = cleaned.replace(/<t([dh])>(<p>)*(.*?)(<\/p>)*<\/t\1>/gis, (match, tagType, _1, content, _2) => {
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
  
  // Remove wrappers
  for (let pass = 0; pass < 10; pass++) {
    cleaned = cleaned.replace(/<\/?span>/gi, "");
    cleaned = cleaned.replace(/<\/?font>/gi, "");
    cleaned = cleaned.replace(/<div[^>]*>/gi, "");
    cleaned = cleaned.replace(/<\/div>/gi, "");
  }
  
  cleaned = cleaned.replace(/>\s+</g, "><");
  
  // Add table headers
  cleaned = cleaned.replace(/<table><tbody><tr>(.*?)<\/tr>/gis, (match, firstRow) => {
    const headerRow = firstRow.replace(/<td>/gi, "<th>").replace(/<\/td>/gi, "</th>");
    return `<table><thead><tr>${headerRow}</tr></thead><tbody>`;
  });
  
  return cleaned.trim();
}

function postProcessMarkdown(markdown) {
  let fixed = markdown;
  fixed = fixed.replace(/^\*\*\s*$/gm, "");
  fixed = fixed.replace(/^\*\*\s*\n+/, "");
  fixed = fixed.replace(/\n+\s*\*\*\s*$/, "");
  fixed = fixed.replace(/\\-/g, "-");
  fixed = fixed.replace(/^\d+\.\s+$/gm, "");
  fixed = fixed.replace(/^●\s+(.+)$/gm, "-   $1");
  fixed = fixed.replace(/\n{4,}/g, "\n\n\n");
  fixed = fixed.replace(/[ \t]+$/gm, "");
  return fixed.trim();
}

// Convert
const cleaned = cleanHtmlLightweight(inputHtml);
const turndown = new TurndownService({ headingStyle: "atx", hr: "---", bulletListMarker: "-" });
turndown.use(gfm);
const markdown = turndown.turndown(cleaned);
const final = postProcessMarkdown(markdown);

// Stats
console.log("\n✅ Conversion complete!");
console.log("   Output:", (final.length / 1024).toFixed(1), "KB");
console.log("   Lines:", final.split("\n").length);
console.log("   Tables:", (final.match(/\| --- \|/g) || []).length);
console.log("   Links:", (final.match(/\[[^\]]+\]\(http[^)]+\)/g) || []).length);
console.log("   Has <table>?", final.includes("<table>") ? "❌" : "✅");

// Save
fs.writeFileSync("result.md", final);
console.log("\n💾 Saved to: result.md\n");
