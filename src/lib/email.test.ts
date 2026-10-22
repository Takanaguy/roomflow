import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  construireUrl,
  envoyerEmail,
  estEnProduction,
  injecterAvertissement,
  masquerAdresse,
  redirectionActive,
  resoudreDestinataire,
} from "@/lib/email";
import { emailBienvenue } from "@/lib/email-templates";

// Le SDK Resend est remplace par un faux AVANT l'import de email.ts. Les tests
// d'envoi ne tournent que sans cle API (le code sort avant de creer un client),
// et ce faux prouve qu'aucun client reseau n'est jamais construit : meme si un
// jour le code changeait d'ordre, aucun vrai mail ne pourrait partir d'ici.
const { ResendFaux } = vi.hoisted(() => ({ ResendFaux: vi.fn() }));
vi.mock("resend", () => ({ Resend: ResendFaux }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  ResendFaux.mockClear();
});

// ---------------------------------------------------------------------------
// resoudreDestinataire
// ---------------------------------------------------------------------------

describe("resoudreDestinataire", () => {
  it("sans redirection (undefined) : valeurs inchangees, aucun avertissement", () => {
    expect(resoudreDestinataire("a@b.fr", undefined, "Sujet")).toStrictEqual({
      to: "a@b.fr",
      subject: "Sujet",
    });
  });

  it.each(["", " ", "   ", "\t\n"])("redirection vide ou espaces (%j) : ignoree", (redirection) => {
    expect(resoudreDestinataire("a@b.fr", redirection, "Sujet")).toStrictEqual({
      to: "a@b.fr",
      subject: "Sujet",
    });
  });

  it("avec redirection : to = redirection, sujet prefixe, avertissements presents", () => {
    const r = resoudreDestinataire("test1@roomflow.test", "moi@exemple.fr", "Bienvenue");
    expect(r.to).toBe("moi@exemple.fr");
    expect(r.subject).toBe("[pour : test1@roomflow.test] Bienvenue");
    expect(r.avertissementTexte).toBe(
      "[Mode test : cet email était destiné à test1@roomflow.test]"
    );
    expect(r.avertissementHtml).toContain("Mode test : cet email était destiné à");
    expect(r.avertissementHtml).toContain("<strong>test1@roomflow.test</strong>");
  });

  it("la redirection est nettoyee des espaces autour", () => {
    expect(resoudreDestinataire("a@b.fr", "  moi@exemple.fr \n", "S").to).toBe("moi@exemple.fr");
  });

  it("le destinataire d'origine est echappe dans l'avertissement HTML, brut dans le texte", () => {
    const r = resoudreDestinataire('"><img src=x onerror=alert(1)>@x.fr', "moi@exemple.fr", "S");
    expect(r.avertissementHtml).not.toMatch(/<img/i);
    expect(r.avertissementHtml).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;@x.fr");
    expect(r.avertissementTexte).toContain('"><img src=x onerror=alert(1)>@x.fr');
  });

  it("le sujet d'origine est conserve apres le prefixe, meme vide", () => {
    expect(resoudreDestinataire("a@b.fr", "r@x.fr", "").subject).toBe("[pour : a@b.fr] ");
  });
});

// ---------------------------------------------------------------------------
// construireUrl
// ---------------------------------------------------------------------------

