import { describe, expect, it } from "vitest";
import { destinatairesDepense } from "@/lib/notifications";
import { remboursementsDepense } from "@/lib/settlements";

// Seule la fonction pure destinatairesDepense est testee. Importer
// notifications.ts charge aussi Mongo, Resend et les gabarits d'email, mais
// sans aucune connexion ni envoi : connectDB() et envoyerEmail() ne sont
// appelees que par notifierBienvenue / notifierNouvelleDepense, que ce fichier
// n'appelle jamais.

const part = (userId: string, amount: number) => ({ userId, amount });

// Le Map n'a pas d'ordre garanti sur les remboursements d'une meme personne
// (c'est un detail de l'algorithme glouton) : on compare triees par
// beneficiaire pour ne figer que ce qui compte pour l'utilisateur.
const trie = (liste: { versUserId: string; montant: number }[] | undefined) =>
  [...(liste ?? [])].sort((a, b) => a.versUserId.localeCompare(b.versUserId));

// ---------------------------------------------------------------------------
// Cas de Tanguy : 100 euros, T1 avance 40, T2 avance 60, parts 33.34 / 33.33 / 33.33
// ---------------------------------------------------------------------------

describe("destinatairesDepense : cas de Tanguy (repas de 100 euros)", () => {
  const payers = [part("T1", 40), part("T2", 60)];
  const splits = [part("T1", 33.34), part("T2", 33.33), part("T3", 33.33)];

  it("auteur T1 : une seule entree, T3, avec deux remboursements exacts", () => {
    const res = destinatairesDepense(payers, splits, "T1");
    expect(res.size).toBe(1);
    expect([...res.keys()]).toEqual(["T3"]);
    expect(trie(res.get("T3"))).toEqual([
      { versUserId: "T1", montant: 6.66 },
      { versUserId: "T2", montant: 26.67 },
    ]);
  });

  it("T3 doit en tout 33.33 : la somme de ses remboursements retombe juste", () => {
    const res = destinatairesDepense(payers, splits, "T1");
    const total = (res.get("T3") ?? []).reduce((s, r) => s + Math.round(r.montant * 100), 0);
    expect(total).toBe(3333);
  });

  it("l'auteur n'apparait jamais comme cle, meme s'il est debiteur", () => {
    // Auteur T3 : c'est lui le debiteur, il est donc exclu. T1 et T2 sont des
    // beneficiaires, pas des debiteurs, donc personne n'est a prevenir.
    const res = destinatairesDepense(payers, splits, "T3");
    expect(res.has("T3")).toBe(false);
    expect(res.size).toBe(0);
  });

  it("un beneficiaire (a qui on doit) n'est pas une cle", () => {
    const res = destinatairesDepense(payers, splits, "T1");
    expect(res.has("T1")).toBe(false);
    expect(res.has("T2")).toBe(false);
  });

  it("auteur T2 : T3 est toujours prevenu avec les memes remboursements", () => {
    const res = destinatairesDepense(payers, splits, "T2");
    expect([...res.keys()]).toEqual(["T3"]);
    expect(trie(res.get("T3"))).toEqual([
      { versUserId: "T1", montant: 6.66 },
      { versUserId: "T2", montant: 26.67 },
    ]);
  });

  it("un auteur qui n'a rien a voir avec la depense (T9) n'exclut personne", () => {
    const res = destinatairesDepense(payers, splits, "T9");
    expect([...res.keys()]).toEqual(["T3"]);
  });
});

// ---------------------------------------------------------------------------
// Autres cas nominaux
// ---------------------------------------------------------------------------

describe("destinatairesDepense : un seul payeur qui avance tout", () => {
  const payers = [part("T1", 54)];
  const splits = [part("T1", 18), part("T2", 18), part("T3", 18)];

  it("auteur T2 : seul T3 est prevenu (T2 est l'auteur, T1 est le beneficiaire)", () => {
    const res = destinatairesDepense(payers, splits, "T2");
    expect([...res.keys()]).toEqual(["T3"]);
    expect(res.get("T3")).toEqual([{ versUserId: "T1", montant: 18 }]);
  });

  it("auteur T1 (le payeur) : T2 et T3 sont prevenus, chacun doit 18 a T1", () => {
    const res = destinatairesDepense(payers, splits, "T1");
    expect([...res.keys()].sort()).toEqual(["T2", "T3"]);
    expect(res.get("T2")).toEqual([{ versUserId: "T1", montant: 18 }]);
    expect(res.get("T3")).toEqual([{ versUserId: "T1", montant: 18 }]);
  });
});

