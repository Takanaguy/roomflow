import { auth } from "@/auth";

/**
 * Protegee par proxy.ts (matcher "/tableau-de-bord/:path*") : impossible
 * d'atterrir ici sans session valide, donc `session` ne devrait jamais etre
 * null en pratique. On garde le contournement possible (acces direct par
 * URL avant que proxy.ts ne soit rafraichi, etc.) plutot que de supposer.
 */
export default async function TableauDeBordPage() {
  const session = await auth();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold">
        Bonjour {session?.user?.name ?? "!"}
      </h1>
      <p className="mt-2 text-zinc-600">
        Cette page est protégée : tu ne peux la voir que connecté. Les
        colocations arriveront ici (lot 3).
      </p>
    </main>
  );
}
