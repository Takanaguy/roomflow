import path from "node:path";
import { Document, Font, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formaterEuros } from "@/lib/email-templates";
import {
  deMois,
  formaterDate,
  libellePayeurs,
  libellePourcentage,
  libelleSolde,
  nomVirement,
  type RecapMensuel,
} from "@/lib/recap-mensuel";

// Police embarquee : Noto Sans 400 et 700, TTF statiques (pas de police variable,
// que react-pdf ne gere pas), licence SIL OFL dans src/assets/fonts/OFL.txt.
// Source : paquet npm @expo-google-fonts/noto-sans 0.4.2. Pourquoi pas Helvetica :
// la police integree au PDF ne couvre que Windows-1252 et affiche des lettres
// FAUSSES, sans erreur, pour le cyrillique, le grec, le polonais, le hongrois...
// Un seul fichier par graisse couvre latin, latin etendu, cyrillique et grec, donc
// pas de famille de repli a gerer. Un caractere hors couverture (emoji, chinois)
// s'affiche comme un carre, sans faire planter le rendu.
// Chemin base sur process.cwd() : la racine du projet en local comme sur Vercel ;
// sur Vercel, le dossier est copie dans la fonction par outputFileTracingIncludes
// (next.config.ts), sans quoi le fichier serait introuvable a l'execution.
const DOSSIER_POLICES = path.join(process.cwd(), "src", "assets", "fonts");
const POLICE = "NotoSans";
Font.register({
  family: POLICE,
  fonts: [
    { src: path.join(DOSSIER_POLICES, "NotoSans_400Regular.ttf"), fontWeight: 400 },
    { src: path.join(DOSSIER_POLICES, "NotoSans_700Bold.ttf"), fontWeight: 700 },
  ],
});

// Pourquoi ce prechauffage : fontkit garde un cache de glyphes dont la PREMIERE creation
// gagne, avec ses points de code (glyphe cree par une substitution GSUB = points de code
// vides). pdfkit en tire la table ToUnicode du PDF : un glyphe cree sans point de code y
// reste sans correspondance, et les lecteurs le devinent (le point "." sortait en "!" a
// l'extraction, copier-coller et Ctrl+F faux). On cree donc d'abord CHAQUE glyphe de la
// police depuis son point de code, une seule fois par processus ; l'ordre des documents
// ne compte plus. Le rendu visuel n'est pas concerne, seulement le texte extractible.
// Ce que fontkit expose de la police chargee (le type de react-pdf ne le declare pas).
type FontkitMinimal = { characterSet: number[]; glyphForCodePoint(code: number): unknown };

// ATTENTION : l'echec de chargement est DEFINITIF pour le processus. La promesse
// ci-dessous et FontSource.load de react-pdf gardent l'echec en memoire ; seul un
// redemarrage du processus permet de reessayer.
let policePrete: Promise<void> | null = null;
function preparerPolice(): Promise<void> {
  policePrete ??= (async () => {
    for (const fontWeight of [400, 700] as const) {
      const descripteur = { fontFamily: POLICE, fontWeight };
      await Font.load(descripteur);
      const police = (
        Font.getFont(descripteur) as unknown as { data: FontkitMinimal | null } | null
      )?.data;
      // Erreur explicite plutot qu'un echec silencieux : apres une mise a jour de
      // react-pdf, le defaut du "." lu "!" reviendrait sans que personne le voie.
      if (
        !police ||
        !Array.isArray(police.characterSet) ||
        typeof police.glyphForCodePoint !== "function"
      ) {
        throw new Error("police non chargee : le contournement ToUnicode ne peut pas s'appliquer");
      }
      for (const pointDeCode of police.characterSet) police.glyphForCodePoint(pointDeCode);
    }
  })();
  return policePrete;
}

