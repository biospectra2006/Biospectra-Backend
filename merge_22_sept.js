const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

async function mergePdfs() {
    console.log('Starting merge process...');
    const inputDir = 'C:\\Users\\Asus\\Desktop\\spectra\\frontend\\public\\22 September';
    const outputFile = 'C:\\Users\\Asus\\Desktop\\spectra\\frontend\\public\\BIOSPECTRA SEPTEMBER 2022 VOL 17(2).pdf';

    // Recursively get all pdfs
    function getPdfs(dir, pdfList = []) {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                getPdfs(fullPath, pdfList);
            } else if (file.toLowerCase().endsWith('.pdf')) {
                pdfList.push(fullPath);
            }
        }
        return pdfList;
    }

    let pdfs = getPdfs(inputDir);
    
    // Sort by starting page number
    pdfs.sort((a, b) => {
        const aMatch = path.basename(a).match(/^(\d+)-/);
        const bMatch = path.basename(b).match(/^(\d+)-/);
        const aStart = aMatch ? parseInt(aMatch[1], 10) : 0;
        const bStart = bMatch ? parseInt(bMatch[1], 10) : 0;
        return aStart - bStart;
    });

    console.log(`Found ${pdfs.length} PDFs. Merging in order:`);
    pdfs.forEach(p => console.log(path.basename(p)));

    const mergedPdf = await PDFDocument.create();

    for (let i = 0; i < pdfs.length; i++) {
        const pdfBytes = fs.readFileSync(pdfs[i]);
        const pdf = await PDFDocument.load(pdfBytes);
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
        console.log(`Merged: ${path.basename(pdfs[i])}`);
    }

    const mergedPdfFile = await mergedPdf.save();
    fs.writeFileSync(outputFile, mergedPdfFile);
    console.log(`Successfully merged ${pdfs.length} PDFs into ${outputFile}`);
}

mergePdfs().catch(console.error);
