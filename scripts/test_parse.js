const fs = require('fs');
const pdfParse = require('pdf-parse');

async function run() {
    const filePath = process.argv[2];
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    console.log("--- RAW TEXT ---");
    console.log(data.text);
    console.log("----------------");
    
    const lines = data.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    console.log(lines.slice(0, 30));
}

run();
