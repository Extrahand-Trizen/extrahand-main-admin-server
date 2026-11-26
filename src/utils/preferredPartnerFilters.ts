export interface LocationCatalogNode {
  id?: string;
  name?: string;
  areas?: LocationCatalogNode[];
  zones?: LocationCatalogNode[];
}

export interface PreferredPartnerAreaRuleFilterInput {
  area: string;
  category?: string;
  workTypes?: string[];
  preferredPartners?: unknown[];
}

export function normalizeAssignmentLocation(value: string | undefined): string {
  return String(value || '').toLowerCase().replace(/[-_\s]+/g, '');
}

export function getCityAssignmentAreaNames(city: LocationCatalogNode): string[] {
  const areas = city.areas?.length
    ? city.areas
    : (city.zones || []).flatMap((zone) => zone.areas || []);
  const names = [city.name, ...areas.map((area) => area.name)]
    .map((name) => String(name || '').trim())
    .filter(Boolean);
  const seen = new Set<string>();

  return names.filter((name) => {
    const normalized = normalizeAssignmentLocation(name);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function filterPreferredPartnerAreaRules(
  rules: PreferredPartnerAreaRuleFilterInput[],
  areaNames: string[],
  workType: 'hourly' | 'book_now',
  category?: string,
): PreferredPartnerAreaRuleFilterInput[] {
  const areaKeys = new Set(areaNames.map(normalizeAssignmentLocation));
  const categoryKey = normalizeAssignmentLocation(category);
  const filterCategory = workType === 'book_now' && categoryKey && categoryKey !== 'all';

  return rules.filter((rule) =>
    areaKeys.has(normalizeAssignmentLocation(rule.area)) &&
    (rule.workTypes || []).includes(workType) &&
    (!filterCategory || normalizeAssignmentLocation(rule.category) === categoryKey) &&
    (rule.preferredPartners || []).length > 0,
  );
}
