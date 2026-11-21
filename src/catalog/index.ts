import type { CatalogCategory, CatalogItem } from './types';
import { livingItems } from './items/living';
import { bedroomItems } from './items/bedroom';
import { kitchenItems } from './items/kitchen';
import { bathroomItems } from './items/bathroom';
import { diningItems } from './items/dining';
import { officeItems } from './items/office';
import { lightingItems } from './items/lighting';
import { decorItems } from './items/decor';
import { storageItems } from './items/storage';
import { outdoorItems } from './items/outdoor';
import { structureItems } from './items/structure';
import { vehicleItems } from './items/vehicles';

export type { CatalogItem, CatalogCategory, PlanShape, BuildOptions } from './types';

/** Ordered list of categories for the library UI. */
export const CATEGORIES: { id: CatalogCategory; label: string }[] = [
  { id: 'living', label: 'Living room' },
  { id: 'bedroom', label: 'Bedroom' },
  { id: 'kitchen', label: 'Kitchen' },
  { id: 'dining', label: 'Dining' },
  { id: 'bathroom', label: 'Bathroom & laundry' },
  { id: 'office', label: 'Office' },
  { id: 'storage', label: 'Storage' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'decor', label: 'Decor & plants' },
  { id: 'structure', label: 'Stairs & structure' },
  { id: 'outdoor', label: 'Outdoor & garden' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'custom', label: 'My models' },
];

export const CATALOG: CatalogItem[] = [
  ...livingItems,
  ...bedroomItems,
  ...kitchenItems,
  ...diningItems,
  ...bathroomItems,
  ...officeItems,
  ...storageItems,
  ...lightingItems,
  ...decorItems,
  ...structureItems,
  ...outdoorItems,
  ...vehicleItems,
];

const byId = new Map<string, CatalogItem>(CATALOG.map((i) => [i.id, i]));

export function getCatalogItem(id: string): CatalogItem | undefined {
  return byId.get(id);
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/**
 * Search by name / tags / id / category. All whitespace-separated terms must match.
 * Results are ranked: name-prefix matches first, then name matches, then tag matches.
 */
export function searchCatalog(query: string, category?: CatalogCategory | 'all' | null): CatalogItem[] {
  const pool = category && category !== 'all' ? CATALOG.filter((i) => i.category === category) : CATALOG;
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return pool.slice();
  const scored: { item: CatalogItem; score: number }[] = [];
  for (const item of pool) {
    const name = norm(item.name);
    const tags = item.tags.map(norm);
    const label = norm(CATEGORIES.find((c) => c.id === item.category)?.label ?? '');
    let score = 0;
    let ok = true;
    for (const t of terms) {
      let s = 0;
      if (name.startsWith(t)) s = 4;
      else if (name.split(/[^a-z0-9]+/).some((w) => w.startsWith(t))) s = 3;
      else if (tags.some((g) => g === t)) s = 2.5;
      else if (tags.some((g) => g.includes(t)) || name.includes(t)) s = 2;
      else if (item.id.includes(t) || label.includes(t)) s = 1;
      if (!s) { ok = false; break; }
      score += s;
    }
    if (ok) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}
