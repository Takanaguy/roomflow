import { describe, expect, it } from "vitest";
import { remboursementsDepense } from "@/lib/settlements";

type Ligne = { userId: string; amount: number };
type Remboursement = { fromUserId: string; toUserId: string; amount: number };

// Les montants sortent en euros mais on verifie tout en centimes entiers :
// comparer des euros flottants avec toBe serait fragile pour une raison
// qui n'a rien a voir avec la logique testee.
const enCentimes = (euros: number) => Math.round(euros * 100);

// Applique les remboursements au solde de depart (paye moins part) : un
// remboursement from -> to fait monter le solde de from et baisser celui de
// to. Si tout est correct, tout le monde retombe a 0.
function soldesApres(payers: Ligne[], splits: Ligne[], rembs: Remboursement[]) {
  const soldes = new Map<string, number>();
  const ajouter = (id: string, c: number) => soldes.set(id, (soldes.get(id) ?? 0) + c);
  for (const p of payers) ajouter(p.userId, enCentimes(p.amount));
  for (const s of splits) ajouter(s.userId, -enCentimes(s.amount));
  for (const r of rembs) {
    ajouter(r.fromUserId, enCentimes(r.amount));
    ajouter(r.toUserId, -enCentimes(r.amount));
  }
  return soldes;
}

