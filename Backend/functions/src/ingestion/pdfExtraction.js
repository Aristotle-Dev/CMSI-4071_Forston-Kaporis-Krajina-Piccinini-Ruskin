
const {PDFParse} = require("pdf-parse");

/**
 * Extracts text from a PDF while preserving pages and numbers
 * @param {Buffer} pdfBuffer  -The file contents
 * @return {Promise<Object>} -Extracted document information
 */
async function extractPdfText(pdfBuffer) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new Error("A non-empty PDF buffer is required.");
  }

  const parser = new PDFParse({data: pdfBuffer});

  try {
    const result = await parser.getText();

    const pages = result.pages.map((page) => ({
      pageNumber: page.num,
      text: page.text.trim(),
    }));

    const hasText = pages.some((page) => page.text.length > 0);

    return {
      sourceType: "pdf",
      pageCount: result.total,
      pages,
      hasText,
    };
  } finally {
    await parser.destroy();
  }
}

module.exports = {extractPdfText};
