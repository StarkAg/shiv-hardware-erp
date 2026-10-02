import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Every PDF surface uses the same worker configuration.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
export { pdfjs }
