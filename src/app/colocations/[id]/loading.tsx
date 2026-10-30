/**
 * S'applique aussi aux sous-pages (depenses, dettes, taches, courses) : la
 * forme est celle du dashboard, une approximation suffisante pour eviter un
 * ecran blanc. Pas de loading.tsx a la racine de src/app a dessein : il
 * ferait demarrer le streaming avant l'appel a notFound() de /admin, qui
 * repondrait alors 200 au lieu du 404 d'une URL inconnue.
 */
export default function ChargementColocation() {
  return (
    <main className="mx-auto max-w-2xl animate-pulse px-6 py-16">
      <div role="status">
        <span className="sr-only">Chargement…</span>
      </div>
      <div className="h-8 w-2/3 rounded-md bg-zinc-100" />
      <div className="mt-3 h-4 w-1/2 rounded-md bg-zinc-100" />
      <div className="mt-6 h-8 w-48 rounded-md bg-zinc-100" />
      <div className="mt-6 flex flex-col gap-4">
        <div className="h-24 rounded-md bg-zinc-100" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="h-40 rounded-md bg-zinc-100" />
          <div className="h-40 rounded-md bg-zinc-100" />
        </div>
      </div>
    </main>
  );
}
