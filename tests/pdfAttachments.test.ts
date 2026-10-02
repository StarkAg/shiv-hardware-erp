import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getDocument: vi.fn() }))
vi.mock('../src/lib/pdfjs', () => ({ pdfjs: mocks }))

beforeEach(() => {
  vi.stubGlobal('window', { location: { protocol: 'https:', hostname: 'test.local' } })
  vi.stubGlobal('document', { createElement: () => ({
    getContext: () => ({ fillRect() {}, fillStyle: '' }),
    toBlob: (done: (blob: Blob) => void) => done(new Blob(['page'], { type: 'image/jpeg' })),
  }) })
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('PDF attachments', () => {
  it('converts every page, including pages after twelve, and releases the document', async () => {
    const destroy = vi.fn()
    const getPage = vi.fn(async () => ({
      getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
      render: () => ({ promise: Promise.resolve() }),
    }))
    mocks.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 14, getPage, destroy }) })
    const { pdfToImages } = await import('../src/features/ledger/lib/image')
    const result = await pdfToImages(new File(['pdf'], 'long-bill.pdf', { type: 'application/pdf' }))
    expect(result).toHaveLength(14)
    expect(result.at(-1)?.name).toBe('long-bill p14.jpg')
    expect(getPage).toHaveBeenLastCalledWith(14)
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('rejects the whole conversion if a page cannot render instead of silently omitting it', async () => {
    const destroy = vi.fn()
    mocks.getDocument.mockReturnValue({ promise: Promise.resolve({
      numPages: 2, destroy, getPage: vi.fn().mockRejectedValue(new Error('Unreadable page')),
    }) })
    const { pdfToImages } = await import('../src/features/ledger/lib/image')
    await expect(pdfToImages(new File(['pdf'], 'broken.pdf', { type: 'application/pdf' }))).rejects.toThrow('Unreadable page')
    expect(destroy).toHaveBeenCalledOnce()
  })
})
