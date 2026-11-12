
const {readFile} = require("node:fs/promises");
const {basename} = require("node:path");
const {extractPdfText} = require("../src/ingestion/pdfExtraction");

/**
 * Runs the PDF extractor on a local file
 */
async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    throw new Error("Usage: node scripts/parsePdf.js <pdf-path>");
  }

  const pdfBuffer = await readFile(filePath);
  const document = await extractPdfText(pdfBuffer);

  const result = {
    fileName: basename(filePath),
    ...document,
  };

  console.log(JSON.stringify(result, null, 2));

  if (!document.hasText) {
    console.error("No text found. The PDF may require OCR.");
  }
}

main().catch((error) => {
  console.error("PDF extraction failed:", error.message);
  process.exitCode = 1;
});