describe("remboursementsDepense : cas concrets", () => {
  // Le cas qui a motive la fonction : 100 euros payes 40/60 et partages
  // 33.34/33.33/33.33. Les soldes sont T1 +6.66, T2 +26.67, T3 -33.33.
  // Les montants doivent etre EXACTS, un 6.659999 serait visible a l'ecran.
  it("cas de Tanguy : T3 rembourse 6.66 a T1 et 26.67 a T2", () => {
    const rembs = remboursementsDepense(
      [
        { userId: "T1", amount: 40 },
        { userId: "T2", amount: 60 },
      ],
      [
        { userId: "T1", amount: 33.34 },
        { userId: "T2", amount: 33.33 },
        { userId: "T3", amount: 33.33 },
      ]
    );
    expect(rembs).toHaveLength(2);
    expect(rembs).toContainEqual({ fromUserId: "T3", toUserId: "T1", amount: 6.66 });
    expect(rembs).toContainEqual({ fromUserId: "T3", toUserId: "T2", amount: 26.67 });
  });

  // Le payeur est aussi participant : son solde net est 54 - 18 = 36, il ne
  // doit jamais apparaitre comme debiteur.
  it("un seul payeur avance tout : T2 et T3 lui rendent 18 chacun", () => {
    const rembs = remboursementsDepense(
      [{ userId: "T1", amount: 54 }],
      [
        { userId: "T1", amount: 18 },
        { userId: "T2", amount: 18 },
        { userId: "T3", amount: 18 },
      ]
    );
    expect(rembs).toHaveLength(2);
    expect(rembs).toContainEqual({ fromUserId: "T2", toUserId: "T1", amount: 18 });
    expect(rembs).toContainEqual({ fromUserId: "T3", toUserId: "T1", amount: 18 });
    expect(rembs.some((r) => r.fromUserId === "T1")).toBe(false);
  });

  // Le payeur n'a aucune part : il avance pour les autres, il est donc
  // present cote payeurs seulement.
  it("le payeur ne participe pas : T2 et T3 remboursent 15 chacun a T1", () => {
    const rembs = remboursementsDepense(
      [{ userId: "T1", amount: 30 }],
      [
        { userId: "T2", amount: 15 },
        { userId: "T3", amount: 15 },
      ]
    );
    expect(rembs).toHaveLength(2);
    expect(rembs).toContainEqual({ fromUserId: "T2", toUserId: "T1", amount: 15 });
    expect(rembs).toContainEqual({ fromUserId: "T3", toUserId: "T1", amount: 15 });
  });

  // Chacun a avance exactement sa part : rien a rembourser, et surtout pas
  // de remboursement de 0 euro.
  it("chacun a paye sa part : aucun remboursement", () => {
    const rembs = remboursementsDepense(
      [
        { userId: "T1", amount: 10 },
        { userId: "T2", amount: 20 },
        { userId: "T3", amount: 30 },
      ],
      [
        { userId: "T1", amount: 10 },
        { userId: "T2", amount: 20 },
        { userId: "T3", amount: 30 },
      ]
    );
    expect(rembs).toEqual([]);
  });

  // T1 apparait des deux cotes : seul son solde net (60 - 20 = +40) compte,
  // pas deux lignes separees.
  it("une personne qui paie ET doit n'a qu'un solde net", () => {
    const rembs = remboursementsDepense(
      [{ userId: "T1", amount: 60 }],
      [
        { userId: "T1", amount: 20 },
        { userId: "T2", amount: 20 },
        { userId: "T3", amount: 20 },
      ]
    );
    expect(rembs).toHaveLength(2);
    expect(rembs).toContainEqual({ fromUserId: "T2", toUserId: "T1", amount: 20 });
    expect(rembs).toContainEqual({ fromUserId: "T3", toUserId: "T1", amount: 20 });
  });

  // Un payeur qui paie plus que sa part est credite de la difference, et
  // celui qui paie moins que sa part est debiteur, meme s'il a avance de
  // l'argent : c'est le solde net qui decide du sens.
  it("plusieurs payeurs : un payeur peut rester debiteur", () => {
    const rembs = remboursementsDepense(
      [
        { userId: "T1", amount: 50 },
        { userId: "T2", amount: 10 },
      ],
      [
        { userId: "T1", amount: 20 },
        { userId: "T2", amount: 20 },
        { userId: "T3", amount: 20 },
      ]
    );
    // Soldes : T1 +30, T2 -10, T3 -20.
    expect(rembs).toHaveLength(2);
    expect(rembs).toContainEqual({ fromUserId: "T2", toUserId: "T1", amount: 10 });
    expect(rembs).toContainEqual({ fromUserId: "T3", toUserId: "T1", amount: 20 });
  });

  // Un participant qui n'a rien paye n'est cite que dans les parts.
  it("un participant qui n'a rien paye doit sa part au payeur", () => {
    const rembs = remboursementsDepense(
      [{ userId: "T1", amount: 12 }],
      [
        { userId: "T1", amount: 6 },
        { userId: "T2", amount: 6 },
      ]
    );
    expect(rembs).toEqual([{ fromUserId: "T2", toUserId: "T1", amount: 6 }]);
  });

  // Un payeur absent des parts : n'apparait que cote payeurs, et il est
  // rembourse de tout ce qu'il a avance.
  it("personne qui n'apparait que cote payeurs : creance integrale", () => {
    const rembs = remboursementsDepense(
      [
        { userId: "T1", amount: 5 },
        { userId: "T2", amount: 7.5 },
      ],
      [{ userId: "T3", amount: 12.5 }]
    );
    expect(rembs).toHaveLength(2);
    expect(rembs).toContainEqual({ fromUserId: "T3", toUserId: "T1", amount: 5 });
    expect(rembs).toContainEqual({ fromUserId: "T3", toUserId: "T2", amount: 7.5 });
  });

  // Une personne citee deux fois cote parts (ou payeurs) doit etre cumulee,
  // pas ecrasee par la derniere ligne.
  it("le meme utilisateur cite deux fois est cumule", () => {
    const rembs = remboursementsDepense(
      [{ userId: "T1", amount: 30 }],
      [
        { userId: "T2", amount: 10 },
        { userId: "T2", amount: 20 },
      ]
    );
    expect(rembs).toEqual([{ fromUserId: "T2", toUserId: "T1", amount: 30 }]);
  });
});

