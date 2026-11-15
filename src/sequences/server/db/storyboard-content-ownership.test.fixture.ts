import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import { organization, styles } from '@/platform/server/db/schema';
import { DEFAULT_STYLE_TEMPLATES } from '@/look/style-templates';

// Synthetic organization/style fixtures shared by the remaining ownership tests.
export async function seedSpace(db: Database) {
  const organizationId = generateId();
  const [template] = DEFAULT_STYLE_TEMPLATES;
  if (!template) throw new Error('Synthetic storyboard fixture needs a style');
  await db.insert(organization).values({
    id: organizationId,
    name: 'Synthetic storyboard organization',
    slug: organizationId,
  });
  const [style] = await db
    .insert(styles)
    .values({
      organizationId,
      name: 'Synthetic storyboard style',
      config: template.config,
    })
    .returning();
  if (!style) throw new Error('Synthetic style insert failed');
  return { organizationId, styleId: style.id };
}
