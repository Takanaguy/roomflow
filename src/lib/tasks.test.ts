import { describe, expect, it } from "vitest";
import {
  assignesSuivants,
  construireProchaineOccurrence,
  echeanceChangee,
  estObjectIdValide,
  filtrerAssignesActuels,
  membresParAnciennete,
  peutChangerStatut,
  peutModifierTache,
  prochaineEcheance,
  type RecurrenceRepetitive,
  type TacheSource,
  validerAssignesEtRotation,
} from "@/lib/tasks";

// Dates ecrites en ISO avec "Z" : le test ne depend ainsi jamais du fuseau de
// la machine qui le lance (poste de dev en France, CI en UTC...).
const d = (iso: string) => new Date(iso);

describe("peutChangerStatut", () => {
  // Cas nominal : l'assigne est le seul a pouvoir deplacer sa propre tache.
  it("un assigne non admin peut changer le statut", () => {
    expect(peutChangerStatut(["A", "B"], "B", false)).toBe(true);
  });

  it("un admin peut toujours, meme s'il n'est pas assigne", () => {
    expect(peutChangerStatut(["A"], "Z", true)).toBe(true);
  });

  // Une tache sans assigne serait bloquee pour tout le monde sinon.
  it("tache sans assigne : n'importe quel membre peut", () => {
    expect(peutChangerStatut([], "Z", false)).toBe(true);
  });

  it("tache sans assigne et admin : vrai aussi", () => {
    expect(peutChangerStatut([], "Z", true)).toBe(true);
  });

  it("ni assigne ni admin sur une tache assignee a d'autres : refuse", () => {
    expect(peutChangerStatut(["A", "B"], "Z", false)).toBe(false);
  });

  // Le createur n'a aucun droit special sur le statut : seul l'assignation
  // (ou le role admin) compte. On le verrouille avec un id proche.
  it("la comparaison est exacte : un id qui ressemble n'est pas assigne", () => {
    expect(peutChangerStatut(["user1"], "user", false)).toBe(false);
    expect(peutChangerStatut(["user"], "USER", false)).toBe(false);
  });

  it("un id vide n'est pas assigne quand la tache a des assignes", () => {
    expect(peutChangerStatut(["A"], "", false)).toBe(false);
  });
});

describe("peutModifierTache", () => {
  it("le createur peut modifier", () => {
    expect(peutModifierTache("A", "A", false)).toBe(true);
  });

  it("un admin peut modifier la tache d'un autre", () => {
    expect(peutModifierTache("A", "Z", true)).toBe(true);
  });

  it("ni createur ni admin : refuse", () => {
    expect(peutModifierTache("A", "Z", false)).toBe(false);
  });

  // Les assignes n'ont volontairement pas ce droit (voir commentaire du code).
  // La signature ne recoit meme pas la liste des assignes : on verifie donc
  // simplement qu'un id different du createur est refuse.
  it("la comparaison est exacte (casse et prefixe)", () => {
    expect(peutModifierTache("abc", "ABC", false)).toBe(false);
    expect(peutModifierTache("abc", "ab", false)).toBe(false);
  });

  it("createur et admin a la fois : vrai", () => {
    expect(peutModifierTache("A", "A", true)).toBe(true);
  });
});

