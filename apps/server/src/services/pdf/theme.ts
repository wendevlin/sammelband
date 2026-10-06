// The PDF in Sammelband's light theme. Colours are the web app's OKLCH tokens
// (apps/web/src/routes/layout.css) converted to sRGB once; the page is white.

export const COLORS = {
  text: "#2F1C1A", // --foreground
  primary: "#7B1E2D", // --primary
  muted: "#6A554F", // --muted-foreground
  border: "#E3D4CC", // --border
  highlight: "#FCEAE0", // --highlight
  highlightBorder: "#E9B6AF", // --highlight-border
  paper: "#FAF6F1", // --background, the cover without a photo
  white: "#FFFFFF",
} as const;

/** Noto Sans for text, Playfair Display for titles, as in the app. */
export const FONT_FILES = {
  body: "@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf",
  bodyItalic: "@expo-google-fonts/noto-sans/400Regular_Italic/NotoSans_400Regular_Italic.ttf",
  bodyBold: "@expo-google-fonts/noto-sans/600SemiBold/NotoSans_600SemiBold.ttf",
  bodyBoldItalic: "@expo-google-fonts/noto-sans/600SemiBold_Italic/NotoSans_600SemiBold_Italic.ttf",
  heading: "@expo-google-fonts/playfair-display/400Regular/PlayfairDisplay_400Regular.ttf",
  headingItalic:
    "@expo-google-fonts/playfair-display/400Regular_Italic/PlayfairDisplay_400Regular_Italic.ttf",
} as const;

export type FontKey = keyof typeof FONT_FILES;

/** The bold/italic variant of a body font. */
export function bodyFont(bold: boolean, italic: boolean): FontKey {
  if (bold) return italic ? "bodyBoldItalic" : "bodyBold";
  return italic ? "bodyItalic" : "body";
}
