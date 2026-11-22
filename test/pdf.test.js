// Builds a small PDF laid out like a Meet Manager page and reads it back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { parseResults } from '../lib/parse.js';
import { pdfToLines } from '../lib/pdf.js';

test('PDF text is grouped into lines by Y, cells are ordered by X', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const put = (cols, y) => cols.forEach(([x, s]) => page.drawText(s, { x, y, size: 9, font }));
  put([[250, 'Test meet']], 800); put([[250, 'Ogre, 22.11.2026']], 787);
  put([[400, 'YOB 2012 - 2017'], [40, 'Event 2'], [120, 'Girls, 50m Freestyle']], 765);   // drawn out of order
  put([[40, '22.11.2026 - 12:46'], [500, 'Results']], 752);
  put([[40, 'Points: AQUA 2026']], 741);
  put([[45, 'Rank'], [280, 'YB'], [450, 'Time'], [500, 'Pts']], 725);
  put([[40, 'YOB 2016 - 2017']], 710);
  // the club overlaps the time column, as long club names do in real lists
  put([[55, '1.'], [70, 'NEIBERGA Enija Beatrise'], [280, '17'], [300, 'Cercle De Natation Sportcity Woluwe'], [440, '1:07.19'], [500, '219']], 695);
  put([[50, 'DSQ'], [70, 'BRAUNA Tija'], [280, '16'], [300, 'PK Ogre'], [440, '40.04']], 682);
  put([[70, '(Time: 13:01),'], [140, 'Starts pirms starta signala']], 671);
  put([[40, 'Splash Meet Manager, 11.85099'], [200, 'Registered to X'], [450, '22.11.2026 13:04 - Page 1']], 30);

  const lines = await pdfToLines(await doc.save());
  assert.equal(lines[2], 'Event 2\tGirls, 50m Freestyle\tYOB 2012 - 2017');
  assert.equal(lines[6], 'YOB 2016 - 2017');
  assert.ok(lines[7].startsWith('\t1.\tNEIBERGA'));

  const r = parseResults(lines);
  assert.equal(r.generated, '22.11.2026 13:04');
  assert.equal(r.groups[0].name, 'YOB 2016 - 2017');
  assert.deepEqual([r.groups[0].rows[0].club, r.groups[0].rows[0].time, r.groups[0].rows[0].points],
    ['Cercle De Natation Sportcity Woluwe', '1:07.19', 219]);
  assert.equal(r.groups[0].rows[1].status, 'DSQ');
  assert.equal(r.groups[0].rows[1].note, '(Time: 13:01), Starts pirms starta signala');
});
