import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { authRequestMiddleware } from '@/platform/middleware.fn';
import { ulidSchema } from '@/platform/server/schemas/id.schemas';
import {
  cleanupTestUser,
  createTestUser,
  extendTestApiKeyRateLimitWindow,
} from '@/platform/server/test/seed';
import { testOnlyGuard } from './route';

const DeleteUserSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
});

const ExtendApiKeyWindowSchema = z.object({ apiKeyId: ulidSchema });

export const Route = createFileRoute('/api/test/user')({
  server: {
    middleware: [testOnlyGuard],
    handlers: ({ createHandlers }) =>
      createHandlers({
        /**
         * POST /api/test/user
         */
        POST: async ({ request }) => {
          let body: { name?: string; admin?: boolean } = {};
          try {
            body = await request.json();
          } catch {
            // ok, use defaults
          }

          const created = await createTestUser({
            name: body.name,
            admin: body.admin === true,
          });
          return Response.json(created);
        },

        PATCH: {
          middleware: [authRequestMiddleware],
          handler: async ({ request, context }) => {
            if (!/^test-[a-z0-9]+@e2e\.test$/.test(context.user.email)) {
              return new Response('Not Found', { status: 404 });
            }
            const { apiKeyId } = ExtendApiKeyWindowSchema.parse(
              await request.json()
            );
            const key = await extendTestApiKeyRateLimitWindow(
              context.user.id,
              apiKeyId
            );
            return key
              ? Response.json(key)
              : new Response('Not Found', { status: 404 });
          },
        },

        /**
         * DELETE /api/test/user
         */
        DELETE: async ({ request }) => {
          const { userId, organizationId } = DeleteUserSchema.parse(
            await request.json()
          );

          if (!userId || !organizationId) {
            return Response.json(
              { error: 'userId and organizationId are required' },
              { status: 400 }
            );
          }

          await cleanupTestUser(userId, organizationId);
          return Response.json({ success: true });
        },
      }),
  },
});
