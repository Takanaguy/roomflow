import { describe, expect, it } from "vitest";
import {
  construireRepartitionInput,
  repartirEgalement,
  repartirParPourcentages,
  resoudreRepartition,
  sommeSplits,
} from "@/lib/expenses";

// Somme calculee en centimes entiers dans le test lui-meme : on n'utilise
// volontairement PAS sommeSplits ici, sinon on testerait une fonction avec
// elle-meme et un bug commun aux deux passerait inapercu.
const sommeEnCentimes = (parts: { amount: number }[]) =>
  parts.reduce((s, p) => s + Math.round(p.amount * 100), 0);

const ids = (n: number) => Array.from({ length: n }, (_, i) => `u${i + 1}`);
const montants = (parts: { amount: number }[]) => parts.map((p) => p.amount);

describe("repartirEgalement", () => {
  // Le cas d'ecole : 10 / 3 ne tombe pas juste, le centime restant doit aller
  // au premier de la liste au lieu de disparaitre.
  it("10 euros entre 3 : le reste va au premier", () => {
    const parts = repartirEgalement(10, ids(3));
    expect(montants(parts)).toEqual([3.34, 3.33, 3.33]);
    expect(parts.map((p) => p.userId)).toEqual(["u1", "u2", "u3"]);
  });

  // Reste d'un centime sur un montant qui n'est pas un nombre rond d'euros.
  it("10.01 euros entre 2 : le premier prend le centime en trop", () => {
    expect(montants(repartirEgalement(10.01, ids(2)))).toEqual([5.01, 5.0]);
  });

  it("100 euros entre 3 : 33.34 / 33.33 / 33.33", () => {
    expect(montants(repartirEgalement(100, ids(3)))).toEqual([33.34, 33.33, 33.33]);
  });

  // Division sans reste : personne ne doit recevoir de centime en plus.
  it("division exacte : parts identiques", () => {
    expect(montants(repartirEgalement(9, ids(3)))).toEqual([3, 3, 3]);
  });

  // Une depense payee pour une seule personne : elle porte tout le montant.
  it("un seul membre : il prend tout", () => {
    expect(repartirEgalement(42.42, ["solo"])).toEqual([{ userId: "solo", amount: 42.42 }]);
  });

  // Plus de membres que de centimes : certains recoivent 0, mais la somme
  // doit rester exacte (pas de centime cree ni perdu).
  it("0.01 euro entre 3 : un seul centime distribue", () => {
    const parts = repartirEgalement(0.01, ids(3));
    expect(montants(parts)).toEqual([0.01, 0, 0]);
  });

  // Propriete centrale du projet : sans somme exacte, les soldes du lot 5
  // accumuleraient un ecart d'un centime par depense. Les montants sont des
  // "pieges" du flottant JS (0.1 + 0.2 = 0.30000000000000004, 1.005 * 100 =
  // 100.49999999999999, etc.).
  describe("la somme des parts vaut toujours le montant de depart", () => {
    const montantsPieges = [
      0.01,
      0.1,
      0.1 + 0.2,
      0.07,
      1.005,
      9.99,
      10,
      19.99,
      33.33,
      99.99,
      100,
      1234.56,
      4.35,
      8.2 + 0.1,
      999999.99,
    ];

    for (const montant of montantsPieges) {
      for (let n = 1; n <= 7; n++) {
        it(`${montant} euros entre ${n} membre(s)`, () => {
          const parts = repartirEgalement(montant, ids(n));
          expect(parts).toHaveLength(n);
          expect(sommeEnCentimes(parts)).toBe(Math.round(montant * 100));
        });
      }
    }
  });

  // Equite : l'ecart entre la plus grosse et la plus petite part ne doit
  // jamais depasser un centime, sinon la repartition serait injuste.
  it("l'ecart entre deux parts ne depasse jamais un centime", () => {
    for (const montant of [0.01, 10, 10.01, 99.99, 1234.56]) {
      for (let n = 1; n <= 7; n++) {
        const centimes = repartirEgalement(montant, ids(n)).map((p) => Math.round(p.amount * 100));
        expect(Math.max(...centimes) - Math.min(...centimes)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("repartirParPourcentages", () => {
  // 33.33 * 70 % = 23.331 : l'arrondi du premier laisse un ecart que le
  // dernier doit absorber pour retomber exactement sur 33.33.
  it("70 / 30 sur 33.33 : 23.33 et 10.00", () => {
    const parts = repartirParPourcentages(33.33, [
      { userId: "a", pourcentage: 70 },
      { userId: "b", pourcentage: 30 },
    ]);
    expect(montants(parts)).toEqual([23.33, 10]);
    expect(sommeEnCentimes(parts)).toBe(3333);
  });

  // Trois pourcentages "pas ronds" dont la somme flottante n'est peut-etre
  // pas exactement 100 : la repartition doit quand meme etre exacte.
  it("33.33 / 33.33 / 33.34 sur 100 euros", () => {
    const parts = repartirParPourcentages(100, [
      { userId: "a", pourcentage: 33.33 },
      { userId: "b", pourcentage: 33.33 },
      { userId: "c", pourcentage: 33.34 },
    ]);
    expect(montants(parts)).toEqual([33.33, 33.33, 33.34]);
    expect(sommeEnCentimes(parts)).toBe(10000);
  });

  // Choix documente dans le code : le dernier de la liste absorbe l'ecart
  // d'arrondi (et non le premier, comme pour repartirEgalement).
  it("le dernier de la liste absorbe l'ecart d'arrondi", () => {
    // 3 x 33.333 % sur 10 euros : chacun des deux premiers arrondit a 3.33,
    // le dernier recupere le reste, soit 3.34.
    const parts = repartirParPourcentages(10, [
      { userId: "a", pourcentage: 100 / 3 },
      { userId: "b", pourcentage: 100 / 3 },
      { userId: "c", pourcentage: 100 / 3 },
    ]);
    expect(montants(parts)).toEqual([3.33, 3.33, 3.34]);
  });

  // Un seul participant a 100 % : il prend tout, sans passer par l'arrondi.
  it("un seul participant a 100 %", () => {
    expect(repartirParPourcentages(12.34, [{ userId: "a", pourcentage: 100 }])).toEqual([
      { userId: "a", amount: 12.34 },
    ]);
  });

  // Meme garantie de somme exacte que pour la repartition egale, sur
  // plusieurs combinaisons montant / pourcentages.
  describe("somme exacte dans tous les cas testes", () => {
    const cas: { montant: number; pourcentages: number[] }[] = [
      { montant: 0.01, pourcentages: [50, 50] },
      { montant: 33.33, pourcentages: [70, 30] },
      { montant: 100, pourcentages: [33.33, 33.33, 33.34] },
      { montant: 99.99, pourcentages: [10, 20, 30, 40] },
      { montant: 1234.56, pourcentages: [12.5, 12.5, 25, 50] },
      { montant: 0.1 + 0.2, pourcentages: [33, 33, 34] },
      { montant: 1.005, pourcentages: [60, 40] },
      { montant: 250.75, pourcentages: [1, 99] },
    ];

    for (const { montant, pourcentages } of cas) {
      it(`${montant} euros en ${pourcentages.join(" / ")} %`, () => {
        const parts = repartirParPourcentages(
          montant,
          pourcentages.map((pourcentage, i) => ({ userId: `u${i + 1}`, pourcentage }))
        );
        expect(parts).toHaveLength(pourcentages.length);
        expect(sommeEnCentimes(parts)).toBe(Math.round(montant * 100));
      });
    }
  });
});

describe("sommeSplits", () => {
  // Le piege classique : 0.1 + 0.2 vaut 0.30000000000000004 en flottant JS,
  // alors que la somme en centimes donne exactement 0.3.
  it("[0.1, 0.2] vaut exactement 0.3", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // garde-fou : le piege existe bien
    expect(sommeSplits([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3);
  });

  // Une depense sans participant ne doit pas planter (reduce sans valeur
  // initiale lance une erreur sur une liste vide).
  it("liste vide : 0", () => {
    expect(sommeSplits([])).toBe(0);
  });

  it("plusieurs parts d'une repartition egale retombent sur le montant", () => {
    expect(sommeSplits(repartirEgalement(10, ids(3)))).toBe(10);
  });
});

describe("resoudreRepartition", () => {
  const membres = new Set(["u1", "u2", "u3"]);
  const estMembre = (id: string) => membres.has(id);

  describe("type equal", () => {
    it("cas nominal : parts egales entre les membres choisis", () => {
      const res = resoudreRepartition(10, { type: "equal", memberIds: ["u1", "u2", "u3"] }, estMembre);
      expect(res.ok).toBe(true);
      if (res.ok) expect(montants(res.parts)).toEqual([3.34, 3.33, 3.33]);
    });

    // Sans participant, repartirEgalement diviserait par zero : la validation
    // doit refuser avant d'arriver la.
    it("liste vide : refusee", () => {
      const res = resoudreRepartition(10, { type: "equal", memberIds: [] }, estMembre);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.erreur).toContain("au moins un participant");
    });

    // Securite : un id d'une autre colocation (ou invente) ne doit jamais
    // se retrouver dans une depense.
    it("un non-membre dans la liste : refuse", () => {
      const res = resoudreRepartition(10, { type: "equal", memberIds: ["u1", "intrus"] }, estMembre);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.erreur).toContain("ne fait pas partie");
    });
  });

  describe("type percentages", () => {
    it("cas nominal : 70 / 30", () => {
      const res = resoudreRepartition(
        33.33,
        {
          type: "percentages",
          pourcentages: [
            { userId: "u1", pourcentage: 70 },
            { userId: "u2", pourcentage: 30 },
          ],
        },
        estMembre
      );
      expect(res.ok).toBe(true);
      if (res.ok) expect(montants(res.parts)).toEqual([23.33, 10]);
    });

    // Pourcentages qui ne font pas 100 : la depense serait sous ou sur
    // repartie, il faut un message clair pour l'utilisateur.
    it("total different de 100 : refuse avec un message qui donne le total", () => {
      const res = resoudreRepartition(
        50,
        {
          type: "percentages",
          pourcentages: [
            { userId: "u1", pourcentage: 60 },
            { userId: "u2", pourcentage: 30 },
          ],
        },
        estMembre
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.erreur).toContain("100");
        expect(res.erreur).toContain("90");
      }
    });

    // Tolerance de 0.01 dans le code : 33.33 + 33.33 + 33.34 = 100 passe,
    // meme si la somme flottante n'est pas pile 100.
    it("total a 100 a un epsilon pres : accepte", () => {
      const res = resoudreRepartition(
        100,
        {
          type: "percentages",
          pourcentages: [
            { userId: "u1", pourcentage: 33.33 },
            { userId: "u2", pourcentage: 33.33 },
            { userId: "u3", pourcentage: 33.34 },
          ],
        },
        estMembre
      );
      expect(res.ok).toBe(true);
    });

    it("liste vide : refusee", () => {
      const res = resoudreRepartition(10, { type: "percentages", pourcentages: [] }, estMembre);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.erreur).toContain("manquante");
    });

    it("un non-membre : refuse", () => {
      const res = resoudreRepartition(
        10,
        {
          type: "percentages",
          pourcentages: [
            { userId: "u1", pourcentage: 50 },
            { userId: "intrus", pourcentage: 50 },
          ],
        },
        estMembre
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.erreur).toContain("ne fait pas partie");
    });
  });

  describe("type amounts", () => {
    it("cas nominal : montants qui collent au total", () => {
      const splits = [
        { userId: "u1", amount: 6 },
        { userId: "u2", amount: 4 },
      ];
      const res = resoudreRepartition(10, { type: "amounts", splits }, estMembre);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.parts).toEqual(splits);
    });

    // Le piege 0.1 + 0.2 vu depuis la validation : 0.1 + 0.2 doit etre
    // accepte comme 0.3 grace a la somme en centimes.
    it("0.1 + 0.2 pour un montant de 0.3 : accepte", () => {
      const res = resoudreRepartition(
        0.3,
        {
          type: "amounts",
          splits: [
            { userId: "u1", amount: 0.1 },
            { userId: "u2", amount: 0.2 },
          ],
        },
        estMembre
      );
      expect(res.ok).toBe(true);
    });

    // Une somme qui ne colle pas creerait de l'argent ou en ferait disparaitre.
    it("somme differente du montant : refuse avec les deux chiffres dans le message", () => {
      const res = resoudreRepartition(
        10,
        {
          type: "amounts",
          splits: [
            { userId: "u1", amount: 6 },
            { userId: "u2", amount: 3 },
          ],
        },
        estMembre
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.erreur).toContain("9.00");
        expect(res.erreur).toContain("10.00");
      }
    });

    // Ecart d'un seul centime : doit deja etre refuse.
    it("un centime d'ecart : refuse", () => {
      const res = resoudreRepartition(
        10,
        {
          type: "amounts",
          splits: [
            { userId: "u1", amount: 5 },
            { userId: "u2", amount: 4.99 },
          ],
        },
        estMembre
      );
      expect(res.ok).toBe(false);
    });

    it("liste vide : refusee", () => {
      const res = resoudreRepartition(10, { type: "amounts", splits: [] }, estMembre);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.erreur).toContain("manquante");
    });

    it("un non-membre : refuse", () => {
      const res = resoudreRepartition(
        10,
        {
          type: "amounts",
          splits: [
            { userId: "u1", amount: 5 },
            { userId: "intrus", amount: 5 },
          ],
        },
        estMembre
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.erreur).toContain("ne fait pas partie");
    });
  });
});

describe("construireRepartitionInput", () => {
  const pourcentages = [{ userId: "u1", pourcentage: 100 }];
  const splits = [{ userId: "u1", amount: 10 }];
  const memberIds = ["u1"];

  // La priorite doit rester la meme cote payeurs et cote participants, sinon
  // un meme corps de requete serait lu differemment.
  it("les trois champs a la fois : les pourcentages gagnent", () => {
    const input = construireRepartitionInput({ pourcentages, splits, memberIds });
    expect(input).toEqual({ type: "percentages", pourcentages });
  });

  it("splits + memberIds : les montants gagnent", () => {
    const input = construireRepartitionInput({ splits, memberIds });
    expect(input).toEqual({ type: "amounts", splits });
  });

  it("memberIds seul : repartition egale", () => {
    expect(construireRepartitionInput({ memberIds })).toEqual({ type: "equal", memberIds });
  });

  it("pourcentages seuls", () => {
    expect(construireRepartitionInput({ pourcentages })).toEqual({ type: "percentages", pourcentages });
  });

  it("splits seuls", () => {
    expect(construireRepartitionInput({ splits })).toEqual({ type: "amounts", splits });
  });

  // Un champ present mais vide doit etre traite comme absent : le client
  // peut envoyer [] pour les modes qu'il n'utilise pas.
  it("champs vides ou absents : null", () => {
    expect(construireRepartitionInput({})).toBeNull();
    expect(construireRepartitionInput({ pourcentages: [], splits: [], memberIds: [] })).toBeNull();
  });

  it("un champ vide ne masque pas un champ rempli de priorite plus basse", () => {
    expect(construireRepartitionInput({ pourcentages: [], splits: [], memberIds })).toEqual({
      type: "equal",
      memberIds,
    });
  });
});