describe("construireUrl", () => {
  const BASE = "https://roomflow.app";

  it.each([
    ["base sans slash, chemin avec slash", "https://roomflow.app", "/profil"],
    ["base sans slash, chemin sans slash", "https://roomflow.app", "profil"],
    ["base avec slash, chemin avec slash", "https://roomflow.app/", "/profil"],
    ["base avec slash, chemin sans slash", "https://roomflow.app/", "profil"],
    ["base avec plusieurs slashs finaux", "https://roomflow.app///", "profil"],
    ["chemin avec plusieurs slashs initiaux", "https://roomflow.app", "//profil"],
    ["slashs en trop des deux cotes", "https://roomflow.app//", "///profil"],
  ])("%s => exactement un slash entre les deux", (_nom, base, chemin) => {
    expect(construireUrl(chemin, base)).toBe("https://roomflow.app/profil");
  });

  it("base avec sous-dossier : conserve", () => {
    expect(construireUrl("profil", "https://x.fr/app/")).toBe("https://x.fr/app/profil");
  });

  it("chemin imbrique : les slashs internes sont conserves", () => {
    expect(construireUrl("/colocations/abc/depenses/1", BASE)).toBe(
      "https://roomflow.app/colocations/abc/depenses/1"
    );
  });

  it("slashs doubles a l'interieur du chemin : non touches (seuls les bords sont nettoyes)", () => {
    expect(construireUrl("a//b", BASE)).toBe("https://roomflow.app/a//b");
  });

  it("chemin vide : la base suivie d'un seul slash", () => {
    expect(construireUrl("", BASE)).toBe("https://roomflow.app/");
    expect(construireUrl("/", "https://roomflow.app/")).toBe("https://roomflow.app/");
  });

  it("parametres de requete et ancre preserves", () => {
    expect(construireUrl("/connexion?callbackUrl=/profil&x=1#haut", BASE)).toBe(
      "https://roomflow.app/connexion?callbackUrl=/profil&x=1#haut"
    );
    expect(construireUrl("reinitialiser?token=ab%20cd", BASE)).toBe(
      "https://roomflow.app/reinitialiser?token=ab%20cd"
    );
  });

  it("espaces autour de la base retires", () => {
    expect(construireUrl("profil", "  https://roomflow.app/  ")).toBe("https://roomflow.app/profil");
  });

  describe("base absente ou vide", () => {
    beforeEach(() => {
      // Aucune dependance a l'environnement reel de la machine.
      vi.stubEnv("APP_URL", undefined);
    });

    it("base undefined et APP_URL absente => http://localhost:3000", () => {
      expect(construireUrl("/profil")).toBe("http://localhost:3000/profil");
      expect(construireUrl("profil", undefined)).toBe("http://localhost:3000/profil");
    });

    it("base vide ou faite d'espaces => http://localhost:3000", () => {
      expect(construireUrl("/profil", "")).toBe("http://localhost:3000/profil");
      expect(construireUrl("/profil", "   ")).toBe("http://localhost:3000/profil");
    });

    it("APP_URL vide ou faite d'espaces => http://localhost:3000", () => {
      vi.stubEnv("APP_URL", "");
      expect(construireUrl("/profil")).toBe("http://localhost:3000/profil");
      vi.stubEnv("APP_URL", "   ");
      expect(construireUrl("/profil")).toBe("http://localhost:3000/profil");
    });

    it("sans base explicite, APP_URL est utilisee (slash final retire)", () => {
      vi.stubEnv("APP_URL", "https://prod.roomflow.app/");
      expect(construireUrl("profil")).toBe("https://prod.roomflow.app/profil");
    });

    it("une base explicite l'emporte sur APP_URL", () => {
      vi.stubEnv("APP_URL", "https://prod.roomflow.app");
      expect(construireUrl("profil", "https://autre.fr")).toBe("https://autre.fr/profil");
    });
  });
});

// ---------------------------------------------------------------------------
// masquerAdresse
// ---------------------------------------------------------------------------

describe("masquerAdresse", () => {
  it("tanguy@gmail.com => t***@gmail.com", () => {
    expect(masquerAdresse("tanguy@gmail.com")).toBe("t***@gmail.com");
  });

  it("sans @ => ***", () => {
    expect(masquerAdresse("tanguygmail.com")).toBe("***");
  });

  it("chaine vide => ***", () => {
    expect(masquerAdresse("")).toBe("***");
  });

  it("partie locale vide (@gmail.com) => ***", () => {
    expect(masquerAdresse("@gmail.com")).toBe("***");
  });

  it("partie locale d'un seul caractere : a@b.fr => a***@b.fr", () => {
    expect(masquerAdresse("a@b.fr")).toBe("a***@b.fr");
  });

  it("plusieurs @ : le dernier compte, tout ce qui precede est masque sauf le 1er caractere", () => {
    expect(masquerAdresse("ab@cd@x.fr")).toBe("a***@x.fr");
  });

  it("le nom complet ne ressort jamais", () => {
    const masque = masquerAdresse("prenom.nom@entreprise.fr");
    expect(masque).toBe("p***@entreprise.fr");
    expect(masque).not.toContain("renom");
  });
});

// ---------------------------------------------------------------------------
// injecterAvertissement
// ---------------------------------------------------------------------------

