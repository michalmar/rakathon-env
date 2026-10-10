# Rakathon portal design

The portal uses a light-first modern developer-workspace visual system. It
keeps the established red and blue identity colors without imitating the
institutional composition of VZP.cz.

## Visual language

- Deep blue for structure, access state and primary controls.
- Focused red for identity signals and high-value emphasis.
- Airy light surfaces with precise rounded geometry and restrained depth.
- Neutral system typography optimized for fast scanning and code-adjacent work.
- Yellow only for warnings that require immediate attention.

## Composition

- A compact workspace bar identifies the portal, navigation and tenant boundary.
- Official VZP and Microsoft marks identify Rakathon's supporting organizations;
  the portal does not invent a competing event logo.
- A focused blue opening field states the task without promotional copy.
- Model credentials use collapsed-by-default disclosure panels, keeping the
  inventory compact while exposing copy controls on demand.
- Each collapsed model summary identifies its provider and uses a distinct
  globe or EU-zone symbol for Global Standard versus Data Zone deployment.
- VZP challenge data uses a clear table and separate download guide.

## Interaction and accessibility

- Light mode is always the default; `?scoutTheme=dark` remains available for
  explicit testing.
- All actions retain visible keyboard focus and descriptive accessible names.
- Sensitive keys load only on reveal or copy and hide when the page loses focus.
- Mobile layouts preserve the same information order and avoid horizontal
  overflow.
