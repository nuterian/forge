/**
 * How the shared body shader patterns a surface. Lives here rather than with
 * any one chapter's data because the ids are the body.frag contract: every
 * chapter that draws a rock, a gas giant or an ice moon speaks these three.
 */

export type SurfaceStyle = 'rocky' | 'banded' | 'icy';

export const SURFACE_STYLE_ID: Record<SurfaceStyle, number> = {
  rocky: 0,
  banded: 1,
  icy: 2,
};
