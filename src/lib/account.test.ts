import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DUREE_VERROU_SUPPRESSION_MINUTES,
  RECENCE_CONNEXION_MINUTES,
  classerSoldes,
  connexionRecente,
  peutSupprimer,
  verrouPrenable,
  type SoldeColocation,
} from "@/lib/account";

// account.ts importe Mongoose et les modeles, mais rien ne s'ouvre a
// l'import : la connexion est paresseuse (connectDB). On ne teste ici que les
// trois fonctions pures, sans simuler de base. evaluerSuppressionCompte et
// supprimerCompte touchent la base : elles restent hors de ce fichier.

// Instant fige, ecrit en ISO avec "Z" : le test ne depend jamais du fuseau de
// la machine ni de l'horloge reelle.
const MAINTENANT = Date.parse("2026-10-26T12:00:00.000Z");

// Construit a partir de la constante, pas d'un "10" ecrit en dur : si la
// duree change, les tests de frontiere suivent au lieu de rester faux.
const FENETRE_MS = RECENCE_CONNEXION_MINUTES * 60_000;

const solde = (householdId: string, montant: number, nom = `Coloc ${householdId}`): SoldeColocation => ({
  householdId,
  nom,
  montant,
});

// ---------------------------------------------------------------------------
// RECENCE_CONNEXION_MINUTES
// ---------------------------------------------------------------------------

