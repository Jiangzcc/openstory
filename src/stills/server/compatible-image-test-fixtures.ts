import type { CompatibleImageInput } from './compatible-image-types';

// Synthetic 2x3 fixtures encoded locally; no provider calls.
export const MOCK_IMAGE_BASE64 = {
  png: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAJklEQVR4AQEbAOT/AP8AAP8A/wCAAAAA/////wAAAAD/////AP//ngYNdFPQxmEAAAAASUVORK5CYII=',
  jpeg: '/9j/4AAQSkZJRgABAgAAAQABAAD/wAARCAADAAIDAREAAhEBAxEB/9sAQwAGBAUGBQQGBgUGBwcGCAoQCgoJCQoUDg8MEBcUGBgXFBYWGh0lHxobIxwWFiAsICMmJykqKRkfLTAtKDAlKCko/9sAQwEHBwcKCAoTCgoTKBoWGigoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwAn1u902eSxszbLbWrGGJWtYnIRTgAsykk4A5JJPevqnwFkOKf1irQ96ertOpFXerslJJLskklskkfc5Dwtk+Z5XhsdjMNGdWrThOcmtZSlFOUn5tttn//Z',
  webp: 'UklGRsYAAABXRUJQVlA4TLoAAAAvAYAAEM1VICICHogEAAAAAIAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAHggEgAAAAAA5+8BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIA9kEwAAAADg/HcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKA9kEwAAAADg/AcAAAAAAAAAAAAAAAAAAAAoAAAAAAAAAAAAAAAAAAAA8ITvOuySBQA=',
} as const;

export function mockImageBytes(
  format: keyof typeof MOCK_IMAGE_BASE64 = 'png'
): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(MOCK_IMAGE_BASE64[format]), (char) =>
    char.charCodeAt(0)
  );
}

export function mockImageFile(
  name = 'reference.png',
  format: keyof typeof MOCK_IMAGE_BASE64 = 'png'
): File {
  return new File([mockImageBytes(format)], name, { type: 'image/' + format });
}

export function mockImageInput(
  overrides: Partial<CompatibleImageInput> = {}
): CompatibleImageInput {
  return {
    baseUrl: 'https://mock-images.example.test/v1',
    apiKey: 'mock-platform-credential',
    upstreamModel: 'mock-image-model',
    operation: 'generate',
    prompt: 'Mock fixture image',
    parameters: {},
    references: [],
    ...overrides,
  };
}

export function mockImageResponse(
  overrides: Record<string, unknown> = {}
): Response {
  return Response.json(
    { created: 1, data: [{ b64_json: MOCK_IMAGE_BASE64.png }], ...overrides },
    { headers: { 'x-request-id': 'mock_req_123' } }
  );
}

export const MOCK_DIFFERENT_DIMENSIONS_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAJUlEQVR4AQEaAOX/AP///////////////wD///////////////828Rfp9SKp2wAAAABJRU5ErkJggg==';

export function mockCompatibleRequestUrl(
  input: Parameters<typeof fetch>[0]
): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}
