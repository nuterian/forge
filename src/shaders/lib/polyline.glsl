// Screen-space polyline expansion — "ink strokes".
//
// gl.LINES is pinned to 1px on every desktop driver, far too thin for the
// poster look. Instead each point is emitted twice and pushed sideways here,
// along the screen-space normal, giving crisp constant-width strokes that
// don't thin out with distance.

vec4 expandPolyline(
  vec4 clipCurr, vec4 clipPrev, vec4 clipNext,
  float side, vec2 resolution, float lineWidth
) {
  float aspect = resolution.x / resolution.y;

  // Perspective divide to NDC, then correct for aspect so the width is uniform.
  vec2 currS = clipCurr.xy / max(abs(clipCurr.w), 1e-6); currS.x *= aspect;
  vec2 prevS = clipPrev.xy / max(abs(clipPrev.w), 1e-6); prevS.x *= aspect;
  vec2 nextS = clipNext.xy / max(abs(clipNext.w), 1e-6); nextS.x *= aspect;

  vec2 dirA = currS - prevS;
  vec2 dirB = nextS - currS;
  float lenA = length(dirA);
  float lenB = length(dirB);

  // Endpoints (prev == curr, or next == curr) fall back to the one real direction.
  vec2 dir;
  if (lenA < 1e-7 && lenB < 1e-7) dir = vec2(1.0, 0.0);
  else if (lenA < 1e-7)           dir = dirB / lenB;
  else if (lenB < 1e-7)           dir = dirA / lenA;
  else                            dir = normalize(dirA / lenA + dirB / lenB);

  vec2 normal = vec2(-dir.y, dir.x);

  // Miter the joint so the stroke keeps constant thickness around corners,
  // clamped so that near-reversals don't shoot the vertex off to infinity.
  float miter = 1.0;
  if (lenA > 1e-7 && lenB > 1e-7) {
    vec2 tangentA = dirA / lenA;
    float cosHalf = dot(normal, vec2(-tangentA.y, tangentA.x));
    miter = 1.0 / max(abs(cosHalf), 0.35);
  }

  // Convert the pixel width into clip space at this vertex's depth.
  vec2 offset = normal * side * (lineWidth * miter) / resolution.y;
  offset.x /= aspect;

  vec4 outPos = clipCurr;
  outPos.xy += offset * clipCurr.w;
  return outPos;
}
