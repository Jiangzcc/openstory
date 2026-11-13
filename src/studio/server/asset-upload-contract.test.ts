import { runWithStartContext } from '@tanstack/start-storage-context';
import {
  runtime,
  origin,
  caller,
  foreign,
  poisonedData,
  createExecutor,
  startContext,
  localeCases,
  presignSchema,
} from './db/asset-entry.test.fixture';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { generateId } from '@/platform/id';
import { LOCALE_COOKIE } from '@/platform/i18n/locale';
import { asStub } from '@/test/as-stub';
import * as entries from '@/studio/studio-assets.fn';
import { Route as uploadRoute } from '@/routes/api/storage/upload';
import { uploadStudioImage, uploadStudioVideo } from './upload';

const execute = createExecutor((request, callback) =>
  runWithStartContext(startContext(request), callback)
);

describe('Studio composer upload and generated-result storage boundaries', () => {
  it.each(localeCases)(
    'presigns with trusted identity and carries $label request locale into the actual PUT',
    async ({ cookie, expected }) => {
      const outcome = await execute(
        entries.presignStudioUploadFn,
        { filename: 'Lena.png', ...poisonedData() },
        cookie
      );
      expect(outcome.error).toBeUndefined();
      const presign = presignSchema.parse(outcome.result);
      expect(presign.path).toMatch(
        new RegExp(
          '^talent/' +
            caller.organizationId +
            '/uploads/[0-9A-HJKMNP-TV-Z]{26}\\.png$'
        )
      );
      expect(presign.contentType).toBe('image/png');
      const url = new URL(presign.uploadUrl, origin);
      url.searchParams.set('userId', foreign.id);
      url.searchParams.set('organizationId', foreign.organizationId);
      url.searchParams.set('promptLocale', 'forged');
      const request = new Request(url, {
        method: 'PUT',
        headers: {
          'content-length': '1',
          cookie: LOCALE_COOKIE + '=' + (cookie ?? ''),
        },
        body: new Uint8Array([1]),
      });
      const handlers = uploadRoute.options.server?.handlers;
      if (
        !handlers ||
        typeof handlers === 'function' ||
        typeof handlers.PUT !== 'function'
      )
        throw new Error('Expected real upload PUT');
      // The auth identity is supplied after route middleware; target membership SQL and PUT/check logic execute unchanged.
      const response = await handlers.PUT(
        asStub<Parameters<typeof handlers.PUT>[0]>({
          request,
          context: { user: { id: caller.id, email: caller.email } },
        })
      );
      expect(response).toBeInstanceOf(Response);
      if (!(response instanceof Response))
        throw new Error('Expected upload response');
      expect(response.status, await response.clone().text()).toBe(200);
      expect(runtime.put).toHaveBeenCalledWith(
        presign.path,
        expect.any(ReadableStream),
        expect.objectContaining({
          httpMetadata: expect.objectContaining({ contentType: 'image/png' }),
        })
      );
      expect(runtime.checkAllowed).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: caller.id,
          organizationId: caller.organizationId,
          promptLocale: expected,
        })
      );
      expect(runtime.startCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: caller.id,
          organizationId: caller.organizationId,
          promptLocale: expected,
          request,
        })
      );
      const foreignUrl = new URL(url);
      foreignUrl.searchParams.set(
        'path',
        foreign.organizationId + '/uploads/' + generateId() + '.png'
      );
      const denied = await handlers.PUT(
        asStub<Parameters<typeof handlers.PUT>[0]>({
          request: new Request(foreignUrl, {
            method: 'PUT',
            headers: { 'content-length': '1' },
            body: new Uint8Array([1]),
          }),
          context: { user: { id: caller.id, email: caller.email } },
        })
      );
      expect(denied).toBeInstanceOf(Response);
      if (!(denied instanceof Response))
        throw new Error('Expected denied response');
      expect(denied.status).toBe(403);
      expect(runtime.put).toHaveBeenCalledOnce();
    }
  );

  it('lists only the real organization upload prefix, media entries and newest IDs', async () => {
    runtime.list.mockResolvedValue({
      truncated: false,
      objects: [
        {
          key: 'talent/' + caller.organizationId + '/uploads/01.png',
          size: 1,
          uploaded: new Date(),
          httpMetadata: { contentType: 'image/png' },
        },
        {
          key: 'talent/' + caller.organizationId + '/uploads/03.mp4',
          size: 1,
          uploaded: new Date(),
          httpMetadata: { contentType: 'video/mp4' },
        },
        {
          key: 'talent/' + caller.organizationId + '/uploads/02.txt',
          size: 1,
          uploaded: new Date(),
          httpMetadata: { contentType: 'text/plain' },
        },
      ],
    });
    const outcome = await execute(
      entries.listStudioUploadsFn,
      poisonedData(),
      'en'
    );
    expect(outcome.error).toBeUndefined();
    expect(runtime.list).toHaveBeenCalledWith(
      expect.objectContaining({
        prefix: 'talent/' + caller.organizationId + '/uploads',
        limit: 1000,
      })
    );
    expect(
      z
        .array(z.object({ kind: z.string() }))
        .parse(outcome.result)
        .map((item) => item.kind)
    ).toEqual(['video', 'image']);
  });

  it('stores inline generated images with real byte sniffing under this organization and asset', async () => {
    const assetId = generateId();
    const png = 'data:application/octet-stream;base64,iVBORw0KGgo=';
    const result = await uploadStudioImage({
      imageUrl: png,
      organizationId: caller.organizationId,
      assetId,
      imageIndex: 2,
    });
    const path =
      'org/' + caller.organizationId + '/studio/' + assetId + '/image-2.png';
    expect(result).toEqual({
      url: '/r2/thumbnails/' + path,
      path,
      contentType: 'image/png',
    });
    expect(runtime.put).toHaveBeenCalledWith(
      'thumbnails/' + path,
      expect.any(ReadableStream),
      expect.objectContaining({
        httpMetadata: expect.objectContaining({ contentType: 'image/png' }),
      })
    );
  });

  it('forwards generated-video streaming and Google authentication into real storage', async () => {
    runtime.network.mockResolvedValueOnce(
      new Response(new Uint8Array([1]), {
        headers: { 'content-type': 'video/mp4', 'content-length': '1' },
      })
    );
    const assetId = generateId();
    const result = await uploadStudioVideo({
      videoUrl:
        'https://generativelanguage.googleapis.com/v1beta/files/synthetic:download?alt=media',
      googleApiKey: 'synthetic-google-key',
      organizationId: caller.organizationId,
      assetId,
    });
    expect(result.path).toBe(
      'org/' + caller.organizationId + '/studio/' + assetId + '/video.mp4'
    );
    expect(runtime.network).toHaveBeenCalledOnce();
    expect(JSON.stringify(runtime.network.mock.calls)).toContain(
      'synthetic-google-key'
    );
    expect(runtime.put).toHaveBeenCalledWith(
      'videos/' + result.path,
      expect.any(ReadableStream),
      expect.any(Object)
    );
    runtime.network.mockClear();
  });
});
