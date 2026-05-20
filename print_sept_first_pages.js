const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

async function run() {
    const mainPdfPath = path.join(__dirname, 'temp_uploads/debug/20_sept_main.pdf');
    if (!fs.existsSync(mainPdfPath)) {
        console.log('Main PDF not found');
        process.exit(1);
    }
    
    let pageTexts = [];
    
    function render_page(pageData) {
        return pageData.getTextContent().then(function(textContent) {
            let lastY, text = '';
            for (let item of textContent.items) {
                if (lastY == item.transform[5] || !lastY){
                    text += item.str;
                } else {
                    text += '\n' + item.str;
                }
                lastY = item.transform[5];
            }
            pageTexts.push(text);
            return text;
        });
    }

    await pdfParse(fs.readFileSync(mainPdfPath), { pagerender: render_page });
    
    console.log('=== PAGE 1 ===');
    console.log(pageTexts[0] ? pageTexts[0].substring(0, 1000) : '(empty)');
    console.log('=== PAGE 2 ===');
    console.log(pageTexts[1] ? pageTexts[1].substring(0, 1000) : '(empty)');
    console.log('=== PAGE 3 ===');
    console.log(pageTexts[2] ? pageTexts[2].substring(0, 1000) : '(empty)');
    
    process.exit(0);
}

run().catch(console.error);