describe("remboursementsDepense : cas limites", () => {
  it("listes vides des deux cotes : aucun remboursement", () => {
    expect(remboursementsDepense([], [])).toEqual([]);
  });

  it("montants a 0 : aucun remboursement", () => {
    expect(
      remboursementsDepense([{ userId: "T1", amount: 0 }], [{ userId: "T2", amount: 0 }])
    ).toEqual([]);
  });

  // Chaque ligne est arrondie au centime avant le calcul : un ecart de moins
  // d'un demi-centime ne doit pas produire un remboursement fantome.
  it("ecart de moins d'un demi-centime : ignore", () => {
    expect(
      remboursementsDepense([{ userId: "T1", amount: 0.004 }], [{ userId: "T2", amount: 0.004 }])
    ).toEqual([]);
    expect(
      remboursementsDepense([{ userId: "T1", amount: 10.004 }], [{ userId: "T1", amount: 10 }])
    ).toEqual([]);
    expect(
      remboursementsDepense([{ userId: "T1", amount: 10.001 }], [{ userId: "T2", amount: 10 }])
    ).toEqual([{ fromUserId: "T2", toUserId: "T1", amount: 10 }]);
  });

  // Limite du filtre : exactement 1 centime d'ecart doit etre conserve.
  it("un ecart d'exactement 1 centime est conserve", () => {
    expect(
      remboursementsDepense([{ userId: "T1", amount: 10.01 }], [{ userId: "T1", amount: 10 }])
    ).toEqual([]);
    expect(
      remboursementsDepense([{ userId: "T1", amount: 0.01 }], [{ userId: "T2", amount: 0.01 }])
    ).toEqual([{ fromUserId: "T2", toUserId: "T1", amount: 0.01 }]);
  });

  // Somme des payeurs differente de la somme des parts : ne devrait pas
  // arriver (la validation est en amont) mais la fonction ne doit ni boucler
  // ni lancer d'exception, sinon la page de detail planterait.
  it("somme des payeurs differente de la somme des parts : repond sans boucler", () => {
    const rembs = remboursementsDepense(
      [{ userId: "T1", amount: 100 }],
      [{ userId: "T2", amount: 30 }]
    );
    expect(rembs).toEqual([{ fromUserId: "T2", toUserId: "T1", amount: 30 }]);
  });
});

describe("remboursementsDepense : pieges des flottants", () => {
  const estUnCentimeExact = (r: Remboursement) => Math.round(r.amount * 100) / 100 === r.amount;

  // 0.1 + 0.2 vaut 0.30000000000000004 en flottant : si la fonction
  // additionnait des euros, on verrait une dette de 0.30000000000000004.
  it("0.1 et 0.2 : montants exacts", () => {
    const rembs = remboursementsDepense(
      [{ userId: "T1", amount: 0.3 }],
      [
        { userId: "T2", amount: 0.1 },
        { userId: "T3", amount: 0.2 },
      ]
    );
    expect(rembs).toHaveLength(2);
    expect(rembs).toContainEqual({ fromUserId: "T2", toUserId: "T1", amount: 0.1 });
    expect(rembs).toContainEqual({ fromUserId: "T3", toUserId: "T1", amount: 0.2 });
    for (const r of rembs) expect(estUnCentimeExact(r)).toBe(true);
  });

  it("0.1 + 0.2 saisi comme somme flottante cote parts : pas de reste fantome", () => {
    const rembs = remboursementsDepense(
      [
        { userId: "T1", amount: 0.1 },
        { userId: "T2", amount: 0.2 },
      ],
      [{ userId: "T3", amount: 0.1 + 0.2 }]
    );
    expect(rembs).toHaveLength(2);
    expect(rembs).toContainEqual({ fromUserId: "T3", toUserId: "T1", amount: 0.1 });
    expect(rembs).toContainEqual({ fromUserId: "T3", toUserId: "T2", amount: 0.2 });
  });

  // 33.33 + 33.33 + 33.34 doit faire 100 pile en centimes.
  it("33.33 + 33.33 + 33.34 : soldes a 0 apres remboursement", () => {
    const payers = [{ userId: "T1", amount: 100 }];
    const splits = [
      { userId: "T1", amount: 33.33 },
      { userId: "T2", amount: 33.33 },
      { userId: "T3", amount: 33.34 },
    ];
    const rembs = remboursementsDepense(payers, splits);
    expect(rembs).toHaveLength(2);
    expect(rembs).toContainEqual({ fromUserId: "T2", toUserId: "T1", amount: 33.33 });
    expect(rembs).toContainEqual({ fromUserId: "T3", toUserId: "T1", amount: 33.34 });
    for (const r of rembs) expect(estUnCentimeExact(r)).toBe(true);
    for (const solde of soldesApres(payers, splits, rembs).values()) expect(solde).toBe(0);
  });

  // 10.01 * 100 vaut 1000.9999999999999 en flottant : sans Math.round on
  // perdrait un centime.
  it("10.01 : le centime n'est pas perdu", () => {
    const rembs = remboursementsDepense(
      [{ userId: "T1", amount: 10.01 }],
      [{ userId: "T2", amount: 10.01 }]
    );
    expect(rembs).toEqual([{ fromUserId: "T2", toUserId: "T1", amount: 10.01 }]);
    expect(estUnCentimeExact(rembs[0])).toBe(true);
  });

  // Quelques montants connus pour mal se comporter une fois multiplies par 100.
  it.each([1.005, 1.15, 4.35, 8.2, 19.99, 57, 0.07, 1234.56])(
    "montant %s : le remboursement est un centime exact",
    (montant) => {
      const rembs = remboursementsDepense(
        [{ userId: "T1", amount: montant }],
        [{ userId: "T2", amount: montant }]
      );
      expect(rembs).toHaveLength(1);
      expect(estUnCentimeExact(rembs[0])).toBe(true);
      expect(enCentimes(rembs[0].amount)).toBe(enCentimes(montant));
    }
  );
});

