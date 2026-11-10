import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthorizationError } from '@/platform/errors';
import { asStub } from '@/test/as-stub';
import { STORAGE_BUCKETS } from './buckets';

// Real route callbacks and target validation; auth, membership, storage and checks are mocked.
const getMembership = vi.fn();
const requireCheck = vi.fn();
const startCheck = vi.fn();
const uploadFile = vi.fn();
const createMultipart = vi.fn();
const completeMultipart = vi.fn();
const user = { id: 'mock-user', email: 'mock@example.invalid' };
const organizationId = 'mock-organization';
const filePath = 'org/' + organizationId + '/mock-image.png';
const cookies = [
  undefined,
  'openstory_locale=zh-CN',
  'openstory_locale=en',
  'openstory_locale=invalid',
];

vi.doMock('@/platform/middleware.fn', () => ({ authRequestMiddleware: {} }));
vi.doMock('@/platform/server/auth/system-admin', () => ({
  isSystemAdmin: () => false,
}));
vi.doMock('@/platform/server/db/scoped', () => ({
  getUserOrganizationMembership: getMembership,
}));
vi.doMock('@/cast/server/upload-check', () => ({
  requireUploadCheckAllowed: requireCheck,
  startCheckForStoredUpload: startCheck,
}));
vi.doMock('#storage', () => ({
  fileExists: async () => false,
  uploadFile,
  createMultipartUpload: createMultipart,
  completeMultipartUpload: completeMultipart,
  abortMultipartUpload: vi.fn(),
  uploadPart: vi.fn(),
}));

const { Route: uploadRoute } = await import('@/routes/api/storage/upload');
const { Route: multipartRoute } =
  await import('@/routes/api/storage/multipart');
const uploadHandlers = uploadRoute.options.server?.handlers;
const multipartHandlers = multipartRoute.options.server?.handlers;
if (
  !uploadHandlers ||
  typeof uploadHandlers === 'function' ||
  typeof uploadHandlers.PUT !== 'function'
)
  throw new Error('Expected the real single-upload callback.');
if (
  !multipartHandlers ||
  typeof multipartHandlers === 'function' ||
  typeof multipartHandlers.POST !== 'function'
)
  throw new Error('Expected the real multipart callback.');
const uploadHandler = uploadHandlers.PUT;
const multipartHandler = multipartHandlers.POST;

// A streaming pass-through double; R2 length enforcement is outside this test.
class MockFixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(_length: number) {
    super();
  }
}

function request(
  kind: 'single' | 'create' | 'complete',
  cookie?: string
): Request {
  const single = kind === 'single';
  const url = new URL(
    single ? '/api/storage/upload' : '/api/storage/multipart',
    'https://mock.invalid'
  );
  url.searchParams.set('bucket', STORAGE_BUCKETS.TALENT);
  url.searchParams.set('path', filePath);
  url.searchParams.set('contentType', 'image/png');
  url.searchParams.set('action', kind);
  url.searchParams.set('uploadId', 'mock-upload');
  const headers = new Headers({ 'content-length': '1' });
  if (cookie) headers.set('cookie', cookie);
  return new Request(url, {
    method: single ? 'PUT' : 'POST',
    headers,
    body: single
      ? new Uint8Array([1])
      : JSON.stringify({
          parts: [{ partNumber: 1, etag: 'mock-etag' }],
          promptLocale: 'en',
          userId: 'forged-user',
          organizationId: 'forged-org',
        }),
  });
}

async function handle(value: Request): Promise<Response> {
  const args = { request: value, context: { user } };
  const response =
    value.method === 'PUT'
      ? await uploadHandler(asStub<Parameters<typeof uploadHandler>[0]>(args))
      : await multipartHandler(
          asStub<Parameters<typeof multipartHandler>[0]>(args)
        );
  if (!(response instanceof Response))
    throw new Error('Expected the real route response.');
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('FixedLengthStream', MockFixedLengthStream);
  getMembership.mockResolvedValue({ organizationId, role: 'member' });
  requireCheck.mockResolvedValue(undefined);
  startCheck.mockResolvedValue(undefined);
  uploadFile.mockImplementation(
    async (
      _bucket: string,
      _path: string,
      body: ReadableStream<Uint8Array>
    ) => {
      await new Response(body).arrayBuffer();
    }
  );
  createMultipart.mockResolvedValue({ uploadId: 'mock-upload' });
  completeMultipart.mockResolvedValue({
    publicUrl: 'https://mock.invalid/upload',
  });
});
afterEach(() => vi.unstubAllGlobals());