// Coupure des mots : react-pdf applique par defaut des regles ANGLAISES, fausses
// en francais. On ne coupe donc qu'en dernier recours. Le seuil compte des
// caracteres, pas une largeur : 20 "M" ou "W" depassent une colonne du tableau, d'ou
// un seuil bas. Un mot de 12 caracteres ou moins reste entier ; un mot plus long est
// decoupe par morceaux de 6, mais la coupure ne s'applique que si le mot ne tient pas
// dans la ligne (un mot court qui tient reste entier). ATTENTION : ce reglage est
// GLOBAL a react-pdf (il vaut pour tous les documents du processus). A revoir si un
// second document PDF apparait.
Font.registerHyphenationCallback((mot) =>
  mot.length <= 12 ? [mot] : (mot.match(/.{1,6}/gu) ?? [mot])
);

// Palette zinc de Tailwind, la meme que l'interface.
const ZINC_900 = "#18181b";
const ZINC_600 = "#52525b";
const ZINC_500 = "#71717a";
const ZINC_200 = "#e4e4e7";
const ZINC_100 = "#f4f4f5";

const styles = StyleSheet.create({
  page: {
    fontFamily: POLICE,
    fontSize: 10,
    color: ZINC_900,
    paddingTop: 40,
    paddingHorizontal: 40,
    // Marge basse plus grande que haute : le pied de page absolu y est range.
    paddingBottom: 60,
  },
  marque: { fontSize: 10, color: ZINC_500, letterSpacing: 1 },
  titre: { fontSize: 20, fontFamily: POLICE, fontWeight: 700, marginTop: 4 },
  sousTitre: { fontSize: 13, marginTop: 4 },
  genereLe: { fontSize: 9, color: ZINC_500, marginTop: 6 },
  entete: { borderBottomWidth: 1, borderBottomColor: ZINC_200, paddingBottom: 12 },

  total: { marginTop: 16, flexDirection: "row", alignItems: "baseline" },
  totalLibelle: { fontSize: 11, color: ZINC_600, marginRight: 8 },
  totalMontant: { fontSize: 18, fontFamily: POLICE, fontWeight: 700 },

  section: { marginTop: 22 },
  sectionTitre: { fontSize: 12, fontFamily: POLICE, fontWeight: 700, marginBottom: 8 },

  ligne: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: ZINC_200,
  },
  ligneEntete: {
    flexDirection: "row",
    paddingVertical: 5,
    backgroundColor: ZINC_100,
    borderBottomWidth: 0.5,
    borderBottomColor: ZINC_200,
  },
  cellule: { paddingHorizontal: 4 },
  enteteTexte: { fontSize: 9, fontFamily: POLICE, fontWeight: 700, color: ZINC_600 },
  droite: { textAlign: "right" },

  // Colonnes du tableau des depenses (somme = 100 %).
  colDate: { width: "13%" },
  colDescription: { width: "31%" },
  colCategorie: { width: "13%" },
  colPayeur: { width: "27%" },
  colMontant: { width: "16%" },

  // Colonnes du tableau des categories.
  colCatLibelle: { width: "60%" },
  colCatMontant: { width: "25%" },
  colCatPourcent: { width: "15%" },

  soldeNom: { width: "50%", paddingHorizontal: 4 },
  soldeTexte: { width: "50%", paddingHorizontal: 4, textAlign: "right" },

  vide: { fontSize: 10, color: ZINC_500 },

  piedNom: { width: "80%", maxLines: 1, textOverflow: "ellipsis" },
  pied: {
    position: "absolute",
    bottom: 28,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: ZINC_500,
  },
});