describe("destinatairesDepense : rien a rembourser", () => {
  it("chacun a paye exactement sa part : Map vide", () => {
    const payers = [part("T1", 10), part("T2", 20), part("T3", 30)];
    const splits = [part("T1", 10), part("T2", 20), part("T3", 30)];
    expect(destinatairesDepense(payers, splits, "T1").size).toBe(0);
  });

  it("une seule personne paie et participe seule : Map vide", () => {
    expect(destinatairesDepense([part("T1", 12)], [part("T1", 12)], "T1").size).toBe(0);
  });

  it("listes vides : Map vide", () => {
    const res = destinatairesDepense([], [], "T1");
    expect(res).toBeInstanceOf(Map);
    expect(res.size).toBe(0);
  });

  it("payeurs vides : les parts sont des dettes sans creancier, on ne plante pas", () => {
    // Cas hors usage normal (la route exige au moins un payeur) : on fige
    // juste qu'aucune exception n'est levee et que l'auteur reste exclu.
    expect(() => destinatairesDepense([], [part("T1", 5)], "T1")).not.toThrow();
    expect(destinatairesDepense([], [part("T1", 5)], "T1").has("T1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Centimes exacts
// ---------------------------------------------------------------------------

describe("destinatairesDepense : montants en centimes exacts", () => {
  it("piege 0.1 + 0.2 : T3 doit exactement 0.1 a T1 et 0.2 a T2 (pas 0.30000000000000004)", () => {
    const res = destinatairesDepense(
      [part("T1", 0.1), part("T2", 0.2)],
      [part("T3", 0.3)],
      "T1"
    );
    expect(trie(res.get("T3"))).toEqual([
      { versUserId: "T1", montant: 0.1 },
      { versUserId: "T2", montant: 0.2 },
    ]);
  });

  it("piege 0.1 / 0.2 cote parts : T1 avance 0.3, T2 doit 0.2 exactement", () => {
    const res = destinatairesDepense(
      [part("T1", 0.3)],
      [part("T1", 0.1), part("T2", 0.2)],
      "T1"
    );
    expect(res.get("T2")).toEqual([{ versUserId: "T1", montant: 0.2 }]);
  });

  it("10.01 euros partages 5.01 / 5.00 : T2 doit exactement 5 a T1", () => {
    const res = destinatairesDepense(
      [part("T1", 10.01)],
      [part("T1", 5.01), part("T2", 5)],
      "T1"
    );
    expect(res.get("T2")).toEqual([{ versUserId: "T1", montant: 5 }]);
  });

  it("10.01 euros avances par T1, dus par T2 (5.01) et T3 (5.00)", () => {
    const res = destinatairesDepense(
      [part("T1", 10.01)],
      [part("T2", 5.01), part("T3", 5)],
      "T1"
    );
    expect(res.get("T2")).toEqual([{ versUserId: "T1", montant: 5.01 }]);
    expect(res.get("T3")).toEqual([{ versUserId: "T1", montant: 5 }]);
  });

  it("33.33 a trois : 99.99 avances par T1, chacun des deux autres doit 33.33", () => {
    const res = destinatairesDepense(
      [part("T1", 99.99)],
      [part("T1", 33.33), part("T2", 33.33), part("T3", 33.33)],
      "T1"
    );
    expect(res.get("T2")).toEqual([{ versUserId: "T1", montant: 33.33 }]);
    expect(res.get("T3")).toEqual([{ versUserId: "T1", montant: 33.33 }]);
  });

  it("un centime : 0.01 avance par T1 et du par T2", () => {
    const res = destinatairesDepense([part("T1", 0.01)], [part("T2", 0.01)], "T1");
    expect(res.get("T2")).toEqual([{ versUserId: "T1", montant: 0.01 }]);
  });

  it("grand montant : 1 000 000.07 euros, pas de derive", () => {
    const res = destinatairesDepense(
      [part("T1", 1000000.07)],
      [part("T2", 500000.03), part("T3", 500000.04)],
      "T1"
    );
    expect(res.get("T2")).toEqual([{ versUserId: "T1", montant: 500000.03 }]);
    expect(res.get("T3")).toEqual([{ versUserId: "T1", montant: 500000.04 }]);
  });
});

// ---------------------------------------------------------------------------
// Propriete sur jeux pseudo-aleatoires
// ---------------------------------------------------------------------------

describe("destinatairesDepense : proprietes sur 100 jeux pseudo-aleatoires", () => {
  // Generateur congruentiel a graine fixe : reproductible, contrairement a
  // Math.random qui rendrait un echec impossible a rejouer. Les montants sont
  // d'abord tires en centimes entiers (donc exacts), puis convertis en euros
  // comme le fait l'application.
  it("somme due = verification independante, aucun montant <= 0, auteur et beneficiaires jamais cles", () => {
    let graine = 20261021;
    const suivant = () => {
      graine = (graine * 1103515245 + 12345) % 2147483648;
      return graine;
    };

    // Repartit `total` centimes entre ces personnes : chacune prend un morceau
    // au hasard (eventuellement 0) et la derniere prend le reste, donc la
    // somme est exacte.
    const repartir = (ids: string[], total: number) => {
      const lignes: { userId: string; amount: number }[] = [];
      let reste = total;
      ids.forEach((userId, i) => {
        const centimes = i === ids.length - 1 ? reste : suivant() % (reste + 1);
        reste -= centimes;
        lignes.push({ userId, amount: centimes / 100 });
      });
      return lignes;
    };

    // Sous-ensemble non vide de personnes, dans un ordre melange.
    const choisir = (toutes: string[]) => {
      const gardees = toutes.filter(() => suivant() % 2 === 0);
      const base = gardees.length > 0 ? gardees : [toutes[suivant() % toutes.length]];
      return base.sort(() => (suivant() % 2 === 0 ? -1 : 1));
    };

    for (let jeu = 0; jeu < 100; jeu++) {
      const nb = 2 + (suivant() % 5); // 2 a 6 personnes
      const personnes = Array.from({ length: nb }, (_, i) => `U${i}`);
      const total = 1 + (suivant() % 500000); // jusqu'a 5000.00 euros
      const payers = repartir(choisir(personnes), total);
      const splits = repartir(choisir(personnes), total);
      const auteurId = suivant() % 10 === 0 ? "INCONNU" : personnes[suivant() % nb];

      const res = destinatairesDepense(payers, splits, auteurId);

      // Verification independante : solde en centimes de chacun, calcule ici
      // sans passer par settlements.ts.
      const soldes = new Map<string, number>();
      for (const p of payers) soldes.set(p.userId, (soldes.get(p.userId) ?? 0) + Math.round(p.amount * 100));
      for (const s of splits) soldes.set(s.userId, (soldes.get(s.userId) ?? 0) - Math.round(s.amount * 100));

      const debiteurs = [...soldes.entries()].filter(([, c]) => c < 0);
      const dettesHorsAuteur = debiteurs.filter(([id]) => id !== auteurId);
      const attendu = dettesHorsAuteur.reduce((s, [, c]) => s - c, 0);

      // 1. Les cles sont exactement les debiteurs hors auteur, et chacun
      //    rembourse en tout ce qu'il doit.
      expect([...res.keys()].sort()).toEqual(dettesHorsAuteur.map(([id]) => id).sort());
      let somme = 0;
      for (const [debiteurId, liste] of res) {
        const rembourse = liste.reduce((s, r) => s + Math.round(r.montant * 100), 0);
        expect(rembourse).toBe(-(soldes.get(debiteurId) as number));
        somme += rembourse;
      }
      expect(somme).toBe(attendu);

      // 2. Meme total que remboursementsDepense, une fois l'auteur retire.
      const brut = remboursementsDepense(payers, splits);
      const sommeBrute = brut
        .filter((r) => r.fromUserId !== auteurId)
        .reduce((s, r) => s + Math.round(r.amount * 100), 0);
      expect(somme).toBe(sommeBrute);

      // 3. Invariants de forme.
      const destinataires = new Set<string>();
      for (const liste of res.values()) for (const r of liste) destinataires.add(r.versUserId);
      for (const [debiteurId, liste] of res) {
        expect(debiteurId).not.toBe(auteurId);
        expect(destinataires.has(debiteurId)).toBe(false);
        expect(liste.length).toBeGreaterThan(0);
        for (const r of liste) {
          expect(r.montant).toBeGreaterThan(0);
          expect(r.versUserId).not.toBe(debiteurId);
          // Centimes exacts : pas de reste flottant.
          expect(r.montant).toBe(Math.round(r.montant * 100) / 100);
        }
      }
    }
  });
});
