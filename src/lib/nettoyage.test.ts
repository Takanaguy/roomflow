import { Error as MongooseError } from "mongoose";
import { describe, expect, it } from "vitest";
import {
  DELAI_INACTIVITE_JOURS,
  DELAI_SUPPRESSION_JOURS,
  DELAI_VERROU_DESTRUCTION_MS,
  dateLaPlusRecente,
  destructionEnCours,
  ecritureRefuseeParFiltre,
  evaluerNettoyage,
  filtreHorsDestruction,
  suppressionAutoActive,
  type DecisionNettoyage,
  type EntreeNettoyage,
} from "@/lib/nettoyage";

// nettoyage.ts importe Mongoose et les modeles, mais rien ne s'ouvre a
// l'import : la connexion est paresseuse (connectDB). On ne teste ici que les
// fonctions pures (evaluerNettoyage, dateLaPlusRecente, suppressionAutoActive),
// sans base ni mock. dernieresActivites et derniereActivite touchent la base :
// elles restent hors de ce fichier.
//
// Ce code decide de SUPPRIMER des colocations avec toutes leurs donnees. Les
// tests sont donc volontairement mechants : la propriete de securite est
// verifiee sur une grille de plusieurs dizaines de milliers de combinaisons.

// Dates en ISO avec "Z" : le test ne depend jamais du fuseau de la machine.
const d = (iso: string) => new Date(iso);

// "Maintenant" fige : on ne lit jamais l'horloge reelle.
const MAINTENANT = d("2026-10-30T12:00:00.000Z");
const T = MAINTENANT.getTime();

const JOUR_MS = 24 * 60 * 60 * 1000;

// Construits a partir des constantes du code, pas de "90" ou "30" ecrits en
// dur : si un delai change, les tests de frontiere suivent. Le bloc des
// constantes verifie separement les valeurs 90 et 30.
const INACTIVITE_MS = DELAI_INACTIVITE_JOURS * JOUR_MS;
const SUPPRESSION_MS = DELAI_SUPPRESSION_JOURS * JOUR_MS;

/** Un instant decale de `jours` jours (negatif = passe) par rapport a maintenant. */
const jours = (n: number) => new Date(T + n * JOUR_MS);

/** Un instant decale de `ms` millisecondes par rapport a maintenant. */
const ms = (n: number) => new Date(T + n);

/** Maintenant + 30 jours exactement. */
const ECHEANCE_NEUVE = new Date(T + SUPPRESSION_MS);

const DATE_INVALIDE = new Date("x");

// Fabrique une entree : colocation avec 3 membres, creee il y a 500 jours,
// activite il y a 10 jours (donc saine). Chaque test ne precise que ce qui
// l'interesse.
function entree(surcharge: Partial<EntreeNettoyage> = {}): EntreeNettoyage {
  return {
    nombreMembres: 3,
    creeLe: jours(-500),
    derniereActivite: jours(-10),
    ...surcharge,
  };
}

// Colocation sans membre, creee il y a 500 jours, sans trace de nettoyage.
const vide = (surcharge: Partial<EntreeNettoyage> = {}) =>
  entree({ nombreMembres: 0, derniereActivite: jours(-500), ...surcharge });

// Colocation avec membres inactive depuis 100 jours, sans trace de nettoyage.
const inactive = (surcharge: Partial<EntreeNettoyage> = {}) =>
  entree({ nombreMembres: 2, derniereActivite: jours(-100), ...surcharge });

const eval_ = (e: EntreeNettoyage) => evaluerNettoyage(e, MAINTENANT);

// Applique a l'entree les ecritures que l'appelant doit faire d'apres la
// decision (voir le commentaire de DecisionNettoyage). Sert a rejouer.
function appliquer(e: EntreeNettoyage, decision: DecisionNettoyage): EntreeNettoyage {
  switch (decision.action) {
    case "planifier_vide":
      return {
        ...e,
        videDepuis: decision.videDepuis,
        suppressionPrevueLe: decision.suppressionPrevueLe,
        motifSuppression: "vide",
        avertieLe: null,
      };
    case "avertir_inactive":
      return {
        ...e,
        avertieLe: decision.avertieLe,
        suppressionPrevueLe: decision.suppressionPrevueLe,
        motifSuppression: "inactive",
      };
    case "annuler":
      return {
        ...e,
        videDepuis: null,
        avertieLe: null,
        suppressionPrevueLe: null,
        motifSuppression: null,
      };
    default:
      return e;
  }
}

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

