/**
 * Tool rentals browse directory: canonical EN strings from `toolDirectory.ts`
 * map to `toolRentalsDir.taxonomy.*` keys (slugified where needed).
 */
import type { TFunction } from 'i18next';

import { TOOL_TILES, type ToolCategoryTile } from '../types/toolDirectory';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function translateToolDirectoryCategory(t: TFunction, categoryEn: string): string {
  const key = `toolRentalsDir.taxonomy.categories.${slugify(categoryEn)}`;
  return t(key, { defaultValue: categoryEn });
}

export function translateToolDirectorySubType(t: TFunction, subTypeEn: string): string {
  const key = `toolRentalsDir.taxonomy.subTypes.${slugify(subTypeEn)}`;
  return t(key, { defaultValue: subTypeEn });
}

export function translateToolTileLabel(t: TFunction, tileId: string): string {
  return t(`toolRentalsDir.taxonomy.tiles.${tileId}.label`, {
    defaultValue: TOOL_TILES.find((x) => x.id === tileId)?.label ?? tileId,
  });
}

export function translateToolTileDesc(t: TFunction, tileId: string): string {
  return t(`toolRentalsDir.taxonomy.tiles.${tileId}.desc`, {
    defaultValue: TOOL_TILES.find((x) => x.id === tileId)?.desc ?? '',
  });
}

/** Tiles with translated label, description, and sub-type labels (category stays EN for API). */
export function getToolTilesTranslated(t: TFunction): Array<
  ToolCategoryTile & { label: string; desc: string; subTypes: string[] }
> {
  return TOOL_TILES.map((tile) => ({
    ...tile,
    label: translateToolTileLabel(t, tile.id),
    desc: translateToolTileDesc(t, tile.id),
    subTypes: tile.subTypes.map((st) => translateToolDirectorySubType(t, st)),
  }));
}