it.each(cookies)(
  'preserves single upload language and trusted owner for Cookie %s',
  async (cookie) => {
    const value = request('single', cookie);
    const response = await handle(value);
    const promptLocale = cookie === 'openstory_locale=en' ? 'en' : 'zh-CN';
    expect(response.status).toBe(200);
    expect(getMembership).toHaveBeenCalledWith(user.id, organizationId);
    expect(requireCheck).toHaveBeenCalledWith({
      promptLocale,
      bucket: STORAGE_BUCKETS.TALENT,
      contentType: 'image/png',
      organizationId,
      userId: user.id,
    });
    expect(startCheck).toHaveBeenCalledWith({
      promptLocale,
      bucket: STORAGE_BUCKETS.TALENT,
      path: filePath,
      contentType: 'image/png',
      organizationId,
      userId: user.id,
      request: value,
    });
    expect(uploadFile).toHaveBeenCalledOnce();
  }
);

it.each(cookies)(
  'preserves multipart create language and trusted owner for Cookie %s',
  async (cookie) => {
    const response = await handle(request('create', cookie));
    expect(response.status).toBe(200);
    expect(requireCheck).toHaveBeenCalledWith({
      promptLocale: cookie === 'openstory_locale=en' ? 'en' : 'zh-CN',
      bucket: STORAGE_BUCKETS.TALENT,
      contentType: 'image/png',
      organizationId,
      userId: user.id,
    });
    expect(createMultipart).toHaveBeenCalledWith(
      STORAGE_BUCKETS.TALENT,
      filePath,
      'image/png'
    );
    expect(startCheck).not.toHaveBeenCalled();
  }
);

it.each(cookies)(
  'preserves multipart complete language and rejects body identity overrides for Cookie %s',
  async (cookie) => {
    const value = request('complete', cookie);
    const response = await handle(value);
    const promptLocale = cookie === 'openstory_locale=en' ? 'en' : 'zh-CN';
    expect(response.status).toBe(200);
    expect(requireCheck).toHaveBeenCalledWith({
      promptLocale,
      bucket: STORAGE_BUCKETS.TALENT,
      contentType: 'image/png',
      organizationId,
      userId: user.id,
    });
    expect(startCheck).toHaveBeenCalledWith({
      promptLocale,
      bucket: STORAGE_BUCKETS.TALENT,
      path: filePath,
      contentType: 'image/png',
      organizationId,
      userId: user.id,
      request: value,
    });
    expect(completeMultipart).toHaveBeenCalledWith(
      STORAGE_BUCKETS.TALENT,
      filePath,
      'mock-upload',
      [{ partNumber: 1, etag: 'mock-etag' }]
    );
  }
);

it.each(['single', 'create', 'complete'] as const)(
  'refuses unauthorized %s targets before checks or storage',
  async (kind) => {
    getMembership.mockResolvedValue(null);
    expect((await handle(request(kind, 'openstory_locale=en'))).status).toBe(
      403
    );
    expect(requireCheck).not.toHaveBeenCalled();
    expect(startCheck).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
    expect(createMultipart).not.toHaveBeenCalled();
    expect(completeMultipart).not.toHaveBeenCalled();
  }
);

it.each(['single', 'create', 'complete'] as const)(
  'keeps the %s compliance refusal before storage',
  async (kind) => {
    requireCheck.mockRejectedValueOnce(
      new AuthorizationError('Mock upload check refusal')
    );
    expect((await handle(request(kind))).status).toBe(403);
    expect(startCheck).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
    expect(createMultipart).not.toHaveBeenCalled();
    expect(completeMultipart).not.toHaveBeenCalled();
  }
);
