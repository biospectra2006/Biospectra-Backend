const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

async function run() {
    const p = path.join(__dirname, '../../frontend/public/pdf biospectra/1-8_1779268559178.pdf');
    const dataBuffer = fs.readFileSync(p);
    const data = await pdfParse(dataBuffer);
    
    const lines = data.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const titleIndex = lines.findIndex(l => l.includes('Assessment of acute toxicity and'));
    if (titleIndex !== -1) {
        console.log("Lines around title:");
        for(let i=titleIndex-2; i<=titleIndex+20; i++) {
            if(lines[i]) console.log(`[${i}] ${lines[i]}`);
        }
    } else {
        console.log("Title not found in text!");
    }
}
run();
