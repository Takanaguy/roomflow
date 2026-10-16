import { describe, expect, it } from "vitest";
import { simplifier, type DetteCentimes } from "@/lib/settlements";

// Applique les virements aux soldes de depart : un virement from -> to fait
// monter le solde de from (il se libere de sa dette) et baisser celui de to
// (on lui doit moins). Si l'algorithme est correct, tout retombe a zero.
function appliquer(soldes: Map<string, number>, virements: DetteCentimes[]) {
  const apres = new Map(soldes);
  for (const v of virements) {
    apres.set(v.fromUserId, (apres.get(v.fromUserId) ?? 0) + v.centimes);
    apres.set(v.toUserId, (apres.get(v.toUserId) ?? 0) - v.centimes);
  }
  return apres;
}

const carte = (obj: Record<string, number>) => new Map(Object.entries(obj));

describe("simplifier : entrees triviales", () => {
  // Colocation sans aucune depense : pas de dette, et surtout pas de plantage
  // sur soldes[0] qui vaut undefined.
  it("Map vide : aucun virement", () => {
    expect(simplifier(new Map())).toEqual([]);
  });

  it("tous les soldes a 0 : aucun virement", () => {
    expect(simplifier(carte({ A: 0, B: 0, C: 0 }))).toEqual([]);
  });

  // Le code ignore les ecarts sous le centime (|solde| < 1) : un reste
  // flottant comme 0.4 ne doit pas produire un virement fantome.
  it("ecarts de moins d'un centime : ignores", () => {
    expect(simplifier(carte({ A: 0.4, B: -0.4 }))).toEqual([]);
    expect(simplifier(carte({ A: 0.9, B: -0.9, C: 0 }))).toEqual([]);
  });

  // Limite du filtre : exactement 1 centime doit, lui, etre conserve.
  it("un ecart d'exactement 1 centime est conserve", () => {
    expect(simplifier(carte({ A: 1, B: -1 }))).toEqual([{ fromUserId: "B", toUserId: "A", centimes: 1 }]);
  });
});

describe("simplifier : cas concrets", () => {
  // Le plus petit cas possible : un debiteur, un crediteur. Verifie le sens
  // du virement (le debiteur paie le crediteur, pas l'inverse).
  it("A +1000, B -1000 : un seul virement de B vers A", () => {
    expect(simplifier(carte({ A: 1000, B: -1000 }))).toEqual([
      { fromUserId: "B", toUserId: "A", centimes: 1000 },
    ]);
  });

  // Chiffres reels de la colocation de demo, verifies a la main dans le
  // journal du lot 5 : sert de test de non regression sur du vrai.
  it("colocation demo : T3 et T2 remboursent T1", () => {
    const virements = simplifier(carte({ T1: 38909, T2: -9260, T3: -29649 }));
    expect(virements).toHaveLength(2);
    expect(virements).toContainEqual({ fromUserId: "T3", toUserId: "T1", centimes: 29649 });
    expect(virements).toContainEqual({ fromUserId: "T2", toUserId: "T1", centimes: 9260 });
  });

  // L'interet de l'algorithme : A doit a B et B doit a C donne des soldes nets
  // A -500, B 0, C +500. B disparait de la liste, A paie C directement.
  it("chaine A -> B -> C : virement direct de A vers C", () => {
    expect(simplifier(carte({ A: -500, B: 0, C: 500 }))).toEqual([
      { fromUserId: "A", toUserId: "C", centimes: 500 },
    ]);
  });

  // Un crediteur pour plusieurs debiteurs de montants differents : le plus
  // gros debiteur est traite en premier (glouton), les montants restent exacts.
  it("deux crediteurs et deux debiteurs : montants partiels", () => {
    const virements = simplifier(carte({ A: 700, B: 300, C: -600, D: -400 }));
    expect(virements.length).toBeLessThanOrEqual(3);
    const apres = appliquer(carte({ A: 700, B: 300, C: -600, D: -400 }), virements);
    for (const solde of apres.values()) expect(solde).toBe(0);
  });
});

