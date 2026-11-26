const vendor = name => new URL(`./vendor/ocr/${name}`, import.meta.url).href;

export async function readRecipeImage(file, log) {
  const {default: tesseract} = await import('./vendor/ocr/tesseract.esm.min.js');
  const worker = await tesseract.createWorker(['rus', 'eng'], 1, {
    workerPath: vendor('worker.min.js'),
    corePath: vendor('tesseract-core-lstm.wasm.js'),
    langPath: vendor(''),
    workerBlobURL: false,
    logger: log
  });
  try {
    const {data} = await worker.recognize(file);
    return data.text.trim();
  } finally {
    await worker.terminate();
  }
}