describe("RECENCE_CONNEXION_MINUTES", () => {
  it("vaut 10", () => {
    expect(RECENCE_CONNEXION_MINUTES).toBe(10);
  });

  it("est un entier strictement positif (sinon la fenetre serait vide ou fausse)", () => {
    expect(Number.isInteger(RECENCE_CONNEXION_MINUTES)).toBe(true);
    expect(RECENCE_CONNEXION_MINUTES).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// connexionRecente
// ---------------------------------------------------------------------------

describe("connexionRecente : date absente ou illisible", () => {
  it("undefined : false", () => {
    expect(connexionRecente(undefined, MAINTENANT)).toBe(false);
  });

  it("NaN : false", () => {
    expect(connexionRecente(NaN, MAINTENANT)).toBe(false);
  });

  it("Infinity et -Infinity : false", () => {
    expect(connexionRecente(Infinity, MAINTENANT)).toBe(false);
    expect(connexionRecente(-Infinity, MAINTENANT)).toBe(false);
  });

  it("valeurs non numeriques glissees malgre le typage (null, '123', {}) : false, sans exception", () => {
    // Le jeton de session vient d'un cookie signe, mais un vieux jeton ou un
    // bug pourrait y laisser n'importe quoi : on refuse au lieu de planter.
    expect(connexionRecente(null as unknown as number, MAINTENANT)).toBe(false);
    expect(connexionRecente("123" as unknown as number, MAINTENANT)).toBe(false);
    expect(connexionRecente({} as unknown as number, MAINTENANT)).toBe(false);
  });

  it("chaine qui ressemble a une date recente : false (pas de conversion implicite)", () => {
    expect(connexionRecente(String(MAINTENANT) as unknown as number, MAINTENANT)).toBe(false);
  });

  it("objet Date glisse malgre le typage : false (seul un nombre est accepte)", () => {
    expect(connexionRecente(new Date(MAINTENANT) as unknown as number, MAINTENANT)).toBe(false);
  });
});

describe("connexionRecente : dans la fenetre", () => {
  it("connecte a l'instant meme : true", () => {
    expect(connexionRecente(MAINTENANT, MAINTENANT)).toBe(true);
  });

  it("il y a 1 seconde : true", () => {
    expect(connexionRecente(MAINTENANT - 1000, MAINTENANT)).toBe(true);
  });

  it("il y a 9 min 59 s 999 ms (1 ms avant la limite) : true", () => {
    expect(connexionRecente(MAINTENANT - (FENETRE_MS - 1), MAINTENANT)).toBe(true);
    // Meme chose ecrite en clair, pour que la lecture du test n'exige pas la constante.
    expect(connexionRecente(MAINTENANT - (9 * 60_000 + 59_999), MAINTENANT)).toBe(true);
  });

  it("il y a EXACTEMENT 10 minutes : true (frontiere incluse, ecart <= fenetre)", () => {
    expect(connexionRecente(MAINTENANT - FENETRE_MS, MAINTENANT)).toBe(true);
    expect(connexionRecente(MAINTENANT - 600_000, MAINTENANT)).toBe(true);
  });
});

describe("connexionRecente : hors fenetre", () => {
  it("10 minutes + 1 ms : false", () => {
    expect(connexionRecente(MAINTENANT - (FENETRE_MS + 1), MAINTENANT)).toBe(false);
  });

  it("il y a 1 heure : false", () => {
    expect(connexionRecente(MAINTENANT - 3_600_000, MAINTENANT)).toBe(false);
  });

  it("il y a un an : false", () => {
    expect(connexionRecente(MAINTENANT - 365 * 86_400_000, MAINTENANT)).toBe(false);
  });

  it("connecteLe = 0 (epoque) avec une horloge actuelle : false, traite comme un nombre", () => {
    expect(connexionRecente(0, MAINTENANT)).toBe(false);
  });

  it("connecteLe = 0 est bien calcule, pas pris pour 'absent' : recent si maintenant est proche de l'epoque", () => {
    // Un "if (!connecteLe)" aurait renvoye false pour 0 sans calcul.
    expect(connexionRecente(0, FENETRE_MS)).toBe(true);
    expect(connexionRecente(0, FENETRE_MS + 1)).toBe(false);
  });

  it("connecteLe negatif (avant l'epoque) : false si l'ecart depasse la fenetre", () => {
    expect(connexionRecente(-1, MAINTENANT)).toBe(false);
  });
});

describe("connexionRecente : connexion dans le futur", () => {
  // Prudence : une horloge decalee ou un jeton bricole ne doit jamais ouvrir
  // l'acces a la suppression, car on ne sait pas mesurer l'anciennete.
  it("1 ms dans le futur : false", () => {
    expect(connexionRecente(MAINTENANT + 1, MAINTENANT)).toBe(false);
  });

  it("1 seconde dans le futur : false", () => {
    expect(connexionRecente(MAINTENANT + 1000, MAINTENANT)).toBe(false);
  });

  it("1 heure dans le futur : false", () => {
    expect(connexionRecente(MAINTENANT + 3_600_000, MAINTENANT)).toBe(false);
  });
});

describe("connexionRecente : maintenant illisible", () => {
  // Documente le code actuel : on ne valide que connecteLe. Avec un
  // "maintenant" non fini l'ecart n'est pas dans la fenetre, donc false.
  it("maintenant NaN : false", () => {
    expect(connexionRecente(MAINTENANT, NaN)).toBe(false);
  });

  it("maintenant Infinity : false (ecart infini)", () => {
    expect(connexionRecente(MAINTENANT, Infinity)).toBe(false);
  });

  it("maintenant -Infinity : false (ecart negatif, traite comme futur)", () => {
    expect(connexionRecente(MAINTENANT, -Infinity)).toBe(false);
  });
});

describe("connexionRecente : coherence avec la constante", () => {
  it.each([
    ["0 ms", 0, true],
    ["fenetre - 1 ms", FENETRE_MS - 1, true],
    ["fenetre pile", FENETRE_MS, true],
    ["fenetre + 1 ms", FENETRE_MS + 1, false],
    ["2 x fenetre", 2 * FENETRE_MS, false],
  ])("ecart de %s : %s", (_nom, ecart, attendu) => {
    expect(connexionRecente(MAINTENANT - ecart, MAINTENANT)).toBe(attendu);
  });

  it("la frontiere est exprimee en minutes : RECENCE_CONNEXION_MINUTES x 60 000 ms", () => {
    expect(FENETRE_MS).toBe(RECENCE_CONNEXION_MINUTES * 60 * 1000);
  });

  it("la reponse ne depend que de l'ecart, pas de l'instant absolu", () => {
    for (const base of [0, 1_000, MAINTENANT, Date.parse("2100-01-01T00:00:00.000Z")]) {
      expect(connexionRecente(base, base + FENETRE_MS)).toBe(true);
      expect(connexionRecente(base, base + FENETRE_MS + 1)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// classerSoldes
// ---------------------------------------------------------------------------

describe("classerSoldes : entree vide", () => {
  it("liste vide : { dettes: [], creances: [] }", () => {
    expect(classerSoldes([])).toEqual({ dettes: [], creances: [] });
  });
});

describe("classerSoldes : dettes et creances", () => {
  it("montant negatif : dette, montant en valeur absolue", () => {
    const r = classerSoldes([solde("a", -30, "Maison")]);
    expect(r.dettes).toEqual([{ householdId: "a", nom: "Maison", montant: 30 }]);
    expect(r.creances).toEqual([]);
  });

  it("montant positif : creance", () => {
    const r = classerSoldes([solde("a", 42.5, "Maison")]);
    expect(r.creances).toEqual([{ householdId: "a", nom: "Maison", montant: 42.5 }]);
    expect(r.dettes).toEqual([]);
  });

  it("montant 0 : ignore", () => {
    expect(classerSoldes([solde("a", 0)])).toEqual({ dettes: [], creances: [] });
  });

  it("-0 (zero negatif) : ignore", () => {
    expect(classerSoldes([solde("a", -0)])).toEqual({ dettes: [], creances: [] });
  });

  it("le nom et l'id sont recopies tels quels", () => {
    const r = classerSoldes([solde("65f0c0ffee", -5, "Coloc  \"Les Lilas\" <b>")]);
    expect(r.dettes[0].householdId).toBe("65f0c0ffee");
    expect(r.dettes[0].nom).toBe("Coloc  \"Les Lilas\" <b>");
  });

  it("les champs en trop de l'entree ne sont pas recopies (seuls id, nom, montant sortent)", () => {
    const entree = { householdId: "a", nom: "A", montant: -10, secret: "x" } as SoldeColocation;
    const r = classerSoldes([entree]);
    expect(Object.keys(r.dettes[0]).sort()).toEqual(["householdId", "montant", "nom"]);
  });
});

describe("classerSoldes : arrondi au centime", () => {
  it("-12.345 : dette de 12.35 (demi vers le haut sur la valeur absolue)", () => {
    // 12.345 * 100 vaut exactement 1234.5 en flottant, Math.round donne 1235.
    expect(classerSoldes([solde("a", -12.345)]).dettes[0].montant).toBe(12.35);
  });

  it("12.345 : creance de 12.35 (meme arrondi pour les deux signes)", () => {
    expect(classerSoldes([solde("a", 12.345)]).creances[0].montant).toBe(12.35);
  });

  it("-12.344 : 12.34 ; -12.346 : 12.35", () => {
    expect(classerSoldes([solde("a", -12.344)]).dettes[0].montant).toBe(12.34);
    expect(classerSoldes([solde("a", -12.346)]).dettes[0].montant).toBe(12.35);
  });

  it("piege flottant : -0.1 - 0.2 (-0.30000000000000004) devient 0.3", () => {
    const brut = -0.1 - 0.2;
    expect(brut).not.toBe(-0.3);
    expect(classerSoldes([solde("a", brut)]).dettes[0].montant).toBe(0.3);
  });

  it("0.1 + 0.2 (0.30000000000000004) en creance devient 0.3", () => {
    expect(classerSoldes([solde("a", 0.1 + 0.2)]).creances[0].montant).toBe(0.3);
  });

  it("-1.005 : 1 et non 1.01 (limite du flottant, 1.005 * 100 = 100.49999...)", () => {
    // Documente le code actuel, sans le juger : mathematiquement 1.005 arrondit
    // a 1.01, mais 1.005 n'est pas representable exactement. Sans consequence
    // reelle tant que les soldes viennent de calculerSoldesNets (centimes entiers
    // divises par 100), qui ne produit jamais de demi-centime.
    expect(classerSoldes([solde("a", -1.005)]).dettes[0].montant).toBe(1);
  });

  it("1e9 : conserve sans perte", () => {
    expect(classerSoldes([solde("a", -1e9)]).dettes[0].montant).toBe(1e9);
    expect(classerSoldes([solde("a", 1e9)]).creances[0].montant).toBe(1e9);
  });

  it("grand montant avec centimes (123456789.12) : conserve", () => {
    expect(classerSoldes([solde("a", -123456789.12)]).dettes[0].montant).toBe(123456789.12);
  });

  it("un montant deja au centime reste identique", () => {
    for (const m of [0.01, 0.1, 0.99, 1, 23.5, 296.49, 92.6, 999.99]) {
      expect(classerSoldes([solde("a", m)]).creances[0].montant).toBe(m);
      expect(classerSoldes([solde("a", -m)]).dettes[0].montant).toBe(m);
    }
  });
});

describe("classerSoldes : seuil du centime", () => {
  it.each([
    ["0.004", 0.004],
    ["-0.004", -0.004],
    ["0.0049", 0.0049],
    ["-0.0049", -0.0049],
    ["0.005", 0.005],
    ["-0.005", -0.005],
    ["0.0099", 0.0099],
    ["-0.0099", -0.0099],
    ["0.00999999999", 0.00999999999],
    ["-0.00999999999", -0.00999999999],
    ["Number.MIN_VALUE", Number.MIN_VALUE],
    ["-Number.MIN_VALUE", -Number.MIN_VALUE],
    ["Number.EPSILON", Number.EPSILON],
  ])("%s : ignore (ni dette ni creance)", (_nom, montant) => {
    expect(classerSoldes([solde("a", montant)])).toEqual({ dettes: [], creances: [] });
  });

  it("exactement 0.01 : creance de 0.01 (le seuil est inclus, < 0.01 seulement ignore)", () => {
    const r = classerSoldes([solde("a", 0.01)]);
    expect(r.creances).toEqual([{ householdId: "a", nom: "Coloc a", montant: 0.01 }]);
    expect(r.dettes).toEqual([]);
  });

  it("exactement -0.01 : dette de 0.01 (elle bloque la suppression)", () => {
    const r = classerSoldes([solde("a", -0.01)]);
    expect(r.dettes).toEqual([{ householdId: "a", nom: "Coloc a", montant: 0.01 }]);
    expect(r.creances).toEqual([]);
  });

  it("juste au-dessus du seuil (0.0100000001) : garde, montant arrondi a 0.01", () => {
    expect(classerSoldes([solde("a", 0.0100000001)]).creances[0].montant).toBe(0.01);
    expect(classerSoldes([solde("a", -0.0100000001)]).dettes[0].montant).toBe(0.01);
  });

  it("aucun montant garde n'est arrondi a 0 (le seuil protege de '0,00 EUR')", () => {
    const entrees = [0.01, 0.0100001, 0.0149, 0.0151, -0.01, -0.0149].map((m, i) => solde(`h${i}`, m));
    const { dettes, creances } = classerSoldes(entrees);
    for (const l of [...dettes, ...creances]) expect(l.montant).toBeGreaterThanOrEqual(0.01);
  });
});

describe("classerSoldes : valeurs non finies", () => {
  it("NaN : ignore", () => {
    expect(classerSoldes([solde("a", NaN)])).toEqual({ dettes: [], creances: [] });
  });

  it("NaN au milieu d'autres soldes : seul le NaN disparait", () => {
    const r = classerSoldes([solde("a", -5), solde("b", NaN), solde("c", 7)]);
    expect(r.dettes.map((l) => l.householdId)).toEqual(["a"]);
    expect(r.creances.map((l) => l.householdId)).toEqual(["c"]);
  });

  it("Infinity et -Infinity : rangees comme creance / dette de montant Infinity (comportement fige)", () => {
    // Documente le code actuel : seul NaN est ecarte. Infinity ne peut pas
    // sortir de calculerSoldesNets (centimes entiers), donc sans risque
    // aujourd'hui, mais aucune garde ne l'empecherait de bloquer une suppression.
    const r = classerSoldes([solde("a", Infinity), solde("b", -Infinity)]);
    expect(r.creances).toEqual([{ householdId: "a", nom: "Coloc a", montant: Infinity }]);
    expect(r.dettes).toEqual([{ householdId: "b", nom: "Coloc b", montant: Infinity }]);
  });
});

describe("classerSoldes : plusieurs colocations", () => {
  it("melange dettes, creances et soldes nuls : chacun dans la bonne liste", () => {
    const r = classerSoldes([
      solde("a", -10),
      solde("b", 20),
      solde("c", 0),
      solde("d", -0.004),
      solde("e", 5.5),
      solde("f", -7.25),
    ]);
    expect(r.dettes.map((l) => [l.householdId, l.montant])).toEqual([
      ["a", 10],
      ["f", 7.25],
    ]);
    expect(r.creances.map((l) => [l.householdId, l.montant])).toEqual([
      ["b", 20],
      ["e", 5.5],
    ]);
  });

  it("l'ordre d'entree est conserve dans chaque liste (pas de tri par montant)", () => {
    const r = classerSoldes([
      solde("z", -1),
      solde("y", -100),
      solde("x", -50),
      solde("w", 1),
      solde("v", 100),
      solde("u", 50),
    ]);
    expect(r.dettes.map((l) => l.householdId)).toEqual(["z", "y", "x"]);
    expect(r.creances.map((l) => l.householdId)).toEqual(["w", "v", "u"]);
  });

  it("un seul solde non nul parmi plusieurs nuls : une seule ligne", () => {
    const r = classerSoldes([solde("a", 0), solde("b", -3), solde("c", 0)]);
    expect(r.dettes).toHaveLength(1);
    expect(r.creances).toHaveLength(0);
  });

  it("deux soldes de meme householdId : pas de dedoublonnage (comportement fige)", () => {
    // evaluerSuppressionCompte produit un solde par colocation, donc pas de
    // doublon en pratique ; la fonction ne s'en occupe pas.
    const r = classerSoldes([solde("a", -1), solde("a", -2)]);
    expect(r.dettes.map((l) => l.montant)).toEqual([1, 2]);
  });
});

describe("classerSoldes : pas d'effet de bord", () => {
  it("l'entree n'est pas modifiee (tableau et objets gele : toute ecriture leverait une erreur)", () => {
    const entree = [solde("a", -12.345), solde("b", 0.004), solde("c", 8.5)];
    const copie = structuredClone(entree);
    for (const s of entree) Object.freeze(s);
    Object.freeze(entree);

    expect(() => classerSoldes(entree)).not.toThrow();
    expect(entree).toEqual(copie);
  });

  it("les objets rendus ne sont pas ceux de l'entree (nouvelles references)", () => {
    const a = solde("a", -10);
    const b = solde("b", 10);
    const r = classerSoldes([a, b]);
    expect(r.dettes[0]).not.toBe(a);
    expect(r.creances[0]).not.toBe(b);
  });

  it("modifier un objet rendu ne touche pas l'entree", () => {
    const a = solde("a", -10);
    const r = classerSoldes([a]);
    r.dettes[0].montant = 999;
    r.dettes[0].nom = "autre";
    expect(a.montant).toBe(-10);
    expect(a.nom).toBe("Coloc a");
  });

  it("deux appels successifs donnent le meme resultat, sans memoire entre eux", () => {
    const entree = [solde("a", -3), solde("b", 4)];
    expect(classerSoldes(entree)).toEqual(classerSoldes(entree));
    expect(classerSoldes(entree).dettes).not.toBe(classerSoldes(entree).dettes);
  });
});

// ---------------------------------------------------------------------------
// classerSoldes : proprietes sur jeux pseudo-aleatoires
// ---------------------------------------------------------------------------

// Generateur a graine fixe (mulberry32) : un echec est toujours rejouable,
// contrairement a Math.random().
function generateur(graine: number): () => number {
  let etat = graine >>> 0;
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Un melange volontairement tordu autour du seuil du centime, pour que les
// cas limites tombent souvent et pas seulement des montants "ronds".
const MONTANTS_PIEGES = [0, -0, 0.004, -0.004, 0.0049, -0.0049, 0.0099, -0.0099, 0.01, -0.01, NaN];

function jeuAleatoire(rnd: () => number): SoldeColocation[] {
  const taille = Math.floor(rnd() * 9); // 0 a 8 colocations
  return Array.from({ length: taille }, (_, i) => {
    const r = rnd();
    let montant: number;
    if (r < 0.3) montant = MONTANTS_PIEGES[Math.floor(rnd() * MONTANTS_PIEGES.length)];
    else if (r < 0.5) montant = (Math.round(rnd() * 20000) - 10000) / 100; // au centime
    else if (r < 0.8) montant = (rnd() - 0.5) * 2000; // flottant brut, centimes parasites
    else montant = (rnd() - 0.5) * 0.04; // autour de zero
    // Un id unique par entree : permet de tester "jamais dans les deux listes".
    return { householdId: `h${i}`, nom: `Coloc ${i}`, montant };
  });
}

describe("classerSoldes : proprietes sur 100 jeux pseudo-aleatoires (graine fixe)", () => {
  const rnd = generateur(20261026);
  const jeux = Array.from({ length: 100 }, () => jeuAleatoire(rnd));

  it("les jeux couvrent bien le vide, les dettes, les creances et les ignores", () => {
    // Garde-fou contre un generateur qui ne produirait plus rien d'interessant.
    const resultats = jeux.map((j) => classerSoldes(j));
    expect(jeux.some((j) => j.length === 0)).toBe(true);
    expect(resultats.some((r) => r.dettes.length > 0)).toBe(true);
    expect(resultats.some((r) => r.creances.length > 0)).toBe(true);
    expect(
      jeux.some((j) => j.some((s) => Number.isNaN(s.montant) || Math.abs(s.montant) < 0.01))
    ).toBe(true);
  });

  it("dettes + creances + ignores = taille de l'entree", () => {
    for (const jeu of jeux) {
      const { dettes, creances } = classerSoldes(jeu);
      // Ignore = NaN ou ecart sous le centime. Compte ici sans reutiliser la
      // fonction testee.
      const ignores = jeu.filter((s) => Number.isNaN(s.montant) || Math.abs(s.montant) < 0.01).length;
      expect(dettes.length + creances.length + ignores).toBe(jeu.length);
    }
  });

  it("tous les montants rendus sont > 0 (et au moins 0.01), et finis", () => {
    for (const jeu of jeux) {
      const { dettes, creances } = classerSoldes(jeu);
      for (const l of [...dettes, ...creances]) {
        expect(l.montant).toBeGreaterThanOrEqual(0.01);
        expect(Number.isFinite(l.montant)).toBe(true);
      }
    }
  });

  it("tous les montants rendus sont au centime (x100 entier, a l'erreur flottante pres)", () => {
    for (const jeu of jeux) {
      const { dettes, creances } = classerSoldes(jeu);
      for (const l of [...dettes, ...creances]) {
        const centimes = l.montant * 100;
        expect(Math.abs(centimes - Math.round(centimes))).toBeLessThan(1e-6);
      }
    }
  });

  it("aucune colocation n'apparait dans les deux listes, ni deux fois dans une liste", () => {
    for (const jeu of jeux) {
      const { dettes, creances } = classerSoldes(jeu);
      const ids = [...dettes, ...creances].map((l) => l.householdId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("le signe de l'entree decide la liste, et l'ordre d'entree est conserve", () => {
    for (const jeu of jeux) {
      const { dettes, creances } = classerSoldes(jeu);
      const grands = jeu.filter((s) => Math.abs(s.montant) >= 0.01);
      expect(dettes.map((l) => l.householdId)).toEqual(
        grands.filter((s) => s.montant < 0).map((s) => s.householdId)
      );
      expect(creances.map((l) => l.householdId)).toEqual(
        grands.filter((s) => s.montant > 0).map((s) => s.householdId)
      );
    }
  });

  it("chaque montant rendu est l'arrondi au centime de la valeur absolue d'entree (a 1 centime pres)", () => {
    for (const jeu of jeux) {
      const parId = new Map(jeu.map((s) => [s.householdId, s.montant]));
      const { dettes, creances } = classerSoldes(jeu);
      for (const l of [...dettes, ...creances]) {
        expect(Math.abs(l.montant - Math.abs(parId.get(l.householdId)!))).toBeLessThanOrEqual(0.005 + 1e-9);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// peutSupprimer
// ---------------------------------------------------------------------------

describe("peutSupprimer", () => {
  it("tableau vide : true", () => {
    expect(peutSupprimer([])).toBe(true);
  });

  it("une seule dette : false (elle suffit a bloquer)", () => {
    expect(peutSupprimer([{ householdId: "a", nom: "A", montant: 1 }])).toBe(false);
  });

  it("plusieurs dettes : false", () => {
    expect(
      peutSupprimer([
        { householdId: "a", nom: "A", montant: 1 },
        { householdId: "b", nom: "B", montant: 2 },
        { householdId: "c", nom: "C", montant: 3 },
      ])
    ).toBe(false);
  });

  it("seule la longueur compte : objet vide, undefined, null, 0, chaine vide comptent comme une dette", () => {
    // Fige le comportement : la fonction ne regarde pas le contenu.
    expect(peutSupprimer([{}])).toBe(false);
    expect(peutSupprimer([undefined])).toBe(false);
    expect(peutSupprimer([null])).toBe(false);
    expect(peutSupprimer([0])).toBe(false);
    expect(peutSupprimer([""])).toBe(false);
    expect(peutSupprimer([NaN])).toBe(false);
    expect(peutSupprimer([false])).toBe(false);
  });

  it("tableau creux (trous) de longueur 1 : false", () => {
    expect(peutSupprimer([,])).toBe(false);
    expect(peutSupprimer(new Array(3))).toBe(false);
  });

  it("ne modifie pas le tableau recu", () => {
    const dettes = Object.freeze([{ montant: 1 }]) as unknown as unknown[];
    expect(() => peutSupprimer(dettes)).not.toThrow();
    expect(dettes).toHaveLength(1);
  });
});

describe("peutSupprimer : coherence avec classerSoldes", () => {
  it("aucune dette (que des creances ou des nuls) : on peut supprimer", () => {
    expect(peutSupprimer(classerSoldes([solde("a", 50), solde("b", 0), solde("c", -0.004)]).dettes)).toBe(
      true
    );
  });

  it("une dette dans une seule colocation sur plusieurs : bloque", () => {
    expect(peutSupprimer(classerSoldes([solde("a", 50), solde("b", -20), solde("c", 5)]).dettes)).toBe(
      false
    );
  });

  it("dette d'un centime pile (-0.01) : bloque", () => {
    expect(peutSupprimer(classerSoldes([solde("a", -0.01)]).dettes)).toBe(false);
  });

  it("dette sous le centime (-0.0099) : ne bloque pas", () => {
    expect(peutSupprimer(classerSoldes([solde("a", -0.0099)]).dettes)).toBe(true);
  });

  it("une creance enorme n'empeche rien", () => {
    expect(peutSupprimer(classerSoldes([solde("a", 1e9)]).dettes)).toBe(true);
  });

  it("aucune colocation : on peut supprimer", () => {
    expect(peutSupprimer(classerSoldes([]).dettes)).toBe(true);
  });

  it("sur 100 jeux pseudo-aleatoires : vrai si et seulement si aucun montant ne vaut <= -0.01", () => {
    const rnd = generateur(777);
    let bloques = 0;
    let libres = 0;
    for (let n = 0; n < 100; n++) {
      const jeu = jeuAleatoire(rnd);
      const attendu = !jeu.some((s) => s.montant <= -0.01);
      const obtenu = peutSupprimer(classerSoldes(jeu).dettes);
      expect(obtenu).toBe(attendu);
      if (attendu) libres++;
      else bloques++;
    }
    // Les deux branches doivent etre vues, sinon la propriete serait triviale.
    expect(bloques).toBeGreaterThan(0);
    expect(libres).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// DUREE_VERROU_SUPPRESSION_MINUTES et verrouPrenable
// ---------------------------------------------------------------------------

// Construit a partir de la constante, comme FENETRE_MS plus haut.
const VERROU_MS = DUREE_VERROU_SUPPRESSION_MINUTES * 60_000;
const MAINTENANT_DATE = new Date(MAINTENANT);
// Verrou pose il y a `ecartMs` millisecondes (negatif = dans le futur).
const poseIlYa = (ecartMs: number) => new Date(MAINTENANT - ecartMs);

describe("DUREE_VERROU_SUPPRESSION_MINUTES", () => {
  it("vaut 10", () => {
    expect(DUREE_VERROU_SUPPRESSION_MINUTES).toBe(10);
  });

  it("est un entier strictement positif", () => {
    expect(Number.isInteger(DUREE_VERROU_SUPPRESSION_MINUTES)).toBe(true);
    expect(DUREE_VERROU_SUPPRESSION_MINUTES).toBeGreaterThan(0);
  });
});

describe("verrouPrenable : verrou absent ou illisible", () => {
  it("null : prenable", () => {
    expect(verrouPrenable(null, MAINTENANT_DATE)).toBe(true);
  });

  it("undefined : prenable", () => {
    expect(verrouPrenable(undefined, MAINTENANT_DATE)).toBe(true);
  });

  it("date invalide (new Date('x')) : traitee comme absente, donc prenable", () => {
    expect(verrouPrenable(new Date("x"), MAINTENANT_DATE)).toBe(true);
    expect(verrouPrenable(new Date(NaN), MAINTENANT_DATE)).toBe(true);
  });

  it("valeur qui n'est pas une Date (chaine, nombre) glissee malgre le typage : prenable, sans exception", () => {
    // Documente le code actuel : seule une vraie Date compte comme verrou pose.
    expect(verrouPrenable("2026-10-26T11:59:00.000Z" as unknown as Date, MAINTENANT_DATE)).toBe(true);
    expect(verrouPrenable(MAINTENANT as unknown as Date, MAINTENANT_DATE)).toBe(true);
  });
});

describe("verrouPrenable : verrou recent", () => {
  it("pose a l'instant meme : non prenable", () => {
    expect(verrouPrenable(poseIlYa(0), MAINTENANT_DATE)).toBe(false);
  });

  it("pose il y a 1 seconde : non prenable", () => {
    expect(verrouPrenable(poseIlYa(1000), MAINTENANT_DATE)).toBe(false);
  });

  it("pose il y a 5 minutes : non prenable", () => {
    expect(verrouPrenable(poseIlYa(5 * 60_000), MAINTENANT_DATE)).toBe(false);
  });

  it("pose il y a 9 min 59 s 999 ms (1 ms avant la limite) : non prenable", () => {
    expect(verrouPrenable(poseIlYa(VERROU_MS - 1), MAINTENANT_DATE)).toBe(false);
    expect(verrouPrenable(poseIlYa(9 * 60_000 + 59_999), MAINTENANT_DATE)).toBe(false);
  });
});

describe("verrouPrenable : frontiere des 10 minutes", () => {
  // Le code compare avec "<" strict : a EXACTEMENT 10 minutes, le verrou n'est
  // pas encore repris (meme regle que le filtre Mongo $lt de supprimerCompte).
  it("pose il y a EXACTEMENT 10 minutes : non prenable (frontiere exclue)", () => {
    expect(verrouPrenable(poseIlYa(VERROU_MS), MAINTENANT_DATE)).toBe(false);
    expect(verrouPrenable(poseIlYa(600_000), MAINTENANT_DATE)).toBe(false);
  });

  it("pose il y a 10 minutes + 1 ms : prenable", () => {
    expect(verrouPrenable(poseIlYa(VERROU_MS + 1), MAINTENANT_DATE)).toBe(true);
  });

  it("pose il y a 1 heure : prenable", () => {
    expect(verrouPrenable(poseIlYa(3_600_000), MAINTENANT_DATE)).toBe(true);
  });

  it("pose il y a un an : prenable", () => {
    expect(verrouPrenable(poseIlYa(365 * 86_400_000), MAINTENANT_DATE)).toBe(true);
  });

  it("la reponse ne depend que de l'ecart, pas de l'instant absolu", () => {
    for (const base of [VERROU_MS, MAINTENANT, Date.parse("2100-01-01T00:00:00.000Z")]) {
      const maintenant = new Date(base + VERROU_MS);
      expect(verrouPrenable(new Date(base), maintenant)).toBe(false);
      expect(verrouPrenable(new Date(base - 1), maintenant)).toBe(true);
    }
  });

  it.each([
    ["0 ms", 0, false],
    ["duree - 1 ms", VERROU_MS - 1, false],
    ["duree pile", VERROU_MS, false],
    ["duree + 1 ms", VERROU_MS + 1, true],
    ["2 x duree", 2 * VERROU_MS, true],
  ])("verrou pose il y a %s : prenable = %s", (_nom, ecart, attendu) => {
    expect(verrouPrenable(poseIlYa(ecart), MAINTENANT_DATE)).toBe(attendu);
  });
});

describe("verrouPrenable : verrou dans le futur (horloge decalee)", () => {
  it("1 ms dans le futur : non prenable", () => {
    expect(verrouPrenable(poseIlYa(-1), MAINTENANT_DATE)).toBe(false);
  });

  it("1 minute dans le futur : non prenable", () => {
    expect(verrouPrenable(poseIlYa(-60_000), MAINTENANT_DATE)).toBe(false);
  });

  it("1 heure dans le futur : non prenable", () => {
    expect(verrouPrenable(poseIlYa(-3_600_000), MAINTENANT_DATE)).toBe(false);
  });

  it("devient prenable seulement quand l'horloge a depasse la date posee + la duree du verrou", () => {
    const futur = new Date(MAINTENANT + 3_600_000);
    expect(verrouPrenable(futur, new Date(futur.getTime() + VERROU_MS))).toBe(false);
    expect(verrouPrenable(futur, new Date(futur.getTime() + VERROU_MS + 1))).toBe(true);
  });
});

describe("verrouPrenable : maintenant illisible et pas d'effet de bord", () => {
  it("maintenant = Invalid Date : non prenable (comparaison avec NaN fausse)", () => {
    // Documente le code actuel : seul le verrou est valide, pas `maintenant`.
    expect(verrouPrenable(poseIlYa(VERROU_MS * 10), new Date(NaN))).toBe(false);
  });

  it("ne modifie pas les dates recues", () => {
    const debut = poseIlYa(VERROU_MS + 1);
    const maintenant = new Date(MAINTENANT);
    verrouPrenable(debut, maintenant);
    expect(debut.getTime()).toBe(MAINTENANT - VERROU_MS - 1);
    expect(maintenant.getTime()).toBe(MAINTENANT);
  });
});

// ---------------------------------------------------------------------------
// Coherence par lecture du source (POTENTIELLEMENT FRAGILE)
// ---------------------------------------------------------------------------

// Ces tests lisent le texte des fichiers : ils cassent si on reformate un
// import (ex. une re-exportation, un alias de chemin different de "@/lib/...").
// Ils servent de filet pour deux regles qu'aucun type ne garantit : un
// composant client ne doit importer que des TYPES de account.ts (sinon
// Mongoose partirait dans le navigateur), et la route doit bien utiliser les
// gardes de securite attendues.
const lire = (cheminRelatif: string) =>
  readFileSync(fileURLToPath(new URL(cheminRelatif, import.meta.url)), "utf8");

describe("lecture du source : SuppressionCompte.tsx n'importe que des types de account", () => {
  const source = lire("../app/profil/SuppressionCompte.tsx");
  // [^;] : une instruction s'arrete au point-virgule, la regex ne peut donc pas
  // enjamber un import voisin.
  const imports = source.match(/^import\s[^;]*?from\s*["']@\/lib\/account["']/gm) ?? [];

  it("c'est un composant client (directive 'use client' en premiere ligne)", () => {
    expect(source.trimStart().startsWith('"use client"')).toBe(true);
  });

  it("importe bien quelque chose de @/lib/account (sinon le test ne prouverait rien)", () => {
    expect(imports.length).toBeGreaterThan(0);
  });

  it("chaque import de @/lib/account est un 'import type'", () => {
    for (const ligne of imports) {
      expect(ligne).toMatch(/^import\s+type\s/);
    }
  });

  it("aucun 'import { type X }' mele a des valeurs, aucun require ni import() dynamique de account", () => {
    expect(source).not.toMatch(/require\(\s*["']@\/lib\/account["']\s*\)/);
    expect(source).not.toMatch(/import\(\s*["']@\/lib\/account["']\s*\)/);
    expect(source).not.toMatch(/^import\s+(?!type\s)[^;]*from\s*["']@\/lib\/account["']/m);
  });

  it("n'importe pas non plus de module serveur (mongodb, modeles)", () => {
    expect(source).not.toMatch(/from\s*["']@\/lib\/mongodb["']/);
    expect(source).not.toMatch(/from\s*["']@\/models\//);
    expect(source).not.toMatch(/from\s*["']mongoose["']/);
  });
});

describe("lecture du source : la route DELETE /api/profil utilise les gardes attendues", () => {
  const source = lire("../app/api/profil/route.ts");

  it("importe connexionRecente depuis @/lib/account et l'appelle", () => {
    expect(source).toMatch(/import\s*\{[^}]*\bconnexionRecente\b[^}]*\}\s*from\s*["']@\/lib\/account["']/);
    expect(source).toMatch(/\bconnexionRecente\(/);
  });

  it("importe reserverTentative et cleEmail depuis @/lib/login-limiter et les appelle", () => {
    expect(source).toMatch(/import\s*\{[^}]*\breserverTentative\b[^}]*\}\s*from\s*["']@\/lib\/login-limiter["']/);
    expect(source).toMatch(/import\s*\{[^}]*\bcleEmail\b[^}]*\}\s*from\s*["']@\/lib\/login-limiter["']/);
    expect(source).toMatch(/\breserverTentative\(/);
    expect(source).toMatch(/\bcleEmail\(/);
  });
});
