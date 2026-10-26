import { describe, expect, it } from "vitest";
import {
  INTERVALLE_REVERIFICATION_PAR_DEFAUT,
  doitReverifier,
  lireIntervalleReverification,
  sessionRevoquee,
} from "@/lib/session-guard";

// session-guard.ts n'a aucun import : tout est pur, rien a simuler.

// Dates ecrites en ISO avec "Z" : le test ne depend jamais du fuseau de la
// machine, ni de l'horloge reelle.
const MAINTENANT = Date.parse("2026-10-21T12:00:00.000Z");
const CONNECTE_LE = Date.parse("2026-10-21T10:00:00.000Z");
const d = (ms: number) => new Date(ms);

// ---------------------------------------------------------------------------
// INTERVALLE_REVERIFICATION_PAR_DEFAUT
// ---------------------------------------------------------------------------

describe("INTERVALLE_REVERIFICATION_PAR_DEFAUT", () => {
  it("vaut 300 secondes (5 minutes)", () => {
    expect(INTERVALLE_REVERIFICATION_PAR_DEFAUT).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// lireIntervalleReverification
// ---------------------------------------------------------------------------

describe("lireIntervalleReverification : valeurs valides", () => {
  it.each([
    ["10", 10],
    ["300", 300],
    ["1", 1],
    ["60", 60],
    ["3600", 3600],
  ])("%j : lu tel quel (%i)", (texte, attendu) => {
    expect(lireIntervalleReverification(texte)).toBe(attendu);
  });

  it("' 10 ' (espaces autour) : accepte, retires par le trim", () => {
    expect(lireIntervalleReverification(" 10 ")).toBe(10);
  });

  it("tabulation et retour a la ligne autour : acceptes aussi", () => {
    expect(lireIntervalleReverification("\t60\n")).toBe(60);
  });

  it("zeros en tete ('010') : lu comme 10, pas comme de l'octal", () => {
    expect(lireIntervalleReverification("010")).toBe(10);
  });

  it("plus grand entier sur : accepte", () => {
    expect(lireIntervalleReverification(String(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER
    );
  });

  it("'99999999999' (11 chiffres, entier sur) : accepte tel quel", () => {
    // Documente le code actuel : pas de plafond. Avec cette valeur la
    // verification ne se refait pratiquement jamais (3 000 ans). C'est une
    // valeur d'environnement posee par le developpeur, pas une entree
    // utilisateur, mais aucune borne haute ne l'empeche.
    expect(lireIntervalleReverification("99999999999")).toBe(99999999999);
  });
});

describe("lireIntervalleReverification : retombe sur le defaut (300)", () => {
  it.each([
    ["undefined", undefined],
    ["chaine vide", ""],
    ["espaces seuls", "   "],
    ["texte", "abc"],
    ["negatif", "-5"],
    ["zero", "0"],
    ["zeros", "000"],
    ["decimal", "1.5"],
    ["decimal avec zero", "10.0"],
    ["notation scientifique", "1e3"],
    ["signe plus", "+10"],
    ["hexadecimal", "0x10"],
    ["melange chiffres et lettres", "10s"],
    ["espace au milieu", "1 0"],
    ["virgule", "1,5"],
    ["'NaN'", "NaN"],
    ["'Infinity'", "Infinity"],
    ["chiffres arabes (\\d sans drapeau u = ASCII seulement)", "١٢"],
  ])("%s (%j) : 300", (_nom, valeur) => {
    expect(lireIntervalleReverification(valeur)).toBe(INTERVALLE_REVERIFICATION_PAR_DEFAUT);
  });

  it("entier trop grand pour etre sur (> MAX_SAFE_INTEGER) : 300", () => {
    // 2^53 = 9007199254740992 : Number() le lit, mais Number.isSafeInteger refuse.
    expect(lireIntervalleReverification("9007199254740992")).toBe(300);
    expect(lireIntervalleReverification("9".repeat(400))).toBe(300);
  });

  it("valeur non-chaine glissee malgre le typage (null, nombre) : 300, sans exception", () => {
    expect(lireIntervalleReverification(null as unknown as string)).toBe(300);
    expect(lireIntervalleReverification(60 as unknown as string)).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// doitReverifier
// ---------------------------------------------------------------------------

describe("doitReverifier", () => {
  const INTERVALLE = 300;
  const ms = INTERVALLE * 1000;

  it("verifieLe undefined : true (aucune verification connue)", () => {
    expect(doitReverifier(undefined, MAINTENANT, INTERVALLE)).toBe(true);
  });

  it("verifieLe NaN : true (date illisible)", () => {
    expect(doitReverifier(NaN, MAINTENANT, INTERVALLE)).toBe(true);
  });

  it("verifieLe Infinity ou -Infinity : true", () => {
    expect(doitReverifier(Infinity, MAINTENANT, INTERVALLE)).toBe(true);
    expect(doitReverifier(-Infinity, MAINTENANT, INTERVALLE)).toBe(true);
  });

  it("verifieLe null ou chaine glisses malgre le typage : true, sans exception", () => {
    expect(doitReverifier(null as unknown as number, MAINTENANT, INTERVALLE)).toBe(true);
    expect(doitReverifier("1000" as unknown as number, MAINTENANT, INTERVALLE)).toBe(true);
  });

  it("verifie a l'instant meme : false", () => {
    expect(doitReverifier(MAINTENANT, MAINTENANT, INTERVALLE)).toBe(false);
  });

  it("juste avant l'intervalle (299,999 s) : false", () => {
    expect(doitReverifier(MAINTENANT - (ms - 1), MAINTENANT, INTERVALLE)).toBe(false);
  });

  it("a l'intervalle pile (300 s) : true (frontiere incluse, >=)", () => {
    expect(doitReverifier(MAINTENANT - ms, MAINTENANT, INTERVALLE)).toBe(true);
  });

  it("1 ms apres l'intervalle : true", () => {
    expect(doitReverifier(MAINTENANT - (ms + 1), MAINTENANT, INTERVALLE)).toBe(true);
  });

  it("tres longtemps apres : true", () => {
    expect(doitReverifier(0, MAINTENANT, INTERVALLE)).toBe(true);
  });

  it("verifieLe = 0 (epoque, valeur valide) : traite comme un nombre, pas comme 'absent'", () => {
    // Un test "if (!verifieLe)" aurait renvoye true pour 0 sans calcul ; ici
    // on verifie le calcul avec un instant tout proche de l'epoque.
    expect(doitReverifier(0, 1000, INTERVALLE)).toBe(false);
    expect(doitReverifier(0, ms, INTERVALLE)).toBe(true);
  });

  it("verifieLe dans le futur (1 ms) : true (horloges decalees, on reverifie)", () => {
    expect(doitReverifier(MAINTENANT + 1, MAINTENANT, INTERVALLE)).toBe(true);
  });

  it("verifieLe dans le futur (1 heure) : true", () => {
    expect(doitReverifier(MAINTENANT + 3_600_000, MAINTENANT, INTERVALLE)).toBe(true);
  });

  it("maintenant < verifieLe : meme resultat que ci-dessus, quelle que soit la duree de l'intervalle", () => {
    expect(doitReverifier(MAINTENANT + 10, MAINTENANT, 1_000_000)).toBe(true);
  });

  it("intervalle 0 : toujours true (a l'instant meme aussi)", () => {
    expect(doitReverifier(MAINTENANT, MAINTENANT, 0)).toBe(true);
    expect(doitReverifier(MAINTENANT - 1, MAINTENANT, 0)).toBe(true);
  });

  it("intervalle negatif : toujours true (documente : lireIntervalleReverification ne peut pas en produire)", () => {
    expect(doitReverifier(MAINTENANT, MAINTENANT, -10)).toBe(true);
  });

  it("intervalle NaN : false (NaN n'est jamais atteint), la verification serait desactivee", () => {
    // Documente le code actuel, sans le juger : ecouleMs >= NaN est toujours
    // faux. Sans risque aujourd'hui car l'intervalle vient de
    // lireIntervalleReverification, qui ne renvoie jamais NaN.
    expect(doitReverifier(MAINTENANT - 10 * ms, MAINTENANT, NaN)).toBe(false);
  });

  it("intervalle de 1 s : 999 ms false, 1000 ms true", () => {
    expect(doitReverifier(MAINTENANT - 999, MAINTENANT, 1)).toBe(false);
    expect(doitReverifier(MAINTENANT - 1000, MAINTENANT, 1)).toBe(true);
  });

  it("va avec lireIntervalleReverification : variable absente => 5 minutes", () => {
    const intervalle = lireIntervalleReverification(undefined);
    expect(doitReverifier(MAINTENANT - 299_000, MAINTENANT, intervalle)).toBe(false);
    expect(doitReverifier(MAINTENANT - 300_000, MAINTENANT, intervalle)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sessionRevoquee
// ---------------------------------------------------------------------------

describe("sessionRevoquee : utilisateur supprime", () => {
  it("utilisateur inexistant : revoquee", () => {
    expect(
      sessionRevoquee({ connecteLe: CONNECTE_LE, passwordChangedAt: null, utilisateurExiste: false })
    ).toBe(true);
  });

  it("utilisateur inexistant : revoquee quel que soit le reste", () => {
    const cas = [
      { connecteLe: undefined, passwordChangedAt: undefined },
      { connecteLe: undefined, passwordChangedAt: null },
      { connecteLe: CONNECTE_LE, passwordChangedAt: d(CONNECTE_LE - 1000) },
      { connecteLe: CONNECTE_LE, passwordChangedAt: d(CONNECTE_LE + 1000) },
      { connecteLe: 0, passwordChangedAt: d(NaN) },
      { connecteLe: NaN, passwordChangedAt: d(0) },
    ];
    for (const c of cas) {
      expect(sessionRevoquee({ ...c, utilisateurExiste: false })).toBe(true);
    }
  });
});

describe("sessionRevoquee : pas de changement de mot de passe", () => {
  it("passwordChangedAt null : valide", () => {
    expect(
      sessionRevoquee({ connecteLe: CONNECTE_LE, passwordChangedAt: null, utilisateurExiste: true })
    ).toBe(false);
  });

  it("passwordChangedAt undefined : valide", () => {
    expect(
      sessionRevoquee({
        connecteLe: CONNECTE_LE,
        passwordChangedAt: undefined,
        utilisateurExiste: true,
      })
    ).toBe(false);
  });

  it("passwordChangedAt absent ET connecteLe absent (vieux jeton, jamais de changement) : valide", () => {
    expect(
      sessionRevoquee({ connecteLe: undefined, passwordChangedAt: null, utilisateurExiste: true })
    ).toBe(false);
  });
});

describe("sessionRevoquee : comparaison avec la date de connexion", () => {
  const base = { utilisateurExiste: true, connecteLe: CONNECTE_LE };

  it("mot de passe change AVANT la connexion : valide", () => {
    expect(sessionRevoquee({ ...base, passwordChangedAt: d(CONNECTE_LE - 60_000) })).toBe(false);
  });

  it("mot de passe change 1 ms AVANT la connexion : valide", () => {
    expect(sessionRevoquee({ ...base, passwordChangedAt: d(CONNECTE_LE - 1) })).toBe(false);
  });

  it("mot de passe change APRES la connexion : revoquee", () => {
    expect(sessionRevoquee({ ...base, passwordChangedAt: d(CONNECTE_LE + 60_000) })).toBe(true);
  });

  it("mot de passe change 1 ms APRES la connexion : revoquee", () => {
    expect(sessionRevoquee({ ...base, passwordChangedAt: d(CONNECTE_LE + 1) })).toBe(true);
  });

  it("egalite exacte a la milliseconde : valide (revoque seulement si strictement apres)", () => {
    expect(sessionRevoquee({ ...base, passwordChangedAt: d(CONNECTE_LE) })).toBe(false);
  });
});

describe("sessionRevoquee : donnees manquantes ou illisibles", () => {
  it("connecteLe undefined + passwordChangedAt present : revoquee (jeton anterieur au changement)", () => {
    expect(
      sessionRevoquee({
        connecteLe: undefined,
        passwordChangedAt: d(CONNECTE_LE),
        utilisateurExiste: true,
      })
    ).toBe(true);
  });

  it("connecteLe NaN + passwordChangedAt present : revoquee", () => {
    expect(
      sessionRevoquee({ connecteLe: NaN, passwordChangedAt: d(CONNECTE_LE), utilisateurExiste: true })
    ).toBe(true);
  });

  it("connecteLe Infinity + passwordChangedAt present : revoquee (non fini = illisible)", () => {
    expect(
      sessionRevoquee({
        connecteLe: Infinity,
        passwordChangedAt: d(CONNECTE_LE),
        utilisateurExiste: true,
      })
    ).toBe(true);
  });

  it("passwordChangedAt = Invalid Date : ignore, session valide (sinon le compte serait bloque a jamais)", () => {
    expect(
      sessionRevoquee({
        connecteLe: CONNECTE_LE,
        passwordChangedAt: new Date("pas une date"),
        utilisateurExiste: true,
      })
    ).toBe(false);
  });

  it("passwordChangedAt = Invalid Date + connecteLe undefined : valide aussi (la date illisible est testee avant)", () => {
    expect(
      sessionRevoquee({
        connecteLe: undefined,
        passwordChangedAt: new Date(NaN),
        utilisateurExiste: true,
      })
    ).toBe(false);
  });

  it("connecteLe = 0 (epoque, valeur valide) : traite comme un nombre, pas comme 'absent'", () => {
    // Un mot de passe change apres l'epoque revoque la session ; un mot de
    // passe change a l'epoque exactement (egalite) ne la revoque pas.
    expect(
      sessionRevoquee({ connecteLe: 0, passwordChangedAt: d(1), utilisateurExiste: true })
    ).toBe(true);
    expect(
      sessionRevoquee({ connecteLe: 0, passwordChangedAt: d(0), utilisateurExiste: true })
    ).toBe(false);
  });

  it("connecteLe = 0 et mot de passe change avant l'epoque (date negative) : valide", () => {
    expect(
      sessionRevoquee({ connecteLe: 0, passwordChangedAt: d(-1000), utilisateurExiste: true })
    ).toBe(false);
  });

  it("scenario complet : connexion, changement de mot de passe, nouvelle connexion", () => {
    const changement = d(CONNECTE_LE + 3_600_000);
    // Ancienne session : revoquee.
    expect(
      sessionRevoquee({
        connecteLe: CONNECTE_LE,
        passwordChangedAt: changement,
        utilisateurExiste: true,
      })
    ).toBe(true);
    // Nouvelle session ouverte apres le changement : valide.
    expect(
      sessionRevoquee({
        connecteLe: changement.getTime() + 1,
        passwordChangedAt: changement,
        utilisateurExiste: true,
      })
    ).toBe(false);
  });
});
