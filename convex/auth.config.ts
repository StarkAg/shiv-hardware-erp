/**
 * Who may call this deployment: devices holding a token from devices.trust,
 * signed by this deployment's own key and checked against its public half.
 * See convex/devices.ts and convex/lib/guarded.ts.
 */
export default {
  providers: [
    {
      type: 'customJwt' as const,
      applicationID: 'shiv-devices',
      issuer: process.env.CONVEX_SITE_URL!,
      jwks: `${process.env.CONVEX_SITE_URL}/.well-known/jwks.json`,
      algorithm: 'ES256' as const,
    },
  ],
}