export function RecapMensuelPdf({ recap }: { recap: RecapMensuel }) {
  return (
    <Document
      title={`Récapitulatif ${deMois(recap.moisLibelle)} - ${recap.colocation.nom}`}
      author="RoomFlow"
      creator="RoomFlow"
      language="fr"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.entete}>
          <Text style={styles.marque}>RoomFlow</Text>
          <Text style={styles.titre}>{recap.colocation.nom}</Text>
          <Text style={styles.sousTitre}>Récapitulatif {deMois(recap.moisLibelle)}</Text>
          <Text style={styles.genereLe}>Généré le {formaterDate(recap.genereLe)}</Text>
        </View>

        <View style={styles.total}>
          <Text style={styles.totalLibelle}>Total du mois</Text>
          <Text style={styles.totalMontant}>{formaterEuros(recap.totalMois)}</Text>
        </View>

        {recap.categories.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitre}>Par catégorie</Text>
            <View style={styles.ligneEntete}>
              <Text style={[styles.cellule, styles.colCatLibelle, styles.enteteTexte]}>Catégorie</Text>
              <Text style={[styles.cellule, styles.colCatMontant, styles.enteteTexte, styles.droite]}>
                Montant
              </Text>
              <Text style={[styles.cellule, styles.colCatPourcent, styles.enteteTexte, styles.droite]}>
                Part
              </Text>
            </View>
            {recap.categories.map((c) => (
              <View key={c.category} style={styles.ligne} wrap={false}>
                <Text style={[styles.cellule, styles.colCatLibelle]}>{c.label}</Text>
                <Text style={[styles.cellule, styles.colCatMontant, styles.droite]}>
                  {formaterEuros(c.total)}
                </Text>
                <Text style={[styles.cellule, styles.colCatPourcent, styles.droite]}>
                  {libellePourcentage(c.pourcentage)}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitre}>Dépenses du mois</Text>
          {recap.depenses.length === 0 ? (
            <Text style={styles.vide}>Aucune dépense ce mois-ci.</Text>
          ) : (
            <View>
              {/* `fixed` : sur un tableau coupé par un saut de page, l'en-tête
                  est répété en haut de chaque page où le tableau continue. */}
              <View style={styles.ligneEntete} fixed>
                <Text style={[styles.cellule, styles.colDate, styles.enteteTexte]}>Date</Text>
                <Text style={[styles.cellule, styles.colDescription, styles.enteteTexte]}>
                  Description
                </Text>
                <Text style={[styles.cellule, styles.colCategorie, styles.enteteTexte]}>
                  Catégorie
                </Text>
                <Text style={[styles.cellule, styles.colPayeur, styles.enteteTexte]}>Payé par</Text>
                <Text style={[styles.cellule, styles.colMontant, styles.enteteTexte, styles.droite]}>
                  Montant
                </Text>
              </View>
              {recap.depenses.map((d, i) => (
                // Une dépense ne doit jamais être coupée en deux entre deux pages.
                <View key={i} style={styles.ligne} wrap={false}>
                  <Text style={[styles.cellule, styles.colDate]}>{formaterDate(d.date)}</Text>
                  <Text style={[styles.cellule, styles.colDescription]}>{d.description}</Text>
                  <Text style={[styles.cellule, styles.colCategorie]}>{d.categorie}</Text>
                  <Text style={[styles.cellule, styles.colPayeur]}>{libellePayeurs(d.payeurs)}</Text>
                  <Text style={[styles.cellule, styles.colMontant, styles.droite]}>
                    {formaterEuros(d.montant)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* wrap={false} : le titre ne reste pas seul en bas d'une page. */}
        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitre}>Soldes au {formaterDate(recap.soldesAu)}</Text>
          {recap.soldes.map((s) => (
            <View key={s.userId} style={styles.ligne}>
              <Text style={styles.soldeNom}>{s.name}</Text>
              <Text style={styles.soldeTexte}>{libelleSolde(s.amount)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitre}>Pour s&apos;équilibrer</Text>
          {recap.virements.length === 0 ? (
            <Text style={styles.vide}>Tout le monde est à jour.</Text>
          ) : (
            recap.virements.map((v, i) => (
              <View key={i} style={styles.ligne}>
                <Text style={styles.cellule}>
                  {nomVirement(v.de, v.deAncienMembre)} doit {formaterEuros(v.montant)} à{" "}
                  {nomVirement(v.a, v.aAncienMembre)}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.pied} fixed>
          {/* Largeur fixe + une ligne : un nom de colocation tres long est tronque (...) au lieu de passer sous le numero de page. */}
          <Text style={styles.piedNom}>
            RoomFlow · {recap.colocation.nom}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Rend le récapitulatif en PDF ; la route de téléchargement n'a qu'à renvoyer ce Buffer. */
export async function genererPdfRecap(recap: RecapMensuel): Promise<Buffer> {
  await preparerPolice();
  return renderToBuffer(<RecapMensuelPdf recap={recap} />);
}