describe("simplifier : proprietes sur des jeux de soldes equilibres", () => {
  // Chaque jeu a une somme nulle (ce que produit calculerSoldesNets quand
  // chaque depense est bien repartie). Le jeu a 5 personnes et celui avec
  // des zeros verifient que le nombre de virements reste borne.
  const jeux: Record<string, Record<string, number>> = {
    "2 personnes": { A: 2500, B: -2500 },
    "3 personnes, un crediteur": { A: 1000, B: -400, C: -600 },
    "4 personnes, deux crediteurs": { A: 3000, B: 1500, C: -2000, D: -2500 },
    "4 personnes dont deux a zero": { A: 1200, B: 0, C: -1200, D: 0 },
    "5 personnes": { A: 5000, B: 1250, C: -750, D: -3500, E: -2000 },
    "5 personnes, montants premiers entre eux": { A: 1373, B: 811, C: -997, D: -1021, E: -166 },
    "centimes impairs": { A: 1, B: 1, C: -2 },
  };

  for (const [nom, soldes] of Object.entries(jeux)) {
    describe(nom, () => {
      const entree = carte(soldes);
      const somme = [...entree.values()].reduce((s, c) => s + c, 0);
      const virements = simplifier(entree);
      const nonNuls = [...entree.values()].filter((c) => c !== 0).length;

      it("le jeu de test est bien equilibre", () => {
        expect(somme).toBe(0);
      });

      // Propriete de correction : si un solde ne retombe pas a 0, quelqu'un
      // paierait trop ou pas assez.
      it("apres les virements, tous les soldes sont a 0", () => {
        for (const solde of appliquer(entree, virements).values()) expect(solde).toBe(0);
      });

      // C'est tout l'interet de "minimum cash flow" : au plus n - 1 virements
      // pour n personnes concernees.
      it("au plus (personnes non nulles - 1) virements", () => {
        expect(virements.length).toBeLessThanOrEqual(Math.max(nonNuls - 1, 0));
      });

      // Un virement de 0 ou negatif s'afficherait a l'ecran comme une dette
      // absurde, ou inverserait le sens du paiement.
      it("aucun virement de montant <= 0", () => {
        for (const v of virements) expect(v.centimes).toBeGreaterThan(0);
      });

      it("aucun virement vers soi-meme", () => {
        for (const v of virements) expect(v.fromUserId).not.toBe(v.toUserId);
      });

      // Les montants doivent rester des entiers : on est en centimes, un
      // 0.5 trahirait une fuite du flottant dans l'algorithme.
      it("tous les montants sont des centimes entiers", () => {
        for (const v of virements) expect(Number.isInteger(v.centimes)).toBe(true);
      });
    });
  }

  // Meme proprietes sur beaucoup de jeux generes : un generateur congruentiel
  // a graine fixe garde le test reproductible (pas de Math.random, qui rendrait
  // un echec impossible a rejouer).
  it("200 jeux pseudo-aleatoires equilibres de 2 a 8 personnes", () => {
    let graine = 12345;
    const suivant = () => {
      graine = (graine * 1103515245 + 12345) % 2147483648;
      return graine;
    };

    for (let essai = 0; essai < 200; essai++) {
      const n = 2 + (suivant() % 7);
      const soldes = new Map<string, number>();
      let total = 0;
      for (let i = 0; i < n - 1; i++) {
        const valeur = (suivant() % 20001) - 10000;
        soldes.set(`u${i}`, valeur);
        total += valeur;
      }
      // Le dernier solde rend la somme nulle, comme dans une vraie colocation.
      soldes.set(`u${n - 1}`, -total);

      const virements = simplifier(soldes);
      const nonNuls = [...soldes.values()].filter((c) => c !== 0).length;

      for (const solde of appliquer(soldes, virements).values()) expect(solde).toBe(0);
      expect(virements.length).toBeLessThanOrEqual(Math.max(nonNuls - 1, 0));
      for (const v of virements) {
        expect(v.centimes).toBeGreaterThan(0);
        expect(v.fromUserId).not.toBe(v.toUserId);
      }
    }
  });
});

describe("simplifier : entrees anormales", () => {
  // Somme != 0 ne devrait jamais arriver (bug de repartition en amont), mais
  // la boucle for(;;) ne doit ni tourner a l'infini ni lancer une exception :
  // la page "dettes" planterait pour toute la colocation.
  it("plus de credit que de dette : rend une reponse sans boucler", () => {
    const virements = simplifier(carte({ A: 1000, B: -300 }));
    expect(Array.isArray(virements)).toBe(true);
    expect(virements).toEqual([{ fromUserId: "B", toUserId: "A", centimes: 300 }]);
  });

  it("plus de dette que de credit : rend une reponse sans boucler", () => {
    const virements = simplifier(carte({ A: 300, B: -1000 }));
    expect(Array.isArray(virements)).toBe(true);
    expect(virements).toEqual([{ fromUserId: "B", toUserId: "A", centimes: 300 }]);
  });

  it("que des soldes positifs : aucun virement possible", () => {
    expect(simplifier(carte({ A: 500, B: 200 }))).toEqual([]);
  });

  it("que des soldes negatifs : aucun virement possible", () => {
    expect(simplifier(carte({ A: -500, B: -200 }))).toEqual([]);
  });
});

describe("simplifier : pas d'effet de bord", () => {
  // simplifier travaille sur une copie ({userId, centimes}) : si elle
  // modifiait la Map recue, confirmerReglement (qui reutilise les soldes)
  // verrait des chiffres deja consommes.
  it("la Map passee en argument n'est pas modifiee", () => {
    const entree = carte({ T1: 38909, T2: -9260, T3: -29649, T4: 0, T5: 0.4 });
    const avant = [...entree.entries()];

    simplifier(entree);

    expect([...entree.entries()]).toEqual(avant);
  });

  // Deux appels de suite sur la meme Map doivent donner le meme resultat.
  it("deux appels successifs donnent le meme resultat", () => {
    const entree = carte({ A: 1373, B: 811, C: -997, D: -1021, E: -166 });
    expect(simplifier(entree)).toEqual(simplifier(entree));
  });
});
