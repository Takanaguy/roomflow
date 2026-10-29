import type { NextConfig } from "next";

// En-tetes de securite appliques a toutes les routes.
// Pourquoi une CSP partielle : on ne met volontairement ni script-src, ni style-src,
// ni default-src. Next.js injecte des scripts en ligne (hydratation, donnees RSC) : une
// CSP stricte les bloquerait sans nonces par requete. On ne met pas non plus form-action :
// certains navigateurs bloquent alors les redirections de connexion Google/GitHub qui
// suivent un envoi de formulaire. On garde donc les directives sans risque (anti-clickjacking,
// base, objets). Une CSP complete avec nonces est une amelioration future.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  // Ignore par les navigateurs en http local, utile en production sur https.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  },
];

const nextConfig: NextConfig = {
  // Ne pas annoncer "X-Powered-By: Next.js" : inutile a un attaquant qui cherche la version.
  poweredByHeader: false,
  // Les polices du PDF sont lues par chemin a l'execution (Font.register) : Next ne
  // peut pas deviner qu'elles servent et ne les copierait pas dans la fonction
  // serverless de Vercel. La cle est la route, crochets echappes (picomatch).
  outputFileTracingIncludes: {
    "/api/colocations/\\[id\\]/export": ["./src/assets/fonts/**/*"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
