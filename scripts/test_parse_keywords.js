const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

async function run() {
    const p = path.join(__dirname, '../../frontend/public/pdf biospectra/1-8_1779268559178.pdf');
    const dataBuffer = fs.readFileSync(p);
    const data = await pdfParse(dataBuffer);
    
    const lines = data.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const kwIndex = lines.findIndex(l => l.toLowerCase().includes('key word') || l.toLowerCase().includes('keywords'));
    if (kwIndex !== -1) {
        console.log("Lines around Keywords:");
        for(let i=kwIndex-2; i<=kwIndex+5; i++) {
            if(lines[i]) console.log(`[${i}] ${lines[i]}`);
        }
    } else {
        console.log("Keywords not found in text!");
    }
}
run();
