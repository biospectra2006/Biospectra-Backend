const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

async function run() {
    const tocPdfPath = path.join(__dirname, 'temp_uploads/debug/20_sept_toc.pdf');
    if (!fs.existsSync(tocPdfPath)) {
        console.log('TOC PDF not found');
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
            pageTexts.push({
                pageIndex: pageData.pageIndex,
                text: text
            });
            return text;
        });
    }

    await pdfParse(fs.readFileSync(tocPdfPath), { pagerender: render_page });
    
    console.log(`Parsed ${pageTexts.length} pages in TOC PDF.`);
    
    pageTexts.sort((a, b) => a.pageIndex - b.pageIndex);
    
    pageTexts.forEach((p, idx) => {
        const lines = p.text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const hasContents = lines.some(l => {
            const clean = l.toUpperCase().replace(/\s+/g, ' ');
            return clean === 'CONTENTS' || clean === 'TABLE OF CONTENTS' || clean.includes('INDEX OF ARTICLES') || clean === 'CONTENT';
        });
        if (hasContents) {
            console.log(`Page ${idx + 1} has CONTENTS / INDEX OF ARTICLES!`);
            console.log('Lines:');
            console.log(lines.slice(0, 15).join('\n'));
            console.log('------------------------');
        }
    });
    
    process.exit(0);
}

run().catch(console.error);
