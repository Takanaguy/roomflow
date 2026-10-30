import { Schema, model, models, Types, type InferSchemaType } from "mongoose";
import { randomBytes } from "crypto";

const memberSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["admin", "member"], required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const householdSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    members: { type: [memberSchema], default: [] },
    // Code court partage aux colocataires pour rejoindre (section 4.2 et
    // parcours 2 du cahier des charges). Genere par defaut a la creation.
    inviteCode: {
      type: String,
      required: true,
      unique: true,
      default: () => randomBytes(4).toString("hex"), // ex: "a1b2c3d4"
    },
    // --- Nettoyage automatique (lot 11, voir lib/nettoyage.ts) ---
    // Tous optionnels et sans effet sur les documents existants : un champ
    // absent vaut "aucun nettoyage en cours". Un .lean() n'applique pas les
    // defauts Mongoose : lire `demo === true`, jamais `!demo`.
    // Colocation de demonstration : jamais avertie ni supprimee par le
    // mecanisme. Posee a la main en base.
    demo: { type: Boolean, default: false },
    // Moment ou le dernier membre est parti. Point de depart du delai de
    // suppression d'une colocation vide ; efface quand quelqu'un rejoint.
    videDepuis: { type: Date },
    // Date de l'email d'avertissement d'inactivite. Reference pour savoir s'il
    // y a eu une NOUVELLE activite depuis (ce qui annule la suppression).
    avertieLe: { type: Date },
    // Echeance affichee dans le panneau admin et promise dans l'email : gardee
    // en base pour que tout le monde voie la meme date, meme si le delai
    // change plus tard dans le code.
    suppressionPrevueLe: { type: Date },
    // Pourquoi la suppression est prevue : la raison doit rester vraie au
    // moment de supprimer, et ce n'est pas la meme a verifier (0 membre, ou
    // aucune activite depuis l'avertissement).
    motifSuppression: { type: String, enum: ["vide", "inactive"] },
    // Verrou pose par le cron juste avant de detruire : tant qu'il a moins de
    // 10 minutes, /join traite la colocation comme introuvable et un second
    // passage ne la detruit pas en double. Plus vieux = passage plante, la
    // colocation redevient joignable et le cron peut reprendre.
    destructionDebut: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export type Household = InferSchemaType<typeof householdSchema>;
export type HouseholdMember = InferSchemaType<typeof memberSchema> & {
  userId: Types.ObjectId;
};

export default models.Household ?? model("Household", householdSchema);
