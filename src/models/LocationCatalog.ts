import mongoose, { Schema } from 'mongoose';
import legacyCatalog from '../data/legacyLocationCatalog.json';

const LocationCatalogSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, default: 'partner-registration' },
    cities: { type: [Schema.Types.Mixed], default: [] },
    migrationVersion: { type: Number, default: 1 },
    updatedBy: { type: String },
  },
  { timestamps: true, collection: 'locationcatalogs' },
);

export const LocationCatalog =
  mongoose.models.LocationCatalog || mongoose.model('LocationCatalog', LocationCatalogSchema);

export async function getLocationCatalog() {
  return LocationCatalog.findOneAndUpdate(
    { key: 'partner-registration' },
    {
      $setOnInsert: {
        key: 'partner-registration',
        cities: legacyCatalog.cities,
        migrationVersion: legacyCatalog.version,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}