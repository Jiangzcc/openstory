import { CompatibleImageError } from './compatible-image-error';

export async function limitCompatibleImageResponse(
  response: Response,
  maxBytes: number
): Promise<Response> {
  const advertised = Number(response.headers.get('content-length'));
  let received = 0;
  if (advertised > maxBytes) {
    await response.body?.cancel();
    throw new CompatibleImageError('resource_limit');
  }
  if (!response.body) return response;
  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maxBytes)
          throw new CompatibleImageError('resource_limit');
        controller.enqueue(chunk);
      },
    })
  );
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function readCompatibleImageResponse(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  return new Uint8Array(
    await (await limitCompatibleImageResponse(response, maxBytes)).arrayBuffer()
  );
}
