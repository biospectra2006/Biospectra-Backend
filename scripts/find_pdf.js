const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

const dir = path.join(__dirname, '../../frontend/public/pdf biospectra');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));

async function run() {
    for (const f of files) {
        const p = path.join(dir, f);
        try {
            const dataBuffer = fs.readFileSync(p);
            const data = await pdfParse(dataBuffer);
            if (data.text.includes('Sukriti Suman')) {
                console.log('Found in:', f);
                break;
            }
        } catch(e) {}
    }
}
run();
