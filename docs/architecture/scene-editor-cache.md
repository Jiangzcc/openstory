# Scene editor cache after narrative saves

The upstream `useUpdateScene` hook invalidates the structure queries after a
narrative save. Until those reads complete, the rail can still show the old
title even though `updateSceneFn` has returned the saved scene. A global
mutation invalidation followed by the hook's invalidation can also restart the
same active read; the cancelled read's response does not update the cache.

This local integration merges the confirmed server result into the matching
row of `sceneKeys.list(sequenceId)` before retaining the existing structure and
staleness invalidations. It changes the domain UI hook only; the server write,
global QueryClient and other mutation hooks keep their existing contracts.

The list has the selected script as well as the scene narrative. The mutation
returns the script read by the immutable version id on its saved scene, using
`getByIdForScene`; it must not re-read the live selection, which could move
again. A concurrent script edit may have preceded the narrative save, so a
cached script cannot safely be paired with the saved version id. Merge the
confirmed row and its script together, and update only its matching scene in
its sequence. Leave an uncached list absent rather than creating a partial
list from one response. A failed save leaves the cached scene untouched.

`src/shots/ui/use-scene-structure.test.tsx` exercises the real QueryClient with
active refetches deliberately left pending. It verifies that the confirmed
narrative and script are available immediately, other scenes and sequences are
unchanged, an older cached script is replaced together with its version, and
failure or an absent list does not manufacture cache data.
Browser acceptance belongs to the manual-pipeline rename flow.

On an upstream merge, recheck `useUpdateScene`, the `updateSceneFn` response and
`SceneWithScript`: a changed mutation response or upstream cache reconciliation
may change which fields this merge should retain.