describe("DELAI_INACTIVITE_JOURS et DELAI_SUPPRESSION_JOURS", () => {
  it("DELAI_INACTIVITE_JOURS vaut 90", () => {
    expect(DELAI_INACTIVITE_JOURS).toBe(90);
  });

  it("DELAI_SUPPRESSION_JOURS vaut 30", () => {
    expect(DELAI_SUPPRESSION_JOURS).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// suppressionAutoActive
// ---------------------------------------------------------------------------

describe("suppressionAutoActive", () => {
  it('la chaine exacte "true" : vrai', () => {
    expect(suppressionAutoActive({ NETTOYAGE_AUTO_ACTIF: "true" })).toBe(true);
  });

  it("undefined (variable absente) : faux", () => {
    expect(suppressionAutoActive({})).toBe(false);
    expect(suppressionAutoActive({ NETTOYAGE_AUTO_ACTIF: undefined })).toBe(false);
  });

  it.each([
    ["chaine vide", ""],
    ["TRUE", "TRUE"],
    ["True", "True"],
    ["tRuE", "tRuE"],
    ["espace devant", " true"],
    ["espace derriere", "true "],
    ["retour a la ligne", "true\n"],
    ["tabulation", "\ttrue"],
    ["1", "1"],
    ["yes", "yes"],
    ["false", "false"],
    ["on", "on"],
    ["oui", "oui"],
    ["guillemets", '"true"'],
  ])("%s : faux", (_nom, valeur) => {
    expect(suppressionAutoActive({ NETTOYAGE_AUTO_ACTIF: valeur })).toBe(false);
  });

  it("ignore les autres variables d'environnement", () => {
    const env = { NETTOYAGE_AUTO_ACTIF: "false", AUTRE: "true" } as { NETTOYAGE_AUTO_ACTIF?: string };
    expect(suppressionAutoActive(env)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dateLaPlusRecente
// ---------------------------------------------------------------------------

describe("dateLaPlusRecente", () => {
  it("tableau vide : null", () => {
    expect(dateLaPlusRecente([])).toBeNull();
  });

  it("uniquement des null, undefined et dates invalides : null", () => {
    expect(dateLaPlusRecente([null, undefined, DATE_INVALIDE])).toBeNull();
  });

  it("une seule date : cette date", () => {
    expect(dateLaPlusRecente([d("2026-01-01T00:00:00.000Z")])).toEqual(d("2026-01-01T00:00:00.000Z"));
  });

  it("plusieurs dates : la plus recente, quel que soit l'ordre", () => {
    const a = d("2026-01-01T00:00:00.000Z");
    const b = d("2026-06-01T00:00:00.000Z");
    const c = d("2026-03-01T00:00:00.000Z");
    expect(dateLaPlusRecente([a, b, c])).toEqual(b);
    expect(dateLaPlusRecente([b, c, a])).toEqual(b);
    expect(dateLaPlusRecente([c, a, b])).toEqual(b);
  });

  it("ignore les valeurs absentes ou invalides parmi des dates valides", () => {
    const a = d("2026-01-01T00:00:00.000Z");
    const b = d("2026-06-01T00:00:00.000Z");
    expect(dateLaPlusRecente([null, a, undefined, DATE_INVALIDE, b, null])).toEqual(b);
  });

  it("une date invalide ne masque pas une date valide plus ancienne", () => {
    const a = d("2020-01-01T00:00:00.000Z");
    expect(dateLaPlusRecente([DATE_INVALIDE, a])).toEqual(a);
  });

  it("dates identiques : cette date", () => {
    const a = d("2026-01-01T00:00:00.000Z");
    expect(dateLaPlusRecente([a, new Date(a.getTime())])).toEqual(a);
  });

  it("dates avant 1970 (negatives) : la plus recente est la bonne", () => {
    expect(dateLaPlusRecente([d("1960-01-01T00:00:00.000Z"), d("1950-01-01T00:00:00.000Z")])).toEqual(
      d("1960-01-01T00:00:00.000Z")
    );
  });

  it("l'epoque (timestamp 0) est une date valide, pas une valeur absente", () => {
    expect(dateLaPlusRecente([new Date(0)])).toEqual(new Date(0));
  });

  it("renvoie une nouvelle instance, pas celle de l'entree", () => {
    const a = d("2026-01-01T00:00:00.000Z");
    const resultat = dateLaPlusRecente([a]);
    expect(resultat).not.toBe(a);
  });

  it("ne modifie pas le tableau ni les dates d'entree", () => {
    const tableau = [d("2026-06-01T00:00:00.000Z"), null, d("2026-01-01T00:00:00.000Z"), DATE_INVALIDE];
    const avant = structuredClone(tableau);
    dateLaPlusRecente(tableau);
    expect(tableau).toEqual(avant);
    expect(tableau).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// evaluerNettoyage : demo
// ---------------------------------------------------------------------------

describe("evaluerNettoyage : colocation de demo", () => {
  it("demo true : ignorer, meme avec 0 membre, plan vide echu, inactive depuis 10 ans", () => {
    const e = vide({
      demo: true,
      creeLe: jours(-3650),
      derniereActivite: jours(-3650),
      videDepuis: jours(-3000),
      suppressionPrevueLe: jours(-2000),
      motifSuppression: "vide",
    });
    expect(eval_(e)).toEqual({ action: "ignorer" });
  });

  it("demo true : ignorer, meme avec membres, avertissement d'inactivite echu", () => {
    const e = inactive({
      demo: true,
      creeLe: jours(-3650),
      derniereActivite: jours(-3650),
      avertieLe: jours(-100),
      suppressionPrevueLe: jours(-70),
      motifSuppression: "inactive",
    });
    expect(eval_(e)).toEqual({ action: "ignorer" });
  });

  it("demo true : ignorer, meme sans aucune trace sur une colocation vide", () => {
    expect(eval_(vide({ demo: true }))).toEqual({ action: "ignorer" });
  });

  it("demo true : ignorer, meme avec dates invalides", () => {
    const e = entree({ demo: true, creeLe: DATE_INVALIDE, derniereActivite: DATE_INVALIDE });
    expect(eval_(e)).toEqual({ action: "ignorer" });
  });

  it.each([
    ["false", false],
    ["undefined", undefined],
    ["null", null],
  ])("demo %s : ne protege pas (une colocation vide est planifiee)", (_nom, demo) => {
    const decision = eval_(vide({ demo }));
    expect(decision.action).toBe("planifier_vide");
  });

  it.each([
    ["false", false],
    ["undefined", undefined],
    ["null", null],
  ])("demo %s : ne protege pas (une colocation inactive est avertie)", (_nom, demo) => {
    const decision = eval_(inactive({ demo }));
    expect(decision.action).toBe("avertir_inactive");
  });

  it.each([
    ["false", false],
    ["undefined", undefined],
    ["null", null],
  ])("demo %s : ne protege pas (un plan vide echu est execute)", (_nom, demo) => {
    const e = vide({
      demo,
      videDepuis: jours(-40),
      suppressionPrevueLe: jours(-10),
      motifSuppression: "vide",
    });
    expect(eval_(e)).toEqual({ action: "supprimer", motif: "vide" });
  });

  it("comportement reel : demo true ne dispense PAS de la validation (RangeError avant le test demo)", () => {
    expect(() => eval_(entree({ demo: true, nombreMembres: -1 }))).toThrow(RangeError);
    expect(() => evaluerNettoyage(entree({ demo: true }), DATE_INVALIDE)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// evaluerNettoyage : colocation vide
// ---------------------------------------------------------------------------

describe("evaluerNettoyage : colocation vide, sans plan", () => {
  it("sans aucune trace : planifier_vide, echeance = maintenant + 30 j exactement, videDepuis = maintenant", () => {
    expect(eval_(vide())).toEqual({
      action: "planifier_vide",
      videDepuis: MAINTENANT,
      suppressionPrevueLe: ECHEANCE_NEUVE,
    });
  });

  it("l'echeance est exactement maintenant + 30 jours en millisecondes", () => {
    const decision = eval_(vide());
    if (decision.action !== "planifier_vide") throw new Error("planifier_vide attendu");
    expect(decision.suppressionPrevueLe.getTime() - T).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("videDepuis valide et passe : conserve (information), echeance repart de maintenant", () => {
    const decision = eval_(vide({ videDepuis: jours(-5) }));
    expect(decision).toEqual({
      action: "planifier_vide",
      videDepuis: jours(-5),
      suppressionPrevueLe: ECHEANCE_NEUVE,
    });
  });

  it("videDepuis il y a 200 jours, sans plan : le preavis repart de maintenant (jamais supprimer)", () => {
    const decision = eval_(vide({ videDepuis: jours(-200) }));
    expect(decision).toEqual({
      action: "planifier_vide",
      videDepuis: jours(-200),
      suppressionPrevueLe: ECHEANCE_NEUVE,
    });
  });

  it("videDepuis il y a 200 jours, motif vide mais echeance absente : planifier_vide, pas supprimer", () => {
    const decision = eval_(vide({ videDepuis: jours(-200), motifSuppression: "vide" }));
    expect(decision).toEqual({
      action: "planifier_vide",
      videDepuis: jours(-200),
      suppressionPrevueLe: ECHEANCE_NEUVE,
    });
  });

  it("videDepuis exactement maintenant : valide (pas futur), conserve", () => {
    const decision = eval_(vide({ videDepuis: MAINTENANT }));
    expect(decision).toEqual({
      action: "planifier_vide",
      videDepuis: MAINTENANT,
      suppressionPrevueLe: ECHEANCE_NEUVE,
    });
  });

  it("videDepuis 1 ms dans le futur : remplace par maintenant", () => {
    const decision = eval_(vide({ videDepuis: ms(1) }));
    expect(decision).toEqual({
      action: "planifier_vide",
      videDepuis: MAINTENANT,
      suppressionPrevueLe: ECHEANCE_NEUVE,
    });
  });

  it("videDepuis invalide : traite comme absent, remplace par maintenant", () => {
    const decision = eval_(vide({ videDepuis: DATE_INVALIDE }));
    expect(decision).toEqual({
      action: "planifier_vide",
      videDepuis: MAINTENANT,
      suppressionPrevueLe: ECHEANCE_NEUVE,
    });
  });

  it("vide ET inactive depuis tres longtemps, sans plan : planifier_vide, pas supprimer", () => {
    const e = vide({ creeLe: jours(-5000), derniereActivite: jours(-4000) });
    const decision = eval_(e);
    expect(decision.action).toBe("planifier_vide");
    expect(decision).not.toEqual({ action: "supprimer", motif: "inactive" });
    expect(decision).not.toEqual({ action: "supprimer", motif: "vide" });
  });

  it("un plan d'inactivite echu sur une colocation vide est remplace, pas execute", () => {
    const e = vide({
      avertieLe: jours(-100),
      suppressionPrevueLe: jours(-70),
      motifSuppression: "inactive",
    });
    const decision = eval_(e);
    expect(decision).toEqual({
      action: "planifier_vide",
      videDepuis: MAINTENANT,
      suppressionPrevueLe: ECHEANCE_NEUVE,
    });
  });
});

describe("evaluerNettoyage : colocation vide, plan coherent", () => {
  it("avant l'echeance : rien", () => {
    const e = vide({
      videDepuis: jours(-10),
      suppressionPrevueLe: jours(20),
      motifSuppression: "vide",
    });
    expect(eval_(e)).toEqual({ action: "rien" });
  });

  it("1 ms avant l'echeance : rien", () => {
    const e = vide({
      videDepuis: jours(-30),
      suppressionPrevueLe: ms(1),
      motifSuppression: "vide",
    });
    expect(eval_(e)).toEqual({ action: "rien" });
  });

  it("a l'echeance exacte (>=) : supprimer, motif vide", () => {
    const e = vide({
      videDepuis: jours(-30),
      suppressionPrevueLe: MAINTENANT,
      motifSuppression: "vide",
    });
    expect(eval_(e)).toEqual({ action: "supprimer", motif: "vide" });
  });

  it("1 ms apres l'echeance : supprimer, motif vide", () => {
    const e = vide({
      videDepuis: jours(-40),
      suppressionPrevueLe: ms(-1),
      motifSuppression: "vide",
    });
    expect(eval_(e)).toEqual({ action: "supprimer", motif: "vide" });
  });

  it("plan ancien mais coherent et echu (videDepuis -200 j, echeance -170 j) : supprimer", () => {
    const e = vide({
      videDepuis: jours(-200),
      suppressionPrevueLe: jours(-170),
      motifSuppression: "vide",
    });
    expect(eval_(e)).toEqual({ action: "supprimer", motif: "vide" });
  });

  it("l'activite est ignoree : vide + activite recente, plan echu : supprimer motif vide", () => {
    const e = vide({
      derniereActivite: jours(-1),
      videDepuis: jours(-40),
      suppressionPrevueLe: jours(-10),
      motifSuppression: "vide",
    });
    expect(eval_(e)).toEqual({ action: "supprimer", motif: "vide" });
  });

  it("l'echeance fait exactement videDepuis + 30 j : coherente (>=)", () => {
    const e = vide({
      videDepuis: jours(-45),
      suppressionPrevueLe: jours(-15),
      motifSuppression: "vide",
    });
    expect(eval_(e)).toEqual({ action: "supprimer", motif: "vide" });
  });

  it("un avertieLe qui traine est ignore quand le plan vide est coherent", () => {
    const e = vide({
      videDepuis: jours(-10),
      suppressionPrevueLe: jours(20),
      motifSuppression: "vide",
      avertieLe: jours(-100),
    });
    expect(eval_(e)).toEqual({ action: "rien" });
  });
});

describe("evaluerNettoyage : colocation vide, plan incoherent (jamais supprimer)", () => {
  const replanifie = { action: "planifier_vide", suppressionPrevueLe: ECHEANCE_NEUVE };

  it("echeance 1 ms avant videDepuis + 30 j : planifier_vide, pas supprimer", () => {
    const e = vide({
      videDepuis: jours(-30),
      suppressionPrevueLe: ms(-1),
      motifSuppression: "vide",
    });
    expect(eval_(e)).toEqual({ ...replanifie, videDepuis: jours(-30) });
  });

  it("echeance passee mais trop proche de videDepuis (< 30 j) : planifier_vide", () => {
    const e = vide({
      videDepuis: jours(-10),
      suppressionPrevueLe: jours(-1),
      motifSuppression: "vide",
    });
    expect(eval_(e)).toEqual({ ...replanifie, videDepuis: jours(-10) });
  });

  it("echeance avant videDepuis : planifier_vide", () => {
    const e = vide({
      videDepuis: jours(-10),
      suppressionPrevueLe: jours(-50),
      motifSuppression: "vide",
    });
    expect(eval_(e)).toEqual({ ...replanifie, videDepuis: jours(-10) });
  });

  it("motif absent (echeance passee et videDepuis ancien) : planifier_vide", () => {
    const e = vide({ videDepuis: jours(-100), suppressionPrevueLe: jours(-10) });
    expect(eval_(e)).toEqual({ ...replanifie, videDepuis: jours(-100) });
  });

  it("motif null : planifier_vide", () => {
    const e = vide({ videDepuis: jours(-100), suppressionPrevueLe: jours(-10), motifSuppression: null });
    expect(eval_(e)).toEqual({ ...replanifie, videDepuis: jours(-100) });
  });

  it('motif "inactive" (echeance passee et videDepuis ancien) : planifier_vide', () => {
    const e = vide({
      videDepuis: jours(-100),
      suppressionPrevueLe: jours(-10),
      motifSuppression: "inactive",
    });
    expect(eval_(e)).toEqual({ ...replanifie, videDepuis: jours(-100) });
  });

  it("videDepuis dans le futur (echeance passee, motif vide) : planifier_vide, videDepuis = maintenant", () => {
    const e = vide({
      videDepuis: jours(1),
      suppressionPrevueLe: jours(-5),
      motifSuppression: "vide",
    });
    expect(eval_(e)).toEqual({ ...replanifie, videDepuis: MAINTENANT });
  });

  it("videDepuis dans le futur lointain avec une echeance encore plus lointaine : planifier_vide, videDepuis = maintenant", () => {
    const e = vide({
      videDepuis: jours(400),
      suppressionPrevueLe: jours(500),
      motifSuppression: "vide",
    });
    expect(eval_(e)).toEqual({ ...replanifie, videDepuis: MAINTENANT });
  });

  it("videDepuis absent (echeance passee, motif vide) : planifier_vide, videDepuis = maintenant", () => {
    const e = vide({ suppressionPrevueLe: jours(-5), motifSuppression: "vide" });
    expect(eval_(e)).toEqual({ ...replanifie, videDepuis: MAINTENANT });
  });

  it("echeance absente (motif vide, videDepuis ancien) : planifier_vide", () => {
    const e = vide({ videDepuis: jours(-100), motifSuppression: "vide" });
    expect(eval_(e)).toEqual({ ...replanifie, videDepuis: jours(-100) });
  });

  it("echeance invalide (motif vide, videDepuis ancien) : traitee comme absente, planifier_vide", () => {
    const e = vide({
      videDepuis: jours(-100),
      suppressionPrevueLe: DATE_INVALIDE,
      motifSuppression: "vide",
    });
    expect(eval_(e)).toEqual({ ...replanifie, videDepuis: jours(-100) });
  });

  it("motif inconnu (plan par ailleurs parfait et echu) : planifier_vide, pas supprimer", () => {
    const e = vide({
      videDepuis: jours(-100),
      suppressionPrevueLe: jours(-10),
      motifSuppression: "bizarre",
    });
    expect(eval_(e)).toEqual({ ...replanifie, videDepuis: jours(-100) });
  });

  it.each(["Vide", "VIDE", " vide", "vide ", ""])(
    'motif "%s" (casse ou espace differents) : traite comme absent, planifier_vide',
    (motif) => {
      const e = vide({ videDepuis: jours(-100), suppressionPrevueLe: jours(-10), motifSuppression: motif });
      expect(eval_(e).action).toBe("planifier_vide");
    }
  );
});

// ---------------------------------------------------------------------------
// evaluerNettoyage : vide qui recoit un membre
// ---------------------------------------------------------------------------

describe("evaluerNettoyage : colocation qui etait vide et recoit un membre", () => {
  it("videDepuis passe + membres > 0 : annuler", () => {
    expect(eval_(entree({ nombreMembres: 1, videDepuis: jours(-5) }))).toEqual({ action: "annuler" });
  });

  it('motif "vide" + membres > 0 : annuler', () => {
    expect(eval_(entree({ nombreMembres: 1, motifSuppression: "vide" }))).toEqual({ action: "annuler" });
  });

  it("plan vide coherent et ECHU + un membre qui vient d'arriver : annuler, jamais supprimer", () => {
    const e = entree({
      nombreMembres: 1,
      videDepuis: jours(-100),
      suppressionPrevueLe: jours(-70),
      motifSuppression: "vide",
    });
    expect(eval_(e)).toEqual({ action: "annuler" });
  });

  it("videDepuis dans le futur + membres > 0 : annuler (c'est quand meme une trace)", () => {
    expect(eval_(entree({ nombreMembres: 2, videDepuis: jours(3) }))).toEqual({ action: "annuler" });
  });

  it("trace vide + colocation par ailleurs inactive : annuler (le passage suivant reavertira)", () => {
    const e = inactive({ videDepuis: jours(-5) });
    expect(eval_(e)).toEqual({ action: "annuler" });
  });

  it("videDepuis invalide sans motif : pas une trace, la colocation saine reste en rien", () => {
    expect(eval_(entree({ nombreMembres: 1, videDepuis: DATE_INVALIDE }))).toEqual({ action: "rien" });
  });

  it("une seule personne dans la colocation (membres = 1) compte comme non vide", () => {
    expect(eval_(entree({ nombreMembres: 1, videDepuis: jours(-1) })).action).toBe("annuler");
  });
});

// ---------------------------------------------------------------------------
// evaluerNettoyage : inactivite, premier avertissement
// ---------------------------------------------------------------------------

describe("evaluerNettoyage : inactivite sans plan", () => {
  it("activite il y a exactement 90 jours : rien (comparaison stricte)", () => {
    expect(eval_(inactive({ derniereActivite: jours(-90) }))).toEqual({ action: "rien" });
  });

  it("activite il y a 90 jours moins 1 ms : rien", () => {
    expect(eval_(inactive({ derniereActivite: ms(-INACTIVITE_MS + 1) }))).toEqual({ action: "rien" });
  });

  it("activite il y a 90 jours + 1 ms : avertir_inactive, avertieLe = maintenant, echeance = maintenant + 30 j", () => {
    const decision = eval_(inactive({ derniereActivite: ms(-INACTIVITE_MS - 1) }));
    expect(decision).toEqual({
      action: "avertir_inactive",
      avertieLe: MAINTENANT,
      suppressionPrevueLe: ECHEANCE_NEUVE,
    });
  });

  it("inactive depuis 10 ans : avertir_inactive (premier passage), jamais supprimer", () => {
    const decision = eval_(inactive({ creeLe: jours(-4000), derniereActivite: jours(-3650) }));
    expect(decision).toEqual({
      action: "avertir_inactive",
      avertieLe: MAINTENANT,
      suppressionPrevueLe: ECHEANCE_NEUVE,
    });
  });

  it("la creation compte comme activite : creee il y a 10 jours, derniereActivite ancienne : rien", () => {
    const e = entree({ creeLe: jours(-10), derniereActivite: jours(-400) });
    expect(eval_(e)).toEqual({ action: "rien" });
  });

  it("creee il y a 10 jours, aucune activite (derniereActivite = creation) : rien", () => {
    const e = entree({ creeLe: jours(-10), derniereActivite: jours(-10) });
    expect(eval_(e)).toEqual({ action: "rien" });
  });

  it("creee il y a 10 jours, derniereActivite invalide : rien", () => {
    const e = entree({ creeLe: jours(-10), derniereActivite: DATE_INVALIDE });
    expect(eval_(e)).toEqual({ action: "rien" });
  });

  it("creee il y a 200 jours, aucune activite : avertir_inactive", () => {
    const e = entree({ creeLe: jours(-200), derniereActivite: jours(-200) });
    expect(eval_(e).action).toBe("avertir_inactive");
  });

  it("creee il y a 200 jours, derniereActivite invalide : avertir_inactive (la creation seule compte)", () => {
    const e = entree({ creeLe: jours(-200), derniereActivite: DATE_INVALIDE });
    expect(eval_(e).action).toBe("avertir_inactive");
  });

  it("creeLe invalide mais derniereActivite recente : rien", () => {
    const e = entree({ creeLe: DATE_INVALIDE, derniereActivite: jours(-5) });
    expect(eval_(e)).toEqual({ action: "rien" });
  });

  it("creeLe invalide et derniereActivite ancienne : avertir_inactive", () => {
    const e = entree({ creeLe: DATE_INVALIDE, derniereActivite: jours(-200) });
    expect(eval_(e).action).toBe("avertir_inactive");
  });

  it("creeLe ancienne mais derniereActivite recente : rien (c'est le max qui compte)", () => {
    const e = entree({ creeLe: jours(-1000), derniereActivite: jours(-1) });
    expect(eval_(e)).toEqual({ action: "rien" });
  });

  it("activite dans le futur : jamais inactive, rien", () => {
    expect(eval_(entree({ derniereActivite: jours(5), creeLe: jours(-1000) }))).toEqual({ action: "rien" });
  });

  it("activite 1 ms dans le futur : rien", () => {
    expect(eval_(entree({ derniereActivite: ms(1), creeLe: jours(-1000) }))).toEqual({ action: "rien" });
  });

  it("activite dans un futur tres lointain : rien", () => {
    expect(eval_(entree({ derniereActivite: jours(36500), creeLe: jours(-1000) }))).toEqual({ action: "rien" });
  });

  it("creation dans le futur et activite ancienne : rien", () => {
    expect(eval_(entree({ creeLe: jours(5), derniereActivite: jours(-1000) }))).toEqual({ action: "rien" });
  });

  it("aucune date valide : rien (on ne juge pas)", () => {
    expect(eval_(entree({ creeLe: DATE_INVALIDE, derniereActivite: DATE_INVALIDE }))).toEqual({ action: "rien" });
  });

  it("aucune date valide, meme avec un plan d'inactivite echu : rien, pas supprimer", () => {
    const e = entree({
      creeLe: DATE_INVALIDE,
      derniereActivite: DATE_INVALIDE,
      avertieLe: jours(-100),
      suppressionPrevueLe: jours(-70),
      motifSuppression: "inactive",
    });
    expect(eval_(e)).toEqual({ action: "rien" });
  });

  it("motif inconnu seul (aucune date) : traite comme absent, donc avertir_inactive si inactive", () => {
    expect(eval_(inactive({ motifSuppression: "bizarre" })).action).toBe("avertir_inactive");
  });

  it("motif inconnu seul sur une colocation saine : rien", () => {
    expect(eval_(entree({ motifSuppression: "bizarre" }))).toEqual({ action: "rien" });
  });

  it("colocation saine sans aucune trace : rien", () => {
    expect(eval_(entree())).toEqual({ action: "rien" });
  });
});

// ---------------------------------------------------------------------------
// evaluerNettoyage : apres avertissement
// ---------------------------------------------------------------------------

describe("evaluerNettoyage : apres l'avertissement d'inactivite", () => {
  // Avertie il y a 30 jours, echeance maintenant, activite il y a 130 jours.
  const echu = (surcharge: Partial<EntreeNettoyage> = {}) =>
    inactive({
      derniereActivite: jours(-130),
      avertieLe: jours(-30),
      suppressionPrevueLe: MAINTENANT,
      motifSuppression: "inactive",
      ...surcharge,
    });

  it("plan coherent, toujours inactive, avant l'echeance : rien", () => {
    const e = echu({ avertieLe: jours(-10), suppressionPrevueLe: jours(20) });
    expect(eval_(e)).toEqual({ action: "rien" });
  });

  it("1 ms avant l'echeance : rien", () => {
    expect(eval_(echu({ suppressionPrevueLe: ms(1) }))).toEqual({ action: "rien" });
  });

  it("a l'echeance exacte : supprimer, motif inactive", () => {
    expect(eval_(echu())).toEqual({ action: "supprimer", motif: "inactive" });
  });

  it("1 ms apres l'echeance : supprimer, motif inactive", () => {
    expect(eval_(echu({ avertieLe: jours(-31), suppressionPrevueLe: ms(-1) }))).toEqual({
      action: "supprimer",
      motif: "inactive",
    });
  });

  it("echeance = avertieLe + 30 j exactement : coherente (>=), supprimer si echue", () => {
    const e = echu({ avertieLe: jours(-30), suppressionPrevueLe: jours(0) });
    expect(eval_(e)).toEqual({ action: "supprimer", motif: "inactive" });
  });

  it("echeance 1 ms avant avertieLe + 30 j : incoherente, annuler (jamais supprimer)", () => {
    const e = echu({ avertieLe: jours(-30), suppressionPrevueLe: ms(-1) });
    expect(eval_(e)).toEqual({ action: "annuler" });
  });

  it("activite STRICTEMENT posterieure a avertieLe (1 ms), encore inactive : annuler", () => {
    const e = echu({
      derniereActivite: ms(-100 * JOUR_MS + 1),
      avertieLe: jours(-100),
      suppressionPrevueLe: jours(-70),
    });
    expect(eval_(e)).toEqual({ action: "annuler" });
  });

  it("nouvelle activite apportee par creeLe (posterieur a avertieLe) : annuler", () => {
    const e = echu({
      creeLe: ms(-100 * JOUR_MS + 1),
      derniereActivite: jours(-300),
      avertieLe: jours(-100),
      suppressionPrevueLe: jours(-70),
    });
    expect(eval_(e)).toEqual({ action: "annuler" });
  });

  it("activite recente (hier) apres l'avertissement : annuler", () => {
    expect(eval_(echu({ derniereActivite: jours(-1) }))).toEqual({ action: "annuler" });
  });

  it("activite dans le futur apres l'avertissement : annuler", () => {
    expect(eval_(echu({ derniereActivite: jours(3) }))).toEqual({ action: "annuler" });
  });

  it("comportement reel : activite == avertieLe a la ms n'est PAS une nouvelle activite, on continue, echeance echue : supprimer", () => {
    const e = echu({
      derniereActivite: jours(-100),
      avertieLe: jours(-100),
      suppressionPrevueLe: jours(-70),
    });
    expect(eval_(e)).toEqual({ action: "supprimer", motif: "inactive" });
  });

  it("comportement reel : activite == avertieLe, echeance future : rien", () => {
    const e = echu({
      derniereActivite: jours(-100),
      avertieLe: jours(-100),
      suppressionPrevueLe: jours(5),
    });
    expect(eval_(e)).toEqual({ action: "rien" });
  });

  it("comportement reel : activite == avertieLe mais plus inactive (recente) : annuler", () => {
    const e = echu({
      creeLe: jours(-500),
      derniereActivite: jours(-40),
      avertieLe: jours(-40),
      suppressionPrevueLe: jours(-10),
    });
    expect(eval_(e)).toEqual({ action: "annuler" });
  });

  it("plus inactive a cet instant (activite avant l'avertissement mais recente) : annuler", () => {
    const e = echu({
      derniereActivite: jours(-41),
      avertieLe: jours(-40),
      suppressionPrevueLe: jours(-10),
    });
    expect(eval_(e)).toEqual({ action: "annuler" });
  });

  it("activite exactement 90 j avant maintenant (pas inactive) avec plan echu : annuler, jamais supprimer", () => {
    const e = echu({
      derniereActivite: jours(-90),
      avertieLe: jours(-60),
      suppressionPrevueLe: jours(-30),
    });
    expect(eval_(e)).toEqual({ action: "annuler" });
  });

  it("activite 90 j + 1 ms avant maintenant (inactive) avec plan echu : supprimer", () => {
    const e = echu({
      derniereActivite: ms(-INACTIVITE_MS - 1),
      avertieLe: jours(-60),
      suppressionPrevueLe: jours(-30),
    });
    expect(eval_(e)).toEqual({ action: "supprimer", motif: "inactive" });
  });

  it("avertieLe dans le futur (plan par ailleurs echu) : rien, ni annuler ni supprimer", () => {
    const e = echu({ avertieLe: jours(1), suppressionPrevueLe: jours(-5) });
    expect(eval_(e)).toEqual({ action: "rien" });
  });

  it("avertieLe 1 ms dans le futur : rien", () => {
    const e = echu({ avertieLe: ms(1), suppressionPrevueLe: jours(-5) });
    expect(eval_(e)).toEqual({ action: "rien" });
  });

  it("avertieLe dans le futur sans motif ni echeance : rien", () => {
    const e = inactive({ avertieLe: jours(2) });
    expect(eval_(e)).toEqual({ action: "rien" });
  });

  it("avertieLe == maintenant n'est pas futur : plan coherent avant echeance : rien", () => {
    const e = echu({ avertieLe: MAINTENANT, suppressionPrevueLe: ECHEANCE_NEUVE });
    expect(eval_(e)).toEqual({ action: "rien" });
  });

  it("echeance sans motif : annuler", () => {
    const e = echu({ motifSuppression: undefined });
    expect(eval_(e)).toEqual({ action: "annuler" });
  });

  it("echeance sans motif ni avertieLe : annuler", () => {
    const e = inactive({ suppressionPrevueLe: jours(-10) });
    expect(eval_(e)).toEqual({ action: "annuler" });
  });

  it("motif sans aucune date : annuler (et pas avertir_inactive)", () => {
    const e = inactive({ motifSuppression: "inactive" });
    expect(eval_(e)).toEqual({ action: "annuler" });
  });

  it("avertieLe absent avec motif inactive et echeance echue : annuler, jamais supprimer", () => {
    const e = inactive({ motifSuppression: "inactive", suppressionPrevueLe: jours(-10) });
    expect(eval_(e)).toEqual({ action: "annuler" });
  });

  it("avertieLe sans echeance, motif inactive : annuler", () => {
    const e = inactive({ avertieLe: jours(-40), motifSuppression: "inactive" });
    expect(eval_(e)).toEqual({ action: "annuler" });
  });

  it("avertieLe sans motif ni echeance : annuler", () => {
    const e = inactive({ avertieLe: jours(-40) });
    expect(eval_(e)).toEqual({ action: "annuler" });
  });

  it("motif inconnu avec avertieLe et echeance echue : annuler, pas supprimer", () => {
    const e = echu({ motifSuppression: "bizarre" });
    expect(eval_(e)).toEqual({ action: "annuler" });
  });

  it("avertieLe invalide avec motif et echeance : traite comme absent, annuler", () => {
    const e = echu({ avertieLe: DATE_INVALIDE });
    expect(eval_(e)).toEqual({ action: "annuler" });
  });

  it("echeance invalide avec motif et avertieLe : traitee comme absente, annuler", () => {
    const e = echu({ suppressionPrevueLe: DATE_INVALIDE });
    expect(eval_(e)).toEqual({ action: "annuler" });
  });

  it("annuler puis reevaluer : la colocation encore inactive est reavertie", () => {
    const e = echu({ motifSuppression: undefined });
    const apresAnnulation = appliquer(e, eval_(e));
    expect(eval_(apresAnnulation).action).toBe("avertir_inactive");
  });
});

// ---------------------------------------------------------------------------
// evaluerNettoyage : robustesse
// ---------------------------------------------------------------------------

describe("evaluerNettoyage : robustesse", () => {
  it("maintenant invalide : RangeError", () => {
    expect(() => evaluerNettoyage(entree(), DATE_INVALIDE)).toThrow(RangeError);
  });

  it.each([
    ["-1", -1],
    ["-0.5", -0.5],
    ["1.5", 1.5],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
  ])("nombreMembres %s : RangeError", (_nom, n) => {
    expect(() => eval_(entree({ nombreMembres: n }))).toThrow(RangeError);
  });

  it("nombreMembres negatif ne mene jamais a une decision (pas de 'moins que zero = vide')", () => {
    expect(() => eval_(vide({ nombreMembres: -3, videDepuis: jours(-40), suppressionPrevueLe: jours(-10), motifSuppression: "vide" }))).toThrow(RangeError);
  });

  it("nombreMembres = 0 et grand nombre entier : acceptes", () => {
    expect(() => eval_(entree({ nombreMembres: 0 }))).not.toThrow();
    expect(() => eval_(entree({ nombreMembres: 1_000_000 }))).not.toThrow();
  });

  it("dates invalides traitees comme absentes : colocation vide avec toutes les dates invalides", () => {
    const e = vide({
      videDepuis: DATE_INVALIDE,
      avertieLe: DATE_INVALIDE,
      suppressionPrevueLe: DATE_INVALIDE,
      motifSuppression: "vide",
    });
    expect(eval_(e)).toEqual({
      action: "planifier_vide",
      videDepuis: MAINTENANT,
      suppressionPrevueLe: ECHEANCE_NEUVE,
    });
  });

  it("dates invalides identiques aux dates absentes (meme decision)", () => {
    const invalides = inactive({
      videDepuis: DATE_INVALIDE,
      avertieLe: DATE_INVALIDE,
      suppressionPrevueLe: DATE_INVALIDE,
    });
    const absentes = inactive({ videDepuis: null, avertieLe: null, suppressionPrevueLe: null });
    expect(eval_(invalides)).toEqual(eval_(absentes));
  });

  it("une valeur qui n'est pas une Date (chaine ISO) est traitee comme absente, pas comme une date", () => {
    // Garde-fou : un champ mal type venu de la base ne doit pas etre interprete.
    const e = vide({
      videDepuis: "2026-01-01T00:00:00.000Z" as unknown as Date,
      suppressionPrevueLe: "2026-01-31T00:00:00.000Z" as unknown as Date,
      motifSuppression: "vide",
    });
    expect(eval_(e).action).toBe("planifier_vide");
  });

  it("motif inconnu traite comme absent (colocation vide)", () => {
    const e = vide({
      videDepuis: jours(-100),
      suppressionPrevueLe: jours(-10),
      motifSuppression: "bizarre",
    });
    expect(eval_(e).action).toBe("planifier_vide");
  });

  it('motif "VIDE" sur une colocation avec membres n\'est pas une trace de vide', () => {
    expect(eval_(entree({ motifSuppression: "VIDE" }))).toEqual({ action: "rien" });
  });

  it("n'altere ni l'entree ni maintenant (colocation vide, planifier_vide)", () => {
    const e = vide({ videDepuis: jours(-5) });
    const eAvant = structuredClone(e);
    const mAvant = structuredClone(MAINTENANT);
    eval_(e);
    expect(e).toEqual(eAvant);
    expect(MAINTENANT).toEqual(mAvant);
  });

  it("n'altere pas l'entree (plan complet, supprimer)", () => {
    const e = vide({ videDepuis: jours(-40), suppressionPrevueLe: jours(-10), motifSuppression: "vide" });
    const avant = structuredClone(e);
    eval_(e);
    expect(e).toEqual(avant);
  });

  it("n'altere pas l'entree (inactive, avertir_inactive et annuler)", () => {
    const a = inactive();
    const b = inactive({ avertieLe: jours(-40) });
    const aAvant = structuredClone(a);
    const bAvant = structuredClone(b);
    eval_(a);
    eval_(b);
    expect(a).toEqual(aAvant);
    expect(b).toEqual(bAvant);
  });

  it("les dates renvoyees sont de nouvelles instances : les modifier ne touche pas l'entree ni maintenant", () => {
    const e = vide({ videDepuis: jours(-5) });
    const decision = eval_(e);
    if (decision.action !== "planifier_vide") throw new Error("planifier_vide attendu");
    expect(decision.videDepuis).not.toBe(e.videDepuis);
    decision.videDepuis.setTime(0);
    decision.suppressionPrevueLe.setTime(0);
    expect(e.videDepuis).toEqual(jours(-5));
    expect(MAINTENANT.getTime()).toBe(T);

    const avert = eval_(inactive());
    if (avert.action !== "avertir_inactive") throw new Error("avertir_inactive attendu");
    expect(avert.avertieLe).not.toBe(MAINTENANT);
    avert.avertieLe.setTime(0);
    expect(MAINTENANT.getTime()).toBe(T);
  });

  it("deux appels identiques donnent le meme resultat (pas d'etat cache)", () => {
    const cas = [
      vide(),
      inactive(),
      entree(),
      vide({ videDepuis: jours(-40), suppressionPrevueLe: jours(-10), motifSuppression: "vide" }),
      inactive({ avertieLe: jours(-40), suppressionPrevueLe: jours(-10), motifSuppression: "inactive" }),
    ];
    for (const c of cas) {
      const premier = eval_(c);
      const second = eval_(c);
      expect(second).toEqual(premier);
    }
  });

  it("le resultat ne depend que de (entree, maintenant) : un autre instant donne une autre decision", () => {
    const e = vide({ videDepuis: jours(-5), suppressionPrevueLe: jours(25), motifSuppression: "vide" });
    expect(evaluerNettoyage(e, MAINTENANT)).toEqual({ action: "rien" });
    expect(evaluerNettoyage(e, jours(25))).toEqual({ action: "supprimer", motif: "vide" });
    expect(evaluerNettoyage(e, ms(25 * JOUR_MS - 1))).toEqual({ action: "rien" });
  });
});

// ---------------------------------------------------------------------------
// Propriete de securite sur une grille exhaustive
// ---------------------------------------------------------------------------

// Dates relatives (en jours) : null = absente. Les valeurs sont choisies pour
// produire des plans coherents ET incoherents, echus ET futurs.
const DATES_RELATIVES: (number | null)[] = [null, -400, -100, -35, 0, 10];
const ACTIVITES_RELATIVES = [-400, -100, -10, 5];
const CREATIONS_RELATIVES = [-500, -10];
const MOTIFS: (string | undefined)[] = [undefined, "vide", "inactive", "bizarre"];
const DEMOS: (boolean | undefined)[] = [true, false, undefined];

type Cas = EntreeNettoyage;

function* toutesLesCombinaisons(nombreMembres: number): Generator<Cas> {
  const dateOuNull = (n: number | null) => (n === null ? null : jours(n));
  for (const demo of DEMOS) {
    for (const videDepuis of DATES_RELATIVES) {
      for (const avertieLe of DATES_RELATIVES) {
        for (const echeance of DATES_RELATIVES) {
          for (const motif of MOTIFS) {
            for (const activite of ACTIVITES_RELATIVES) {
              for (const creation of CREATIONS_RELATIVES) {
                yield {
                  nombreMembres,
                  demo,
                  creeLe: jours(creation),
                  derniereActivite: jours(activite),
                  videDepuis: dateOuNull(videDepuis),
                  avertieLe: dateOuNull(avertieLe),
                  suppressionPrevueLe: dateOuNull(echeance),
                  motifSuppression: motif,
                };
              }
            }
          }
        }
      }
    }
  }
}

const ms_ = (x: Date | null | undefined) => (x instanceof Date && !Number.isNaN(x.getTime()) ? x.getTime() : null);

// Cles attendues par action : aucune decision ne porte un effet de plus.
const CLES_PAR_ACTION: Record<DecisionNettoyage["action"], string[]> = {
  ignorer: ["action"],
  rien: ["action"],
  planifier_vide: ["action", "suppressionPrevueLe", "videDepuis"], // deja trie
  avertir_inactive: ["action", "avertieLe", "suppressionPrevueLe"], // deja trie
  annuler: ["action"],
  supprimer: ["action", "motif"],
};

/** Verifie, de facon independante du code teste, qu'un `supprimer` est legitime. */
function verifierSuppressionLegitime(e: Cas, decision: DecisionNettoyage): void {
  if (decision.action !== "supprimer") return;
  const contexte = JSON.stringify(e);

  // Jamais sur une demo.
  expect(e.demo, `demo true supprimee : ${contexte}`).not.toBe(true);

  // Echeance posee, valide et atteinte.
  const echeance = ms_(e.suppressionPrevueLe);
  expect(echeance, `echeance absente : ${contexte}`).not.toBeNull();
  expect(echeance!, `echeance future : ${contexte}`).toBeLessThanOrEqual(T);

  if (e.nombreMembres === 0) {
    expect(decision.motif, contexte).toBe("vide");
    expect(e.motifSuppression, `motif en base != vide : ${contexte}`).toBe("vide");
    const depart = ms_(e.videDepuis);
    expect(depart, `videDepuis absent : ${contexte}`).not.toBeNull();
    expect(depart!, `videDepuis futur : ${contexte}`).toBeLessThanOrEqual(T);
    expect(echeance!, `preavis raccourci : ${contexte}`).toBeGreaterThanOrEqual(depart! + SUPPRESSION_MS);
    return;
  }

  // Avec membres : uniquement inactivite averee.
  expect(decision.motif, contexte).toBe("inactive");
  expect(e.motifSuppression, `motif en base != inactive : ${contexte}`).toBe("inactive");
  // Aucune trace de vide.
  expect(ms_(e.videDepuis), `trace vide : ${contexte}`).toBeNull();
  const avertie = ms_(e.avertieLe);
  expect(avertie, `avertieLe absent : ${contexte}`).not.toBeNull();
  expect(avertie!, `avertieLe futur : ${contexte}`).toBeLessThanOrEqual(T);
  expect(echeance!, `preavis raccourci : ${contexte}`).toBeGreaterThanOrEqual(avertie! + SUPPRESSION_MS);
  const activite = Math.max(ms_(e.derniereActivite) ?? -Infinity, ms_(e.creeLe) ?? -Infinity);
  expect(activite, `activite posterieure a l'avertissement : ${contexte}`).toBeLessThanOrEqual(avertie!);
  expect(T - activite, `pas inactive : ${contexte}`).toBeGreaterThan(INACTIVITE_MS);
}

describe.each([
  ["colocation vide (0 membre)", 0],
  ["colocation a 1 membre", 1],
  ["colocation a 3 membres", 3],
])("propriete de securite : %s", (_nom, nombreMembres) => {
  it("supprimer n'est rendu que dans les cas legitimes, avec une seule action par appel", () => {
    let total = 0;
    let suppressions = 0;
    for (const cas of toutesLesCombinaisons(nombreMembres)) {
      total++;
      const decision = eval_(cas);
      // Le message (JSON.stringify) n'est construit qu'en cas d'echec : 60 000
      // combinaisons, on evite un travail inutile a chaque tour.
      const cles = Object.keys(decision).sort().join(",");
      if (cles !== CLES_PAR_ACTION[decision.action].join(",")) {
        throw new Error(`Effets inattendus ${cles} pour ${JSON.stringify(cas)}`);
      }
      if (decision.action === "supprimer") suppressions++;
      verifierSuppressionLegitime(cas, decision);
    }
    expect(total).toBe(DEMOS.length * DATES_RELATIVES.length ** 3 * MOTIFS.length * ACTIVITES_RELATIVES.length * CREATIONS_RELATIVES.length);
    // Garde-fou : la grille doit bien atteindre `supprimer`, sinon la propriete
    // serait vide de sens. Aucune suppression si la grille ne la rend jamais.
    expect(suppressions).toBeGreaterThan(0);
  });

  it("demo true : toujours ignorer, quelle que soit la combinaison", () => {
    for (const cas of toutesLesCombinaisons(nombreMembres)) {
      if (cas.demo !== true) continue;
      if (eval_(cas).action !== "ignorer") throw new Error(`demo non ignoree : ${JSON.stringify(cas)}`);
    }
  });

  it("jamais supprimer juste apres planifier_vide, avertir_inactive ou annuler (on rejoue au meme instant)", () => {
    let rejoues = 0;
    for (const cas of toutesLesCombinaisons(nombreMembres)) {
      const decision = eval_(cas);
      if (
        decision.action !== "planifier_vide" &&
        decision.action !== "avertir_inactive" &&
        decision.action !== "annuler"
      ) {
        continue;
      }
      rejoues++;
      const suite = eval_(appliquer(cas, decision));
      const mauvais =
        suite.action === "supprimer" || (decision.action !== "annuler" && suite.action !== "rien");
      if (mauvais) {
        // Apres planifier/avertir, le plan pose est coherent : il faut attendre l'echeance.
        throw new Error(`${JSON.stringify(cas)} -> ${decision.action} puis ${suite.action}`);
      }
    }
    expect(rejoues).toBeGreaterThan(0);
  });

  it("l'entree n'est jamais modifiee, quelle que soit la combinaison", () => {
    let n = 0;
    for (const cas of toutesLesCombinaisons(nombreMembres)) {
      // Echantillon deterministe : une combinaison sur 7 suffit pour l'immutabilite.
      if (n++ % 7 !== 0) continue;
      const avant = structuredClone(cas);
      eval_(cas);
      expect(cas).toEqual(avant);
    }
  });

  it("deterministe : deux appels identiques donnent le meme resultat sur toute la grille", () => {
    let n = 0;
    for (const cas of toutesLesCombinaisons(nombreMembres)) {
      if (n++ % 5 !== 0) continue;
      expect(eval_(cas)).toEqual(eval_(cas));
    }
  });
});

describe("propriete de securite : la grille atteint bien les deux motifs de suppression", () => {
  it("supprimer motif vide et supprimer motif inactive sont tous les deux atteints", () => {
    const motifs = new Set<string>();
    for (const nombreMembres of [0, 1, 3]) {
      for (const cas of toutesLesCombinaisons(nombreMembres)) {
        const decision = eval_(cas);
        if (decision.action === "supprimer") motifs.add(decision.motif);
      }
    }
    expect([...motifs].sort()).toEqual(["inactive", "vide"]);
  });
});

describe("propriete de securite : valeurs invalides melangees aux dates", () => {
  const INVALIDES: (Date | null | undefined)[] = [undefined, null, DATE_INVALIDE, jours(-400), jours(-35), jours(10)];

  it("aucune combinaison de dates absentes, invalides ou valides ne produit une suppression illegitime", () => {
    for (const nombreMembres of [0, 2]) {
      for (const videDepuis of INVALIDES) {
        for (const avertieLe of INVALIDES) {
          for (const echeance of INVALIDES) {
            for (const motif of MOTIFS) {
              for (const derniere of [DATE_INVALIDE, jours(-400), jours(-10)]) {
                for (const creeLe of [DATE_INVALIDE, jours(-500), jours(-10)]) {
                  const cas: Cas = {
                    nombreMembres,
                    creeLe,
                    derniereActivite: derniere,
                    videDepuis,
                    avertieLe,
                    suppressionPrevueLe: echeance,
                    motifSuppression: motif,
                  };
                  verifierSuppressionLegitime(cas, eval_(cas));
                }
              }
            }
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Verrou de destruction : DELAI_VERROU_DESTRUCTION_MS, destructionEnCours,
// filtreHorsDestruction
// ---------------------------------------------------------------------------

// Le verrou est pose par le cron juste avant de detruire une colocation, et lu
// par /join pour refuser qu'on la rejoigne pendant qu'elle s'efface. Ces deux
// fonctions doivent dire EXACTEMENT la meme chose : l'une en JavaScript,
// l'autre sous forme de filtre Mongo. Une difference d'une milliseconde de
// seuil laisserait un trou entre le refus de /join et la reprise du cron.

describe("DELAI_VERROU_DESTRUCTION_MS", () => {
  it("vaut 10 minutes, en millisecondes", () => {
    expect(DELAI_VERROU_DESTRUCTION_MS).toBe(600_000);
    expect(DELAI_VERROU_DESTRUCTION_MS).toBe(10 * 60 * 1000);
  });
});

describe("destructionEnCours", () => {
  const VERROU = DELAI_VERROU_DESTRUCTION_MS;
  const enCours = (debut: Date | null | undefined, maintenant: Date = MAINTENANT) =>
    destructionEnCours(debut, maintenant);

  it("marqueur absent (undefined) : pas en cours", () => {
    expect(enCours(undefined)).toBe(false);
  });

  it("marqueur null : pas en cours", () => {
    expect(enCours(null)).toBe(false);
  });

  it("marqueur pose il y a 1 seconde : en cours", () => {
    expect(enCours(new Date(T - 1000))).toBe(true);
  });

  it("marqueur pose il y a 1 minute, 5 minutes, 9 minutes 59 s : en cours", () => {
    expect(enCours(new Date(T - 60_000))).toBe(true);
    expect(enCours(new Date(T - 5 * 60_000))).toBe(true);
    expect(enCours(new Date(T - (VERROU - 1000)))).toBe(true);
  });

  it("marqueur pose exactement maintenant : en cours", () => {
    expect(enCours(new Date(T))).toBe(true);
  });

  it("borne : exactement 10 minutes => EN COURS (>= au seuil, le contraire exact du $lt de Mongo)", () => {
    expect(enCours(new Date(T - VERROU))).toBe(true);
  });

  it("borne : 10 minutes moins 1 ms => en cours", () => {
    expect(enCours(new Date(T - VERROU + 1))).toBe(true);
  });

  it("borne : 10 minutes plus 1 ms => PAS en cours (verrou perime, passage plante)", () => {
    expect(enCours(new Date(T - VERROU - 1))).toBe(false);
  });

  it("marqueur plus vieux : 1 heure, 1 jour, 1 an : pas en cours", () => {
    expect(enCours(new Date(T - 60 * 60_000))).toBe(false);
    expect(enCours(new Date(T - JOUR_MS))).toBe(false);
    expect(enCours(new Date(T - 365 * JOUR_MS))).toBe(false);
  });

  it("marqueur dans le futur (horloges decalees) : en cours, meme de 1 ms, d'un jour ou de 100 ans", () => {
    expect(enCours(new Date(T + 1))).toBe(true);
    expect(enCours(new Date(T + JOUR_MS))).toBe(true);
    expect(enCours(new Date(T + 36500 * JOUR_MS))).toBe(true);
  });

  it("marqueur invalide (Invalid Date) : traite comme absent, pas en cours", () => {
    expect(enCours(DATE_INVALIDE)).toBe(false);
    expect(enCours(new Date(NaN))).toBe(false);
  });

  it("valeur qui n'est pas une Date (chaine ISO ou nombre venus d'une base abimee) : traitee comme absente, pas en cours", () => {
    expect(enCours(new Date(T).toISOString() as unknown as Date)).toBe(false);
    expect(enCours(T as unknown as Date)).toBe(false);
  });

  it("l'epoque (timestamp 0) est une date valide, pas une absence", () => {
    // 5 minutes apres l'epoque : le marqueur de l'epoque a 5 min, il est en cours.
    expect(destructionEnCours(new Date(0), new Date(5 * 60_000))).toBe(true);
    // 11 minutes apres : perime.
    expect(destructionEnCours(new Date(0), new Date(11 * 60_000))).toBe(false);
  });

  it("depend de maintenant : le meme marqueur passe de en cours a perime avec le temps", () => {
    const debut = new Date(T);
    expect(destructionEnCours(debut, new Date(T))).toBe(true);
    expect(destructionEnCours(debut, new Date(T + VERROU))).toBe(true);
    expect(destructionEnCours(debut, new Date(T + VERROU + 1))).toBe(false);
  });

  it("comportement reel : maintenant invalide => pas en cours (le seuil devient NaN, la comparaison est fausse)", () => {
    // Hors d'atteinte du code reel (les appelants passent new Date()), mais a
    // connaitre : une horloge invalide leverait le verrou au lieu de le garder.
    expect(destructionEnCours(new Date(T), DATE_INVALIDE)).toBe(false);
  });

  it("ne modifie ni le marqueur ni maintenant", () => {
    const debut = new Date(T - 1000);
    const maintenant = new Date(T);
    destructionEnCours(debut, maintenant);
    expect(debut.getTime()).toBe(T - 1000);
    expect(maintenant.getTime()).toBe(T);
  });

  it("deterministe : deux appels identiques, meme resultat", () => {
    const debut = new Date(T - VERROU);
    expect(enCours(debut)).toBe(enCours(debut));
  });
});

describe("filtreHorsDestruction", () => {
  const SEUIL = new Date(T - DELAI_VERROU_DESTRUCTION_MS);

  it("forme exacte du filtre : marqueur null (absent ou null) OU marqueur strictement plus vieux que le seuil", () => {
    expect(filtreHorsDestruction(MAINTENANT)).toStrictEqual({
      $or: [{ destructionDebut: null }, { destructionDebut: { $lt: SEUIL } }],
    });
  });

  it("le seuil est exactement maintenant moins 10 minutes (600 000 ms), en instance de Date", () => {
    const filtre = filtreHorsDestruction(MAINTENANT);
    const seuil = filtre.$or[1].destructionDebut;
    expect(seuil).not.toBeNull();
    const borne = (seuil as { $lt: Date }).$lt;
    expect(borne).toBeInstanceOf(Date);
    expect(borne.getTime()).toBe(T - 600_000);
  });

  it("la seule cle de premier niveau est $or, avec exactement deux clauses (fusionnable dans un filtre existant)", () => {
    const filtre = filtreHorsDestruction(MAINTENANT);
    expect(Object.keys(filtre)).toEqual(["$or"]);
    expect(filtre.$or).toHaveLength(2);
  });

  it("la fusion par decomposition conserve les autres cles du filtre", () => {
    const fusion = { inviteCode: "ABCD1234", ...filtreHorsDestruction(MAINTENANT) };
    expect(Object.keys(fusion).sort()).toEqual(["$or", "inviteCode"]);
  });

  it("le seuil est une NOUVELLE instance : modifier maintenant apres coup ne change pas le filtre", () => {
    const maintenant = new Date(T);
    const filtre = filtreHorsDestruction(maintenant);
    const borne = (filtre.$or[1].destructionDebut as { $lt: Date }).$lt;
    expect(borne).not.toBe(maintenant);
    maintenant.setTime(0);
    expect(borne.getTime()).toBe(T - 600_000);
  });

  it("ne modifie pas maintenant", () => {
    const maintenant = new Date(T);
    filtreHorsDestruction(maintenant);
    expect(maintenant.getTime()).toBe(T);
  });

  it("deux appels avec le meme instant donnent des filtres egaux mais independants", () => {
    const a = filtreHorsDestruction(MAINTENANT);
    const b = filtreHorsDestruction(MAINTENANT);
    expect(a).toStrictEqual(b);
    expect(a).not.toBe(b);
    expect(a.$or).not.toBe(b.$or);
  });

  it("un autre instant donne un autre seuil", () => {
    const plusTard = new Date(T + 5 * 60_000);
    const borne = (filtreHorsDestruction(plusTard).$or[1].destructionDebut as { $lt: Date }).$lt;
    expect(borne.getTime()).toBe(T + 5 * 60_000 - 600_000);
  });

  it("comportement reel : maintenant invalide => seuil invalide, sans exception (les appelants passent new Date())", () => {
    let filtre: ReturnType<typeof filtreHorsDestruction> | undefined;
    expect(() => {
      filtre = filtreHorsDestruction(DATE_INVALIDE);
    }).not.toThrow();
    const borne = (filtre!.$or[1].destructionDebut as { $lt: Date }).$lt;
    expect(Number.isNaN(borne.getTime())).toBe(true);
  });

  describe("coherence avec destructionEnCours : meme seuil, a la milliseconde", () => {
    // Petit evaluateur de LA forme exacte du filtre, avec la semantique de
    // MongoDB : `{ champ: null }` correspond a un champ absent OU null ; `$lt`
    // sur une date est une comparaison stricte.
    type Filtre = ReturnType<typeof filtreHorsDestruction>;
    function correspond(filtre: Filtre, destructionDebut: Date | null | undefined): boolean {
      return filtre.$or.some((clause) => {
        const condition = clause.destructionDebut;
        if (condition === null) return destructionDebut === null || destructionDebut === undefined;
        return destructionDebut instanceof Date && destructionDebut.getTime() < condition.$lt.getTime();
      });
    }

    const V = DELAI_VERROU_DESTRUCTION_MS;
    const DECALAGES_AUTOUR_DU_SEUIL: number[] = [
      -365 * JOUR_MS,
      -JOUR_MS,
      -V - 1000,
      -V - 1,
      -V,
      -V + 1,
      -V + 1000,
      -1000,
      -1,
      0,
      1,
      1000,
      V,
      JOUR_MS,
      365 * JOUR_MS,
    ];

    it("sur toute une grille de marqueurs autour du seuil : le filtre correspond si et seulement si la destruction n'est PAS en cours", () => {
      const instants = [MAINTENANT, new Date(0), new Date(V), new Date(V - 1), new Date(-V), d("2027-03-28T00:59:59.999Z")];
      let verifies = 0;
      for (const maintenant of instants) {
        const filtre = filtreHorsDestruction(maintenant);
        const marqueurs: (Date | null | undefined)[] = [
          undefined,
          null,
          ...DECALAGES_AUTOUR_DU_SEUIL.map((delta) => new Date(maintenant.getTime() + delta)),
        ];
        for (const marqueur of marqueurs) {
          verifies++;
          expect(
            correspond(filtre, marqueur),
            `maintenant=${maintenant.toISOString()} marqueur=${marqueur instanceof Date ? marqueur.toISOString() : String(marqueur)}`
          ).toBe(!destructionEnCours(marqueur, maintenant));
        }
      }
      expect(verifies).toBe(instants.length * (2 + DECALAGES_AUTOUR_DU_SEUIL.length));
    });

    it("exactement 10 minutes : le filtre REFUSE (un autre passage ne peut pas encore reprendre) et destructionEnCours dit en cours", () => {
      const marqueur = new Date(T - V);
      expect(correspond(filtreHorsDestruction(MAINTENANT), marqueur)).toBe(false);
      expect(destructionEnCours(marqueur, MAINTENANT)).toBe(true);
    });

    it("10 minutes + 1 ms : le filtre ACCEPTE (reprise possible) et destructionEnCours dit perime", () => {
      const marqueur = new Date(T - V - 1);
      expect(correspond(filtreHorsDestruction(MAINTENANT), marqueur)).toBe(true);
      expect(destructionEnCours(marqueur, MAINTENANT)).toBe(false);
    });

    it("marqueur absent ou null : le filtre accepte (pas de verrou)", () => {
      const filtre = filtreHorsDestruction(MAINTENANT);
      expect(correspond(filtre, undefined)).toBe(true);
      expect(correspond(filtre, null)).toBe(true);
    });

    it("marqueur dans le futur : le filtre refuse, comme destructionEnCours", () => {
      const filtre = filtreHorsDestruction(MAINTENANT);
      expect(correspond(filtre, new Date(T + 1))).toBe(false);
      expect(destructionEnCours(new Date(T + 1), MAINTENANT)).toBe(true);
    });

    it("200 couples (maintenant, marqueur) pseudo-aleatoires de graine fixe : jamais de desaccord", () => {
      let etat = 20261030;
      const tirer = (max: number) => {
        etat = (etat * 1103515245 + 12345) % 2147483648;
        return etat % max;
      };
      for (let i = 0; i < 200; i++) {
        const maintenant = new Date(T + tirer(400 * JOUR_MS) - 200 * JOUR_MS);
        // Marqueur dans une fenetre de +-20 minutes autour du seuil, au ms pres.
        const marqueur = new Date(maintenant.getTime() - V + (tirer(2_400_001) - 1_200_000));
        expect(
          correspond(filtreHorsDestruction(maintenant), marqueur),
          `maintenant=${maintenant.toISOString()} marqueur=${marqueur.toISOString()}`
        ).toBe(!destructionEnCours(marqueur, maintenant));
      }
    });
  });
});

// ---------------------------------------------------------------------------
// ecritureRefuseeParFiltre
// ---------------------------------------------------------------------------

describe("ecritureRefuseeParFiltre", () => {
  // Vraies instances Mongoose : leurs constructeurs sont simples (pas de base).
  const notFound = () => new MongooseError.DocumentNotFoundError("filtre _id x");
  const versionError = () =>
    new MongooseError.VersionError({ _doc: { _id: "x" } } as never, 3, ["members"]);

  it("DocumentNotFoundError de Mongoose : vrai", () => {
    expect(ecritureRefuseeParFiltre(notFound())).toBe(true);
  });

  it("VersionError de Mongoose : vrai", () => {
    expect(ecritureRefuseeParFiltre(versionError())).toBe(true);
  });

  it("les vraies instances ont bien le nom attendu (garde-fou : le test construit ce qu'il croit construire)", () => {
    expect(notFound().name).toBe("DocumentNotFoundError");
    expect(versionError().name).toBe("VersionError");
    expect(notFound()).toBeInstanceOf(Error);
    expect(versionError()).toBeInstanceOf(Error);
  });

  it("une sous-classe de DocumentNotFoundError ou de VersionError : vrai (instanceof)", () => {
    class MonNotFound extends MongooseError.DocumentNotFoundError {}
    class MonVersion extends MongooseError.VersionError {}
    expect(ecritureRefuseeParFiltre(new MonNotFound("filtre"))).toBe(true);
    expect(ecritureRefuseeParFiltre(new MonVersion({ _doc: {} } as never, 1, []))).toBe(true);
  });

  it("une instance dont on a change le message ou le nom reste reconnue (c'est la classe qui compte)", () => {
    const e = notFound();
    e.message = "autre texte";
    Object.defineProperty(e, "name", { value: "AutreNom" });
    expect(ecritureRefuseeParFiltre(e)).toBe(true);
  });

  it("un objet qui herite du prototype de DocumentNotFoundError : vrai", () => {
    expect(ecritureRefuseeParFiltre(Object.create(MongooseError.DocumentNotFoundError.prototype))).toBe(true);
    expect(ecritureRefuseeParFiltre(Object.create(MongooseError.VersionError.prototype))).toBe(true);
  });

  it.each([
    ["Error ordinaire", () => new Error("boom")],
    ["TypeError", () => new TypeError("x")],
    ["RangeError", () => new RangeError("x")],
    ["MongooseError de base", () => new MongooseError("x")],
    ["ValidationError de Mongoose", () => new MongooseError.ValidationError()],
    ["CastError de Mongoose", () => new MongooseError.CastError("ObjectId", "zzz", "_id")],
    ["ParallelSaveError de Mongoose", () => new MongooseError.ParallelSaveError({ _doc: { _id: "x" } } as never)],
  ])("%s : faux", (_nom, fabrique) => {
    expect(ecritureRefuseeParFiltre(fabrique())).toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["chaine vide", ""],
    ["chaine « DocumentNotFoundError »", "DocumentNotFoundError"],
    ["chaine « VersionError »", "VersionError"],
    ["nombre", 404],
    ["zero", 0],
    ["NaN", NaN],
    ["booleen vrai", true],
    ["booleen faux", false],
    ["objet vide", {}],
    ["tableau", []],
    ["fonction", () => 1],
    ["symbole", Symbol("VersionError")],
    ["la classe elle-meme (pas une instance)", MongooseError.DocumentNotFoundError],
    ["la classe VersionError elle-meme", MongooseError.VersionError],
  ])("%s : faux", (_nom, valeur) => {
    expect(ecritureRefuseeParFiltre(valeur)).toBe(false);
  });

  it("comportement reel : un objet ou une Error qui porte seulement le NOM DocumentNotFoundError / VersionError est refuse (pas de duck typing : seule la classe de Mongoose compte)", () => {
    // Signale dans le rapport : deux copies de Mongoose dans le bundle donneraient
    // des classes differentes et ce test d'instanceof dirait « faux » a tort ;
    // le code releverait alors l'erreur au lieu de repondre « introuvable ».
    const imitationNotFound = Object.assign(new Error("x"), { name: "DocumentNotFoundError" });
    const imitationVersion = Object.assign(new Error("x"), { name: "VersionError" });
    expect(ecritureRefuseeParFiltre(imitationNotFound)).toBe(false);
    expect(ecritureRefuseeParFiltre(imitationVersion)).toBe(false);
    expect(ecritureRefuseeParFiltre({ name: "DocumentNotFoundError", message: "x" })).toBe(false);
    expect(ecritureRefuseeParFiltre({ name: "VersionError" })).toBe(false);
  });

  it("ne modifie pas l'erreur recue et ne leve rien (erreur gelee)", () => {
    const e = Object.freeze(new Error("gelee"));
    expect(() => ecritureRefuseeParFiltre(e)).not.toThrow();
    expect(e.message).toBe("gelee");
  });

  it("deterministe : meme entree, meme sortie", () => {
    const e = notFound();
    expect(ecritureRefuseeParFiltre(e)).toBe(ecritureRefuseeParFiltre(e));
  });
});
