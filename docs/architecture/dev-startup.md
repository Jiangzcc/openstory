# Local dev startup

`bun dev` prepares the local environment and database, builds content collections, then starts Vite and the library mirror. A successful content-collections build does not mean the HTTP server is listening: the Cloudflare SSR environment also scans and pre-bundles its dependencies.

## Watch scope

Vite's root watcher excludes `.tmp/**`, where local validation artifacts and dependency backups live. A backup named `node_modules-before-…` does not match Vite's default `node_modules` exclusion. Temporary HTML and optimizer caches must not trigger application reloads.

On Windows on 2026-11-16, a backup under `.tmp` contained 127,831 files, and the stalled Vite process held approximately 94,000 handles. The exclusion prevents these artifacts from competing with application startup. Content-collections already excludes hidden paths in its own watcher; Vite's watcher needs its separate configuration.

## Dependency optimization

Mermaid is excluded from dependency optimization in both the client and SSR environments. Vite does not inherit the top-level `optimizeDeps` configuration into SSR, so its exclusion must also be set under `environments.ssr.optimizeDeps`. Before this fix, the SSR temporary cache contained Mermaid and its diagram modules despite the existing client exclusion.

Keep the existing client CommonJS includes and the Cloudflare/TanStack SSR entries. These exclusions only affect development; they do not change production bundling or stored library data. Recheck the environment merge behavior when upgrading Vite or the Cloudflare plugin.

## Verification on 2026-11-16

Type checking, targeted lint and formatting checks passed. The completed SSR cache contained no Mermaid entries. The running server answered `/@vite/client`, `/cdn-cgi/explorer/api` and `/login` with HTTP 200; the warmed login request took approximately 685 ms. Its Node process held approximately 10,000 handles instead of the earlier 94,000. Cold dependency scanning and the first Worker initialization still took several minutes on this machine.

Keep one `bun dev` launcher active per checkout during startup. A second launch rewrites `.env.local` during environment preparation, even if its values are unchanged. In this verification, that restarted the first Vite instance while Cloudflare was initializing and interrupted its local Worker connection. The final checks used the remaining single instance without disabling environment-file watching.
