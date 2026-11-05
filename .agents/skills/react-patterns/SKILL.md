---
name: react-patterns
description: Write or review this repository's React components using Suspense queries, shadcn layout, and FormData/Zod forms with TanStack Query mutations.
---

# React patterns

Read the React Patterns section of root `AGENTS.md` and
`docs/secondary-development/extension-policy.md`. Keep requests in domain UI
hooks and existing `*.fn.ts`/API interfaces; keep business logic in services.
The examples below use existing repository interfaces, not mock APIs.

## Server data and Suspense

This repository uses TanStack Query v5. The installed
`node_modules/@tanstack/react-query/src/types.ts` excludes `suspense` from
`UseQueryOptions`. Use `useSuspenseQuery` for the Suspense behavior required by `AGENTS.md`;
`suspense: true` is not an option to pass to `useQuery`. Do not copy `useQuery({ suspense: true })`.

Prefer the existing domain hook. This is the query shape in
`src/cast/ui/use-organization-locations.ts` (cache options omitted):

```tsx
import { useSuspenseQuery } from '@tanstack/react-query';
import { getOrganizationLocationFn } from '@/cast/organization-locations.fn';
import { organizationLocationKeys } from '@/cast/ui/location-keys';

export function useOrganizationLocation(locationId: string) {
  return useSuspenseQuery({
    queryKey: organizationLocationKeys.detail(locationId),
    queryFn: () => getOrganizationLocationFn({ data: { locationId } }),
  });
}
```

Reuse the list hook and let a parent Suspense boundary own initial loading:

```tsx
import type React from 'react';
import { Suspense } from 'react';
import { useOrganizationLocations } from '@/cast/ui/use-organization-locations';
import { Skeleton } from '@/ui/shadcn/skeleton';

const LocationsContent: React.FC = () => {
  const { data: locations } = useOrganizationLocations();
  return (
    <ul className="flex flex-col gap-4">
      {locations.map((location) => (
        <li key={location.id}>{location.name}</li>
      ))}
    </ul>
  );
};

export const LocationsList: React.FC = () => (
  <Suspense fallback={<Skeleton className="h-24 w-full" />}>
    <LocationsContent />
  </Suspense>
);
```

Do not replace this with effect-driven fetching, local `isLoading` state,
or a separate skeleton component. Match the inline fallback to the content.
Existing non-suspending queries are intentional for conditional pickers,
optional data and headers: `useOrganizationLocationList(enabled)` and
`useOrganizationLocationName` in the same file use `useQuery`. Suspense queries do
not accept `enabled` or `placeholderData`; preserve that distinction.

## Styling and spacing

Use shadcn components for theme, borders and typography. Avoid hard-coded
colors, manual dark-mode color pairs and component margins. The parent owns
spacing through flex/grid and gap; use Tailwind for layout.

Existing component composition (the `location` is domain data):

```tsx
<Card>
  <CardHeader>
    <CardTitle>{location.name}</CardTitle>
    <CardDescription>{location.description}</CardDescription>
  </CardHeader>
</Card>
```

Put repeated cards inside a parent such as
`<div className="grid grid-cols-3 gap-4">`, rather than adding `m-4` or
`mb-2` to each child. Use CSS visibility for existing pre-rendered panels
where required by the project's visibility convention.

## Forms and mutations

Use uncontrolled inputs with `name`, `FormData`, a real Zod schema's
`safeParse`, and a domain mutation hook. Avoid one state variable per field,
manual duplicate validation and requests embedded in a page.

`src/cast/ui/new-character-form.tsx` owns the actual local
`newCharacterSchema` and a typed `onSubmit` prop. Its submit-handler
excerpt shows the validation and visible failure path:

```tsx
event.preventDefault();
const result = newCharacterSchema.safeParse(
  Object.fromEntries(new FormData(event.currentTarget))
);
if (!result.success) {
  toast.error(translateEvent('Check the character name'), {
    description: result.error.issues[0]?.message,
  });
  return;
}
onSubmit(result.data);
```

The caller connects that submit prop to the existing
`useCreateOrganizationCharacter` hook in `src/cast/ui/use-organization-characters.ts`.
That hook uses `useMutation`, calls `createOrganizationCharacterFn({ data })`
and invalidates `organizationCharacterKeys.all` on success. Check its actual input
contract, including `rendering`; a form's fields alone need not be the
complete mutation input. Disable submit from `mutation.isPending` and show
a pending label such as `Creating…`.

Surface mutation failures through the existing caller's toast or inline UI.
The global mutation toast in `src/ui/query-client.ts` is opt-in:
`meta: { globalError: true }` belongs on a mutation whose callers do not
handle its error. Avoid duplicate toasts or a silent validation return.

Follow the existing i18n namespace and English-source translation keys for
visible copy; do not introduce semantic keys or untranslated production text.
Use named exports, kebab-case filenames, `@/` imports, and `.ts` files
for non-UI logic, as specified in `AGENTS.md`.
