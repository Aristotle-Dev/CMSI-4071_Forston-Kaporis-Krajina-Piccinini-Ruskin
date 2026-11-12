
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readFile} = require("node:fs/promises");
const {resolve} = require("node:path");
const {extractPdfText} = require("../src/ingestion/pdfExtraction");

test("extracts text and page numbers from a PDF", async () => {
  const filePath = resolve(__dirname, "../../../Documents/Gather_SDD.pdf"); //check each time
  const pdfBuffer = await readFile(filePath);

  const result = await extractPdfText(pdfBuffer);

  assert.equal(result.sourceType, "pdf");
  assert.ok(result.pageCount > 0);
  assert.equal(result.pages.length, result.pageCount);
  assert.equal(result.pages[0].pageNumber, 1);
  assert.equal(result.hasText, true);
  assert.ok(result.pages.some((page) => /Gather/i.test(page.text)));
});

test("rejects an empty PDF buffer", async () => {
  await assert.rejects(
      extractPdfText(Buffer.alloc(0)),
      /non-empty PDF buffer/,
  );
});

test("rejects non-PDF input", async () => {
  await assert.rejects(
      extractPdfText(Buffer.from("This is not a PDF.")),
  );
});
