# ClawX Application Icons

This directory contains the application icons for all supported platforms.

## Required Files

| File | Platform | Description |
|------|----------|-------------|
| `icon.svg` | Source | Vector source for all icons |
| `icon.icns` | macOS | Apple Icon Image format |
| `icon.ico` | Windows | Windows ICO format |
| `icon.png` | All | 512x512 PNG fallback |
| `16x16.png` - `512x512.png` | Linux | PNG set for Linux |
| `tray-icon-template.svg` | Source | macOS tray icon template source |
| `tray-icon-Template.png` | macOS | 22x22 status bar icon (note: "Template" suffix required) |

## Generating Icons

### Using the Script

```bash
# Make the script executable
chmod +x scripts/generate-icons.sh

# Run icon generation
./scripts/generate-icons.sh
```

### Prerequisites

**macOS:**
```bash
brew install imagemagick librsvg
```

**Linux:**
```bash
apt install imagemagick librsvg2-bin
```

**Windows:**
Install ImageMagick from https://imagemagick.org/

### Manual Generation

If you prefer to generate icons manually:

1. **macOS (.icns)**
   - Create a `.iconset` folder with properly named PNGs
   - Run: `iconutil -c icns -o icon.icns ClawX.iconset`

2. **Windows (.ico)**
   - Use ImageMagick: `convert icon_16.png icon_32.png icon_64.png icon_128.png icon_256.png icon.ico`

3. **Linux (PNGs)**
   - Generate PNGs at: 16, 32, 48, 64, 128, 256, 512 pixels

## Design Guidelines

### Application Icon
- **Corner Radius**: ~20% of width (200px on 1024px canvas)
- **Foreground**: White claw symbol with "X" accent
- **Safe Area**: Keep 10% margin from edges

### macOS Tray Icon
- **Format**: Single-color (black) on transparent background
- **Size**: 22x22 pixels (system automatically handles @2x retina)
- **Naming**: Must end with "Template.png" for automatic template mode
- **Design**: Simplified monochrome version of main icon (ClawX logo)
- **Source**: Use `tray-icon-template.svg` as the source
- **Important**: Must be pure black (#000000) on transparent background - no gradients or colors

## Updating the Icon

1. Edit `icon.svg` with your vector editor (Figma, Illustrator, Inkscape)
2. For macOS tray icon, edit `tray-icon-template.svg` (must be single-color black on transparent)
3. Run `node scripts/generate-icons.mjs`
4. Verify generated icons look correct
5. Commit all generated files