describe("remboursementsDepense : pas d'effet de bord", () => {
  // Les tableaux viennent du document Mongoose de la depense : les modifier
  // changerait ce que la page affiche juste apres.
  it("les entrees ne sont pas modifiees", () => {
    const payers = [
      { userId: "T1", amount: 40 },
      { userId: "T2", amount: 60 },
    ];
    const splits = [
      { userId: "T1", amount: 33.34 },
      { userId: "T2", amount: 33.33 },
      { userId: "T3", amount: 33.33 },
    ];
    const payersAvant = structuredClone(payers);
    const splitsAvant = structuredClone(splits);

    remboursementsDepense(payers, splits);

    expect(payers).toEqual(payersAvant);
    expect(splits).toEqual(splitsAvant);
  });

  it("deux appels successifs donnent le meme resultat", () => {
    const payers = [{ userId: "T1", amount: 54 }];
    const splits = [
      { userId: "T1", amount: 18 },
      { userId: "T2", amount: 18 },
      { userId: "T3", amount: 18 },
    ];
    expect(remboursementsDepense(payers, splits)).toEqual(remboursementsDepense(payers, splits));
  });
});

describe("remboursementsDepense : proprietes sur des jeux", () => {
  // Jeux ecrits a la main : montants en euros avec somme payeurs = somme parts.
  const jeux: Record<string, { payers: Ligne[]; splits: Ligne[] }> = {
    "2 personnes": {
      payers: [{ userId: "A", amount: 25 }],
      splits: [{ userId: "B", amount: 25 }],
    },
    "cas de Tanguy": {
      payers: [
        { userId: "T1", amount: 40 },
        { userId: "T2", amount: 60 },
      ],
      splits: [
        { userId: "T1", amount: 33.34 },
        { userId: "T2", amount: 33.33 },
        { userId: "T3", amount: 33.33 },
      ],
    },
    "4 personnes, deux payeurs": {
      payers: [
        { userId: "A", amount: 80.5 },
        { userId: "B", amount: 19.5 },
      ],
      splits: [
        { userId: "A", amount: 25 },
        { userId: "B", amount: 25 },
        { userId: "C", amount: 25 },
        { userId: "D", amount: 25 },
      ],
    },
    "5 personnes, montants premiers entre eux": {
      payers: [
        { userId: "A", amount: 13.73 },
        { userId: "B", amount: 8.11 },
      ],
      splits: [
        { userId: "A", amount: 2.27 },
        { userId: "B", amount: 4.21 },
        { userId: "C", amount: 9.97 },
        { userId: "D", amount: 3.01 },
        { userId: "E", amount: 2.38 },
      ],
    },
  };

  for (const [nom, { payers, splits }] of Object.entries(jeux)) {
    describe(nom, () => {
      const somme = (l: Ligne[]) => l.reduce((s, x) => s + enCentimes(x.amount), 0);
      const rembs = remboursementsDepense(payers, splits);
      const nonNuls = [...soldesApres(payers, splits, []).values()].filter((c) => c !== 0).length;

      it("le jeu de test est bien equilibre", () => {
        expect(somme(payers)).toBe(somme(splits));
      });

      it("apres les remboursements, tous les soldes sont a 0", () => {
        for (const solde of soldesApres(payers, splits, rembs).values()) expect(solde).toBe(0);
      });

      it("au plus (personnes non nulles - 1) remboursements", () => {
        expect(rembs.length).toBeLessThanOrEqual(Math.max(nonNuls - 1, 0));
      });

      it("aucun montant <= 0 et aucun remboursement vers soi-meme", () => {
        for (const r of rembs) {
          expect(r.amount).toBeGreaterThan(0);
          expect(r.fromUserId).not.toBe(r.toUserId);
        }
      });

      it("tous les montants sont des centimes exacts", () => {
        for (const r of rembs) expect(Math.round(r.amount * 100) / 100).toBe(r.amount);
      });
    });
  }

  // Generateur congruentiel a graine fixe : reproductible, contrairement a
  // Math.random qui rendrait un echec impossible a rejouer. Les montants sont
  // d'abord tires en centimes entiers (donc exacts), puis convertis en euros
  // comme le fait l'application.
  it("100 jeux pseudo-aleatoires de 2 a 6 personnes (somme payeurs = somme parts)", () => {
    let graine = 987654;
    const suivant = () => {
      graine = (graine * 1103515245 + 12345) % 2147483648;
      return graine;
    };

    // Repartit `total` centimes entre les personnes choisies, chacune
    // recevant au moins 0 et le dernier prenant le reste (somme exacte).
    const repartir = (ids: string[], total: number): Ligne[] => {
      const lignes: Ligne[] = [];
      let reste = total;
      ids.forEach((userId, i) => {
        const part = i === ids.length - 1 ? reste : suivant() % (reste + 1);
        reste -= part;
        lignes.push({ userId, amount: part / 100 });
      });
      return lignes;
    };

    // Sous-ensemble non vide de personnes : certaines n'apparaissent que
    // cote payeurs, d'autres que cote parts, d'autres des deux cotes.
    const choisir = (tous: string[]) => {
      const choisis = tous.filter(() => suivant() % 2 === 0);
      return choisis.length > 0 ? choisis : [tous[suivant() % tous.length]];
    };

    for (let essai = 0; essai < 100; essai++) {
      const n = 2 + (suivant() % 5);
      const tous = Array.from({ length: n }, (_, i) => `u${i}`);
      const total = 1 + (suivant() % 100000);
      const payers = repartir(choisir(tous), total);
      const splits = repartir(choisir(tous), total);
      const payersAvant = structuredClone(payers);
      const splitsAvant = structuredClone(splits);

      const rembs = remboursementsDepense(payers, splits);

      for (const solde of soldesApres(payers, splits, rembs).values()) expect(solde).toBe(0);

      const nonNuls = [...soldesApres(payers, splits, []).values()].filter((c) => c !== 0).length;
      expect(rembs.length).toBeLessThanOrEqual(Math.max(nonNuls - 1, 0));

      for (const r of rembs) {
        expect(r.amount).toBeGreaterThan(0);
        expect(r.fromUserId).not.toBe(r.toUserId);
        expect(Math.round(r.amount * 100) / 100).toBe(r.amount);
      }

      expect(payers).toEqual(payersAvant);
      expect(splits).toEqual(splitsAvant);
    }
  });
});
