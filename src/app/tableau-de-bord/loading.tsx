export default function ChargementTableauDeBord() {
  return (
    <main className="mx-auto max-w-2xl animate-pulse px-6 py-16">
      <div role="status">
        <span className="sr-only">Chargement…</span>
      </div>
      <div className="flex items-center justify-between">
        <div className="h-8 w-48 rounded-md bg-zinc-100" />
        <div className="h-9 w-32 rounded-md bg-zinc-100" />
      </div>
      <ul className="mt-8 flex flex-col gap-2">
        <li className="h-24 rounded-md bg-zinc-100" />
        <li className="h-24 rounded-md bg-zinc-100" />
        <li className="h-24 rounded-md bg-zinc-100" />
      </ul>
    </main>
  );
}