describe("injecterAvertissement", () => {
  const AV_HTML = '<p class="av">Mode test</p>';
  const AV_TEXTE = "[Mode test : pour x@y.fr]";

  it("HTML : insere juste apres la balise <body ...>", () => {
    const r = injecterAvertissement(
      { html: '<html><body style="margin:0"><p>Salut</p></body></html>', text: "Salut" },
      { avertissementHtml: AV_HTML, avertissementTexte: AV_TEXTE }
    );
    expect(r.html).toBe(
      `<html><body style="margin:0">${AV_HTML}<p>Salut</p></body></html>`
    );
  });

  it("HTML sans balise <body> : avertissement tout au debut", () => {
    const r = injecterAvertissement(
      { html: "<p>Salut</p>", text: "Salut" },
      { avertissementHtml: AV_HTML }
    );
    expect(r.html).toBe(`${AV_HTML}<p>Salut</p>`);
  });

  it("balise BODY en majuscules reconnue", () => {
    const r = injecterAvertissement(
      { html: "<HTML><BODY><p>x</p></BODY></HTML>", text: "x" },
      { avertissementHtml: AV_HTML }
    );
    expect(r.html).toBe(`<HTML><BODY>${AV_HTML}<p>x</p></BODY></HTML>`);
  });

  it("texte : avertissement en premiere ligne, suivi d'une ligne vide", () => {
    const r = injecterAvertissement(
      { html: "<body></body>", text: "Salut\nTout le monde" },
      { avertissementHtml: AV_HTML, avertissementTexte: AV_TEXTE }
    );
    expect(r.text).toBe(`${AV_TEXTE}\n\nSalut\nTout le monde`);
  });

  it("sans avertissement : mail inchange", () => {
    const mail = { html: "<body><p>x</p></body>", text: "x" };
    expect(injecterAvertissement(mail, {})).toEqual(mail);
    expect(
      injecterAvertissement(mail, { avertissementHtml: undefined, avertissementTexte: undefined })
    ).toEqual(mail);
  });

  it("avertissements vides : traites comme absents", () => {
    const mail = { html: "<body><p>x</p></body>", text: "x" };
    expect(injecterAvertissement(mail, { avertissementHtml: "", avertissementTexte: "" })).toEqual(
      mail
    );
  });

  it("seul l'avertissement HTML fourni : le texte reste inchange (et inversement)", () => {
    const mail = { html: "<body></body>", text: "x" };
    expect(injecterAvertissement(mail, { avertissementHtml: AV_HTML }).text).toBe("x");
    expect(injecterAvertissement(mail, { avertissementTexte: AV_TEXTE }).html).toBe("<body></body>");
  });

  it("le mail d'origine n'est pas modifie (objet gele, copie de controle)", () => {
    const mail = Object.freeze({ html: "<body><p>x</p></body>", text: "x" });
    const copie = { ...mail };
    const r = injecterAvertissement(mail, {
      avertissementHtml: AV_HTML,
      avertissementTexte: AV_TEXTE,
    });
    expect(mail).toEqual(copie);
    expect(r).not.toBe(mail);
    expect(r.html).not.toBe(mail.html);
  });

  it("caracteres speciaux de remplacement ($&, $1, $$) inseres tels quels", () => {
    const av = "<p>Prix $& et $1 et $$ et $`</p>";
    const r = injecterAvertissement({ html: "<body></body>", text: "x" }, { avertissementHtml: av });
    expect(r.html).toBe(`<body>${av}</body>`);
  });

  it("seule la premiere balise <body> recoit l'avertissement", () => {
    const r = injecterAvertissement(
      { html: "<body>a</body><body>b</body>", text: "x" },
      { avertissementHtml: AV_HTML }
    );
    expect(r.html.split(AV_HTML)).toHaveLength(2);
  });

  it("bout en bout avec un vrai modele : resoudre puis injecter dans emailBienvenue", () => {
    const mail = emailBienvenue({
      nomColocation: "Les Lilas",
      lien: "https://app.test/c/1",
      lienProfil: "https://app.test/profil",
    });
    const resolu = resoudreDestinataire("test1@roomflow.test", "moi@exemple.fr", mail.subject);
    const corps = injecterAvertissement({ html: mail.html, text: mail.text }, resolu);

    expect(resolu.to).toBe("moi@exemple.fr");
    expect(resolu.subject).toBe("[pour : test1@roomflow.test] RoomFlow : tu as rejoint Les Lilas");
    expect(corps.html).toContain(`<body style="margin:0;padding:0;background-color:#f4f4f5;">${resolu.avertissementHtml}`);
    expect(corps.html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(corps.text.startsWith("[Mode test : cet email était destiné à test1@roomflow.test]\n\n")).toBe(true);
    expect(corps.text.endsWith(mail.text)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// envoyerEmail : uniquement le cas sans cle API (aucun appel reseau)
// ---------------------------------------------------------------------------

describe("envoyerEmail sans RESEND_API_KEY", () => {
  const mail = { to: "test1@roomflow.test", subject: "Sujet", html: "<p>x</p>", text: "x" };

  beforeEach(() => {
    // On remplace la variable pour la duree du test sans jamais lire sa vraie
    // valeur ; afterEach (unstubAllEnvs) la restaure.
    vi.stubEnv("RESEND_API_KEY", undefined);
  });

  it("renvoie { ok: false, erreur } sans lever d'exception", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(envoyerEmail(mail)).resolves.toStrictEqual({
      ok: false,
      erreur: "Envoi d'emails non configuré",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("RESEND_API_KEY absente");
  });

  it("aucun client Resend n'est construit (donc aucun appel reseau)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await envoyerEmail(mail);
    expect(ResendFaux).not.toHaveBeenCalled();
  });

  it("cle faite d'espaces : meme resultat que cle absente", async () => {
    vi.stubEnv("RESEND_API_KEY", "   ");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await envoyerEmail(mail);
    expect(r).toStrictEqual({ ok: false, erreur: "Envoi d'emails non configuré" });
    expect(ResendFaux).not.toHaveBeenCalled();
  });

  it("cle vide : meme resultat que cle absente", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await envoyerEmail(mail);
    expect(r.ok).toBe(false);
    expect(ResendFaux).not.toHaveBeenCalled();
  });

  it("destinataire vide sans cle : c'est l'absence de cle qui est signalee, sans exception", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(envoyerEmail({ ...mail, to: "" })).resolves.toStrictEqual({
      ok: false,
      erreur: "Envoi d'emails non configuré",
    });
  });

  it("le message d'erreur ne contient ni le contenu du mail ni l'adresse du destinataire", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await envoyerEmail(mail);
    expect(JSON.stringify(r)).not.toContain("test1@roomflow.test");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("test1@roomflow.test");
  });
});

// ---------------------------------------------------------------------------
// estEnProduction
// ---------------------------------------------------------------------------

describe("estEnProduction", () => {
  it("VERCEL_ENV 'production' : production", () => {
    expect(estEnProduction({ VERCEL_ENV: "production" })).toBe(true);
  });

  it("VERCEL_ENV 'production' l'emporte meme si NODE_ENV dit autre chose", () => {
    expect(estEnProduction({ VERCEL_ENV: "production", NODE_ENV: "development" })).toBe(true);
    expect(estEnProduction({ VERCEL_ENV: "production", NODE_ENV: "test" })).toBe(true);
  });

  it.each(["preview", "development"])(
    "VERCEL_ENV '%s' : PAS production, meme si NODE_ENV vaut 'production'",
    (vercel) => {
      // Cas reel : Vercel compile ses deploiements "preview" avec
      // NODE_ENV=production. Sans cette regle, la redirection de test y serait
      // interdite alors qu'elle y est voulue.
      expect(estEnProduction({ VERCEL_ENV: vercel, NODE_ENV: "production" })).toBe(false);
    }
  );

  it("VERCEL_ENV inconnu ('staging') : pas production, meme avec NODE_ENV 'production'", () => {
    expect(estEnProduction({ VERCEL_ENV: "staging", NODE_ENV: "production" })).toBe(false);
  });

  it("VERCEL_ENV absent et NODE_ENV 'production' : production", () => {
    expect(estEnProduction({ NODE_ENV: "production" })).toBe(true);
  });

  it.each(["", "   ", "\t\n"])(
    "VERCEL_ENV vide ou espaces (%j) : traite comme absent, on se rabat sur NODE_ENV",
    (vide) => {
      expect(estEnProduction({ VERCEL_ENV: vide, NODE_ENV: "production" })).toBe(true);
      expect(estEnProduction({ VERCEL_ENV: vide, NODE_ENV: "development" })).toBe(false);
    }
  );

  it("VERCEL_ENV avec espaces autour (' production ') : nettoye, donc production", () => {
    expect(estEnProduction({ VERCEL_ENV: " production " })).toBe(true);
    expect(estEnProduction({ VERCEL_ENV: " preview ", NODE_ENV: "production" })).toBe(false);
  });

  it.each(["development", "test"])("NODE_ENV '%s' sans VERCEL_ENV : pas production", (node) => {
    expect(estEnProduction({ NODE_ENV: node })).toBe(false);
  });

  it("NODE_ENV absent et VERCEL_ENV absent : pas production", () => {
    expect(estEnProduction({})).toBe(false);
    expect(estEnProduction({ VERCEL_ENV: undefined, NODE_ENV: undefined })).toBe(false);
  });

  it("NODE_ENV vide : pas production", () => {
    expect(estEnProduction({ NODE_ENV: "" })).toBe(false);
  });

  it("NODE_ENV n'est PAS nettoye des espaces (' production ' : pas production)", () => {
    // Comportement actuel : seul VERCEL_ENV passe par trim(). Sans consequence
    // reelle (Node et Next positionnent NODE_ENV sans espace), mais l'asymetrie
    // est figee ici.
    expect(estEnProduction({ NODE_ENV: " production " })).toBe(false);
  });

  it.each(["Production", "PRODUCTION"])(
    "casse : VERCEL_ENV '%s' n'est PAS reconnu comme production (comparaison exacte)",
    (vercel) => {
      // Comportement actuel du code, fige ici. Vercel ecrit toujours
      // "production" en minuscules, donc pas de risque reel, mais une erreur
      // de casse a la main dans un test ou un script ferait basculer en
      // "pas production" (donc en mode ou EMAIL_REDIRECT_TO s'applique).
      expect(estEnProduction({ VERCEL_ENV: vercel })).toBe(false);
      expect(estEnProduction({ VERCEL_ENV: vercel, NODE_ENV: "production" })).toBe(false);
    }
  );

  it.each(["Production", "PRODUCTION"])(
    "casse : NODE_ENV '%s' (sans VERCEL_ENV) n'est PAS reconnu comme production",
    (node) => {
      expect(estEnProduction({ NODE_ENV: node })).toBe(false);
    }
  );

  it("n'a aucun effet de bord : l'objet passe n'est pas modifie", () => {
    const env = Object.freeze({ VERCEL_ENV: "production", NODE_ENV: "production" });
    expect(() => estEnProduction(env)).not.toThrow();
    expect(env).toStrictEqual({ VERCEL_ENV: "production", NODE_ENV: "production" });
  });
});

// ---------------------------------------------------------------------------
// redirectionActive
// ---------------------------------------------------------------------------

describe("redirectionActive", () => {
  const CIBLE = "moi@exemple.fr";

  it("hors production : renvoie l'adresse", () => {
    expect(redirectionActive({ EMAIL_REDIRECT_TO: CIBLE, NODE_ENV: "development" })).toBe(CIBLE);
    expect(redirectionActive({ EMAIL_REDIRECT_TO: CIBLE, NODE_ENV: "test" })).toBe(CIBLE);
    expect(redirectionActive({ EMAIL_REDIRECT_TO: CIBLE })).toBe(CIBLE);
  });

  it("hors production : l'adresse est renvoyee SANS les espaces autour", () => {
    expect(redirectionActive({ EMAIL_REDIRECT_TO: `  ${CIBLE} \n`, NODE_ENV: "development" })).toBe(
      CIBLE
    );
  });

  it("deploiement Vercel 'preview' (NODE_ENV 'production') : la redirection reste active", () => {
    expect(
      redirectionActive({ EMAIL_REDIRECT_TO: CIBLE, VERCEL_ENV: "preview", NODE_ENV: "production" })
    ).toBe(CIBLE);
  });

  it("VERCEL_ENV 'development' : la redirection reste active", () => {
    expect(
      redirectionActive({ EMAIL_REDIRECT_TO: CIBLE, VERCEL_ENV: "development", NODE_ENV: "production" })
    ).toBe(CIBLE);
  });

  it("EMAIL_REDIRECT_TO absente : undefined", () => {
    expect(redirectionActive({ NODE_ENV: "development" })).toBeUndefined();
    expect(redirectionActive({})).toBeUndefined();
    expect(redirectionActive({ EMAIL_REDIRECT_TO: undefined })).toBeUndefined();
  });

  it.each(["", " ", "   ", "\t\n"])(
    "EMAIL_REDIRECT_TO vide ou faite d'espaces (%j) : undefined",
    (vide) => {
      expect(redirectionActive({ EMAIL_REDIRECT_TO: vide, NODE_ENV: "development" })).toBeUndefined();
    }
  );

  // CAS CRITIQUE : c'est le garde-fou qui empeche une variable de test oubliee
  // dans les reglages Vercel de detourner tous les liens de reinitialisation
  // de mot de passe vers une seule boite.
  describe("EN PRODUCTION : jamais de redirection, meme avec une adresse remplie", () => {
    it("VERCEL_ENV 'production' : undefined", () => {
      expect(redirectionActive({ EMAIL_REDIRECT_TO: CIBLE, VERCEL_ENV: "production" })).toBeUndefined();
    });

    it("VERCEL_ENV 'production' avec NODE_ENV 'development' : undefined", () => {
      expect(
        redirectionActive({ EMAIL_REDIRECT_TO: CIBLE, VERCEL_ENV: "production", NODE_ENV: "development" })
      ).toBeUndefined();
    });

    it("hors Vercel, NODE_ENV 'production' : undefined", () => {
      expect(redirectionActive({ EMAIL_REDIRECT_TO: CIBLE, NODE_ENV: "production" })).toBeUndefined();
    });

    it("VERCEL_ENV vide + NODE_ENV 'production' : undefined (vide = absent)", () => {
      expect(
        redirectionActive({ EMAIL_REDIRECT_TO: CIBLE, VERCEL_ENV: "  ", NODE_ENV: "production" })
      ).toBeUndefined();
    });

    it("adresse entouree d'espaces : toujours undefined", () => {
      expect(
        redirectionActive({ EMAIL_REDIRECT_TO: `  ${CIBLE}  `, VERCEL_ENV: "production" })
      ).toBeUndefined();
    });

    it("vaut aussi pour une adresse invalide (pas d'analyse de la valeur)", () => {
      expect(redirectionActive({ EMAIL_REDIRECT_TO: "pas-une-adresse", NODE_ENV: "production" })).toBeUndefined();
    });
  });

  it.each(["Production", "PRODUCTION"])(
    "casse : VERCEL_ENV '%s' n'est pas reconnu comme production, donc la redirection S'APPLIQUE",
    (vercel) => {
      // Comportement actuel du code, fige ici (voir estEnProduction) : le
      // garde-fou est sensible a la casse. Vercel ecrit "production" en
      // minuscules, donc pas de trou en pratique, mais il tombe du mauvais
      // cote (redirection active) si la valeur est ecrite autrement.
      expect(redirectionActive({ EMAIL_REDIRECT_TO: CIBLE, VERCEL_ENV: vercel })).toBe(CIBLE);
    }
  );

  it("NODE_ENV 'Production' (sans VERCEL_ENV) : la redirection s'applique aussi", () => {
    expect(redirectionActive({ EMAIL_REDIRECT_TO: CIBLE, NODE_ENV: "Production" })).toBe(CIBLE);
  });

  it("l'objet env passe n'est pas modifie", () => {
    const env = Object.freeze({ EMAIL_REDIRECT_TO: `  ${CIBLE} `, NODE_ENV: "development" });
    redirectionActive(env);
    expect(env.EMAIL_REDIRECT_TO).toBe(`  ${CIBLE} `);
  });
});

// ---------------------------------------------------------------------------
// envoyerEmail et construireUrl : avertissements uniques, redirection
// ---------------------------------------------------------------------------

// Les avertissements "une seule fois" reposent sur des variables de MODULE
// (avertiRedirection, avertiAppUrl). Un import statique les partagerait entre
// tous les tests du fichier : le resultat dependrait de l'ordre d'execution.
// Chaque test repart donc d'un module neuf (vi.resetModules + import dynamique).
async function chargerEmailNeuf() {
  vi.resetModules();
  return import("@/lib/email");
}

// Variables lues par email.ts, remises a un etat connu : aucune dependance a
// l'environnement reel de la machine (ni cle, ni production).
function envNeutre() {
  vi.stubEnv("RESEND_API_KEY", undefined);
  vi.stubEnv("EMAIL_REDIRECT_TO", undefined);
  vi.stubEnv("EMAIL_FROM", undefined);
  vi.stubEnv("APP_URL", undefined);
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("NODE_ENV", "test");
}

describe("construireUrl : avertissement APP_URL absente en production", () => {
  beforeEach(() => {
    envNeutre();
  });

  const messageAppUrl = (warn: { mock: { calls: unknown[][] } }) =>
    warn.mock.calls.filter((c) => String(c[0]).includes("APP_URL absente en production"));

  it("production, APP_URL absente, aucune base : un seul avertissement meme apres 3 appels", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { construireUrl: construire } = await chargerEmailNeuf();

    // Le repli sur localhost est toujours applique : l'avertissement ne change
    // pas le resultat.
    expect(construire("/profil")).toBe("http://localhost:3000/profil");
    expect(construire("/connexion")).toBe("http://localhost:3000/connexion");
    expect(construire("/colocations/1")).toBe("http://localhost:3000/colocations/1");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toBe(
      "[email] APP_URL absente en production : les liens des emails pointent vers localhost"
    );
  });

  it.each(["", "   "])("production, APP_URL vide ou espaces (%j) : avertit une fois", async (vide) => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("APP_URL", vide);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { construireUrl: construire } = await chargerEmailNeuf();

    construire("/a");
    construire("/b");

    expect(messageAppUrl(warn)).toHaveLength(1);
  });

  it("hors Vercel, NODE_ENV 'production', APP_URL absente : avertit une fois", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { construireUrl: construire } = await chargerEmailNeuf();

    construire("/a");
    construire("/b");

    expect(messageAppUrl(warn)).toHaveLength(1);
  });

  it("production avec une base passee en argument : jamais d'avertissement", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { construireUrl: construire } = await chargerEmailNeuf();

    expect(construire("/profil", "https://roomflow.app")).toBe("https://roomflow.app/profil");
    expect(construire("/profil", "  https://roomflow.app  ")).toBe("https://roomflow.app/profil");

    expect(warn).not.toHaveBeenCalled();
  });

  it("production avec APP_URL renseignee : jamais d'avertissement", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("APP_URL", "https://roomflow.app");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { construireUrl: construire } = await chargerEmailNeuf();

    expect(construire("/profil")).toBe("https://roomflow.app/profil");

    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["Vercel preview (NODE_ENV production)", { VERCEL_ENV: "preview", NODE_ENV: "production" }],
    ["Vercel development", { VERCEL_ENV: "development", NODE_ENV: "production" }],
    ["NODE_ENV development", { NODE_ENV: "development" }],
    ["NODE_ENV test", { NODE_ENV: "test" }],
  ])("hors production (%s), APP_URL absente : jamais d'avertissement", async (_nom, variables) => {
    for (const [cle, valeur] of Object.entries(variables)) vi.stubEnv(cle, valeur);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { construireUrl: construire } = await chargerEmailNeuf();

    expect(construire("/profil")).toBe("http://localhost:3000/profil");

    expect(warn).not.toHaveBeenCalled();
  });

  it("base explicite vide en production : avertit (une base vide compte comme absente)", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { construireUrl: construire } = await chargerEmailNeuf();

    construire("/profil", "");

    expect(messageAppUrl(warn)).toHaveLength(1);
  });

  it("base explicite vide : elle l'emporte sur APP_URL et renvoie localhost (comportement actuel)", async () => {
    // "" n'est pas null/undefined, donc l'operateur ?? ne retombe pas sur
    // APP_URL. Aucun appelant du projet ne passe de base, donc pas de risque
    // aujourd'hui ; fige ici pour qu'un changement soit voulu.
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("APP_URL", "https://roomflow.app");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { construireUrl: construire } = await chargerEmailNeuf();

    expect(construire("/profil", "")).toBe("http://localhost:3000/profil");
    expect(messageAppUrl(warn)).toHaveLength(1);
  });

  it("un appel avec base entre deux appels sans base ne consomme pas l'avertissement", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { construireUrl: construire } = await chargerEmailNeuf();

    construire("/a", "https://roomflow.app");
    expect(warn).not.toHaveBeenCalled();
    construire("/b");
    construire("/c");
    construire("/d", "https://roomflow.app");

    expect(messageAppUrl(warn)).toHaveLength(1);
  });

  it("module neuf = compteur neuf : l'isolation entre tests fonctionne (un avertissement par module)", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const premier = await chargerEmailNeuf();
    premier.construireUrl("/a");
    premier.construireUrl("/b");
    const second = await chargerEmailNeuf();
    second.construireUrl("/a");
    second.construireUrl("/b");

    expect(messageAppUrl(warn)).toHaveLength(2);
  });

  it("l'avertissement ne contient aucune valeur secrete", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "re_cle_secrete_de_test");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { construireUrl: construire } = await chargerEmailNeuf();

    construire("/profil");

    expect(warn.mock.calls.flat().join(" ")).not.toContain("re_cle_secrete_de_test");
  });
});

