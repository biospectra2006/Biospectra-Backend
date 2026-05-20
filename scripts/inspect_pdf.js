const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

async function run() {
  const dir = path.join(__dirname, '../../frontend/public/assets/Pdf Biospectra/13 march/animal');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf')).sort();
  
  for (const f of files.slice(0, 2)) {
    console.log(`\n========== ${f} ==========`);
    const buf = fs.readFileSync(path.join(dir, f));
    const data = await pdfParse(buf);
    const lines = data.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    console.log(lines.slice(0, 60).join('\n'));
    console.log(`\n--- TOTAL LINES: ${lines.length} ---`);
  }
}
run();