describe("assignesSuivants", () => {
  const membres = ["A", "B", "C", "D"];

  it("un assigne passe au membre suivant", () => {
    expect(assignesSuivants(["A"], membres)).toEqual(["B"]);
    expect(assignesSuivants(["B"], membres)).toEqual(["C"]);
  });

  // Circularite : sans le modulo, on lirait membres[4] = undefined.
  it("le dernier membre est suivi du premier", () => {
    expect(assignesSuivants(["D"], membres)).toEqual(["A"]);
  });

  it("deux assignes consecutifs : tous decales d'un cran, sans doublon (A,B -> B,C)", () => {
    expect(assignesSuivants(["A", "B"], membres)).toEqual(["B", "C"]);
  });

  it("deux assignes dont le dernier : la rotation boucle (C,D -> D,A)", () => {
    expect(assignesSuivants(["C", "D"], membres)).toEqual(["D", "A"]);
  });

  it("trois assignes : meme nombre en sortie, tous distincts", () => {
    const res = assignesSuivants(["A", "B", "C"], membres);
    expect(res).toEqual(["B", "C", "D"]);
    expect(new Set(res).size).toBe(3);
  });

  it("assignes non consecutifs : chacun avance d'un cran (A,C -> B,D)", () => {
    expect(assignesSuivants(["A", "C"], membres)).toEqual(["B", "D"]);
  });

  it("tous les membres assignes : l'ensemble est inchange", () => {
    const res = assignesSuivants(["A", "B", "C", "D"], membres);
    expect(res).toHaveLength(4);
    expect(new Set(res)).toEqual(new Set(membres));
  });

  // L'ordre du resultat suit l'ordre des assignes d'entree, pas celui de
  // l'anciennete.
  it("l'ordre du resultat suit celui des assignes d'entree", () => {
    expect(assignesSuivants(["C", "A"], membres)).toEqual(["D", "B"]);
    expect(assignesSuivants(["B", "A"], membres)).toEqual(["C", "B"]);
  });

  // Colocation de deux : A et B s'echangent, et si les deux sont assignes
  // l'ensemble reste le meme (pas de perte, pas de doublon).
  it("deux membres, un assigne : il passe a l'autre", () => {
    expect(assignesSuivants(["A"], ["A", "B"])).toEqual(["B"]);
    expect(assignesSuivants(["B"], ["A", "B"])).toEqual(["A"]);
  });

  it("deux membres, les deux assignes : echange, sans doublon", () => {
    const res = assignesSuivants(["A", "B"], ["A", "B"]);
    expect(res).toEqual(["B", "A"]);
    expect(new Set(res)).toEqual(new Set(["A", "B"]));
  });

  // Un seul membre : son suivant est lui-meme (index 0 + 1 modulo 1 = 0).
  it("un seul membre : il reste assigne a lui-meme", () => {
    expect(assignesSuivants(["A"], ["A"])).toEqual(["A"]);
  });

  it("un assigne qui n'est plus membre est ignore", () => {
    expect(assignesSuivants(["FANTOME", "A"], membres)).toEqual(["B"]);
  });

  it("aucun assigne membre : liste vide", () => {
    expect(assignesSuivants(["X", "Y"], membres)).toEqual([]);
  });

  it("aucun assigne : liste vide", () => {
    expect(assignesSuivants([], membres)).toEqual([]);
  });

  // Liste d'anciennete vide : n vaut 0, aucun assigne n'est trouve, donc on
  // ne doit jamais arriver au modulo par zero (qui donnerait NaN).
  it("liste de membres vide : liste vide, sans plantage", () => {
    expect(assignesSuivants(["A"], [])).toEqual([]);
    expect(assignesSuivants([], [])).toEqual([]);
  });

  it("un assigne cite deux fois n'est compte qu'une fois", () => {
    expect(assignesSuivants(["A", "A"], membres)).toEqual(["B"]);
  });

  it("ne modifie pas les tableaux d'entree", () => {
    const assignes = ["A", "B"];
    const anciens = ["A", "B", "C"];
    assignesSuivants(assignes, anciens);
    expect(assignes).toEqual(["A", "B"]);
    expect(anciens).toEqual(["A", "B", "C"]);
  });

  // Rotation complete : apres autant de rotations que de membres, on revient
  // au point de depart.
  it("n rotations successives ramenent a l'etat initial", () => {
    let courant = ["A", "B"];
    for (let i = 0; i < membres.length; i++) {
      courant = assignesSuivants(courant, membres);
    }
    expect(courant).toEqual(["A", "B"]);
  });
});

describe("membresParAnciennete", () => {
  const membre = (id: string, joinedAt?: string | null) => ({
    userId: { toString: () => id },
    joinedAt: joinedAt === undefined || joinedAt === null ? joinedAt : d(joinedAt),
  });

  it("liste vide : liste vide", () => {
    expect(membresParAnciennete([])).toEqual([]);
  });

  it("trie par joinedAt croissant (le plus ancien d'abord)", () => {
    const res = membresParAnciennete([
      membre("C", "2026-03-01T00:00:00Z"),
      membre("A", "2026-01-01T00:00:00Z"),
      membre("B", "2026-02-01T00:00:00Z"),
    ]);
    expect(res).toEqual(["A", "B", "C"]);
  });

  it("un seul membre : cette personne", () => {
    expect(membresParAnciennete([membre("A", "2026-01-01T00:00:00Z")])).toEqual(["A"]);
  });

  // Egalite de date : departagee par l'id pour un ordre reproductible,
  // quel que soit l'ordre de stockage.
  it("egalite de date : departage par l'id, quel que soit l'ordre d'entree", () => {
    const date = "2026-01-01T00:00:00Z";
    expect(membresParAnciennete([membre("B", date), membre("A", date)])).toEqual(["A", "B"]);
    expect(membresParAnciennete([membre("A", date), membre("B", date)])).toEqual(["A", "B"]);
  });

  it("sans joinedAt (undefined ou null) : traite comme le plus ancien", () => {
    const res = membresParAnciennete([
      membre("A", "2026-01-01T00:00:00Z"),
      membre("Z", undefined),
      membre("Y", null),
    ]);
    // Y et Z valent 0 et passent avant A ; entre eux, l'id departage.
    expect(res).toEqual(["Y", "Z", "A"]);
  });

  it("tous sans joinedAt : tri par id", () => {
    expect(membresParAnciennete([membre("C"), membre("A"), membre("B")])).toEqual(["A", "B", "C"]);
  });

  it("des dates a la milliseconde pres sont departagees correctement", () => {
    const res = membresParAnciennete([
      membre("A", "2026-01-01T00:00:00.002Z"),
      membre("B", "2026-01-01T00:00:00.001Z"),
    ]);
    expect(res).toEqual(["B", "A"]);
  });

  it("accepte des userId de type string (toString natif)", () => {
    const res = membresParAnciennete([
      { userId: "B", joinedAt: d("2026-02-01T00:00:00Z") },
      { userId: "A", joinedAt: d("2026-01-01T00:00:00Z") },
    ]);
    expect(res).toEqual(["A", "B"]);
  });

  it("ne modifie pas le tableau d'entree", () => {
    const entree = [membre("B", "2026-02-01T00:00:00Z"), membre("A", "2026-01-01T00:00:00Z")];
    const copie = [...entree];
    membresParAnciennete(entree);
    expect(entree).toEqual(copie);
    expect(entree[0]).toBe(copie[0]);
  });
});

