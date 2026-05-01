/**
 * Browse Jobs directory: map canonical EN taxonomy (shared with API / DB)
 * to translated labels via jobsDir.taxonomy.* locale keys.
 */
import type { TFunction } from 'i18next';

import {
  ADJACENT_SKILLS,
  CATEGORIES,
  SKILL_TILES,
  type SkillTile,
} from '../types/helperDirectory';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function translateJobCategory(t: TFunction, categoryEn: string): string {
  const key = `jobsDir.taxonomy.categories.${slugify(categoryEn)}`;
  return t(key, { defaultValue: categoryEn });
}

export function translateJobSkill(t: TFunction, skillEn: string): string {
  const key = `jobsDir.taxonomy.skills.${slugify(skillEn)}`;
  return t(key, { defaultValue: skillEn });
}

export function translateSkillTileLabel(t: TFunction, tileId: string): string {
  return t(`jobsDir.taxonomy.tiles.${tileId}.label`, {
    defaultValue: SKILL_TILES.find((x) => x.id === tileId)?.label ?? tileId,
  });
}

export function translateSkillTileDesc(t: TFunction, tileId: string): string {
  return t(`jobsDir.taxonomy.tiles.${tileId}.desc`, {
    defaultValue: SKILL_TILES.find((x) => x.id === tileId)?.desc ?? '',
  });
}

/** Skill tiles with translated label, description, and sub-skills (category stays EN for filters/API). */
export function getSkillTilesTranslated(t: TFunction): Array<
  SkillTile & { label: string; desc: string; subSkills: string[] }
> {
  return SKILL_TILES.map((tile) => ({
    ...tile,
    label: translateSkillTileLabel(t, tile.id),
    desc: translateSkillTileDesc(t, tile.id),
    subSkills: tile.subSkills.map((sk) => translateJobSkill(t, sk)),
  }));
}

/** Adjacent category names translated for empty-state suggestions (keys are EN). */
export function translateAdjacentCategories(t: TFunction, categoryEn: string): string[] {
  const adjacent = ADJACENT_SKILLS[categoryEn] ?? [];
  return adjacent.map((c) => translateJobCategory(t, c));
}

export { CATEGORIES as JOB_CATEGORY_KEYS_EN };
