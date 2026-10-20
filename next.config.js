/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // A production build must NOT share an output directory with the running dev
  // server. `next build` clears stale output from distDir, and the dev server
  // serves its route manifests and webpack cache out of `.next/dev/…` — so a
  // verification build against the default `.next` deletes them underneath a live
  // preview. The preview then 500s on every request with ENOENT on
  // `.next/dev/server/app-paths-manifest.json`, the monitor reports
  // NextDevCacheMissing, and restarting cannot fix it. Observed twice in 25
  // minutes on 2026-08-14, each time within a minute of the post-build restart.
  //
  // The platform's build gates set NEXT_BUILD_DIST_DIR so their build lands
  // elsewhere; unset (every dev and deploy build) this is exactly `.next`, so
  // normal behaviour is unchanged.
  distDir: process.env.NEXT_BUILD_DIST_DIR || '.next',

  // Reduce build time by skipping type checking (run separately)
  typescript: {
    ignoreBuildErrors: true,
  },

  // Optimize images
  images: {
    unoptimized: true,
  },

  // Every host the preview iframe is served from must be listed, or Next 16
  // rejects the /_next/webpack-hmr WebSocket upgrade with a 502 and the dev
  // runtime never initializes — React stops before hydration and the page is
  // frozen on its server-rendered markup (for generated apps, SSOGuard's
  // spinner). The JS bundles themselves still load, which is what makes this
  // failure look like an app bug rather than a config one. E2B serves sandboxes
  // from BOTH domains, so both belong here: dropping .e2b.app silently bricked
  // every preview.
  //
  // The list must cover every deployment's PREVIEW_DOMAIN (backend builds the
  // host as preview--{app}.{PREVIEW_DOMAIN}, app/utils/preview.py). That value
  // is per-environment — az.architect.space on Azure, architect.lyzr.*.wtwco.com
  // on WTW — and a domain missing here bricks every preview in that
  // environment, so ALLOWED_DEV_ORIGINS (comma-separated) is also honoured for
  // a new domain that has not reached this baked template yet.
  allowedDevOrigins: [
    'architect.new',
    '**.architect.new',
    '**.e2b.dev',
    '**.e2b.app',
    'az.architect.space',
    '**.az.architect.space',
    '**.lyzr.dev.ai.wtwco.com',
    '**.lyzr.ai.wtwco.com',
    'preview--testapp.localhost',
    'preview--testapp.localhost:8090',
    ...(process.env.ALLOWED_DEV_ORIGINS || '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  ],

  // Stable since Next.js 15 — no longer under experimental
  optimizePackageImports: [
    'lucide-react',
    '@radix-ui/react-accordion',
    '@radix-ui/react-alert-dialog',
    '@radix-ui/react-aspect-ratio',
    '@radix-ui/react-avatar',
    '@radix-ui/react-checkbox',
    '@radix-ui/react-collapsible',
    '@radix-ui/react-context-menu',
    '@radix-ui/react-dialog',
    '@radix-ui/react-dropdown-menu',
    '@radix-ui/react-hover-card',
    '@radix-ui/react-label',
    '@radix-ui/react-menubar',
    '@radix-ui/react-navigation-menu',
    '@radix-ui/react-popover',
    '@radix-ui/react-progress',
    '@radix-ui/react-radio-group',
    '@radix-ui/react-scroll-area',
    '@radix-ui/react-select',
    '@radix-ui/react-separator',
    '@radix-ui/react-slider',
    '@radix-ui/react-slot',
    '@radix-ui/react-switch',
    '@radix-ui/react-tabs',
    '@radix-ui/react-toggle',
    '@radix-ui/react-toggle-group',
    '@radix-ui/react-tooltip',
    'recharts',
    'date-fns',
  ],
}

module.exports = nextConfig
