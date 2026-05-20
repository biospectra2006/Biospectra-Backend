const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

async function run() {
    const p = path.join(__dirname, '../../frontend/public/pdf biospectra/1-8_1779268559178.pdf');
    const dataBuffer = fs.readFileSync(p);
    const data = await pdfParse(dataBuffer);
    
    const lines = data.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const authorIndex = lines.findIndex(l => l.includes('Sukriti Suman'));
    if (authorIndex !== -1) {
        console.log("Lines around author:");
        for(let i=authorIndex-5; i<=authorIndex+10; i++) {
            if(lines[i]) console.log(`[${i}] ${lines[i]}`);
        }
    } else {
        console.log("Author not found in text!");
    }
}
run();