describe("envoyerEmail avec une cle API : client Resend entierement simule", () => {
  const mail = { to: "test1@roomflow.test", subject: "Sujet", html: "<body><p>x</p></body>", text: "x" };
  const CIBLE = "moi@exemple.fr";
  const envoi = vi.fn();

  beforeEach(() => {
    envNeutre();
    vi.stubEnv("RESEND_API_KEY", "re_cle_factice_de_test");
    // Double securite contre un vrai envoi : le SDK est deja remplace par
    // ResendFaux (vi.mock en haut du fichier), et fetch lui-meme est remplace
    // par une fonction qui leve. Si un jour un vrai client etait construit,
    // le test echouerait au lieu de contacter Resend.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("appel reseau interdit dans les tests");
      })
    );
    envoi.mockReset();
    envoi.mockResolvedValue({ error: null });
    ResendFaux.mockReset();
    // function (pas une fleche) : le code appelle `new Resend(cle)`.
    ResendFaux.mockImplementation(function () {
      return { emails: { send: envoi } };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    ResendFaux.mockReset();
  });

  const messagesRedirection = (warn: { mock: { calls: unknown[][] } }) =>
    warn.mock.calls.filter((c) => String(c[0]).includes("EMAIL_REDIRECT_TO est ignorée en production"));

  it("sans redirection ni production : le mail part au vrai destinataire, sujet intact", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { envoyerEmail: envoyer } = await chargerEmailNeuf();

    await expect(envoyer(mail)).resolves.toStrictEqual({ ok: true });

    expect(ResendFaux).toHaveBeenCalledWith("re_cle_factice_de_test");
    expect(envoi).toHaveBeenCalledTimes(1);
    const envoye = envoi.mock.calls[0][0];
    expect(envoye.to).toBe(mail.to);
    expect(envoye.subject).toBe(mail.subject);
    expect(envoye.html).toBe(mail.html);
    expect(warn).not.toHaveBeenCalled();
  });

  it("hors production avec EMAIL_REDIRECT_TO : redirige, prefixe le sujet, ajoute l'avertissement", async () => {
    vi.stubEnv("EMAIL_REDIRECT_TO", `  ${CIBLE} `);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { envoyerEmail: envoyer } = await chargerEmailNeuf();

    await envoyer(mail);

    const envoye = envoi.mock.calls[0][0];
    expect(envoye.to).toBe(CIBLE);
    expect(envoye.subject).toBe("[pour : test1@roomflow.test] Sujet");
    expect(envoye.html).toContain("Mode test : cet email était destiné à");
    expect(envoye.text.startsWith("[Mode test : cet email était destiné à test1@roomflow.test]")).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("Vercel preview avec EMAIL_REDIRECT_TO : la redirection reste appliquee, sans avertissement", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_REDIRECT_TO", CIBLE);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { envoyerEmail: envoyer } = await chargerEmailNeuf();

    await envoyer(mail);

    expect(envoi.mock.calls[0][0].to).toBe(CIBLE);
    expect(messagesRedirection(warn)).toHaveLength(0);
  });

  it("EN PRODUCTION avec EMAIL_REDIRECT_TO remplie : le mail part au VRAI destinataire, non modifie", async () => {
    // Test de bout en bout du garde-fou : prouve que envoyerEmail passe bien
    // par redirectionActive et n'applique jamais la variable en production.
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("EMAIL_REDIRECT_TO", CIBLE);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { envoyerEmail: envoyer } = await chargerEmailNeuf();

    await expect(envoyer(mail)).resolves.toStrictEqual({ ok: true });

    const envoye = envoi.mock.calls[0][0];
    expect(envoye.to).toBe(mail.to);
    expect(envoye.subject).toBe(mail.subject);
    expect(envoye.html).toBe(mail.html);
    expect(envoye.text).toBe(mail.text);
    expect(JSON.stringify(envoye)).not.toContain(CIBLE);
  });

  it("production par NODE_ENV (hors Vercel) : meme garde-fou", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_REDIRECT_TO", CIBLE);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { envoyerEmail: envoyer } = await chargerEmailNeuf();

    await envoyer(mail);

    expect(envoi.mock.calls[0][0].to).toBe(mail.to);
  });

  it("production + EMAIL_REDIRECT_TO : un seul avertissement, meme apres 3 envois", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("EMAIL_REDIRECT_TO", CIBLE);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { envoyerEmail: envoyer } = await chargerEmailNeuf();

    await envoyer(mail);
    await envoyer(mail);
    await envoyer({ ...mail, to: "autre@roomflow.test" });

    expect(envoi).toHaveBeenCalledTimes(3);
    expect(messagesRedirection(warn)).toHaveLength(1);
    expect(String(messagesRedirection(warn)[0][0])).toBe(
      "[email] EMAIL_REDIRECT_TO est ignorée en production : les emails partent aux vrais destinataires"
    );
  });

  it("l'avertissement de redirection ne cite aucune adresse ni la cle API", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("EMAIL_REDIRECT_TO", CIBLE);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { envoyerEmail: envoyer } = await chargerEmailNeuf();

    await envoyer(mail);

    const tout = warn.mock.calls.flat().join(" ");
    expect(tout).not.toContain(CIBLE);
    expect(tout).not.toContain("test1@roomflow.test");
    expect(tout).not.toContain("re_cle_factice_de_test");
  });

  it.each(["", "   "])(
    "production + EMAIL_REDIRECT_TO vide ou espaces (%j) : aucun avertissement",
    async (vide) => {
      vi.stubEnv("VERCEL_ENV", "production");
      vi.stubEnv("EMAIL_REDIRECT_TO", vide);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { envoyerEmail: envoyer } = await chargerEmailNeuf();

      await envoyer(mail);

      expect(warn).not.toHaveBeenCalled();
    }
  );

  it("production sans EMAIL_REDIRECT_TO : aucun avertissement", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { envoyerEmail: envoyer } = await chargerEmailNeuf();

    await envoyer(mail);
    await envoyer(mail);

    expect(warn).not.toHaveBeenCalled();
  });

  it("module neuf = compteur neuf : l'avertissement reapparait une fois par module", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("EMAIL_REDIRECT_TO", CIBLE);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const premier = await chargerEmailNeuf();
    await premier.envoyerEmail(mail);
    await premier.envoyerEmail(mail);
    const second = await chargerEmailNeuf();
    await second.envoyerEmail(mail);

    expect(messagesRedirection(warn)).toHaveLength(2);
  });

  it("aucun appel a fetch : le reseau n'est jamais touche", async () => {
    vi.stubEnv("EMAIL_REDIRECT_TO", CIBLE);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { envoyerEmail: envoyer } = await chargerEmailNeuf();

    await envoyer(mail);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Coherence par lecture du source : envoyerEmail passe par redirectionActive
// ---------------------------------------------------------------------------

describe("source de email.ts : envoyerEmail utilise le garde-fou", () => {
  // FRAGILE par nature : ce test lit le texte du fichier, pas son comportement.
  // Un renommage ou un reformatage (ex. passer env dans une variable locale)
  // le ferait echouer sans bug reel. Il est un filet en plus des tests de
  // comportement ci-dessus (production => le mail part au vrai destinataire),
  // qui sont, eux, la vraie preuve.
  const source = readFileSync(fileURLToPath(new URL("./email.ts", import.meta.url)), "utf8");
  const corpsEnvoyer = source.slice(source.indexOf("export async function envoyerEmail"));

  it("envoyerEmail appelle redirectionActive(process.env)", () => {
    expect(corpsEnvoyer).toMatch(/redirectionActive\(process\.env\)/);
  });

  it("la valeur de redirectionActive est celle passee a resoudreDestinataire", () => {
    expect(corpsEnvoyer).toMatch(/const redirection = redirectionActive\(/);
    expect(corpsEnvoyer).toMatch(/resoudreDestinataire\(to, redirection, subject\)/);
  });

  it("envoyerEmail ne passe JAMAIS EMAIL_REDIRECT_TO directement a resoudreDestinataire", () => {
    expect(corpsEnvoyer).not.toMatch(/resoudreDestinataire\([^)]*EMAIL_REDIRECT_TO/);
  });
});
