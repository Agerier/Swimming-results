// Turns a PDF into text lines. Text items are grouped into lines by their Y coordinate
// and ordered by X. Meet Manager draws every table cell as its own text item, so cells
// are joined with a TAB: columns never stick together ("Woluwe1:07.19") and the parser
// does not have to guess where a name ends and a club begins.
// A line that starts to the right of the page margin gets a leading TAB. That is how
// a sub-group heading (at the margin) differs from a DSQ reason (indented).
// Pages are separated by a form feed line.
import { getDocumentProxy } from 'unpdf';

export async function pdfToLines(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => typeof it.str === 'string' && it.str.trim().length)
      .map((it) => ({
        str: it.str.replace(/\s+/g, ' ').trim(),
        x: it.transform[4], y: it.transform[5],
        h: Math.abs(it.transform[3]) || it.height || 8,
      }));
    const rows = [];
    for (const it of items) {
      let row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, Math.min(r.h, it.h) * 0.3));
      if (!row) { row = { y: it.y, h: it.h, items: [] }; rows.push(row); }
      row.items.push(it);
    }
    rows.sort((a, b) => b.y - a.y);
    for (const row of rows) row.items.sort((a, b) => a.x - b.x);
    // The page footer ("Splash Meet Manager, ...") is the lowest line and sits at the margin.
    const margin = rows.length ? rows[rows.length - 1].items[0].x : 0;
    for (const row of rows) {
      const indent = row.items[0].x > margin + 2 ? '\t' : '';
      lines.push(indent + row.items.map((it) => it.str).join('\t'));
    }
    if (p < pdf.numPages) lines.push('\f'); // page break
  }
  return lines;
}