describe("prochaineEcheance : weekly", () => {
  it("ajoute exactement 7 jours", () => {
    expect(prochaineEcheance("weekly", d("2026-03-10T12:00:00Z"))).toEqual(d("2026-03-17T12:00:00Z"));
  });

  it("passage de fin de mois : 28/02/2026 -> 07/03/2026", () => {
    expect(prochaineEcheance("weekly", d("2026-02-28T00:00:00Z"))).toEqual(d("2026-03-07T00:00:00Z"));
  });

  it("passage d'annee : 28/12/2026 -> 04/01/2027", () => {
    expect(prochaineEcheance("weekly", d("2026-12-28T00:00:00Z"))).toEqual(d("2027-01-04T00:00:00Z"));
  });

  it("annee bissextile : 26/02/2028 -> 04/03/2028 (le 29/02 existe)", () => {
    expect(prochaineEcheance("weekly", d("2028-02-26T00:00:00Z"))).toEqual(d("2028-03-04T00:00:00Z"));
  });

  it("annee non bissextile : 26/02/2026 -> 05/03/2026", () => {
    expect(prochaineEcheance("weekly", d("2026-02-26T00:00:00Z"))).toEqual(d("2026-03-05T00:00:00Z"));
  });

  // Heure tardive en UTC : un calcul en heure locale pourrait faire glisser
  // le jour. Ici l'heure et le jour UTC doivent rester ceux attendus.
  it("23:30Z : l'heure est conservee et le jour UTC avance de 7 exactement", () => {
    const res = prochaineEcheance("weekly", d("2026-03-10T23:30:00Z"));
    expect(res.toISOString()).toBe("2026-03-17T23:30:00.000Z");
  });

  // Changement d'heure europeen du 29/03/2026 : 7 jours = 168 h reelles en UTC,
  // pas de decalage d'une heure.
  it("traversee du passage a l'heure d'ete : toujours 168 h", () => {
    const depuis = d("2026-03-25T23:30:00Z");
    const res = prochaineEcheance("weekly", depuis);
    expect(res.getTime() - depuis.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(res.toISOString()).toBe("2026-04-01T23:30:00.000Z");
  });

  it("traversee du passage a l'heure d'hiver : toujours 168 h", () => {
    const depuis = d("2026-10-22T23:30:00Z");
    const res = prochaineEcheance("weekly", depuis);
    expect(res.toISOString()).toBe("2026-10-29T23:30:00.000Z");
  });

  it("conserve les secondes et millisecondes", () => {
    expect(prochaineEcheance("weekly", d("2026-03-10T08:15:42.123Z")).toISOString()).toBe(
      "2026-03-17T08:15:42.123Z"
    );
  });
});

describe("prochaineEcheance : monthly", () => {
  const cas: [string, string, string][] = [
    ["cas simple", "2026-03-10T00:00:00Z", "2026-04-10T00:00:00Z"],
    ["31/01/2026 -> 28/02/2026 (ecretage, annee normale)", "2026-01-31T00:00:00Z", "2026-02-28T00:00:00Z"],
    ["31/01/2028 -> 29/02/2028 (ecretage, annee bissextile)", "2028-01-31T00:00:00Z", "2028-02-29T00:00:00Z"],
    ["30/01/2026 -> fin fevrier (28)", "2026-01-30T00:00:00Z", "2026-02-28T00:00:00Z"],
    ["30/01/2028 -> fin fevrier (29)", "2028-01-30T00:00:00Z", "2028-02-29T00:00:00Z"],
    ["29/01/2026 -> 28/02/2026", "2026-01-29T00:00:00Z", "2026-02-28T00:00:00Z"],
    ["29/01/2028 -> 29/02/2028 (pas d'ecretage)", "2028-01-29T00:00:00Z", "2028-02-29T00:00:00Z"],
    ["28/01/2026 -> 28/02/2026 (pas d'ecretage)", "2026-01-28T00:00:00Z", "2026-02-28T00:00:00Z"],
    ["31/03/2026 -> 30/04/2026", "2026-03-31T00:00:00Z", "2026-04-30T00:00:00Z"],
    ["31/05/2026 -> 30/06/2026", "2026-05-31T00:00:00Z", "2026-06-30T00:00:00Z"],
    ["31/08/2026 -> 30/09/2026", "2026-08-31T00:00:00Z", "2026-09-30T00:00:00Z"],
    ["31/07/2026 -> 31/08/2026 (deux mois de 31 jours)", "2026-07-31T00:00:00Z", "2026-08-31T00:00:00Z"],
    ["15/12/2026 -> 15/01/2027 (passage d'annee)", "2026-12-15T00:00:00Z", "2027-01-15T00:00:00Z"],
    ["31/12/2026 -> 31/01/2027 (passage d'annee, fin de mois)", "2026-12-31T00:00:00Z", "2027-01-31T00:00:00Z"],
    ["28/02/2026 -> 28/03/2026", "2026-02-28T00:00:00Z", "2026-03-28T00:00:00Z"],
    ["29/02/2028 -> 29/03/2028", "2028-02-29T00:00:00Z", "2028-03-29T00:00:00Z"],
    ["01/01/2026 -> 01/02/2026", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"],
    // 1900 n'est pas bissextile (divisible par 100 mais pas par 400), 2000 l'est.
    ["31/01/2100 -> 28/02/2100 (siecle non bissextile)", "2100-01-31T00:00:00Z", "2100-02-28T00:00:00Z"],
    ["31/01/2000 -> 29/02/2000 (siecle bissextile)", "2000-01-31T00:00:00Z", "2000-02-29T00:00:00Z"],
  ];

  it.each(cas)("%s", (_nom, depuis, attendu) => {
    expect(prochaineEcheance("monthly", d(depuis)).toISOString()).toBe(d(attendu).toISOString());
  });

  // Heures tardives : si le code passait par les methodes locales, 23:30Z
  // pourrait basculer au jour suivant (fuseau en avance sur UTC) et fausser
  // l'ecretage.
  it("31/01 a 23:30Z : reste le 28/02 a 23:30Z, sans glissement de jour", () => {
    expect(prochaineEcheance("monthly", d("2026-01-31T23:30:00Z")).toISOString()).toBe(
      "2026-02-28T23:30:00.000Z"
    );
  });

  it("31/03 a 23:59:59.999Z : reste le 30/04 a 23:59:59.999Z", () => {
    expect(prochaineEcheance("monthly", d("2026-03-31T23:59:59.999Z")).toISOString()).toBe(
      "2026-04-30T23:59:59.999Z"
    );
  });

  it("01/03 a 00:30Z : reste le 01/04 a 00:30Z", () => {
    expect(prochaineEcheance("monthly", d("2026-03-01T00:30:00Z")).toISOString()).toBe(
      "2026-04-01T00:30:00.000Z"
    );
  });

  it("31/12 a 23:30Z : 31/01 de l'annee suivante a 23:30Z", () => {
    expect(prochaineEcheance("monthly", d("2026-12-31T23:30:00Z")).toISOString()).toBe(
      "2027-01-31T23:30:00.000Z"
    );
  });

  it("conserve l'heure, les minutes, les secondes et les millisecondes", () => {
    expect(prochaineEcheance("monthly", d("2026-03-10T08:15:42.123Z")).toISOString()).toBe(
      "2026-04-10T08:15:42.123Z"
    );
  });

  // Pas de derive : l'ecretage est refait a chaque occurrence a partir de la
  // date de completion, donc 31/01 -> 28/02 -> 28/03 (le 31 d'origine est perdu,
  // c'est le comportement documente puisque le calcul part de la date de completion).
  it("enchainement : 31/01 -> 28/02 -> 28/03", () => {
    const fev = prochaineEcheance("monthly", d("2026-01-31T00:00:00Z"));
    const mars = prochaineEcheance("monthly", fev);
    expect(fev.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(mars.toISOString()).toBe("2026-03-28T00:00:00.000Z");
  });
});

describe("prochaineEcheance : erreurs et immutabilite", () => {
  it("date invalide (weekly) : RangeError", () => {
    expect(() => prochaineEcheance("weekly", new Date("pas une date"))).toThrow(RangeError);
  });

  it("date invalide (monthly) : RangeError", () => {
    expect(() => prochaineEcheance("monthly", new Date(NaN))).toThrow(RangeError);
  });

  it("le message de la RangeError est explicite", () => {
    expect(() => prochaineEcheance("weekly", new Date(NaN))).toThrow("Date de depart invalide");
  });

  // Securite a l'execution : le type interdit "none", mais une valeur venue de
  // la base ou d'un JSON mal valide pourrait arriver jusqu'ici.
  it("recurrence inconnue ou 'none' (forcee) : erreur claire", () => {
    expect(() => prochaineEcheance("none" as RecurrenceRepetitive, d("2026-03-10T00:00:00Z"))).toThrow(
      /Recurrence non repetitive/
    );
    expect(() => prochaineEcheance("daily" as RecurrenceRepetitive, d("2026-03-10T00:00:00Z"))).toThrow(
      /Recurrence non repetitive/
    );
  });

  it("la date invalide est testee avant la recurrence inconnue", () => {
    expect(() => prochaineEcheance("none" as RecurrenceRepetitive, new Date(NaN))).toThrow(RangeError);
  });

  it("ne modifie pas la date d'entree (weekly)", () => {
    const depuis = d("2026-03-10T12:00:00Z");
    const avant = depuis.getTime();
    const res = prochaineEcheance("weekly", depuis);
    expect(depuis.getTime()).toBe(avant);
    expect(res).not.toBe(depuis);
  });

  it("ne modifie pas la date d'entree (monthly)", () => {
    const depuis = d("2026-01-31T23:30:00Z");
    const avant = depuis.getTime();
    const res = prochaineEcheance("monthly", depuis);
    expect(depuis.getTime()).toBe(avant);
    expect(res).not.toBe(depuis);
  });

  it("renvoie une vraie date valide", () => {
    const res = prochaineEcheance("monthly", d("2026-01-31T00:00:00Z"));
    expect(res).toBeInstanceOf(Date);
    expect(Number.isNaN(res.getTime())).toBe(false);
  });
});

describe("construireProchaineOccurrence", () => {
  const tacheBase: TacheSource = {
    householdId: "H1",
    title: "Sortir les poubelles",
    description: "Bac jaune le mardi",
    recurrence: "weekly",
    rotation: false,
    createdBy: "A",
    assignedTo: ["A"],
  };
  const tache = (surcharge: Partial<TacheSource> = {}): TacheSource => ({
    ...tacheBase,
    ...surcharge,
    // Copie du tableau pour que chaque test parte d'une source independante.
    assignedTo: [...(surcharge.assignedTo ?? tacheBase.assignedTo)],
  });
  const completedAt = d("2026-03-10T12:00:00Z");

  it("cas nominal weekly sans rotation : tous les champs attendus", () => {
    const res = construireProchaineOccurrence(tache(), ["A", "B", "C"], completedAt);
    expect(res).toEqual({
      householdId: "H1",
      title: "Sortir les poubelles",
      description: "Bac jaune le mardi",
      recurrence: "weekly",
      rotation: false,
      createdBy: "A",
      status: "todo",
      dueDate: d("2026-03-17T12:00:00Z"),
      assignedTo: ["A"],
      occurrenceGeneree: false,
    });
  });

  it("status todo et occurrenceGeneree false", () => {
    const res = construireProchaineOccurrence(tache(), ["A", "B"], completedAt);
    expect(res.status).toBe("todo");
    expect(res.occurrenceGeneree).toBe(false);
  });

  it("pas de completedAt ni de completedBy sur la nouvelle occurrence", () => {
    const res = construireProchaineOccurrence(tache(), ["A", "B"], completedAt);
    expect("completedAt" in res).toBe(false);
    expect("completedBy" in res).toBe(false);
  });

  // L'echeance part de la date de COMPLETION, pas d'une ancienne echeance.
  it("dueDate = prochaineEcheance(recurrence, completedAt) en weekly", () => {
    const res = construireProchaineOccurrence(tache({ recurrence: "weekly" }), ["A"], completedAt);
    expect(res.dueDate).toEqual(prochaineEcheance("weekly", completedAt));
  });

  it("dueDate en monthly avec ecretage : 31/01/2026 -> 28/02/2026", () => {
    const res = construireProchaineOccurrence(
      tache({ recurrence: "monthly" }),
      ["A"],
      d("2026-01-31T23:30:00Z")
    );
    expect(res.recurrence).toBe("monthly");
    expect(res.dueDate.toISOString()).toBe("2026-02-28T23:30:00.000Z");
  });

  it("completedAt invalide : RangeError remontee", () => {
    expect(() => construireProchaineOccurrence(tache(), ["A"], new Date(NaN))).toThrow(RangeError);
  });

  it("ne modifie pas completedAt", () => {
    const date = d("2026-03-10T12:00:00Z");
    const avant = date.getTime();
    construireProchaineOccurrence(tache(), ["A"], date);
    expect(date.getTime()).toBe(avant);
  });

  describe("description", () => {
    it("description vide : la cle description est absente", () => {
      const res = construireProchaineOccurrence(tache({ description: "" }), ["A"], completedAt);
      expect("description" in res).toBe(false);
    });

    it("description undefined : la cle est absente", () => {
      const res = construireProchaineOccurrence(tache({ description: undefined }), ["A"], completedAt);
      expect("description" in res).toBe(false);
    });

    it("description null : la cle est absente", () => {
      const res = construireProchaineOccurrence(tache({ description: null }), ["A"], completedAt);
      expect("description" in res).toBe(false);
    });

    it("description renseignee : recopiee a l'identique", () => {
      const res = construireProchaineOccurrence(tache({ description: "Texte" }), ["A"], completedAt);
      expect(res.description).toBe("Texte");
    });
  });

  describe("sans rotation", () => {
    it("assignedTo identique mais copie : pas la meme reference de tableau", () => {
      const source = tache({ assignedTo: ["A", "B"] });
      const res = construireProchaineOccurrence(source, ["A", "B", "C"], completedAt);
      expect(res.assignedTo).toEqual(["A", "B"]);
      expect(res.assignedTo).not.toBe(source.assignedTo);
    });

    it("modifier le resultat ne touche pas la tache source", () => {
      const source = tache({ assignedTo: ["A", "B"] });
      const res = construireProchaineOccurrence(source, ["A", "B", "C"], completedAt);
      res.assignedTo.push("Z");
      expect(source.assignedTo).toEqual(["A", "B"]);
    });

    it("un assigne qui n'est plus membre est conserve (pas de rotation, pas de filtre)", () => {
      const res = construireProchaineOccurrence(tache({ assignedTo: ["FANTOME"] }), ["A", "B"], completedAt);
      expect(res.assignedTo).toEqual(["FANTOME"]);
    });

    it("aucun assigne : reste vide", () => {
      const res = construireProchaineOccurrence(tache({ assignedTo: [] }), ["A", "B"], completedAt);
      expect(res.assignedTo).toEqual([]);
    });
  });

  describe("avec rotation", () => {
    it("3 membres, un assigne : passe au suivant", () => {
      const res = construireProchaineOccurrence(
        tache({ rotation: true, assignedTo: ["A"] }),
        ["A", "B", "C"],
        completedAt
      );
      expect(res.rotation).toBe(true);
      expect(res.assignedTo).toEqual(["B"]);
    });

    it("3 membres, le dernier assigne : retour au premier", () => {
      const res = construireProchaineOccurrence(
        tache({ rotation: true, assignedTo: ["C"] }),
        ["A", "B", "C"],
        completedAt
      );
      expect(res.assignedTo).toEqual(["A"]);
    });

    it("3 membres, deux assignes (A,B) : B,C sans doublon", () => {
      const res = construireProchaineOccurrence(
        tache({ rotation: true, assignedTo: ["A", "B"] }),
        ["A", "B", "C"],
        completedAt
      );
      expect(res.assignedTo).toEqual(["B", "C"]);
    });

    it("2 membres, un assigne : passe a l'autre", () => {
      const res = construireProchaineOccurrence(
        tache({ rotation: true, assignedTo: ["A"] }),
        ["A", "B"],
        completedAt
      );
      expect(res.assignedTo).toEqual(["B"]);
    });

    it("2 membres, les deux assignes : ensemble inchange", () => {
      const res = construireProchaineOccurrence(
        tache({ rotation: true, assignedTo: ["A", "B"] }),
        ["A", "B"],
        completedAt
      );
      expect(new Set(res.assignedTo)).toEqual(new Set(["A", "B"]));
      expect(res.assignedTo).toHaveLength(2);
    });

    it("1 membre : reste assigne a lui-meme", () => {
      const res = construireProchaineOccurrence(
        tache({ rotation: true, assignedTo: ["A"] }),
        ["A"],
        completedAt
      );
      expect(res.assignedTo).toEqual(["A"]);
    });

    it("4 membres, trois assignes : meme nombre, tous distincts", () => {
      const res = construireProchaineOccurrence(
        tache({ rotation: true, assignedTo: ["A", "B", "C"] }),
        ["A", "B", "C", "D"],
        completedAt
      );
      expect(res.assignedTo).toEqual(["B", "C", "D"]);
    });

    it("assigne parti de la colocation : ignore, la tache devient ouverte a tous", () => {
      const res = construireProchaineOccurrence(
        tache({ rotation: true, assignedTo: ["FANTOME"] }),
        ["A", "B"],
        completedAt
      );
      expect(res.assignedTo).toEqual([]);
    });

    it("ne modifie pas assignedTo de la tache source", () => {
      const source = tache({ rotation: true, assignedTo: ["A", "B"] });
      construireProchaineOccurrence(source, ["A", "B", "C"], completedAt);
      expect(source.assignedTo).toEqual(["A", "B"]);
    });
  });

  describe("weekly et monthly combines a la rotation", () => {
    it("monthly + rotation : echeance +1 mois ET assigne suivant", () => {
      const res = construireProchaineOccurrence(
        tache({ recurrence: "monthly", rotation: true, assignedTo: ["B"] }),
        ["A", "B", "C"],
        d("2026-12-15T10:00:00Z")
      );
      expect(res.dueDate.toISOString()).toBe("2027-01-15T10:00:00.000Z");
      expect(res.assignedTo).toEqual(["C"]);
    });

    it("weekly + rotation : echeance +7 jours ET assigne suivant", () => {
      const res = construireProchaineOccurrence(
        tache({ recurrence: "weekly", rotation: true, assignedTo: ["C"] }),
        ["A", "B", "C"],
        d("2026-12-28T10:00:00Z")
      );
      expect(res.dueDate.toISOString()).toBe("2027-01-04T10:00:00.000Z");
      expect(res.assignedTo).toEqual(["A"]);
    });

    it("monthly sans rotation, 3 membres : assignes identiques, echeance +1 mois", () => {
      const res = construireProchaineOccurrence(
        tache({ recurrence: "monthly", rotation: false, assignedTo: ["B"] }),
        ["A", "B", "C"],
        d("2028-01-31T00:00:00Z")
      );
      expect(res.assignedTo).toEqual(["B"]);
      expect(res.dueDate.toISOString()).toBe("2028-02-29T00:00:00.000Z");
    });
  });

  it("recopie householdId, title, recurrence, rotation et createdBy sans les alterer", () => {
    const res = construireProchaineOccurrence(
      tache({ householdId: "H9", title: "Menage", recurrence: "monthly", rotation: true, createdBy: "Z" }),
      ["A"],
      completedAt
    );
    expect(res).toMatchObject({
      householdId: "H9",
      title: "Menage",
      recurrence: "monthly",
      rotation: true,
      createdBy: "Z",
    });
  });
});

describe("estObjectIdValide", () => {
  it("accepte 24 caracteres hexadecimaux", () => {
    expect(estObjectIdValide("507f1f77bcf86cd799439011")).toBe(true);
  });

  // Types.ObjectId.isValid accepterait ces 12 caracteres : c'est justement
  // pour ca qu'on ne s'en sert pas.
  it("refuse une chaine de 12 caracteres, un id trop court ou non hexadecimal", () => {
    expect(estObjectIdValide("abcdefghijkl")).toBe(false);
    expect(estObjectIdValide("507f1f77bcf86cd79943901")).toBe(false);
    expect(estObjectIdValide("507f1f77bcf86cd79943901z")).toBe(false);
    expect(estObjectIdValide("")).toBe(false);
    expect(estObjectIdValide("abc")).toBe(false);
  });
});

describe("filtrerAssignesActuels", () => {
  it("retire les assignes qui ne sont plus membres, en gardant l'ordre", () => {
    expect(filtrerAssignesActuels(["A", "B", "C"], ["C", "A"])).toEqual(["A", "C"]);
  });

  // Tous partis : la tache doit redevenir "sans assigne" (ouverte a tous).
  it("renvoie un tableau vide si plus aucun assigne n'est membre", () => {
    expect(filtrerAssignesActuels(["A", "B"], ["Z"])).toEqual([]);
  });

  it("ne change rien si tous les assignes sont encore membres ou s'il n'y en a pas", () => {
    expect(filtrerAssignesActuels(["A"], ["A", "B"])).toEqual(["A"]);
    expect(filtrerAssignesActuels([], ["A"])).toEqual([]);
  });
});

describe("validerAssignesEtRotation", () => {
  const membres = new Set(["A", "B"]);
  const estMembre = (id: string) => membres.has(id);

  it("accepte des assignes membres et une rotation sur tache recurrente", () => {
    expect(
      validerAssignesEtRotation({ assignedTo: ["A", "B"], recurrence: "weekly", rotation: true }, estMembre)
    ).toBeNull();
  });

  it("accepte l'absence d'assignes", () => {
    expect(
      validerAssignesEtRotation({ assignedTo: [], recurrence: "none", rotation: false }, estMembre)
    ).toBeNull();
  });

  it("refuse un assigne qui n'est pas membre", () => {
    expect(
      validerAssignesEtRotation({ assignedTo: ["A", "Z"], recurrence: "none", rotation: false }, estMembre)
    ).toMatch(/colocation/);
  });

  it("refuse la rotation avec la recurrence none", () => {
    expect(
      validerAssignesEtRotation({ assignedTo: ["A"], recurrence: "none", rotation: true }, estMembre)
    ).toMatch(/rotation/i);
  });
});

// ---------------------------------------------------------------------------
// echeanceChangee
// ---------------------------------------------------------------------------

describe("echeanceChangee", () => {
  const A = "2026-10-22T00:00:00.000Z";

  it("memes dates : false", () => {
    expect(echeanceChangee(d(A), d(A))).toBe(false);
  });

  it("a la milliseconde pres (+1 ms) : true", () => {
    expect(echeanceChangee(d(A), d("2026-10-22T00:00:00.001Z"))).toBe(true);
  });

  it("a la milliseconde pres (-1 ms) : true", () => {
    expect(echeanceChangee(d(A), d("2026-10-21T23:59:59.999Z"))).toBe(true);
  });

  it("un autre jour : true", () => {
    expect(echeanceChangee(d(A), d("2026-10-29T00:00:00.000Z"))).toBe(true);
  });

  it("deux objets Date differents de meme valeur : false (pas de comparaison de reference)", () => {
    const a = d(A);
    const b = d(A);
    expect(a).not.toBe(b);
    expect(echeanceChangee(a, b)).toBe(false);
  });

  it("le meme objet des deux cotes : false", () => {
    const a = d(A);
    expect(echeanceChangee(a, a)).toBe(false);
  });

  it("meme instant ecrit avec deux fuseaux differents : false", () => {
    expect(echeanceChangee(d("2026-10-22T02:00:00.000+02:00"), d("2026-10-22T00:00:00.000Z"))).toBe(false);
  });

  describe("pas d'echeance : undefined et null sont equivalents", () => {
    it.each([
      [undefined, undefined],
      [null, null],
      [undefined, null],
      [null, undefined],
    ])("%s vers %s : false", (ancienne, nouvelle) => {
      expect(echeanceChangee(ancienne, nouvelle)).toBe(false);
    });

    it("null vers une date : true", () => {
      expect(echeanceChangee(null, d(A))).toBe(true);
    });

    it("undefined vers une date : true", () => {
      expect(echeanceChangee(undefined, d(A))).toBe(true);
    });

    it("une date vers null : true", () => {
      expect(echeanceChangee(d(A), null)).toBe(true);
    });

    it("une date vers undefined : true", () => {
      expect(echeanceChangee(d(A), undefined)).toBe(true);
    });
  });

  describe("cas limites de dates", () => {
    it("le 1er janvier 1970 (timestamp 0) est une vraie date, pas 'pas d'echeance'", () => {
      // Piege classique : tester la valeur numerique avec un simple `!date`
      // traiterait 0 comme absent. Un objet Date reste truthy meme a 0.
      expect(echeanceChangee(d("1970-01-01T00:00:00.000Z"), null)).toBe(true);
      expect(echeanceChangee(null, d("1970-01-01T00:00:00.000Z"))).toBe(true);
      expect(echeanceChangee(d("1970-01-01T00:00:00.000Z"), d("1970-01-01T00:00:00.000Z"))).toBe(false);
    });

    it("dates tres eloignees mais differentes : true", () => {
      expect(echeanceChangee(d("1900-01-01T00:00:00.000Z"), d("2100-01-01T00:00:00.000Z"))).toBe(true);
    });
  });

  describe("dates invalides (comportement fige)", () => {
    // Le code compare getTime() avec !==, et NaN !== NaN : une date invalide
    // est donc toujours vue comme "differente", meme de elle-meme. Consequence
    // pratique : rappelEnvoye repasse a false. Pas de risque dans l'appli, car
    // la route cree la date avec new Date(data.dueDate) apres validation Zod.
    it("invalide vers valide : true", () => {
      expect(echeanceChangee(new Date("x"), d(A))).toBe(true);
    });

    it("valide vers invalide : true", () => {
      expect(echeanceChangee(d(A), new Date("x"))).toBe(true);
    });

    it("invalide vers invalide : true (NaN n'est jamais egal a NaN)", () => {
      expect(echeanceChangee(new Date("x"), new Date("y"))).toBe(true);
    });

    it("la meme date invalide des deux cotes : true aussi", () => {
      const invalide = new Date("x");
      expect(echeanceChangee(invalide, invalide)).toBe(true);
    });

    it("invalide vers null : true (une Date invalide est un objet, donc 'a une echeance')", () => {
      expect(echeanceChangee(new Date("x"), null)).toBe(true);
      expect(echeanceChangee(null, new Date("x"))).toBe(true);
    });

    it("ne leve jamais d'exception", () => {
      expect(() => echeanceChangee(new Date("x"), new Date("y"))).not.toThrow();
    });
  });

  it("n'est pas modifiee par l'appel", () => {
    const a = d(A);
    const b = d("2026-10-23T00:00:00.000Z");
    echeanceChangee(a, b);
    expect(a.toISOString()).toBe(A);
    expect(b.toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });
});
